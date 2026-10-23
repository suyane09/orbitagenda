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
