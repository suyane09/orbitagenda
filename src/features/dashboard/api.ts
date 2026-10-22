import { supabase } from '@/lib/supabase'
import { todayInZone } from '@/lib/schedule'
import { listAppointments, type AppointmentRow } from '@/features/appointments/api'
import type { MembershipRole, TeamMember, TodayAppointment } from '@/types/models'

export interface DashboardData {
  counts: { professionals: number; services: number; customers: number; workingHours: number }
  /** Todos os agendamentos de hoje (fuso do estabelecimento), inclusive cancelados e faltas. */
  agenda: AppointmentRow[]
  /** Agendados, confirmados e concluídos de hoje: alimenta a órbita do dia. */
  today: TodayAppointment[]
  team: TeamMember[]
}

async function count(table: string, establishmentId: string, activeOnly = false): Promise<number> {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('establishment_id', establishmentId)
  if (activeOnly) q = q.eq('is_active', true)
  const { count: n, error } = await q
  if (error) throw error
  return n ?? 0
}

/**
 * Os filtros por establishment_id aqui servem só para delimitar a consulta;
 * a garantia de isolamento é do RLS, não deste parâmetro.
 * A agenda de hoje vem da mesma RPC (list_appointments) usada pela página Agenda.
 */
export async function loadDashboard(establishmentId: string, timezone: string): Promise<DashboardData> {
  const today = todayInZone(new Date(), timezone)

  const [professionals, services, customers, workingHours, agenda, members] = await Promise.all([
    count('professionals', establishmentId, true),
    count('services', establishmentId, true),
    count('customers', establishmentId),
    count('working_hours', establishmentId),
    listAppointments(establishmentId, today, today),
    supabase.from('memberships').select('id, user_id, role, is_active').eq('establishment_id', establishmentId).order('created_at', { ascending: true }),
  ])
  if (members.error) throw members.error

  const rows = (members.data ?? []) as Array<{ id: string; user_id: string; role: MembershipRole; is_active: boolean }>
  const ids = rows.map((r) => r.user_id)
  const names = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', ids)
    if (error) throw error
    for (const p of (data ?? []) as Array<{ id: string; full_name: string }>) names.set(p.id, p.full_name)
  }

  return {
    counts: { professionals, services, customers, workingHours },
    agenda,
    today: agenda
      .filter((a) => a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'completed')
      .map((a) => ({ id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status })),
    team: rows.map((r) => ({ membershipId: r.id, userId: r.user_id, name: names.get(r.user_id) ?? 'Usuário', role: r.role, isActive: r.is_active })),
  }
}