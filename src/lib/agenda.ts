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
