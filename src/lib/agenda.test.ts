import { describe, expect, it } from 'vitest'
import { addDays, groupByDate, isActive, layoutLanes, timeToMinutes, weekDays, zoned } from './agenda'

describe('agenda', () => {
  it('semana vai de segunda a domingo', () => {
    expect(weekDays('2026-10-21')[0]).toBe('2026-10-19') // quarta → segunda
    expect(weekDays('2026-10-25')[0]).toBe('2026-10-19') // domingo pertence à semana que termina nele
    expect(weekDays('2026-10-25')[6]).toBe('2026-10-25')
  })
  it('addDays atravessa mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('usa o fuso do estabelecimento, não o do navegador', () => {
    expect(zoned('2026-10-21T02:30:00Z', 'America/Manaus')).toEqual({ date: '2026-10-20', time: '22:30' })
    const g = groupByDate([{ starts_at: '2026-10-21T02:30:00Z' }, { starts_at: '2026-10-21T14:00:00Z' }], 'America/Manaus')
    expect(Object.keys(g)).toEqual(['2026-10-20', '2026-10-21'])
  })
  it('status ativos', () => {
    expect(isActive('scheduled') && isActive('confirmed')).toBe(true)
    expect(isActive('cancelled') || isActive('completed') || isActive('no_show')).toBe(false)
  })
  it('timeToMinutes converte HH:MM', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('00:00')).toBe(0)
  })
  it('layoutLanes: sem sobreposição ocupa a largura toda', () => {
    expect(layoutLanes([{ start: 540, end: 570 }, { start: 570, end: 600 }])).toEqual([{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }])
  })
  it('layoutLanes: sobreposição divide em faixas e reaproveita faixa livre', () => {
    const r = layoutLanes([{ start: 540, end: 600 }, { start: 560, end: 620 }, { start: 600, end: 630 }, { start: 700, end: 730 }])
    expect(r[0]).toEqual({ lane: 0, lanes: 2 })
    expect(r[1]).toEqual({ lane: 1, lanes: 2 })
    expect(r[2]).toEqual({ lane: 0, lanes: 2 })
    expect(r[3]).toEqual({ lane: 0, lanes: 1 })
  })
})
