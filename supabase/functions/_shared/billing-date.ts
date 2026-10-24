/**
 * Resolve a date-only value in the timezone used by Asaas billing. Do not
 * subtract a fixed UTC offset: day boundaries and historical DST matter.
 */
export function brazilBillingDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('invalid_billing_date')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const find = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)?.value
  const year = find('year'), month = find('month'), day = find('day')
  if (!year || !month || !day) throw new Error('invalid_billing_date')
  return `${year}-${month}-${day}`
}
