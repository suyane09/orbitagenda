import { describe, expect, it } from 'vitest'
const fsSpecifier = 'node:fs'
const { readFileSync } = await import(/* @vite-ignore */ fsSpecifier)
import { brazilBillingDate } from '../../supabase/functions/_shared/billing-date'

const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')

function configFor(name: string) {
  const head = '[functions.' + name + ']'
  const start = config.indexOf(head)
  if (start < 0) throw new Error('missing_supabase_function_config:' + name)
  const rest = config.slice(start + head.length)
  const end = rest.search(/^\s*\[[^\]]+\]/m)
  return end >= 0 ? rest.slice(0, end) : rest
}
describe('Asaas production gateway and business dates', () => {
  it('allows Asaas webhook through gateway but authenticates with provider token in handler', () => {
    expect(configFor('asaas-webhook')).toMatch(/^verify_jwt\s*=\s*false\s*$/m)
  })
  it('allows scheduled reconciliation with custom x-reconcile-token authentication', () => {
    expect(configFor('asaas-reconcile')).toMatch(/^verify_jwt\s*=\s*false\s*$/m)
  })
  it('keeps creation of a recurring subscription protected by Supabase JWT', () => {
    expect(configFor('asaas-subscribe')).toMatch(/^verify_jwt\s*=\s*true\s*$/m)
  })
  it('uses Brazilian local day near midnight UTC', () => {
    expect(brazilBillingDate(new Date('2026-10-25T01:30:00.000Z'))).toBe('2026-10-24')
    expect(brazilBillingDate(new Date('2026-10-25T03:30:00.000Z'))).toBe('2026-10-25')
  })
  it('handles historical daylight savings without assuming fixed GMT-3', () => {
    expect(brazilBillingDate(new Date('2018-12-01T02:30:00.000Z'))).toBe('2018-12-01')
  })
  it('rejects invalid system date instead of producing an invalid dueDate', () => {
    expect(() => brazilBillingDate(new Date('not a date'))).toThrow('invalid_billing_date')
  })
})
