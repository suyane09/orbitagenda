import { describe, expect, it } from 'vitest'
import type { AppointmentRow } from '@/features/appointments/api'
import type { Entry } from '@/features/finance/api'
import { calculateReport } from './calculation'

const ap = (status: AppointmentRow['status'], id: string, price = 3500): AppointmentRow => ({
  id, professional_id: 'p1', professional_name: 'Profissional',
  professional_color: '#000000', service_id: 's1', service_name: 'Corte',
  customer_id: 'c1', customer_name: 'Cliente', customer_phone: null,
  starts_at: '2026-10-23T12:00:00Z', ends_at: '2026-10-23T12:30:00Z',
  status, price_cents: price, notes: null,
})
const entry = (kind: Entry['kind'], amount_cents: number): Entry => ({
  id: 'x' + kind, establishment_id: 'e1', appointment_id: null,
  kind, amount_cents, method: 'pix', description: 'Teste',
  occurred_on: '2026-10-23', created_at: '2026-10-23T15:00:00Z',
})

describe('relatórios financeiros e operacionais', () => {
  it('separa serviços concluídos de dinheiro recebido e calcula ticket', () => {
    const r = calculateReport(
      [ap('completed','a',3500), ap('completed','b',4500),ap('cancelled','c'),ap('no_show','d'),ap('confirmed','e')],
      [entry('income',6000),entry('expense',1000),entry('refund',500)])
    expect(r.completed).toBe(2)
    expect(r.cancelled).toBe(1)
    expect(r.noShow).toBe(1)
    expect(r.confirmed).toBe(1)
    expect(r.completedGrossCents).toBe(8000)
    expect(r.averageTicketCents).toBe(4000)
    expect(r.incomeCents).toBe(6000)
    expect(r.cashNetCents).toBe(4500)
    expect(r.services[0]).toMatchObject({name:'Corte',completed:2,grossCents:8000})
  })
  it('funciona sem movimentações e sem agendamentos', () => {
    const r = calculateReport([],[])
    expect(r.averageTicketCents).toBe(0)
    expect(r.cashNetCents).toBe(0)
    expect(r.services).toEqual([])
  })
})
