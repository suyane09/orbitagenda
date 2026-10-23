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
    .select('id,starts_at,price_cents,customer_name,service_name')
    .eq('establishment_id', establishmentId).eq('status', 'completed').gt('price_cents', 0)
    .order('starts_at', { ascending: false }).limit(RECEIVABLES_LIMIT)
  if (error) throw error
  const rows = (data ?? []) as unknown as Array<Pick<Receivable, 'id' | 'starts_at' | 'price_cents' | 'customer_name' | 'service_name'>>
  const paid = paidByAppointment(await listEntriesByAppointments(establishmentId, rows.map((r) => r.id)))
  const items: Receivable[] = []
  for (const r of rows) {
    const paid_cents = paid.get(r.id) ?? 0
    const balance_cents = Math.max(0, r.price_cents - paid_cents)
    if (balance_cents > 0) items.push({ ...r, paid_cents, balance_cents })
  }
  return { items, truncated: rows.length >= RECEIVABLES_LIMIT }
}