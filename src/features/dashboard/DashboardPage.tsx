import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { describeError } from '@/lib/errors'
import { formatLongDate, greeting } from '@/lib/time'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAccount } from '@/features/establishments/AccountProvider'
import { roleLabel } from '@/lib/labels'
import { loadDashboard, type DashboardData } from './api'
import { DayOrbit } from './DayOrbit'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { profile, current } = useAccount()
  const est = current!.establishment
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    setError(null)
    try { setData(await loadDashboard(est.id, est.timezone)); setNow(new Date()) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar os dados do painel.')) }
  }, [est.id, est.timezone])

  useEffect(() => { setData(null); void load() }, [load])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])

  const firstName = (profile?.full_name ?? '').split(' ')[0] || 'por aqui'

  if (error) return <ErrorState title="Painel indisponível" message={error} onRetry={() => void load()} />

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
      <header>
        <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">
          {greeting(now, est.timezone)}, {firstName}
        </h1>
        <p className="mt-1.5 text-slate">
          {formatLongDate(now, est.timezone)} em {est.name}
        </p>
      </header>

      {!data ? (
        <div className="mt-16 flex items-center justify-center gap-3 text-slate"><Spinner />Carregando dados reais do estabelecimento…</div>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <section aria-labelledby="hoje" className="rounded-panel border border-hairline bg-surface p-6 sm:p-8">
            <h2 id="hoje" className="font-display text-lg font-semibold">Hoje no relógio</h2>
            <p className="mt-1 text-sm text-slate">Cada arco é um atendimento; o ponto marca a hora atual.</p>
            <div className="mt-6"><DayOrbit appointments={data.today} timezone={est.timezone} now={now} /></div>
          </section>

          <div className="space-y-6">
            <section aria-labelledby="setup" className="rounded-panel border border-hairline bg-surface p-6 sm:p-8">
              <h2 id="setup" className="font-display text-lg font-semibold">Configuração da casa</h2>
              <dl className="mt-4 divide-y divide-hairline">
                {([
                  ['Profissionais ativos', data.counts.professionals],
                  ['Serviços ativos', data.counts.services],
                  ['Clientes cadastrados', data.counts.customers],
                  ['Horários de atendimento', data.counts.workingHours],
                ] as const).map(([label, n]) => (
                  <div key={label} className="flex items-center justify-between gap-4 py-3.5">
                    <dt className="text-[0.95rem] text-graphite">{label}</dt>
                    <dd className="flex items-center gap-3">
                      <span className="font-display text-xl font-semibold tabular-nums">{n}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${n > 0 ? 'bg-ok-soft text-ok' : 'bg-paper text-slate'}`}>{n > 0 ? 'Pronto' : 'Pendente'}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {data.counts.professionals + data.counts.services === 0 && (
                <p className="mt-4 text-sm leading-relaxed text-slate">O cadastro de profissionais, serviços e horários chega na próxima etapa do Orbit Agenda.</p>
              )}
            </section>

            <section aria-labelledby="equipe" className="rounded-panel border border-hairline bg-surface p-6 sm:p-8">
              <h2 id="equipe" className="font-display text-lg font-semibold">Equipe com acesso</h2>
              {data.team.length === 0 ? (
                <div className="mt-4"><EmptyState title="Ninguém por aqui ainda">Os vínculos da sua equipe aparecem nesta lista.</EmptyState></div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {data.team.map((m) => (
                    <li key={m.membershipId} className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-orbit-soft text-sm font-semibold text-orbit-deep">{initials(m.name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.95rem] font-medium">{m.name}{m.userId === user?.id ? ' (você)' : ''}</p>
                        <p className="text-sm text-slate">{roleLabel[m.role]}{m.isActive ? '' : ' (inativo)'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5"><Button variant="outline" disabled title="Convites chegam na próxima etapa">Convidar funcionário</Button></div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
