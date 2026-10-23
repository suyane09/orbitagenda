/** Regras puras da Agenda (sem React/Supabase). Datas/horas sempre no fuso do ESTABELECIMENTO. */
import type { AppointmentStatus } from '@/features/appointments/api'

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou',
}
export const STATUS_CHIP: Record<AppointmentStatus, string> = {
  scheduled: 'bg-amber-100 text-amber-800', confirmed: 'bg-orbit/10 text-orbit', completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate/15 text-slate', no_show: 'bg-danger/10 text-danger',
}
export const ACTION_LABEL: Partial<Record<AppointmentStatus, string>> = {
  confirmed: 'Confirmar', completed: 'Concluir', cancelled: 'Cancelar', no_show: 'Faltou',
}
export const isActive = (s: AppointmentStatus) => s === 'scheduled' || s === 'confirmed'

/** "YYYY-MM-DD" e "HH:MM" de um instante, no fuso informado. */
export function zoned(iso: string, timeZone: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(iso))) if (p.type !== 'literal') o[p.type] = p.value
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` }
}

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Segunda a domingo da semana que contém a data. */
export function weekDays(date: string): string[] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = domingo
  const monday = addDays(date, dow === 0 ? -6 : 1 - dow)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export function dayLabel(date: string, style: 'long' | 'short' = 'long'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: style === 'long' ? 'long' : 'short', day: 'numeric', month: style === 'long' ? 'long' : 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

export { addDays }

export function groupByDate<T extends { starts_at: string }>(rows: readonly T[], timeZone: string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const r of rows) (out[zoned(r.starts_at, timeZone).date] ??= []).push(r)
  return out
}

/** Minutos desde 00:00 de um "HH:MM". */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return h * 60 + m
}

export interface LaneItem { start: number; end: number }
export interface LanePlacement { lane: number; lanes: number }

/**
 * Distribui itens que se sobrepõem no tempo (mesmo profissional) em faixas lado a lado.
 * Itens sem sobreposição ocupam a largura toda (lanes = 1). Devolve um resultado por índice de entrada.
 */
export function layoutLanes(items: readonly LaneItem[]): LanePlacement[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.start - items[b]!.start || items[a]!.end - items[b]!.end)
  const out: LanePlacement[] = items.map(() => ({ lane: 0, lanes: 1 }))
  let cluster: number[] = []
  let clusterEnd = -Infinity
  let laneEnds: number[] = []
  const flush = () => { for (const i of cluster) out[i]!.lanes = laneEnds.length; cluster = []; laneEnds = [] }
  for (const i of order) {
    const it = items[i]!
    if (cluster.length && it.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((e) => e <= it.start)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end) } else laneEnds[lane] = it.end
    out[i]!.lane = lane
    cluster.push(i)
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  flush()
  return out
}

export const minutesToTime = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Arredonda minutos para múltiplos de `step` (mode: nearest | floor | ceil). */
export function snapMinutes(m: number, step: number, mode: 'nearest' | 'floor' | 'ceil' = 'nearest'): number {
  const f = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round
  return f(m / step) * step
}

/** Trecho de [startIso, endIso) que cai em `date` (fuso do estabelecimento), em minutos do dia; null se não toca o dia. */
export function clipToDay(startIso: string, endIso: string, date: string, timeZone: string): { start: number; end: number } | null {
  const s = zoned(startIso, timeZone)
  const e = zoned(endIso, timeZone)
  if (s.date > date || e.date < date) return null
  const start = s.date < date ? 0 : timeToMinutes(s.time)
  const end = e.date > date ? 24 * 60 : timeToMinutes(e.time)
  return end > start ? { start, end } : null
}

/** Partes de [from, to] NÃO cobertas pelos trechos de expediente (para sombrear "fora do expediente"). */
export function offHours(segments: ReadonlyArray<{ start: number; end: number }>, from: number, to: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let cur = from
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    if (s.start > cur) out.push({ start: cur, end: Math.min(s.start, to) })
    cur = Math.max(cur, s.end)
    if (cur >= to) break
  }
  if (cur < to) out.push({ start: cur, end: to })
  return out.filter((r) => r.end > r.start)
}

export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay()
