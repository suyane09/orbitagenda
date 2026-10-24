import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { brazilBillingDate } from '../_shared/billing-date.ts'

const url = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const publishable = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const environment = Deno.env.get('ASAAS_ENVIRONMENT') ?? 'sandbox'
const apiBase = environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
const billingEnabled = Deno.env.get('ASAAS_BILLING_ENABLED') === 'true'
const allowedOrigin = Deno.env.get('ASAAS_ALLOWED_ORIGIN') ?? 'https://orbitagenda.vercel.app'
const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
const reply = (status: number, message: string, extras: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ message, ...extras }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
const cpfCnpj = (x: unknown): x is string => typeof x === 'string' && /^(\d{11}|\d{14})$/.test(x)
const getAdmin = () => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function requestAsaas(endpoint: string, method: string, data?: Record<string, unknown>) {
  const response = await fetch(apiBase + endpoint, {
    method,
    headers: {
      'access_token': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'OrbitAgenda/1.0 (+https://orbitagenda.vercel.app)',
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(14000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || typeof result !== 'object') {
    // API error details may contain personal data: never return or log them.
    throw new Error('asaas_upstream_failure')
  }
  return result as Record<string, unknown>
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return reply(405, 'Método não permitido.')
  if (!url || !serviceKey || !publishable || !apiKey || !billingEnabled
      || !['sandbox', 'production'].includes(environment)
      || (environment === 'production' && Deno.env.get('ASAAS_PRODUCTION_CONFIRMED') !== 'true')) {
    return reply(503, 'Asaas ainda não foi configurado neste ambiente.')
  }
  if (req.headers.get('origin') && req.headers.get('origin') !== allowedOrigin) return reply(403, 'Origem não permitida.')
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')
  if (!jwt) return reply(401, 'Entre na sua conta.')
  const admin = getAdmin()
  const { data: auth, error: authError } = await admin.auth.getUser(jwt)
  if (authError || !auth.user?.id) return reply(401, 'Sessão inválida.')
  const payload = await req.json().catch(() => null)
  if (!payload || !uuid(payload.establishmentId) || !cpfCnpj(payload.cpfCnpj)
      || !['PIX', 'BOLETO'].includes(payload.billingType)
      || payload.confirm !== true) {
    return reply(400, 'Confira os dados e confirme a autorização da assinatura.')
  }
  const estId: string = payload.establishmentId
  const { data: owner, error: ownerError } = await admin.from('memberships')
    .select('id').eq('user_id', auth.user.id).eq('establishment_id',estId)
    .eq('role','owner').eq('is_active',true).maybeSingle()
  if (ownerError || !owner) return reply(403, 'Somente o proprietário pode contratar.')
  const { data: sub, error: subError } = await admin.from('establishment_subscriptions')
    .select('establishment_id,plan_id,status,asaas_subscription_id,asaas_provisioning_started_at')
    .eq('establishment_id',estId).maybeSingle()
  if (subError || !sub) return reply(409, 'Um plano precisa ser atribuído pela administração antes da contratação.')
  if (!['trialing','active','past_due'].includes(sub.status)) return reply(409,'O plano está suspenso ou cancelado. Fale com a administração.')
  if (sub.asaas_subscription_id || sub.asaas_provisioning_started_at) {
    return reply(409, 'Assinatura já vinculada ou em conferência. Procure o suporte antes de tentar novamente.')
  }
  const { data: plan } = await admin.from('subscription_plans')
    .select('name,monthly_price_cents').eq('id',sub.plan_id).maybeSingle()
  if (!plan || !Number.isSafeInteger(plan.monthly_price_cents) || plan.monthly_price_cents <= 0) {
    return reply(409, 'O plano ainda não tem um preço válido definido.')
  }
  const { data: company } = await admin.from('establishments')
    .select('name').eq('id',estId).maybeSingle()
  if (!company) return reply(404, 'Estabelecimento não encontrado.')
  // Reserva atômica: se a API do Asaas falhar após criar um recurso, não tente novamente
  // automaticamente. O administrador deverá reconciliar os IDs no Asaas primeiro.
  const { data: reservation, error: reserveError } = await admin.from('establishment_subscriptions')
    .update({asaas_provisioning_started_at:new Date().toISOString(),asaas_environment:environment})
    .eq('establishment_id',estId).is('asaas_provisioning_started_at',null)
    .is('asaas_subscription_id',null).select('establishment_id').maybeSingle()
  if (reserveError || !reservation) return reply(409, 'Uma contratação já foi iniciada. Consulte o suporte.')
  try {
    // Customer is attached to the establishment and not duplicated on re-entry.
    const customer = await requestAsaas('/customers','POST',{
      name:company.name, cpfCnpj:payload.cpfCnpj,
      email:auth.user.email ?? undefined, externalReference:estId,
    })
    if (typeof customer.id !== 'string' || !customer.id.startsWith('cus_')) throw new Error('unexpected_customer')
    const nextDueDate = brazilBillingDate(new Date())
    const subscription = await requestAsaas('/subscriptions','POST',{
      customer:customer.id, billingType:payload.billingType,
      value:plan.monthly_price_cents / 100, nextDueDate, cycle:'MONTHLY',
      description:`Orbit Agenda — ${plan.name}`.slice(0,500), externalReference:estId,
    })
    if (typeof subscription.id !== 'string' || !subscription.id.startsWith('sub_')) throw new Error('unexpected_subscription')
    const { data: saved, error: saveError } = await admin.from('establishment_subscriptions')
      .update({asaas_customer_id:customer.id,asaas_subscription_id:subscription.id,asaas_synced_at:new Date().toISOString()})
      .eq('establishment_id',estId).not('asaas_provisioning_started_at','is',null)
      .is('asaas_subscription_id',null).select('establishment_id').maybeSingle()
    // Updating zero rows is not a success. Preserve the provisioning reservation
    // for manual recovery instead of creating an orphaned recurring charge.
    if (saveError || !saved) throw new Error('failed_to_persist_subscription')
    return reply(200,'Assinatura criada no Asaas. Aguarde a confirmação de pagamento.',{
      subscriptionId:subscription.id,environment,
    })
  } catch {
    return reply(502,'Não foi possível confirmar a criação no Asaas. Para evitar cobrança duplicada, novas tentativas foram bloqueadas até conferência pelo suporte.')
  }
})
