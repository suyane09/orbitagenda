/**
 * Regras puras do módulo Horários (sem React/Supabase): conversão expediente ↔ trechos,
 * validação e datas/horas no fuso do ESTABELECIMENTO (nunca o do navegador).
 *
 * Modelo: cada dia tem expediente [início, fim] e N intervalos. No banco isso vira vários
 * trechos em working_hours — o intervalo é a lacuna entre dois trechos.
 */

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const // exibição: segunda → domingo
export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado',
}
export const WEEKDAY_SHORT: Record<number, string> = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' }

export const DEFAULT_START = '09:00'
export const DEFAULT_END = '18:00'
export const MAX_BREAKS = 5 // 6 trechos por dia × 7 dias = 42 (limite do banco)
export const BLOCK_REASON_MAX = 200
export const BLOCK_MAX_DAYS = 366

export interface Break { start: string; end: string }
export interface DaySchedule { open: boolean; start: string; end: string; breaks: Break[] }
/** Índice = dia da semana do banco (0 = domingo). */
export type WeekSchedule = DaySchedule[]
export interface SegmentRow { weekday: number; start_time: string; end_time: string }

// ---- horas ------------------------------------------------------------------

/** "09:30" ou "09:30:00" → minutos desde 00:00; null se inválido. */
export function toMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

export function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

const normTime = (v: string): string => { const m = toMinutes(v); return m === null ? v : toTime(m) }

// ---- expediente semanal ------------------------------------------------------

export function emptyDay(): DaySchedule { return { open: false, start: DEFAULT_START, end: DEFAULT_END, breaks: [] } }
export function emptyWeek(): WeekSchedule { return Array.from({ length: 7 }, emptyDay) }

/** Linhas de working_hours → semana editável (primeiro início, último fim, lacunas = intervalos). */
export function segmentsToWeek(rows: readonly SegmentRow[]): WeekSchedule {
  const week = emptyWeek()
  for (let wd = 0; wd < 7; wd++) {
    const segs = rows
      .filter((r) => r.weekday === wd)
      .map((r) => ({ s: toMinutes(r.start_time), e: toMinutes(r.end_time) }))
      .filter((r): r is { s: number; e: number } => r.s !== null && r.e !== null && r.e > r.s)
      .sort((a, b) => a.s - b.s)
    const first = segs[0]
    const last = segs[segs.length - 1]
    if (!first || !last) continue
    const breaks: Break[] = []
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1]!; const cur = segs[i]!
      if (cur.s > prev.e) breaks.push({ start: toTime(prev.e), end: toTime(cur.s) })
    }
    week[wd] = { open: true, start: toTime(first.s), end: toTime(Math.max(...segs.map((x) => x.e))), breaks }
  }
  return week
}

/** Semana editável → trechos para o banco (pressupõe validateWeek sem erros). */
export function weekToSegments(week: WeekSchedule): SegmentRow[] {
  const out: SegmentRow[] = []
  week.forEach((day, weekday) => {
    if (!day.open) return
    const s = toMinutes(day.start); const e = toMinutes(day.end)
    if (s === null || e === null) return
    const breaks = day.breaks
      .map((b) => ({ s: toMinutes(b.start), e: toMinutes(b.end) }))
      .filter((b): b is { s: number; e: number } => b.s !== null && b.e !== null)
      .sort((a, b) => a.s - b.s)
    let cursor = s
    for (const b of breaks) {
      if (b.s > cursor) out.push({ weekday, start_time: toTime(cursor), end_time: toTime(b.s) })
      cursor = Math.max(cursor, b.e)
    }
    if (e > cursor) out.push({ weekday, start_time: toTime(cursor), end_time: toTime(e) })
  })
  return out
}

/** Mensagem de erro do dia, ou null se válido. Dias fechados não são validados. */
export function validateDay(day: DaySchedule): string | null {
  if (!day.open) return null
  const s = toMinutes(day.start); const e = toMinutes(day.end)
  if (s === null || e === null) return 'Informe o início e o fim do expediente.'
  if (e <= s) return 'O fim do expediente deve ser depois do início.'
  if (day.breaks.length > MAX_BREAKS) return `Use no máximo ${MAX_BREAKS} intervalos por dia.`
  const list: Array<{ s: number; e: number }> = []
  for (const b of day.breaks) {
    const bs = toMinutes(b.start); const be = toMinutes(b.end)
    if (bs === null || be === null) return 'Informe o início e o fim de cada intervalo.'
    if (be <= bs) return 'Em cada intervalo, o fim deve ser depois do início.'
    if (bs <= s || be >= e) return 'Cada intervalo precisa ficar dentro do expediente (não pode começar nem terminar junto com ele).'
    list.push({ s: bs, e: be })
  }
  list.sort((a, b) => a.s - b.s)
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.s <= list[i - 1]!.e) return 'Os intervalos não podem se sobrepor nem se encostar.'
  }
  return null
}

export function validateWeek(week: WeekSchedule): Record<number, string> {
  const out: Record<number, string> = {}
  week.forEach((d, wd) => { const m = validateDay(d); if (m) out[wd] = m })
  return out
}

/** Minutos efetivamente trabalhados no dia (expediente menos intervalos). */
export function workedMinutes(day: DaySchedule): number {
  if (!day.open || validateDay(day)) return 0
  const s = toMinutes(day.start)!; const e = toMinutes(day.end)!
  const br = day.breaks.reduce((acc, b) => acc + (toMinutes(b.end)! - toMinutes(b.start)!), 0)
  return e - s - br
}

export function sameWeek(a: WeekSchedule, b: WeekSchedule): boolean {
  return JSON.stringify(a.map(canon)) === JSON.stringify(b.map(canon))
}
function canon(d: DaySchedule) {
  return d.open ? { o: 1, s: normTime(d.start), e: normTime(d.end), b: d.breaks.map((x) => [normTime(x.start), normTime(x.end)]) } : { o: 0 }
}

// ---- datas no fuso do estabelecimento -------------------------------------------

function zonedParts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') o[p.type] = p.value
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` }
}

/** "YYYY-MM-DD" de hoje no fuso informado. */
export function todayInZone(now: Date, timeZone: string): string { return zonedParts(now, timeZone).date }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}
export function addDays(date: string, n: number): string {
  const m = DATE_RE.exec(date)!
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10)
}
export function daysBetween(from: string, to: string): number {
  const a = DATE_RE.exec(from)!; const b = DATE_RE.exec(to)!
  return Math.round((Date.UTC(+b[1]!, +b[2]! - 1, +b[3]!) - Date.UTC(+a[1]!, +a[2]! - 1, +a[3]!)) / 86_400_000)
}
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

// ---- bloqueios ---------------------------------------------------------------

export type BlockKind = 'block' | 'day_off' | 'vacation'
export const BLOCK_KINDS: ReadonlyArray<{ value: BlockKind; label: string; hint: string }> = [
  { value: 'day_off', label: 'Folga', hint: 'Dia(s) inteiro(s) sem atendimento.' },
  { value: 'vacation', label: 'Férias', hint: 'Período longo de um profissional.' },
  { value: 'block', label: 'Bloqueio', hint: 'Horário específico indisponível.' },
]
export const blockKindLabel = (k: BlockKind): string => BLOCK_KINDS.find((x) => x.value === k)?.label ?? 'Bloqueio'

export interface ScheduleBlock {
  id: string
  professional_id: string | null
  kind: BlockKind
  starts_at: string
  ends_at: string
  reason: string | null
}

export interface BlockFormValues {
  kind: BlockKind
  /** '' = estabelecimento inteiro */
  professionalId: string
  startDate: string
  endDate: string
  allDay: boolean
  startTime: string
  endTime: string
  reason: string
}

export function emptyBlockForm(today: string): BlockFormValues {
  return { kind: 'day_off', professionalId: '', startDate: today, endDate: today, allDay: true, startTime: '12:00', endTime: '13:00', reason: '' }
}

/** Bloqueio salvo → valores do formulário, lidos no fuso do estabelecimento. */
export function blockToForm(b: ScheduleBlock, timeZone: string): BlockFormValues {
  const s = zonedParts(new Date(b.starts_at), timeZone)
  const e = zonedParts(new Date(b.ends_at), timeZone)
  const allDay = s.time === '00:00' && e.time === '00:00'
  return {
    kind: b.kind,
    professionalId: b.professional_id ?? '',
    startDate: s.date,
    endDate: allDay ? addDays(e.date, -1) : e.date,
    allDay,
    startTime: allDay ? '12:00' : s.time,
    endTime: allDay ? '13:00' : e.time,
    reason: b.reason ?? '',
  }
}

export function validateBlockForm(v: BlockFormValues, timeZone: string, now: Date): Record<string, string> {
  const err: Record<string, string> = {}
  if (v.kind === 'vacation' && !v.professionalId) err.professionalId = 'Férias pertencem a um profissional. Escolha quem vai sair.'
  if (!isValidDate(v.startDate)) err.startDate = 'Informe a data inicial.'
  if (!isValidDate(v.endDate)) err.endDate = 'Informe a data final.'
  if (!err.startDate && !err.endDate) {
    if (v.endDate < v.startDate) err.endDate = 'A data final não pode ser antes da inicial.'
    else if (daysBetween(v.startDate, v.endDate) > BLOCK_MAX_DAYS - 1) err.endDate = `O período pode ter no máximo ${BLOCK_MAX_DAYS} dias.`
    else if (v.endDate < todayInZone(now, timeZone)) err.endDate = 'O período não pode estar inteiramente no passado.'
  }
  if (v.kind === 'block' && !v.allDay) {
    const s = toMinutes(v.startTime); const e = toMinutes(v.endTime)
    if (s === null) err.startTime = 'Informe a hora inicial.'
    if (e === null) err.endTime = 'Informe a hora final.'
    if (s !== null && e !== null && !err.endDate && v.startDate === v.endDate && e <= s) err.endTime = 'A hora final deve ser depois da inicial.'
  }
  if (v.reason.trim().length > BLOCK_REASON_MAX) err.reason = `O motivo pode ter no máximo ${BLOCK_REASON_MAX} caracteres.`
  return err
}

/** Valores validados → parâmetros da RPC save_schedule_block (horas só em bloqueio parcial). */
export function blockFormToRpc(v: BlockFormValues) {
  const partial = v.kind === 'block' && !v.allDay
  return {
    p_professional_id: v.professionalId || null,
    p_kind: v.kind,
    p_start_date: v.startDate,
    p_end_date: v.endDate,
    p_start_time: partial ? v.startTime : null,
    p_end_time: partial ? v.endTime : null,
    p_reason: v.reason.trim() || null,
  }
}

/** Texto do período, sempre no fuso do estabelecimento. */
export function formatBlockPeriod(b: ScheduleBlock, timeZone: string): string {
  const f = blockToForm(b, timeZone)
  if (f.allDay) {
    const days = daysBetween(f.startDate, f.endDate) + 1
    return days === 1 ? `${br(f.startDate)} · dia inteiro` : `${br(f.startDate)} a ${br(f.endDate)} · ${days} dias`
  }
  return f.startDate === f.endDate
    ? `${br(f.startDate)} · ${f.startTime}–${f.endTime}`
    : `${br(f.startDate)} ${f.startTime} → ${br(f.endDate)} ${f.endTime}`
}

export function blockStatus(b: ScheduleBlock, now: Date): 'current' | 'upcoming' | 'past' {
  const t = now.getTime()
  if (new Date(b.ends_at).getTime() <= t) return 'past'
  return new Date(b.starts_at).getTime() <= t ? 'current' : 'upcoming'
}
