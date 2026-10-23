import type { AppointmentRow } from '@/features/appointments/api'
import type { Entry } from '@/features/finance/api'

export interface ReportRanking {
  id: string
  name: string
  completed: number
  grossCents: number
}

export interface ReportSummary {
  scheduled: number
  confirmed: number
  completed: number
  cancelled: number
  noShow: number
  completedGrossCents: number
  averageTicketCents: number
  incomeCents: number
  expenseCents: number
  refundCents: number
  cashNetCents: number
  services: ReportRanking[]
  professionals: ReportRanking[]
}

/** Resultados operacionais por data do atendimento e caixa por data do lançamento. */
export function calculateReport(appointments: AppointmentRow[], entries: Entry[]): ReportSummary {
  const totals = { scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0,
    completedGrossCents: 0, incomeCents: 0, expenseCents: 0, refundCents: 0 }
  const services = new Map<string, ReportRanking>()
  const professionals = new Map<string, ReportRanking>()
  for (const a of appointments) {
    if (a.status === 'no_show') totals.noShow++
    else if (a.status === 'cancelled') totals.cancelled++
    else if (a.status === 'scheduled') totals.scheduled++
    else if (a.status === 'confirmed') totals.confirmed++
    else if (a.status === 'completed') {
      totals.completed++
      totals.completedGrossCents += a.price_cents
      const s = services.get(a.service_id) ?? { id: a.service_id, name: a.service_name, completed: 0, grossCents: 0 }
      s.completed++; s.grossCents += a.price_cents; services.set(a.service_id, s)
      const p = professionals.get(a.professional_id) ?? { id: a.professional_id, name: a.professional_name, completed: 0, grossCents: 0 }
      p.completed++; p.grossCents += a.price_cents; professionals.set(a.professional_id, p)
    }
  }
  for (const e of entries) {
    if (e.kind === 'income') totals.incomeCents += Number(e.amount_cents)
    else if (e.kind === 'expense') totals.expenseCents += Number(e.amount_cents)
    else if (e.kind === 'refund') totals.refundCents += Number(e.amount_cents)
  }
  const rank = (a: ReportRanking,b: ReportRanking) => b.completed-a.completed || a.name.localeCompare(b.name, 'pt-BR')
  return {
    ...totals,
    averageTicketCents: totals.completed ? Math.round(totals.completedGrossCents/totals.completed) : 0,
    cashNetCents: totals.incomeCents-totals.expenseCents-totals.refundCents,
    services: [...services.values()].sort(rank),
    professionals: [...professionals.values()].sort(rank),
  }
}
