import { supabase } from '@/lib/supabase'
import { dayBounds } from '@/lib/time'
import type { MembershipRole, TeamMember, TodayAppointment } from '@/types/models'

export interface DashboardData {
  counts: { professionals: number; services: number; customers: number; workingHours: number }
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
 */
export async function loadDashboard(establishmentId: string, timezone: string): Promise<DashboardData> {
  const { start, end } = dayBounds(new Date(), timezone)

  const [professionals, services, customers, workingHours, appts, members] = await Promise.all([
    count('professionals', establishmentId, true),
    count('services', establishmentId, true),
    count('customers', establishmentId),
    count('working_hours', establishmentId),
    supabase.from('appointments').select('id, starts_at, ends_at, status')
      .eq('establishment_id', establishmentId)
      .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString())
      .in('status', ['scheduled', 'confirmed', 'completed'])
      .order('starts_at', { ascending: true }),
    supabase.from('memberships').select('id, user_id, role, is_active').eq('establishment_id', establishmentId).order('created_at', { ascending: true }),
  ])
  if (appts.error) throw appts.error
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
    today: (appts.data ?? []) as TodayAppointment[],
    team: rows.map((r) => ({ membershipId: r.id, userId: r.user_id, name: names.get(r.user_id) ?? 'Usuário', role: r.role, isActive: r.is_active })),
  }
}
