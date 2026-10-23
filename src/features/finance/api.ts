import { supabase } from '@/lib/supabase'
export type EntryKind = 'income' | 'expense' | 'refund'
export type PaymentMethod = 'pix' | 'cash' | 'card' | 'other'
export interface Entry {
  id: string; establishment_id: string; appointment_id: string | null
  kind: EntryKind; description: string; amount_cents: number
  method: PaymentMethod; occurred_on: string; created_at: string
}
export async function listEntries(establishmentId: string, from: string, to: string): Promise<Entry[]> {
  const { data, error } = await supabase.from('financial_entries').select('id,establishment_id,appointment_id,kind,description,amount_cents,method,occurred_on,created_at')
    .eq('establishment_id', establishmentId).gte('occurred_on', from).lte('occurred_on', to)
    .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
  if (error) throw error
  return (data ?? []) as Entry[]
}
export async function createEntry(establishmentId: string, input: {
  kind: EntryKind; description: string; amount_cents: number; method: PaymentMethod
  occurred_on: string; appointment_id: string | null
}): Promise<void> {
  const { error } = await supabase.from('financial_entries').insert({ establishment_id: establishmentId, ...input })
  if (error) throw error
}

/** Consulta todos os lançamentos de um atendimento, sem depender do filtro de datas do painel. */
export async function listAppointmentEntries(establishmentId: string, appointmentId: string): Promise<Entry[]> {
  const { data, error } = await supabase.from('financial_entries')
    .select('id,establishment_id,appointment_id,kind,description,amount_cents,method,occurred_on,created_at')
    .eq('establishment_id', establishmentId).eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Entry[]
}

/** Lançamentos de vários atendimentos (em lotes, para não estourar o tamanho da URL). */
export async function listEntriesByAppointments(establishmentId: string, appointmentIds: string[]): Promise<Entry[]> {
  const ids = [...new Set(appointmentIds)]
  const out: Entry[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('financial_entries')
      .select('id,establishment_id,appointment_id,kind,description,amount_cents,method,occurred_on,created_at')
      .eq('establishment_id', establishmentId).in('appointment_id', ids.slice(i, i + 100))
    if (error) throw error
    out.push(...((data ?? []) as Entry[]))
  }
  return out
}

/** Valor líquido efetivamente recebido por atendimento (recebimentos − estornos). */
export function paidByAppointment(entries: Entry[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of entries) {
    if (!e.appointment_id) continue
    const delta = e.kind === 'income' ? e.amount_cents : e.kind === 'refund' ? -e.amount_cents : 0
    if (delta) m.set(e.appointment_id, (m.get(e.appointment_id) ?? 0) + delta)
  }
  return m
}

export interface Receivable {
  id: string; starts_at: string; customer_name: string; service_name: string
  price_cents: number; paid_cents: number; balance_cents: number
}

const RECEIVABLES_LIMIT = 500

/** Atendimentos concluídos com saldo ainda não recebido (valor do serviço − pagamentos registrados). */
export async function listReceivables(establishmentId: string): Promise<{ items: Receivable[]; truncated: boolean }> {
  const { data, error } = await supabase.from('appointments')
    .select('id,starts_at,price_cents,customers(full_name),services(name)')
    .eq('establishment_id', establishmentId).eq('status', 'completed').gt('price_cents', 0)
    .order('starts_at', { ascending: false }).limit(RECEIVABLES_LIMIT)
  if (error) throw error
  const rows = (data ?? []).map((r) => ({
    id: r.id, starts_at: r.starts_at, price_cents: r.price_cents,
    customer_name: (r.customers as unknown as { full_name: string } | null)?.full_name ?? 'Cliente',
    service_name: (r.services as unknown as { name: string } | null)?.name ?? 'Serviço',
  }))
  const paid = paidByAppointment(await listEntriesByAppointments(establishmentId, rows.map((r) => r.id)))
  const items: Receivable[] = []
  for (const r of rows) {
    const paid_cents = paid.get(r.id) ?? 0
    const balance_cents = Math.max(0, r.price_cents - paid_cents)
    if (balance_cents > 0) items.push({ ...r, paid_cents, balance_cents })
  }
  return { items, truncated: rows.length >= RECEIVABLES_LIMIT }
}

/** Consulta paginada do dia: evita truncar o fechamento em 1.000 lançamentos. */
export async function listDayEntries(establishmentId: string, day: string): Promise<Entry[]> {
  const out: Entry[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('financial_entries')
      .select('id,establishment_id,appointment_id,kind,description,amount_cents,method,occurred_on,created_at')
      .eq('establishment_id', establishmentId).eq('occurred_on', day)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + 499)
    if (error) throw error
    out.push(...((data ?? []) as Entry[]))
    if (!data || data.length < 500) break
  }
  return out
}
export interface CashClosure {
  id: string; establishment_id: string; business_date: string
  status: 'closed' | 'reopened'; income_cents: number; expense_cents: number
  refund_cents: number; net_cents: number; entry_count: number
  closed_at: string; closed_by: string; reopened_at: string | null
  reopened_by: string | null; reopen_reason: string | null
}
export interface CashClosureEvent {
  id: string; closure_id: string; event: 'closed' | 'reopened'
  actor_id: string; happened_at: string; reason: string | null
}
export async function listCashClosures(establishmentId: string): Promise<CashClosure[]> {
  const { data, error } = await supabase.from('cash_closures').select('*')
    .eq('establishment_id', establishmentId).order('closed_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as CashClosure[]
}
export async function listCashClosureEvents(closureId: string): Promise<CashClosureEvent[]> {
  const { data, error } = await supabase.from('cash_closure_events').select('*')
    .eq('closure_id', closureId).order('happened_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CashClosureEvent[]
}
export async function closeCashDay(establishmentId: string, date: string): Promise<void> {
  const { error } = await supabase.rpc('close_cash_day', { p_establishment_id: establishmentId, p_date: date })
  if (error) throw error
}
export async function reopenCashDay(closureId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_cash_day', { p_closure_id: closureId, p_reason: reason })
  if (error) throw error
}
