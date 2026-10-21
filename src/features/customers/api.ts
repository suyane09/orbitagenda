import { supabase } from '@/lib/supabase'

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  notes: string | null
  created_at: string
}
export interface CustomerStats { total: number; completed: number; lastVisit: string | null }
export interface CustomersData { customers: Customer[]; stats: Record<string, CustomerStats> }
export interface CustomerInput { full_name: string; phone: string | null; email: string | null; notes: string | null }
export interface HistoryItem { id: string; starts_at: string; status: string; price_cents: number; service: string; professional: string }

const COLUMNS = 'id, full_name, phone, email, notes, created_at'
const LIMIT = 5000

function assertAffected(data: unknown[] | null) {
  if (!data || data.length === 0) throw { code: '42501', message: 'no rows affected' }
}

export async function loadCustomers(establishmentId: string): Promise<CustomersData> {
  const [cs, ap] = await Promise.all([
    supabase.from('customers').select(COLUMNS).eq('establishment_id', establishmentId).order('full_name', { ascending: true }).limit(LIMIT),
    supabase.from('appointments').select('customer_id, starts_at, status').eq('establishment_id', establishmentId)
      .order('starts_at', { ascending: false }).limit(LIMIT * 4),
  ])
  if (cs.error) throw cs.error
  if (ap.error) throw ap.error
  const stats: Record<string, CustomerStats> = {}
  for (const a of (ap.data ?? []) as Array<{ customer_id: string; starts_at: string; status: string }>) {
    const s = (stats[a.customer_id] ??= { total: 0, completed: 0, lastVisit: null })
    s.total++
    if (a.status === 'completed') { s.completed++; if (!s.lastVisit || a.starts_at > s.lastVisit) s.lastVisit = a.starts_at }
  }
  return { customers: (cs.data ?? []) as Customer[], stats }
}

export async function createCustomer(establishmentId: string, input: CustomerInput): Promise<void> {
  const { error } = await supabase.from('customers').insert({ establishment_id: establishmentId, ...input })
  if (error) throw error
}

export async function updateCustomer(id: string, establishmentId: string, input: CustomerInput): Promise<void> {
  const { data, error } = await supabase.from('customers').update(input)
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}

/** Só o proprietário exclui (RLS). Com agendamentos vinculados o banco bloqueia (FK). */
export async function deleteCustomer(id: string, establishmentId: string): Promise<void> {
  const { data, error } = await supabase.from('customers').delete()
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}

export async function loadHistory(establishmentId: string, customerId: string): Promise<HistoryItem[]> {
  const [ap, sv, pr] = await Promise.all([
    supabase.from('appointments').select('id, starts_at, status, price_cents, service_id, professional_id')
      .eq('establishment_id', establishmentId).eq('customer_id', customerId).order('starts_at', { ascending: false }).limit(200),
    supabase.from('services').select('id, name').eq('establishment_id', establishmentId),
    supabase.from('professionals').select('id, name').eq('establishment_id', establishmentId),
  ])
  if (ap.error) throw ap.error
  if (sv.error) throw sv.error
  if (pr.error) throw pr.error
  const svc = new Map(((sv.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
  const pro = new Map(((pr.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
  return ((ap.data ?? []) as Array<{ id: string; starts_at: string; status: string; price_cents: number; service_id: string; professional_id: string }>)
    .map((a) => ({ id: a.id, starts_at: a.starts_at, status: a.status, price_cents: a.price_cents, service: svc.get(a.service_id) ?? 'Serviço removido', professional: pro.get(a.professional_id) ?? 'Profissional' }))
}
