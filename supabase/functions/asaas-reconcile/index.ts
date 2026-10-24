import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { reconcileSubscription, type AsaasPayment, type LocalSub } from './reconcile.ts'
const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
const token = Deno.env.get('ASAAS_RECONCILE_TOKEN') ?? ''
const environment = Deno.env.get('ASAAS_ENVIRONMENT') ?? 'sandbox'
const apiBase = environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
const MAX_SUBSCRIPTIONS = 50
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
async function digestEquals(a: string, b: string) {
  const e = new TextEncoder()
  const x = new Uint8Array(await crypto.subtle.digest('SHA-256', e.encode(a)))
  const y = new Uint8Array(await crypto.subtle.digest('SHA-256', e.encode(b)))
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}
async function asaas(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(apiBase + path, { headers: { access_token: apiKey, 'User-Agent': 'OrbitAgenda/1.0' }, signal: AbortSignal.timeout(14000) })
  if (res.status === 404) return { status: 404, body: null }
  if (!res.ok) throw new Error('asaas_' + res.status)
  return { status: res.status, body: await res.json() }
}
async function listPayments(subId: string): Promise<AsaasPayment[]> {
  const out: AsaasPayment[] = []
  for (let offset = 0; offset < 1000; offset += 100) {
    const { body } = await asaas(`/subscriptions/${encodeURIComponent(subId)}/payments?limit=100&offset=${offset}`)
    out.push(...(body?.data ?? []))
    if (!body?.hasMore) break
  }
  return out
}
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { message: 'method_not_allowed' })
  if (!apiKey || token.length < 32 || !['sandbox', 'production'].includes(environment)
    || (environment === 'production' && Deno.env.get('ASAAS_PRODUCTION_CONFIRMED') !== 'true')
    || !Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return json(503, { message: 'not_configured' })
  const sent = req.headers.get('x-reconcile-token') ?? ''
  if (!sent || !(await digestEquals(sent, token))) return json(401, { message: 'unauthorized' })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: subs, error } = await admin.from('establishment_subscriptions')
    .select('establishment_id,asaas_subscription_id,status,payment_due_at,last_paid_due_date')
    .eq('asaas_environment', environment).not('asaas_subscription_id', 'is', null).neq('status', 'canceled')
    .order('asaas_synced_at', { ascending: true, nullsFirst: true }).limit(MAX_SUBSCRIPTIONS)
  if (error) return json(503, { message: 'database_unavailable' })
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  let applied = 0, errors = 0
  const divergences: unknown[] = []
  for (const s of subs ?? []) {
    const subId = s.asaas_subscription_id as string
    try {
      const prov = await asaas('/subscriptions/' + encodeURIComponent(subId))
      let provider = prov.body
      if (prov.status === 404) {
        // 404 alone is NOT evidence of cancellation. Confirm the exact ID in
        // Asaas's deleted-only list, scoped to this local establishment.
        const deleted = await asaas('/subscriptions?deletedOnly=true&externalReference='
          + encodeURIComponent(s.establishment_id) + '&limit=100')
        if (!Array.isArray(deleted.body?.data)) throw new Error('invalid_deleted_subscriptions')
        if (deleted.body.data.some((entry: { id?: string }) => entry?.id === subId)) {
          provider = { id: subId, deleted: true }
        }
      }
      const payments = provider && !provider.deleted ? await listPayments(subId) : []
      const local: LocalSub = { status: s.status, payment_due_at: s.payment_due_at, last_paid_due_date: s.last_paid_due_date }
      const result = reconcileSubscription({ subId, env: environment, today, local, provider, payments })
      divergences.push(...result.divergences)
      let subscriptionFailed = false
      for (const plan of result.plans) {
        const { data, error: rpcError } = await admin.rpc(plan.rpc, plan.args)
        if (rpcError) {
          errors++
          subscriptionFailed = true
          break
        }
        if (data === true) applied++
      }
      // A partial failure must not mark the subscription as successfully synced.
      if (!subscriptionFailed) {
        const { error: syncError } = await admin.from('establishment_subscriptions')
          .update({ asaas_synced_at: new Date().toISOString() })
          .eq('establishment_id', s.establishment_id)
        if (syncError) errors++
      }
    } catch { errors++ }
  }
  const { error: auditError } = await admin.rpc('record_asaas_reconciliation_run', {
    p_environment: environment, p_checked: subs?.length ?? 0,
    p_applied: applied, p_errors: errors, p_divergences: divergences,
  })
  if (auditError) return json(503, { message: 'reconciliation_audit_failed' })
  const summary = { checked: subs?.length ?? 0, applied, errors, divergences: divergences.length }
  // Non-2xx tells the caller/monitor that a partial reconciliation needs attention.
  return json(errors > 0 ? 503 : 200, summary)
})
