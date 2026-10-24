// Lógica pura da reconciliação Asaas ↔ banco.
export interface AsaasPayment { id: string; status: string; value: number; dueDate?: string; deleted?: boolean }
export interface LocalSub { status: string; payment_due_at: string | null; last_paid_due_date: string | null }
export interface Plan {
  rpc: 'record_asaas_billing_event' | 'record_asaas_billing_reversal'
  args: { p_event_id: string; p_asaas_subscription_id: string; p_payment_id: string; p_event_type: string;
    p_payment_status: string; p_amount_cents: number; p_environment: string; p_due_date: string | null }
}
export interface Divergence { type: string; subscription_id: string; payment_id?: string; detail?: string }

const CHARGEBACK = ['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000)

export function verifiedEventFor(p: AsaasPayment): string | null {
  if (p.deleted === true) return 'PAYMENT_DELETED'
  if (p.status === 'REFUNDED') return 'PAYMENT_REFUNDED'
  if (CHARGEBACK.includes(p.status)) return 'PAYMENT_CHARGEBACK_REQUESTED'
  if (p.status === 'RECEIVED') return 'PAYMENT_RECEIVED'
  if (p.status === 'CONFIRMED') return 'PAYMENT_CONFIRMED'
  if (p.status === 'OVERDUE') return 'PAYMENT_OVERDUE'
  return null
}
export function planPayment(p: AsaasPayment, subId: string, env: string, today: string, fresh = false): Plan | null {
  const ev = verifiedEventFor(p)
  if (!ev || typeof p.id !== 'string' || !Number.isFinite(p.value) || p.value < 0) return null
  if (!p.dueDate || !DATE.test(p.dueDate)) return null
  const reversal = ev === 'PAYMENT_REFUNDED' || ev === 'PAYMENT_CHARGEBACK_REQUESTED' || ev === 'PAYMENT_DELETED'
  return {
    rpc: reversal ? 'record_asaas_billing_reversal' : 'record_asaas_billing_event',
    args: { p_event_id: `recon_${p.id}_${ev}${fresh ? '_' + today : ''}`, p_asaas_subscription_id: subId, p_payment_id: p.id,
      p_event_type: ev, p_payment_status: p.deleted ? 'DELETED' : p.status, p_amount_cents: Math.round(p.value * 100),
      p_environment: env, p_due_date: p.dueDate },
  }
}
const isPaid = (p: AsaasPayment) => !p.deleted && (p.status === 'RECEIVED' || p.status === 'CONFIRMED')
export function reconcileSubscription(opts: {
  subId: string; env: string; today: string; local: LocalSub
  provider: { status?: string; deleted?: boolean } | null; payments: AsaasPayment[]
}): { plans: Plan[]; divergences: Divergence[] } {
  const { subId, env, today, local, provider, payments } = opts
  const divergences: Divergence[] = []
  const plans: Plan[] = []
  if (!provider) return { plans, divergences: [{ type: 'subscription_missing_at_provider', subscription_id: subId }] }
  if (provider.deleted === true || provider.status === 'INACTIVE') {
    if (local.status !== 'canceled') {
      divergences.push({ type: 'subscription_inactive_at_provider', subscription_id: subId, detail: `local=${local.status}` })
      plans.push({ rpc: 'record_asaas_billing_reversal', args: { p_event_id: `recon_${subId}_SUBSCRIPTION_DELETED`,
        p_asaas_subscription_id: subId, p_payment_id: subId, p_event_type: 'SUBSCRIPTION_DELETED',
        p_payment_status: 'DELETED', p_amount_cents: 0, p_environment: env, p_due_date: null } })
    }
    return { plans, divergences }
  }
  const live = payments.filter((p) => !p.deleted && p.dueDate && DATE.test(p.dueDate))
  const sorted = [...payments].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
  const blockedLocally = ['past_due', 'suspended'].includes(local.status) && !!local.payment_due_at
  const localDue = local.payment_due_at ? local.payment_due_at.slice(0, 10) : null
  if (provider.status === 'ACTIVE' && !live.some((p) => dayDiff(p.dueDate!, today) >= -35))
    divergences.push({ type: 'missing_recent_charge', subscription_id: subId })
  for (const p of sorted) {
    let fresh = false
    // Not a completed refund: do NOT revoke a paid plan, but record an
    // actionable audit divergence until Asaas confirms the final outcome.
    if (p.status === 'REFUND_IN_PROGRESS' || p.status === 'REFUND_REQUESTED') {
      divergences.push({ type: 'refund_pending_at_provider', subscription_id: subId, payment_id: p.id })
    } else if (p.status === 'PARTIALLY_REFUNDED') {
      divergences.push({ type: 'partial_refund_requires_review', subscription_id: subId, payment_id: p.id })
    }
    // A previous overdue invoice must not become a new divergence after a newer invoice was paid.
    if (p.status === 'OVERDUE' && !p.deleted && local.status === 'active'
      && (!local.last_paid_due_date || p.dueDate! > local.last_paid_due_date)) {
      divergences.push({ type: 'overdue_not_blocked', subscription_id: subId, payment_id: p.id }); fresh = true
    }
    if (isPaid(p) && blockedLocally && localDue && p.dueDate! >= localDue) {
      divergences.push({ type: 'local_blocked_provider_paid', subscription_id: subId, payment_id: p.id }); fresh = true
    }
    const plan = planPayment(p, subId, env, today, fresh)
    if (plan) plans.push(plan)
  }
  return { plans, divergences }
}
