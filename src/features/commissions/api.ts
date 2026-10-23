import { supabase } from '@/lib/supabase'
export type CommissionMode = 'none' | 'percentage' | 'fixed'
export interface CommissionSettings { professional_id: string; mode: CommissionMode; rate_basis_points: number; fixed_cents: number }
export async function loadCommissionSettings(establishmentId: string): Promise<CommissionSettings[]> {
 const { data, error } = await supabase.from('professional_commission_rules').select('professional_id,mode,rate_basis_points,fixed_cents').eq('establishment_id', establishmentId)
 if (error) throw error
 return (data ?? []) as CommissionSettings[]
}
export async function saveCommissionSettings(establishmentId: string, settings: CommissionSettings): Promise<void> {
 const { data, error } = await supabase.from('professional_commission_rules').upsert({
  establishment_id: establishmentId, professional_id: settings.professional_id, mode: settings.mode,
  rate_basis_points: settings.mode === 'percentage' ? settings.rate_basis_points : 0,
  fixed_cents: settings.mode === 'fixed' ? settings.fixed_cents : 0,
  updated_at: new Date().toISOString(),
 }, { onConflict: 'establishment_id,professional_id' }).select('professional_id')
 if (error) throw error
 if (!data?.length) throw new Error('Não foi possível confirmar o salvamento.')
}
