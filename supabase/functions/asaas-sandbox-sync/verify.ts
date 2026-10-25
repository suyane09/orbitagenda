export type PaymentRecord = {
  id?: unknown
  subscription?: unknown
  customer?: unknown
  status?: unknown
  value?: unknown
  dueDate?: unknown
  externalReference?: unknown
}

export type ExpectedPayment = {
  subscriptionId: string
  customerId: string
  establishmentId: string
  amountCents: number
}

export type VerifiedPaid = {
  paymentId: string
  dueDate: string
  status: 'RECEIVED' | 'CONFIRMED'
  amountCents: number
}

/** Accept only provider-fetched, paid, correctly-linked charges. */
export function verifyPaidSandboxCharge(payment: PaymentRecord, expected: ExpectedPayment): VerifiedPaid | null {
  if (typeof payment.id !== 'string' || !/^pay_[a-zA-Z0-9]+$/.test(payment.id)) return null
  if (payment.subscription !== expected.subscriptionId) return null
  if (payment.customer !== expected.customerId) return null
  if (payment.externalReference != null && payment.externalReference !== expected.establishmentId) return null
  if (payment.status !== 'RECEIVED' && payment.status !== 'CONFIRMED') return null
  if (typeof payment.value !== 'number' || !Number.isFinite(payment.value) || payment.value < 0) return null
  const amountCents = Math.round(payment.value * 100)
  if (amountCents !== expected.amountCents || Math.abs(payment.value * 100 - amountCents) > 0.001) return null
  if (typeof payment.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)) return null
  const [y,m,d] = payment.dueDate.split('-').map(Number)
  const checked = new Date(Date.UTC(y, m - 1, d))
  if (checked.getUTCFullYear() !== y || checked.getUTCMonth() !== m - 1 || checked.getUTCDate() !== d) return null
  return {paymentId:payment.id,dueDate:payment.dueDate,status:payment.status,amountCents}
}
