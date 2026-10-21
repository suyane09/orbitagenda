import { supabase } from '@/lib/supabase'
import type { Professional, Service } from '@/types/models'

export interface ProfessionalInput {
  id: string | null
  name: string
  bio: string | null
  color: string
  is_active: boolean
  serviceIds: string[]
}

export interface ProfessionalsData {
  professionals: Professional[]
  services: Pick<Service, 'id' | 'name' | 'is_active'>[]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR')

export async function loadProfessionals(establishmentId: string): Promise<ProfessionalsData> {
  const [pros, links, svcs] = await Promise.all([
    supabase.from('professionals').select('id, name, bio, color, is_active').eq('establishment_id', establishmentId),
    supabase.from('professional_services').select('professional_id, service_id').eq('establishment_id', establishmentId),
    supabase.from('services').select('id, name, is_active').eq('establishment_id', establishmentId),
  ])
  if (pros.error) throw pros.error
  if (links.error) throw links.error
  if (svcs.error) throw svcs.error

  const byPro = new Map<string, string[]>()
  for (const l of (links.data ?? []) as Array<{ professional_id: string; service_id: string }>) {
    byPro.set(l.professional_id, [...(byPro.get(l.professional_id) ?? []), l.service_id])
  }
  const professionals = ((pros.data ?? []) as Array<Omit<Professional, 'serviceIds'>>)
    .map((p) => ({ ...p, serviceIds: byPro.get(p.id) ?? [] }))
    .sort(byName)
  return { professionals, services: ((svcs.data ?? []) as ProfessionalsData['services']).sort(byName) }
}

/** Criação/edição + vínculos em UMA transação (RPC SECURITY INVOKER: RLS e papéis valem). */
export async function saveProfessional(establishmentId: string, input: ProfessionalInput): Promise<void> {
  const { error } = await supabase.rpc('save_professional', {
    p_establishment_id: establishmentId,
    p_id: input.id,
    p_name: input.name,
    p_bio: input.bio,
    p_color: input.color,
    p_is_active: input.is_active,
    p_service_ids: input.serviceIds,
  })
  if (error) throw error
}

function assertAffected(data: unknown[] | null) {
  if (!data || data.length === 0) throw { code: '42501', message: 'no rows affected' }
}

export async function setProfessionalActive(id: string, establishmentId: string, isActive: boolean): Promise<void> {
  const { data, error } = await supabase.from('professionals').update({ is_active: isActive })
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}

export async function deleteProfessional(id: string, establishmentId: string): Promise<void> {
  const { data, error } = await supabase.from('professionals').delete()
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}
