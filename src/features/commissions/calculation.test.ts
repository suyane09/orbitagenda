import { describe, expect, it } from 'vitest'
import { accruedCommission, newCommissionAmount } from './calculation'

describe('accruedCommission', () => {
  it('calcula 40% do recebido, não do valor ainda não pago', () => {
    expect(accruedCommission({ mode: 'percentage', basisPoints: 4000 }, 10000, 2500)).toBe(1000)
    expect(accruedCommission({ mode: 'percentage', basisPoints: 4000 }, 10000, 10000)).toBe(4000)
  })
  it('limita a base ao preço do serviço', () => {
    expect(accruedCommission({ mode: 'percentage', basisPoints: 4000 }, 10000, 15000)).toBe(4000)
  })
  it('calcula comissão fixa proporcional aos recebimentos', () => {
    expect(accruedCommission({ mode: 'fixed', fixedCents: 2000 }, 10000, 5000)).toBe(1000)
    expect(accruedCommission({ mode: 'fixed', fixedCents: 2000 }, 10000, 10000)).toBe(2000)
  })
  it('não gera comissão com regra none ou preço zero', () => {
    expect(accruedCommission({ mode: 'none' }, 10000, 10000)).toBe(0)
    expect(accruedCommission({ mode: 'percentage', basisPoints: 4000 }, 0, 10000)).toBe(0)
  })
  it('calcula variação negativa após estorno e evita duplicação por parcelas', () => {
    const rule = { mode: 'percentage' as const, basisPoints: 4000 }
    expect(newCommissionAmount(rule, 10000, 10000, 4000)).toBe(0)
    expect(newCommissionAmount(rule, 10000, 5000, 4000)).toBe(-2000)
  })
  it('rejeita percentuais inválidos e valores negativos', () => {
    expect(() => accruedCommission({ mode: 'percentage', basisPoints: 10001 }, 10000, 10000)).toThrow()
    expect(() => accruedCommission({ mode: 'percentage', basisPoints: 4000 }, -1, 10000)).toThrow()
  })
})
