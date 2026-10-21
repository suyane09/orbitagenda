import { describe, expect, it } from 'vitest'
import { customerSchema, findDuplicate, fold, formatPhone, phoneKey, whatsappUrl } from './customers'
import { describeError } from './errors'

describe('telefone', () => {
  it('chave ignora formatação e DDI 55', () => {
    expect(phoneKey('(79) 99999-0000')).toBe('79999990000')
    expect(phoneKey('+55 79 99999-0000')).toBe('79999990000')
    expect(phoneKey('55 79 3333-4444')).toBe('7933334444')
  })
  it('formata e gera link do WhatsApp', () => {
    expect(formatPhone('79999990000')).toBe('(79) 99999-0000')
    expect(formatPhone('7933334444')).toBe('(79) 3333-4444')
    expect(formatPhone('+1 202 555 0100')).toBe('+1 202 555 0100')
    expect(whatsappUrl('(79) 99999-0000')).toBe('https://wa.me/5579999990000')
    expect(whatsappUrl('12345')).toBeNull()
    expect(whatsappUrl(null)).toBeNull()
  })
})

describe('validação', () => {
  const ok = { fullName: 'Ana Souza', phone: '', email: '', notes: '' }
  it('só o nome é obrigatório', () => { expect(customerSchema.safeParse(ok).success).toBe(true) })
  it('rejeita nome curto, telefone inválido e e-mail inválido', () => {
    expect(customerSchema.safeParse({ ...ok, fullName: 'A' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, phone: '123' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, phone: 'abc12345678' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, email: 'abc' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...ok, notes: 'x'.repeat(1001) }).success).toBe(false)
  })
  it('aceita contato válido', () => {
    expect(customerSchema.safeParse({ ...ok, phone: '(79) 99999-0000', email: 'ana@exemplo.com' }).success).toBe(true)
  })
})

describe('duplicidade e busca', () => {
  const list = [{ id: '1', full_name: 'Ana', phone: '(79) 99999-0000', email: 'ana@x.com' }, { id: '2', full_name: 'Bia', phone: null, email: null }]
  it('detecta por telefone (qualquer formato) e e-mail (sem caixa)', () => {
    expect(findDuplicate(list, { phone: '+55 79 999990000', email: '' }, null)?.by).toBe('phone')
    expect(findDuplicate(list, { phone: '', email: 'ANA@x.com' }, null)?.by).toBe('email')
    expect(findDuplicate(list, { phone: '(79) 98888-1111', email: 'novo@x.com' }, null)).toBeNull()
  })
  it('ignora o próprio cliente na edição', () => {
    expect(findDuplicate(list, { phone: '79999990000', email: '' }, '1')).toBeNull()
  })
  it('busca ignora acentos e caixa', () => { expect(fold('JOÃO Ávila')).toBe('joao avila') })
})

describe('erros de clientes', () => {
  it('traduz duplicidade', () => {
    expect(describeError({ message: 'duplicate key value violates unique constraint "customers_phone_uq"', code: '23505' })).toMatch(/telefone/)
    expect(describeError({ message: 'duplicate key value violates unique constraint "customers_email_uq"', code: '23505' })).toMatch(/e-mail/)
  })
})
