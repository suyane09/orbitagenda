import { supabase } from '@/lib/supabase'
import type { ScheduleBlock, SegmentRow } from '@/lib/schedule'

export interface SchedulePro { id: string; name: string; color: string; is_active: boolean }

export interface ScheduleData {
  professionals: SchedulePro[]
  /** working_hours agrupado por profissional. */
  hours: Record<string, SegmentRow[]>
  /** Bloqueios em andamento ou futuros (o passado não interessa à operação). */
  blocks: ScheduleBlock[]
}

export interface SaveBlockParams {
  p_professional_id: string | null
  p_kind: string
  p_start_date: string
  p_end_date: string
  p_start_time: string | null
  p_end_time: string | null
  p_reason: string | null
}

function assertAffected(data: unknown[] | null) {
  if (!data || data.length === 0) throw { code: '42501', message: 'no rows affected' }
}

export async function loadSchedule(establishmentId: string): Promise<ScheduleData> {
  const [pros, hours, blocks] = await Promise.all([
    supabase.from('professionals').select('id, name, color, is_active').eq('establishment_id', establishmentId),
    supabase.from('working_hours').select('professional_id, weekday, start_time, end_time').eq('establishment_id', establishmentId),
    supabase.from('schedule_blocks').select('id, professional_id, kind, starts_at, ends_at, reason')
      .eq('establishment_id', establishmentId).gt('ends_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(500),
  ])
  if (pros.error) throw pros.error
  if (hours.error) throw hours.error
  if (blocks.error) throw blocks.error

  const byPro: Record<string, SegmentRow[]> = {}
  for (const h of (hours.data ?? []) as Array<SegmentRow & { professional_id: string }>) {
    ;(byPro[h.professional_id] ??= []).push({ weekday: h.weekday, start_time: h.start_time, end_time: h.end_time })
  }
  return {
    professionals: ((pros.data ?? []) as SchedulePro[]).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    hours: byPro,
    blocks: (blocks.data ?? []) as ScheduleBlock[],
  }
}

/** Substitui todo o expediente do profissional em uma transação (só proprietário). */
export async function saveWeeklySchedule(establishmentId: string, professionalId: string, segments: SegmentRow[]): Promise<{ segments: number; outside_appointments: number }> {
  const { data, error } = await supabase.rpc('save_weekly_schedule', {
    p_establishment_id: establishmentId,
    p_professional_id: professionalId,
    p_segments: segments,
  })
  if (error) throw error
  const r = (data ?? {}) as { segments?: number; outside_appointments?: number }
  return { segments: r.segments ?? 0, outside_appointments: r.outside_appointments ?? 0 }
}

/** Datas/horas são interpretadas pelo BANCO no fuso do estabelecimento. */
export async function saveScheduleBlock(establishmentId: string, id: string | null, params: SaveBlockParams): Promise<void> {
  const { error } = await supabase.rpc('save_schedule_block', { p_establishment_id: establishmentId, p_id: id, ...params })
  if (error) throw error
}

export async function deleteScheduleBlock(id: string, establishmentId: string): Promise<void> {
  const { data, error } = await supabase.from('schedule_blocks').delete()
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}
