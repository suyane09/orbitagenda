import { useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/features/establishments/AccountProvider'
import { listAppointments, type AppointmentRow } from '@/features/appointments/api'
import { listEntries, type Entry } from '@/features/finance/api'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { ErrorState } from '@/components/ui/States'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import { todayInZone } from '@/lib/schedule'
import { calculateReport, type ReportRanking } from './calculation'

const tile = 'rounded-xl border border-hairline bg-surface p-5'
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

function Ranking({ title, rows }: { title: string; rows: ReportRanking[] }) {
  const max = rows[0]?.completed ?? 1
  return <section className={tile}>
    <h2 className="font-display text-lg font-semibold">{title}</h2>
    <p className="mt-1 text-xs text-slate">Apenas atendimentos concluídos, por data de execução.</p>
    {!rows.length ? <p className="mt-5 text-sm text-slate">Nenhum atendimento concluído no período.</p> :
      <ol className="mt-5 space-y-4">{rows.slice(0, 10).map(r => <li key={r.id}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{r.name}</span>
          <span className="tabular-nums text-slate">{r.completed} atendimentos · {formatBRL(r.grossCents)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper">
          <div className="h-full rounded-full bg-orbit" style={{ width: `${(r.completed / max) * 100}%` }} />
        </div>
      </li>)}</ol>}
  </section>
}

export default function ReportsPage() {
  const { current } = useAccount()
  const establishmentId = current?.establishment.id ?? ''
  const owner = current?.role === 'owner'
  const tz = current?.establishment.timezone ?? 'America/Maceio'
  const [from, setFrom] = useState(() => todayInZone(new Date(), tz).slice(0,7) + '-01')
  const [to, setTo] = useState(() => todayInZone(new Date(), tz))
  const [nonce, setNonce] = useState(0)
  const [ap, setAp] = useState<AppointmentRow[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const duration = daysBetween(from,to)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
    && Number.isFinite(duration) && duration >= 0 && duration <= 62

  useEffect(() => {
    let active = true
    setAp([]); setEntries([]); setError('')
    if (!owner || !establishmentId) { setLoading(false); return () => { active = false } }
    if (!valid) { setLoading(false); return () => { active = false } }
    setLoading(true)
    Promise.all([listAppointments(establishmentId,from,to),listEntries(establishmentId,from,to)])
      .then(([appointments,financial]) => { if (active) { setAp(appointments); setEntries(financial) } })
      .catch(e => { if (active) setError(describeError(e, 'Não foi possível carregar os relatórios.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [establishmentId, owner, from, to, nonce, valid])

  const report = useMemo(() => calculateReport(ap,entries),[ap,entries])
  if (!owner) return <ErrorState title="Acesso restrito" message="Somente o proprietário pode consultar os relatórios." />

  return <div className="w-full min-w-0 space-y-5 px-4 py-6 pb-12 sm:px-6 lg:px-8 lg:py-8">
    <header>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-slate">Gestão</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Relatórios</h1>
      <p className="mt-1 text-sm text-slate">Resultados do negócio: agendamentos realizados e movimentações financeiras.</p>
    </header>
    <section className={tile + ' flex flex-wrap items-end gap-3'} aria-label="Selecionar período">
      <div className="min-w-[145px] flex-1 sm:max-w-[190px]">
        <TextField type="date" label="De" value={from} max={to} onChange={e=>setFrom(e.target.value)} />
      </div>
      <div className="min-w-[145px] flex-1 sm:max-w-[190px]">
        <TextField type="date" label="Até" value={to} min={from} onChange={e=>setTo(e.target.value)} />
      </div>
      <Button variant="outline" onClick={() => setNonce(n => n+1)} disabled={loading || !valid}>Atualizar</Button>
      <p className="w-full text-xs text-slate">Períodos de até 63 dias. Valores de serviços e de caixa usam datas diferentes.</p>
    </section>
    {!valid && <Alert>Escolha um período válido de até 63 dias, com a data inicial anterior à final.</Alert>}
    {error && <Alert>{error}</Alert>}
    {loading ? <p className="py-12 text-center text-sm text-slate">Carregando relatórios…</p> :
      valid && !error && <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores">
          {([
            ['Recebimentos',report.incomeCents],
            ['Despesas e estornos',report.expenseCents + report.refundCents],
            ['Saldo de caixa',report.cashNetCents],
            ['Valor de serviços concluídos',report.completedGrossCents],
          ] as const).map(([label,value]) => <div className={tile} key={label}>
            <p className="text-xs font-medium text-slate">{label}</p>
            <p className="mt-3 break-words font-display text-[1.65rem] font-semibold tabular-nums">{formatBRL(value)}</p>
          </div>)}
        </section>
        <section className={tile}>
          <h2 className="font-display text-lg font-semibold">Atendimentos no período</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ['Concluídos',report.completed],
              ['Confirmados',report.confirmed],
              ['Agendados',report.scheduled],
              ['Cancelados',report.cancelled],
              ['Faltas',report.noShow],
            ] as const).map(([label,n]) => <div key={label}>
              <p className="text-xs text-slate">{label}</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{n}</p>
            </div>)}
            <div><p className="text-xs text-slate">Ticket médio concluído</p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">{formatBRL(report.averageTicketCents)}</p></div>
          </div>
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <Ranking title="Serviços mais realizados" rows={report.services} />
          <Ranking title="Desempenho por profissional" rows={report.professionals} />
        </div>
        <p className="text-xs leading-relaxed text-slate">Recebimentos, despesas e estornos são filtrados pela data do lançamento no Financeiro. Serviços concluídos e rankings são filtrados pela data do atendimento e representam valores dos serviços, não necessariamente já recebidos. Os resultados respeitam a permissão do proprietário e o estabelecimento selecionado.</p>
      </>}
  </div>
}
