import { describe, expect, it } from 'vitest'
import { dayBounds, minutesOfDay } from './time'
import { isSecretKey } from './env'
import { establishmentSchema, signUpSchema } from './validation'
import { describeError } from './errors'

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.y`

describe('isSecretKey', () => {
  it('bloqueia service_role e sb_secret_', () => {
    expect(isSecretKey(jwt('service_role'))).toBe(true)
    expect(isSecretKey('sb_secret_abc')).toBe(true)
  })
  it('aceita anon e publishable', () => {
    expect(isSecretKey(jwt('anon'))).toBe(false)
    expect(isSecretKey('sb_publishable_abc')).toBe(false)
    expect(isSecretKey('lixo')).toBe(false)
  })
})

describe('dayBounds', () => {
  it('usa o fuso do estabelecimento (Brasília, UTC-3)', () => {
    const { start, end } = dayBounds(new Date('2026-10-21T02:30:00Z'), 'America/Sao_Paulo') // ainda 20/10 23:30 local
    expect(start.toISOString()).toBe('2026-10-20T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-21T03:00:00.000Z')
  })
  it('funciona em outro fuso (Manaus, UTC-4)', () => {
    const { start } = dayBounds(new Date('2026-10-21T15:00:00Z'), 'America/Manaus')
    expect(start.toISOString()).toBe('2026-10-21T04:00:00.000Z')
  })
  it('minutesOfDay respeita o fuso', () => {
    expect(minutesOfDay(new Date('2026-10-21T15:30:00Z'), 'America/Sao_Paulo')).toBe(12 * 60 + 30)
  })
})

describe('validação', () => {
  it('senha exige letra e número e confirmação', () => {
    const base = { fullName: 'Ana Souza', email: 'ana@x.com' }
    expect(signUpSchema.safeParse({ ...base, password: 'abcdefgh', confirm: 'abcdefgh' }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...base, password: 'abcd1234', confirm: 'abcd12345' }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...base, password: 'abcd1234', confirm: 'abcd1234' }).success).toBe(true)
  })
  it('estabelecimento só aceita fuso da lista e não aceita establishment_id', () => {
    const ok = establishmentSchema.safeParse({ name: 'Barbearia Alfa', businessType: 'barbershop', phone: '', timezone: 'America/Maceio' })
    expect(ok.success).toBe(true)
    expect(establishmentSchema.safeParse({ name: 'X', businessType: 'barbershop', timezone: 'Marte/Olympus' }).success).toBe(false)
  })
})

describe('describeError', () => {
  it('traduz erros conhecidos e esconde detalhes desconhecidos', () => {
    expect(describeError({ message: 'Invalid login credentials' })).toMatch(/incorretos/)
    expect(describeError({ message: 'establishment_limit_reached' })).toMatch(/limite/)
    expect(describeError({ message: 'select * from secret_table failed' })).toBe('Não foi possível concluir. Tente novamente.')
  })
})
