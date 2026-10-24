import { describe, expect, it } from 'vitest'
import { planPayment, reconcileSubscription, verifiedEventFor } from '../../supabase/functions/asaas-reconcile/reconcile'

const today = '2026-10-24'
const base = { subId: 'sub_1', env: 'sandbox', today }
const local = (o = {}) => ({ status: 'active', payment_due_at: null, last_paid_due_date: null, ...o })
const pay = (o = {}) => ({ id: 'pay_1', status: 'PENDING', value: 49, dueDate: '2026-10-30', ...o })

describe('reconciliação Asaas · regras puras', () => {
  it('mapeia o estado real do Asaas para o evento', () => {
    expect(verifiedEventFor(pay({ status: 'RECEIVED' }))).toBe('PAYMENT_RECEIVED')
    expect(verifiedEventFor(pay({ status: 'REFUNDED' }))).toBe('PAYMENT_REFUNDED')
    expect(verifiedEventFor(pay({ status: 'CHARGEBACK_DISPUTE' }))).toBe('PAYMENT_CHARGEBACK_REQUESTED')
    expect(verifiedEventFor(pay({ deleted: true, status: 'PENDING' }))).toBe('PAYMENT_DELETED')
    expect(verifiedEventFor(pay())).toBeNull()
  })
  it('ids determinísticos (idempotência) e valores em centavos', () => {
    const a = planPayment(pay({ status: 'RECEIVED', value: 49.9 }), 'sub_1', 'sandbox', today)!
    expect(a.args.p_event_id).toBe('recon_pay_1_PAYMENT_RECEIVED')
    expect(a.args.p_amount_cents).toBe(4990)
    expect(planPayment(pay({ status: 'OVERDUE', value: -1 }), 'sub_1', 'sandbox', today)).toBeNull()
    expect(planPayment(pay({ status: 'RECEIVED', dueDate: undefined }), 'sub_1', 'sandbox', today)).toBeNull()
  })
  it('cobrança atrasada com contrato local ativo é divergência e reaplica com id novo', () => {
    const r = reconcileSubscription({ ...base, local: local(), provider: { status: 'ACTIVE' },
      payments: [pay({ status: 'OVERDUE', dueDate: '2026-10-10' })] })
    expect(r.divergences.map((d) => d.type)).toContain('overdue_not_blocked')
    expect(r.plans[0]?.args.p_event_id).toBe(`recon_pay_1_PAYMENT_OVERDUE_${today}`)
  })
  it('contrato bloqueado localmente mas pago no Asaas é reaplicado', () => {
    const r = reconcileSubscription({ ...base, local: local({ status: 'past_due', payment_due_at: '2026-10-01T03:00:00Z' }),
      provider: { status: 'ACTIVE' }, payments: [pay({ status: 'RECEIVED', dueDate: '2026-10-01' })] })
    expect(r.divergences.map((d) => d.type)).toContain('local_blocked_provider_paid')
    expect(r.plans[0]?.rpc).toBe('record_asaas_billing_event')
  })
  it('estorno pendente não bloqueia nem cria evento de estorno prematuro', () => {
    const r = reconcileSubscription({ ...base,
      local: local({ status: 'active', last_paid_due_date: '2026-10-20' }),
      provider: { status: 'ACTIVE' },
      payments: [pay({ status: 'REFUND_IN_PROGRESS', dueDate: '2026-10-20' })],
    })
    expect(r.divergences.map((d) => d.type)).toContain('refund_pending_at_provider')
    expect(r.plans).toHaveLength(0)
    expect(verifiedEventFor(pay({ status: 'REFUND_IN_PROGRESS' }))).toBeNull()
  })
  it('estorno parcial requer revisão e não equivale a estorno integral', () => {
    const r = reconcileSubscription({ ...base,
      local: local(), provider: { status: 'ACTIVE' },
      payments: [pay({ status: 'PARTIALLY_REFUNDED', dueDate: '2026-10-20' })],
    })
    expect(r.divergences.map((d) => d.type)).toContain('partial_refund_requires_review')
    expect(r.plans).toHaveLength(0)
  })
  it('detecta cobrança ausente e assinatura inexistente no provedor', () => {
    const missing = reconcileSubscription({ ...base, local: local(), provider: { status: 'ACTIVE' },
      payments: [pay({ status: 'RECEIVED', dueDate: '2026-06-01' })] })
    expect(missing.divergences.map((d) => d.type)).toContain('missing_recent_charge')
    const gone = reconcileSubscription({ ...base, local: local(), provider: null, payments: [] })
    expect(gone.divergences[0]?.type).toBe('subscription_missing_at_provider')
    expect(gone.plans).toHaveLength(0)
  })
  it('assinatura cancelada no Asaas cancela localmente uma única vez', () => {
    const r = reconcileSubscription({ ...base, local: local(), provider: { deleted: true }, payments: [] })
    expect(r.plans[0]?.args.p_event_type).toBe('SUBSCRIPTION_DELETED')
    expect(reconcileSubscription({ ...base, local: local({ status: 'canceled' }), provider: { deleted: true }, payments: [] }).plans).toHaveLength(0)
  })
  it('não marca fatura antiga vencida como nova divergência depois de mensalidade recente paga', () => {
    const result = reconcileSubscription({ ...base,
      local: local({ status: 'active', last_paid_due_date: '2026-10-20' }),
      provider: { status: 'ACTIVE' },
      payments: [
        pay({ id: 'pay_antigo', status: 'OVERDUE', dueDate: '2026-09-20' }),
        pay({ id: 'pay_novo', status: 'RECEIVED', dueDate: '2026-10-20' }),
      ],
    })
    expect(result.divergences.map((d) => d.type)).not.toContain('overdue_not_blocked')
    expect(result.plans.find((p) => p.args.p_payment_id === 'pay_antigo')?.args.p_event_id)
      .toBe('recon_pay_antigo_PAYMENT_OVERDUE')
  })
  it('aplica em ordem cronológica de vencimento', () => {
    const r = reconcileSubscription({ ...base, local: local(), provider: { status: 'ACTIVE' }, payments: [
      pay({ id: 'pay_b', status: 'RECEIVED', dueDate: '2026-10-20' }), pay({ id: 'pay_a', status: 'RECEIVED', dueDate: '2026-09-20' })] })
    expect(r.plans.map((p) => p.args.p_payment_id)).toEqual(['pay_a', 'pay_b'])
  })
})
