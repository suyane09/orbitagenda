import { supabase } from '@/lib/supabase'
import type { Service } from '@/types/models'

export interface ServiceInput {
  name: string
  description: string | null
  category: string | null
  duration_minutes: number
  price_cents: number
  is_active: boolean
}

const COLUMNS = 'id, name, description, category, duration_minutes, price_cents, is_active'

/** O RLS filtra silenciosamente linhas sem permissão: 0 linhas afetadas = sem acesso. */
function assertAffected(data: unknown[] | null) {
  if (!data || data.length === 0) throw { code: '42501', message: 'no rows affected' }
}

export async function listServices(establishmentId: string): Promise<Service[]> {
  const { data, error } = await supabase.from('services').select(COLUMNS).eq('establishment_id', establishmentId)
  if (error) throw error
  return ((data ?? []) as Service[]).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export async function createService(establishmentId: string, input: ServiceInput): Promise<void> {
  const { error } = await supabase.from('services').insert({ establishment_id: establishmentId, ...input })
  if (error) throw error
}

export async function updateService(id: string, establishmentId: string, input: ServiceInput): Promise<void> {
  const { data, error } = await supabase.from('services').update(input)
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}

export async function setServiceActive(id: string, establishmentId: string, isActive: boolean): Promise<void> {
  const { data, error } = await supabase.from('services').update({ is_active: isActive })
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}

export async function deleteService(id: string, establishmentId: string): Promise<void> {
  const { data, error } = await supabase.from('services').delete()
    .eq('id', id).eq('establishment_id', establishmentId).select('id')
  if (error) throw error
  assertAffected(data)
}
