import { supabase } from '@/lib/supabase'

export interface CommissionBalance {
  appointment_id: string
  establishment_id: string
  professional_id: string
  price_cents: number
  net_received_cents: number
  accrued_cents: number
  mode: 'none' | 'percentage' | 'fixed'
  rate_basis_points: number
  fixed_cents: number
  captured_at: string
}
export async function loadCommissionBalances(establishmentId: string): Promise<CommissionBalance[]> {
  const all: CommissionBalance[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('appointment_commission_balances')
      .select('appointment_id,establishment_id,professional_id,price_cents,net_received_cents,accrued_cents,mode,rate_basis_points,fixed_cents,captured_at')
      .eq('establishment_id', establishmentId)
      .order('captured_at', { ascending: false }).order('appointment_id', { ascending: true })
      .range(offset, offset + 499)
    if (error) throw error
    all.push(...(data ?? []) as CommissionBalance[])
    if (!data || data.length < 500) break
  }
  return all
}
export async function loadProfessionalNames(establishmentId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('professionals')
    .select('id,name').eq('establishment_id', establishmentId)
  if (error) throw error
  return new Map((data ?? []).map((p) => [p.id as string, p.name as string]))
}
