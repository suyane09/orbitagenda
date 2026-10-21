import { describe, expect, it } from 'vitest'
import {
  addDays, blockFormToRpc, blockToForm, emptyBlockForm, emptyWeek, formatBlockPeriod, segmentsToWeek, toMinutes, todayInZone,
  validateBlockForm, validateDay, weekToSegments, workedMinutes, type BlockFormValues, type ScheduleBlock,
} from './schedule'
import { describeError } from './errors'

const TZ = 'America/Manaus' // UTC-4, sem horário de verão

describe('horas', () => {
  it('aceita HH:MM e HH:MM:SS, rejeita lixo', () => {
    expect(toMinutes('09:30')).toBe(570)
    expect(toMinutes('09:30:00')).toBe(570)
    expect(toMinutes('24:00')).toBe(1440)
    expect(toMinutes('24:01')).toBeNull()
    expect(toMinutes('9:60')).toBeNull()
    expect(toMinutes('abc')).toBeNull()
  })
})

describe('expediente ↔ trechos', () => {
  it('intervalo vira dois trechos e volta igual', () => {
    const week = emptyWeek()
    week[1] = { open: true, start: '09:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00' }] }
    const segs = weekToSegments(week)
    expect(segs).toEqual([
      { weekday: 1, start_time: '09:00', end_time: '12:00' },
      { weekday: 1, start_time: '13:00', end_time: '18:00' },
    ])
    const back = segmentsToWeek(segs.map((s) => ({ ...s, start_time: s.start_time + ':00', end_time: s.end_time + ':00' })))
    expect(back[1]).toEqual(week[1])
    expect(back[0]!.open).toBe(false)
  })
  it('dias fechados não geram trechos e vários intervalos funcionam fora de ordem', () => {
    const week = emptyWeek()
    week[3] = { open: true, start: '08:00', end: '20:00', breaks: [{ start: '15:00', end: '15:30' }, { start: '12:00', end: '13:00' }] }
    expect(weekToSegments(week).map((s) => `${s.start_time}-${s.end_time}`)).toEqual(['08:00-12:00', '13:00-15:00', '15:30-20:00'])
    expect(workedMinutes(week[3]!)).toBe(12 * 60 - 90)
  })
})

describe('validateDay', () => {
  const day = (over: object) => ({ open: true, start: '09:00', end: '18:00', breaks: [], ...over })
  it('aceita dia válido e ignora dia fechado', () => {
    expect(validateDay(day({}))).toBeNull()
    expect(validateDay(day({ open: false, start: '', end: '' }))).toBeNull()
  })
  it('rejeita fim antes do início', () => { expect(validateDay(day({ end: '08:00' }))).toMatch(/depois do início/) })
  it('rejeita intervalo fora do expediente ou colado nas pontas', () => {
    expect(validateDay(day({ breaks: [{ start: '08:00', end: '09:30' }] }))).toMatch(/dentro do expediente/)
    expect(validateDay(day({ breaks: [{ start: '09:00', end: '10:00' }] }))).toMatch(/dentro do expediente/)
    expect(validateDay(day({ breaks: [{ start: '17:00', end: '18:00' }] }))).toMatch(/dentro do expediente/)
  })
  it('rejeita intervalos sobrepostos ou encostados', () => {
    expect(validateDay(day({ breaks: [{ start: '12:00', end: '13:00' }, { start: '12:30', end: '14:00' }] }))).toMatch(/sobrepor/)
    expect(validateDay(day({ breaks: [{ start: '12:00', end: '13:00' }, { start: '13:00', end: '14:00' }] }))).toMatch(/sobrepor/)
  })
  it('limita a quantidade de intervalos', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ start: `${10 + i}:00`, end: `${10 + i}:10` }))
    expect(validateDay(day({ breaks: many }))).toMatch(/no máximo/)
  })
})

describe('datas', () => {
  it('addDays atravessa mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('"hoje" segue o fuso do estabelecimento, não o do navegador', () => {
    const t = new Date('2026-10-21T02:30:00Z') // 20/10 22:30 em Manaus; 21/10 em UTC
    expect(todayInZone(t, TZ)).toBe('2026-10-20')
    expect(todayInZone(t, 'UTC')).toBe('2026-10-21')
  })
})

describe('bloqueios', () => {
  // dia inteiro 2026-11-10..11-12 em Manaus (UTC-4) = 04:00Z → 04:00Z do dia 13
  const allDay: ScheduleBlock = { id: '1', professional_id: 'p', kind: 'vacation', starts_at: '2026-11-10T04:00:00Z', ends_at: '2026-11-13T04:00:00Z', reason: null }
  const partial: ScheduleBlock = { id: '2', professional_id: null, kind: 'block', starts_at: '2026-11-10T19:00:00Z', ends_at: '2026-11-10T20:30:00Z', reason: 'Médico' }

  it('lê período no fuso do estabelecimento (dia inteiro: data final inclusiva)', () => {
    const f = blockToForm(allDay, TZ)
    expect([f.startDate, f.endDate, f.allDay]).toEqual(['2026-11-10', '2026-11-12', true])
    expect(formatBlockPeriod(allDay, TZ)).toBe('10/11/2026 a 12/11/2026 · 3 dias')
  })
  it('lê bloqueio parcial em hora local', () => {
    const f = blockToForm(partial, TZ)
    expect([f.startDate, f.startTime, f.endTime, f.allDay]).toEqual(['2026-11-10', '15:00', '16:30', false])
    expect(formatBlockPeriod(partial, TZ)).toBe('10/11/2026 · 15:00–16:30')
    expect(formatBlockPeriod(partial, 'UTC')).toBe('10/11/2026 · 19:00–20:30') // mesmo instante, outro fuso
  })

  const now = new Date('2026-10-21T12:00:00Z')
  const base: BlockFormValues = { ...emptyBlockForm('2026-10-22'), professionalId: 'p' }
  it('valida o formulário', () => {
    expect(validateBlockForm(base, TZ, now)).toEqual({})
    expect(validateBlockForm({ ...base, kind: 'vacation', professionalId: '' }, TZ, now).professionalId).toBeTruthy()
    expect(validateBlockForm({ ...base, endDate: '2026-10-20' }, TZ, now).endDate).toMatch(/antes da inicial/)
    expect(validateBlockForm({ ...base, startDate: '2026-10-01', endDate: '2026-10-05' }, TZ, now).endDate).toMatch(/passado/)
    expect(validateBlockForm({ ...base, endDate: '2028-10-22' }, TZ, now).endDate).toMatch(/366/)
    expect(validateBlockForm({ ...base, startDate: '' }, TZ, now).startDate).toBeTruthy()
    expect(validateBlockForm({ ...base, kind: 'block', allDay: false, startTime: '15:00', endTime: '14:00' }, TZ, now).endTime).toMatch(/depois da inicial/)
    expect(validateBlockForm({ ...base, reason: 'x'.repeat(201) }, TZ, now).reason).toBeTruthy()
  })
  it('hora final menor é aceita quando o bloqueio atravessa dias', () => {
    expect(validateBlockForm({ ...base, kind: 'block', allDay: false, endDate: '2026-10-23', startTime: '22:00', endTime: '08:00' }, TZ, now)).toEqual({})
  })
  it('envia horas só em bloqueio parcial', () => {
    expect(blockFormToRpc({ ...base, reason: '  Feriado ' })).toMatchObject({ p_start_time: null, p_end_time: null, p_reason: 'Feriado', p_professional_id: 'p' })
    expect(blockFormToRpc({ ...base, kind: 'block', allDay: false, startTime: '10:00', endTime: '11:00', professionalId: '' }))
      .toMatchObject({ p_start_time: '10:00', p_end_time: '11:00', p_professional_id: null })
    expect(blockFormToRpc({ ...base, kind: 'vacation', allDay: false })).toMatchObject({ p_start_time: null })
  })
})

describe('mensagens de erro do módulo', () => {
  it('informa quantidade de agendamentos em conflito', () => {
    expect(describeError({ message: 'block_conflicts_appointments:1' })).toMatch(/1 agendamento ativo/)
    expect(describeError({ message: 'block_conflicts_appointments:3', code: 'P0001' })).toMatch(/3 agendamentos ativos/)
  })
  it('traduz sobreposição e passado, sem vazar detalhes técnicos', () => {
    expect(describeError({ message: 'working_hours_overlap', code: '23P01' })).toMatch(/sobrepostos/)
    expect(describeError({ message: 'block_overlap', code: '23P01' })).toMatch(/Já existe/)
    expect(describeError({ message: 'block_in_the_past' })).toMatch(/passado/)
    expect(describeError({ message: 'forbidden', code: '42501' })).toMatch(/permissão/)
  })
})
