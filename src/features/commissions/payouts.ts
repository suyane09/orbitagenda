import { supabase } from '@/lib/supabase'

export interface CommissionPayout {
  id: string
  establishment_id: string
  professional_id: string
  amount_cents: number
  method: 'pix' | 'cash' | 'card' | 'other'
  paid_on: string
  note: string
  created_at: string
}

/** Histórico completo; acesso de leitura restrito ao proprietário por RLS. */
export async function loadCommissionPayouts(establishmentId: string): Promise<CommissionPayout[]> {
  const all: CommissionPayout[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('commission_payouts')
      .select('id,establishment_id,professional_id,amount_cents,method,paid_on,note,created_at')
      .eq('establishment_id', establishmentId)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(offset, offset + 499)
    if (error) throw error
    all.push(...(data ?? []) as CommissionPayout[])
    if (!data || data.length < 500) break
  }
  return all
}

export async function recordCommissionPayout(input: {
  establishmentId: string
  professionalId: string
  amountCents: number
  method: CommissionPayout['method']
  paidOn: string
  note: string
}): Promise<void> {
  const { error } = await supabase.rpc('record_commission_payout', {
    p_establishment_id: input.establishmentId,
    p_professional_id: input.professionalId,
    p_amount_cents: input.amountCents,
    p_method: input.method,
    p_paid_on: input.paidOn,
    p_note: input.note,
  })
  if (error) throw error
}
