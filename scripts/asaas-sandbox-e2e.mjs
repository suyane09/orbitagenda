/**
 * Homologacao financeira E2E - EXCLUSIVAMENTE Asaas Sandbox + Supabase Docker local.
 * Uso: node scripts/asaas-sandbox-e2e.mjs --execute
 * Opcional: --customer cus_... --scenario overdue|refund|cancel
 * NAO usa Vercel, Supabase remoto, nem chave de producao.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
if (!args.includes('--execute')) {
  console.error('Apenas modo explicito: node scripts/asaas-sandbox-e2e.mjs --execute')
  process.exit(2)
}
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}
const mode = option('--scenario', 'all')
assert.ok(['all', 'overdue', 'refund', 'cancel'].includes(mode), 'Cenario invalido')
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
assert.equal(env.ASAAS_ENVIRONMENT, 'sandbox', 'PROIBIDO: ASAAS_ENVIRONMENT diferente de sandbox')
assert.ok(env.ASAAS_API_KEY, 'ASAAS_API_KEY ausente em .env.local')
assert.ok(env.ASAAS_RECONCILE_TOKEN && env.ASAAS_RECONCILE_TOKEN.length >= 32, 'Token local de conciliacao ausente')
assert.match(env.VITE_SUPABASE_URL || '', /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/, 'VITE_SUPABASE_URL deve apontar APENAS para Supabase local')
if (env.SUPABASE_URL) {
  assert.match(env.SUPABASE_URL, /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/, 'SUPABASE_URL aponta fora do ambiente local')
}
const customerId = option('--customer', 'cus_000009677194')
assert.match(customerId, /^cus_[A-Za-z0-9]+$/, 'Customer ID Sandbox invalido')
const BASE = 'https://api-sandbox.asaas.com/v3'
const LOCAL = 'http://127.0.0.1:54321'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

async function api(path, method = 'GET', data) {
  const res = await fetch(BASE + path, {
    method, headers: {
      access_token: env.ASAAS_API_KEY,
      'User-Agent': 'OrbitAgenda-Sandbox-Homologacao/1.0',
      'Content-Type': 'application/json', Accept: 'application/json',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* empty/non-JSON */ }
  if (!res.ok) {
    const providerMessage = body?.errors?.map((x) => x.description).join('; ') || body?.message || ''
    throw new Error('Asaas HTTP ' + res.status + ' em ' + method + ' ' + path + ' ' + String(providerMessage).slice(0, 200))
  }
  return body
}
function sql(query) {
  return execFileSync('docker', [
    'exec', 'supabase_db_orbit-agenda', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-At', '-c', query,
  ], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
const safeId = (v, kind) => {
  assert.match(v || '', kind === 'sub' ? /^sub_[A-Za-z0-9]+$/ : /^pay_[A-Za-z0-9]+$/, 'ID Asaas inesperado')
  return v
}
async function reconcile() {
  const res = await fetch(LOCAL + '/functions/v1/asaas-reconcile', {
    method: 'POST',
    headers: { 'x-reconcile-token': env.ASAAS_RECONCILE_TOKEN, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(90000),
  })
  const body = await res.json()
  assert.equal(res.status, 200, 'Conciliacao HTTP ' + res.status + ': ' + JSON.stringify(body))
  assert.equal(body.errors, 0, 'Erros na conciliacao')
  return body
}
function state(f) {
  const v = sql("SELECT status || '|' || COALESCE(payment_due_at::text,'') || '|' || private.billing_allows_write(establishment_id)::text FROM public.establishment_subscriptions WHERE establishment_id='" + f.estId + "' AND asaas_subscription_id='" + f.subId + "' AND asaas_environment='sandbox';")
  assert.ok(v, 'Assinatura local nao encontrada')
  const [status, dueAt, canWrite] = v.split('|')
  return { status, dueAt, allowed: canWrite === 'true' || canWrite === 't' }
}
function expectState(f, status, allowed) {
  const actual = state(f)
  assert.equal(actual.status, status, 'Estado financeiro incorreto de ' + f.name)
  if (allowed !== undefined) assert.equal(actual.allowed, allowed, 'Guarda de escrita incorreta de ' + f.name)
  console.log('OK banco:', f.name, status, 'escrita=' + actual.allowed)
}
async function getPayment(subId) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const page = await api('/subscriptions/' + subId + '/payments?limit=20')
    const found = page?.data?.find((p) => p.subscription === subId && p.id?.startsWith('pay_'))
    if (found) return found
    await sleep(1250)
  }
  throw new Error('Asaas nao gerou a primeira cobranca no periodo de consulta')
}
async function verifyPaymentStatus(id, expected, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const p = await api('/payments/' + id)
    if (expected.includes(p.status)) return p
    await sleep(1250)
  }
  throw new Error('Pagamento ' + id + ' nao atingiu status ' + expected.join('/') + ' no Asaas')
}
async function webhookSeen(payId, eventTypes) {
  for (let i = 0; i < 12; i++) {
    const n = Number(sql("SELECT count(*) FROM public.asaas_payment_events WHERE payment_id='" + payId + "' AND environment='sandbox' AND event_type=ANY(ARRAY[" + eventTypes.map((x) => "'" + x + "'").join(',') + "]);"))
    if (n > 0) return true
    await sleep(1500)
  }
  return false
}
const fixtures = []
async function fixture(name) {
  const estId = randomUUID()
  const slug = 'orbit-homolog-' + estId.slice(0, 12)
  const sub = await api('/subscriptions', 'POST', {
    customer: customerId, billingType: 'PIX', value: 49.9,
    cycle: 'MONTHLY', nextDueDate: localDate,
    description: 'TESTE ISOLADO OrbitAgenda ' + name,
    externalReference: estId,
  })
  const subId = safeId(sub?.id, 'sub')
  console.log('Sandbox criado:', name, subId, '(NAO e assinatura principal)')
  // Somente banco Docker local. IDs sao gerados/verificados; nenhum dado real e alterado.
  sql("BEGIN; INSERT INTO public.establishments(id,name,slug,business_type,timezone) VALUES ('" + estId + "','Orbit Teste " + name + "','" + slug + "','barbershop','America/Maceio'); INSERT INTO public.establishment_subscriptions(establishment_id,plan_id,status,notes,asaas_customer_id,asaas_subscription_id,asaas_environment) SELECT '" + estId + "',id,'past_due','HOMOLOGACAO DESCARTAVEL','" + customerId + "','" + subId + "','sandbox' FROM public.subscription_plans WHERE code='inicial_4990' AND monthly_price_cents=4990 LIMIT 1; COMMIT;")
  const f = { name, estId, subId, payId: safeId((await getPayment(subId)).id, 'pay') }
  fixtures.push(f)
  expectState(f, 'past_due', false)
  return f
}
async function testOverdue() {
  const f = await fixture('Vencimento')
  await api('/sandbox/payment/' + f.payId + '/overdue', 'POST')
  await verifyPaymentStatus(f.payId, ['OVERDUE'])
  const webhook = await webhookSeen(f.payId, ['PAYMENT_OVERDUE'])
  await reconcile()
  expectState(f, 'past_due', true) // cinco dias de tolerancia
  sql("UPDATE public.establishment_subscriptions SET payment_due_at=((now() AT TIME ZONE 'America/Sao_Paulo')::date-10)::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'past_due', false) // atraso superior a 5 dias
  await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
  await verifyPaymentStatus(f.payId, ['CONFIRMED', 'RECEIVED'])
  await webhookSeen(f.payId, ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
  await reconcile()
  expectState(f, 'active', true)
  console.log(webhook ? 'OK: webhook de vencimento entregue' : 'AVISO: vencimento corrigido por conciliacao; webhook de vencimento NAO comprovado')
}
async function testRefund() {
  const f = await fixture('Estorno')
  // O Sandbox pode exigir saldo adicional para estorno integral; esta cobranca
  // avulsa NAO e vinculada ao OrbitAgenda e nao movimenta dinheiro real.
  const reserve = await api('/payments', 'POST', {
    customer: customerId, billingType: 'PIX', value: 100,
    dueDate: localDate, description: 'SALDO FICTICIO teste estorno OrbitAgenda',
  })
  const reserveId = safeId(reserve?.id, 'pay')
  await api('/sandbox/payment/' + reserveId + '/confirm', 'POST')
  await verifyPaymentStatus(reserveId, ['CONFIRMED', 'RECEIVED'])
  await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
  await verifyPaymentStatus(f.payId, ['CONFIRMED', 'RECEIVED'])
  await webhookSeen(f.payId, ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
  await reconcile()
  expectState(f, 'active', true)
  await api('/payments/' + f.payId + '/refund', 'POST', {})
  await verifyPaymentStatus(f.payId, ['REFUNDED'], 32)
  const webhook = await webhookSeen(f.payId, ['PAYMENT_REFUNDED'])
  await reconcile()
  expectState(f, 'past_due', true)
  sql("UPDATE public.establishment_subscriptions SET payment_due_at=((now() AT TIME ZONE 'America/Sao_Paulo')::date-10)::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'past_due', false)
  console.log(webhook ? 'OK: webhook de estorno entregue' : 'AVISO: estorno corrigido por conciliacao; webhook de estorno NAO comprovado')
}
async function testCancel() {
  const f = await fixture('Cancelamento')
  await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
  await verifyPaymentStatus(f.payId, ['CONFIRMED', 'RECEIVED'])
  await reconcile()
  expectState(f, 'active', true)
  await api('/subscriptions/' + f.subId, 'DELETE')
  await reconcile()
  expectState(f, 'canceled', false)
  // Simula um periodo pago ate o futuro somente na assinatura da fixture local.
  sql("UPDATE public.establishment_subscriptions SET current_period_end=now()+interval '7 days' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'canceled', true)
  // Sem alteracao do relogio real nem do provedor: periodo encerrado no banco de TESTE.
  sql("UPDATE public.establishment_subscriptions SET started_at=now()-interval '30 days', current_period_end=now()-interval '1 day' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'canceled', false)
}
async function main() {
  console.log('Ambiente protegido: Asaas SANDBOX e Docker Supabase LOCAL')
  assert.equal(sql("SELECT current_database()"), 'postgres', 'Banco local incorreto')
  assert.equal(sql("SELECT count(*) FROM public.subscription_plans WHERE code='inicial_4990' AND monthly_price_cents=4990"), '1', 'Plano local inicial 49,90 indisponivel')
  const c = await api('/customers/' + customerId)
  assert.equal(c?.id, customerId, 'Cliente Sandbox nao identificado')
  // Endpoint local autenticado: um teste de credencial e configuracao, sem modificar estado.
  const probe = await fetch(LOCAL + '/functions/v1/asaas-reconcile', { method: 'GET', signal: AbortSignal.timeout(5000) })
  assert.equal(probe.status, 405, 'Edge Function asaas-reconcile nao esta servida localmente')
  const cases = {
    overdue: testOverdue, refund: testRefund, cancel: testCancel,
  }
  let failed = 0
  for (const [key, test] of Object.entries(cases)) {
    if (mode !== 'all' && mode !== key) continue
    try {
      console.log('\nTESTE ' + key.toUpperCase())
      await test()
      console.log('PASSOU: ' + key)
    } catch (error) {
      failed++
      console.error('FALHOU ' + key + ': ' + error.message)
    }
  }
  console.log('\nResumo: ' + (Object.keys(cases).length - (mode === 'all' ? 0 : 2) - failed) + ' cenario(s) aprovado(s); ' + failed + ' falha(s).')
  console.log('Fixtures Sandbox criadas:', fixtures.map((f) => f.subId).join(', ') || 'nenhuma')
  console.log('Assinatura principal de homologacao NAO foi modificada pelo script.')
  if (failed) process.exitCode = 1
}
main().catch((err) => { console.error('PRECHECK FALHOU:', err.message); process.exitCode = 1 })
