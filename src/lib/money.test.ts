import { describe, expect, it } from 'vitest'
import { centsToInput, formatDuration, parseBRL } from './money'
import { professionalSchema, serviceSchema } from './validation'

describe('parseBRL', () => {
  it('aceita formatos brasileiros comuns', () => {
    expect(parseBRL('45')).toBe(4500)
    expect(parseBRL('45,5')).toBe(4550)
    expect(parseBRL('45,50')).toBe(4550)
    expect(parseBRL('R$ 1.234,56')).toBe(123456)
    expect(parseBRL('1.234')).toBe(123400)
    expect(parseBRL('45.50')).toBe(4550)
    expect(parseBRL('0')).toBe(0)
  })
  it('rejeita lixo, negativos e mais de 2 casas', () => {
    for (const v of ['', 'abc', '-5', '45,555', '1,2,3', '12..5', '1.23.456,7']) expect(parseBRL(v)).toBeNull()
  })
  it('não perde centavos por ponto flutuante', () => {
    expect(parseBRL('0,29')).toBe(29)
    expect(parseBRL('19,99')).toBe(1999)
  })
  it('centsToInput e formatDuration', () => {
    expect(centsToInput(4500)).toBe('45,00')
    expect(formatDuration(30)).toBe('30 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(95)).toBe('1 h 35 min')
  })
})

describe('serviceSchema', () => {
  const ok = { name: 'Corte', description: '', category: '', price: '45,00', duration: '30', isActive: true }
  it('aceita dados válidos', () => expect(serviceSchema.safeParse(ok).success).toBe(true))
  it('valida preço e duração', () => {
    expect(serviceSchema.safeParse({ ...ok, price: 'x' }).success).toBe(false)
    expect(serviceSchema.safeParse({ ...ok, price: '100.000,01' }).success).toBe(false)
    expect(serviceSchema.safeParse({ ...ok, duration: '4' }).success).toBe(false)
    expect(serviceSchema.safeParse({ ...ok, duration: '721' }).success).toBe(false)
    expect(serviceSchema.safeParse({ ...ok, duration: '30,5' }).success).toBe(false)
    expect(serviceSchema.safeParse({ ...ok, name: ' a ' }).success).toBe(false)
  })
})

describe('professionalSchema', () => {
  const ok = { name: 'João', bio: '', color: '#1B7F55', isActive: true, serviceIds: [] as string[] }
  it('valida nome, cor e limite de serviços', () => {
    expect(professionalSchema.safeParse(ok).success).toBe(true)
    expect(professionalSchema.safeParse({ ...ok, color: 'verde' }).success).toBe(false)
    expect(professionalSchema.safeParse({ ...ok, name: ' ' }).success).toBe(false)
    expect(professionalSchema.safeParse({ ...ok, serviceIds: Array(101).fill('a1000000-0000-4000-8000-000000000001') }).success).toBe(false)
  })
})
