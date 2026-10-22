import { supabase } from '@/lib/supabase'

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

export interface AppointmentRow {
  id: string
  professional_id: string
  professional_name: string
  professional_color: string
  service_id: string
  service_name: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  price_cents: number
  notes: string | null
}

export interface Slot { slot_start: string; slot_end: string }

export interface SaveAppointmentParams {
  id: string | null
  customerId: string
  professionalId: string
  serviceId: string
  /** YYYY-MM-DD e HH:MM no fuso do ESTABELECIMENTO (o banco converte). */
  date: string
  time: string
  notes: string | null
  /** null = usa o preço do serviço. */
  priceCents?: number | null
}

export interface AgendaOptions {
  professionals: Array<{ id: string; name: string; color: string }>
  services: Array<{ id: string; name: string; duration_minutes: number; price_cents: number }>
  /** serviço → profissionais que o realizam. */
  offered: Record<string, string[]>
}

/** Agendamentos de p_from a p_to (datas inclusivas, no fuso do estabelecimento). */
export async function listAppointments(establishmentId: string, from: string, to: string, professionalId?: string | null): Promise<AppointmentRow[]> {
  const { data, error } = await supabase.rpc('list_appointments', {
    p_establishment_id: establishmentId, p_from: from, p_to: to, p_professional_id: professionalId ?? null,
  })
  if (error) throw error
  return (data ?? []) as AppointmentRow[]
}

export async function getAvailableSlots(
  establishmentId: string, professionalId: string, serviceId: string, date: string, excludeAppointmentId?: string | null,
): Promise<Slot[]> {
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_establishment_id: establishmentId, p_professional_id: professionalId, p_service_id: serviceId,
    p_date: date, p_exclude_appointment_id: excludeAppointmentId ?? null,
  })
  if (error) throw error
  return (data ?? []) as Slot[]
}

/** Cria (id nulo) ou edita. Conflitos são decididos pelo banco (locks + EXCLUDE), nunca só pela tela. */
export async function saveAppointment(establishmentId: string, p: SaveAppointmentParams): Promise<string> {
  const { data, error } = await supabase.rpc('save_appointment', {
    p_establishment_id: establishmentId, p_id: p.id, p_customer_id: p.customerId,
    p_professional_id: p.professionalId, p_service_id: p.serviceId,
    p_date: p.date, p_time: p.time, p_notes: p.notes, p_price_cents: p.priceCents ?? null,
  })
  if (error) throw error
  return data as string
}

export async function setAppointmentStatus(establishmentId: string, id: string, status: AppointmentStatus): Promise<void> {
  const { error } = await supabase.rpc('set_appointment_status', { p_establishment_id: establishmentId, p_id: id, p_status: status })
  if (error) throw error
}

export async function loadAgendaOptions(establishmentId: string): Promise<AgendaOptions> {
  const [pros, svcs, links] = await Promise.all([
    supabase.from('professionals').select('id, name, color').eq('establishment_id', establishmentId).eq('is_active', true),
    supabase.from('services').select('id, name, duration_minutes, price_cents').eq('establishment_id', establishmentId).eq('is_active', true),
    supabase.from('professional_services').select('professional_id, service_id').eq('establishment_id', establishmentId),
  ])
  if (pros.error) throw pros.error
  if (svcs.error) throw svcs.error
  if (links.error) throw links.error
  const offered: Record<string, string[]> = {}
  for (const l of links.data ?? []) (offered[l.service_id as string] ??= []).push(l.professional_id as string)
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'pt-BR')
  return {
    professionals: (pros.data ?? []).sort(byName) as AgendaOptions['professionals'],
    services: (svcs.data ?? []).sort(byName) as AgendaOptions['services'],
    offered,
  }
}

/** Busca de clientes por nome/telefone (limite 20). Vírgulas e % são removidos para não quebrar o filtro. */
export async function searchCustomers(establishmentId: string, term: string): Promise<Array<{ id: string; full_name: string; phone: string | null }>> {
  const t = term.replace(/[%,()*]/g, ' ').trim()
  let q = supabase.from('customers').select('id, full_name, phone').eq('establishment_id', establishmentId).order('full_name').limit(20)
  if (t) q = q.or(`full_name.ilike.%${t}%,phone.ilike.%${t}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Array<{ id: string; full_name: string; phone: string | null }>
}

/** Transições permitidas na tela (o banco valida de novo). */
export const NEXT_STATUS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [], cancelled: [], no_show: [],
}
