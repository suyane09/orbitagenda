import { supabase } from '@/lib/supabase'
import type { BusinessType, Establishment, Membership, Profile } from '@/types/models'

export interface AccountData { profile: Profile | null; memberships: Membership[]; isSuperadmin: boolean }

/** Tudo é filtrado pelo RLS: o usuário só recebe vínculos e empresas que realmente pode ver. */
export async function loadAccount(userId: string): Promise<AccountData> {
  const [profile, memberships, admin] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('id', userId).maybeSingle(),
    supabase
      .from('memberships')
      .select('id, role, establishment:establishments(id, name, slug, business_type, phone, timezone, created_at)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.rpc('is_platform_admin'),
  ])
  if (profile.error) throw profile.error
  if (memberships.error) throw memberships.error
  if (admin.error) throw admin.error

  const rows = (memberships.data ?? []) as unknown as Array<{ id: string; role: Membership['role']; establishment: Establishment | null }>
  return {
    profile: (profile.data as Profile | null) ?? null,
    memberships: rows.filter((r) => r.establishment).map((r) => ({ id: r.id, role: r.role, establishment: r.establishment as Establishment })),
    isSuperadmin: admin.data === true,
  }
}

export interface CreateEstablishmentInput { name: string; businessType: BusinessType; phone?: string | undefined; timezone: string }

/**
 * Único caminho para criar estabelecimento. O servidor define o dono (auth.uid()),
 * o papel e o establishment_id; o cliente envia apenas dados descritivos.
 */
export async function createEstablishment(input: CreateEstablishmentInput): Promise<Establishment> {
  const { data, error } = await supabase.rpc('create_establishment', {
    p_name: input.name,
    p_business_type: input.businessType,
    p_phone: input.phone?.trim() ? input.phone.trim() : null,
    p_timezone: input.timezone,
  })
  if (error) throw error
  return data as Establishment
}
