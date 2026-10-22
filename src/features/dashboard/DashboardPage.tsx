import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAccount } from '@/features/establishments/AccountProvider'
import { setAppointmentStatus, type AppointmentRow, type AppointmentStatus } from '@/features/appointments/api'
import { STATUS_CHIP, STATUS_LABEL, isActive, zoned } from '@/lib/agenda'
import { describeError } from '@/lib/errors'
import { roleLabel } from '@/lib/labels'
import { formatBRL, formatDuration } from '@/lib/money'
import { formatLongDate, greeting } from '@/lib/time'
import { loadDashboard, type DashboardData } from './api'
import { DayOrbit } from './DayOrbit'

type Filter = 'all' | 'pending' | 'confirmed' | 'completed'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'completed', label: 'Concluídos' },
]

const matches = (f: Filter, s: AppointmentStatus) =>
  f === 'all' || (f === 'pending' && s === 'scheduled') || (f === 'confirmed' && s === 'confirmed') || (f === 'completed' && s === 'completed')

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
const bar = 'block animate-pulse rounded bg-paper motion-reduce:animate-none'
const COLS = 'grid-cols-[3.25rem_minmax(0,1fr)_auto] md:grid-cols-[4.5rem_minmax(0,1.5fr)_minmax(0,1fr)_5.5rem_6rem_6.5rem]'
const ROW_GRID = `grid ${COLS} gap-x-3 gap-y-2 md:items-center md:gap-y-0`

function Panel({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-hairline bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {meta && <div className="text-xs text-slate">{meta}</div>}
      </header>
      {children}
    </section>
  )
}

// ── Faixa de indicadores ────────────────────────────────────────────────────────
function Stat({ label, value, hint, loading, className = '', children }: {
  label: string; value: string; hint?: ReactNode; loading: boolean; className?: string; children?: ReactNode
}) {
  return (
    <div className={`min-w-0 border-hairline px-4 py-3.5 sm:px-5 sm:py-4 ${className}`}>
      <p className="text-xs text-slate">{label}</p>
      {loading ? (
        <div className="mt-2 space-y-2" role="status" aria-label={`Carregando ${label}`}>
          <span className={`${bar} h-7 w-16`} /><span className={`${bar} h-3 w-24`} />
        </div>
      ) : (
        <>
          <p className="mt-1.5 truncate font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums sm:text-[2rem]">{value}</p>
          {children}
          <p className="mt-2 truncate text-xs text-slate">{hint}</p>
        </>
      )}
    </div>
  )
}

// ── Agenda ───────────────────────────────────────────────────────────────────────
function NowLine({ time }: { time: string }) {
  return (
    <li aria-label={`Agora, ${time}`} className="flex items-center gap-2 px-3 py-1 md:px-4">
      <span className="rounded bg-orbit px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-white">{time}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-orbit/40" />
    </li>
  )
}

function AgendaRow({ a, tz, now, busy, onAdvance }: {
  a: AppointmentRow; tz: string; now: Date; busy: boolean; onAdvance: (a: AppointmentRow, s: AppointmentStatus) => void
}) {
  const start = new Date(a.starts_at)
  const end = new Date(a.ends_at)
  const started = start <= now
  const live = isActive(a.status) && started && now < end
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
  const advance: AppointmentStatus | null = a.status === 'scheduled' ? 'confirmed' : a.status === 'confirmed' ? 'completed' : null
  const waiting = advance === 'completed' && !started

  return (
    <li className={`${ROW_GRID} border-l-2 px-3 py-3 transition-colors duration-150 hover:bg-paper/70 motion-reduce:transition-none md:px-4 ${
      live ? 'border-l-orbit bg-orbit-soft/40' : 'border-l-transparent'
    } ${a.status === 'completed' || a.status === 'no_show' ? 'opacity-70' : ''}`}>
      <div>
        <p className="font-display text-[0.95rem] font-semibold leading-tight tabular-nums">{zoned(a.starts_at, tz).time}</p>
        <p className="text-xs tabular-nums text-slate">{zoned(a.ends_at, tz).time}</p>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[0.9rem] font-medium">{a.customer_name}</p>
          {live && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-orbit">
              <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-orbit motion-reduce:animate-none" />Em andamento
            </span>
          )}
        </div>
        <p className="truncate text-[0.8125rem] text-slate">
          <span className="md:hidden">{a.service_name} · {a.professional_name}</span>
          <span className="hidden md:inline">{a.service_name} · {formatDuration(minutes)}{a.customer_phone ? ` · ${a.customer_phone}` : ''}</span>
        </p>
      </div>
      <p className="hidden min-w-0 items-center gap-2 text-sm text-graphite md:flex">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: a.professional_color }} />
        <span className="truncate">{a.professional_name}</span>
      </p>
      <p className="hidden text-right text-sm tabular-nums md:block">{formatBRL(a.price_cents)}</p>
      <div className="flex flex-col items-end gap-1 justify-self-end md:block md:justify-self-start">
        <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
        <span className="text-xs tabular-nums text-slate md:hidden">{formatBRL(a.price_cents)}</span>
      </div>
      {advance ? (
        <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto md:justify-self-end">
          <button type="button" disabled={busy || waiting} onClick={() => onAdvance(a, advance)}
            title={waiting ? 'Disponível após o horário de início' : undefined}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[0.8125rem] font-medium transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
              advance === 'confirmed' ? 'bg-ink text-white hover:bg-graphite' : 'border border-hairline bg-surface hover:border-slate/50'
            }`}>
            {busy && <Spinner className="size-3.5" />}{advance === 'confirmed' ? 'Confirmar' : 'Concluir'}
          </button>
        </div>
      ) : <span className="hidden md:block" />}
    </li>
  )
}

function AgendaSkeleton() {
  return (
    <ul className="divide-y divide-hairline" role="status" aria-label="Carregando agenda de hoje">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-3.5">
          <span className="w-12 space-y-1.5"><span className={`${bar} h-4 w-11`} /><span className={`${bar} h-3 w-8`} /></span>
          <span className="flex-1 space-y-1.5"><span className={`${bar} h-4 w-40 max-w-full`} /><span className={`${bar} h-3 w-56 max-w-full`} /></span>
          <span className={`${bar} hidden h-5 w-20 md:block`} />
        </li>
      ))}
    </ul>
  )
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate">{children}</div>
    </div>
  )
}

const textLink = 'font-medium text-orbit underline-offset-2 hover:underline'

// ── Linhas do painel lateral ─────────────────────────────────────────────────────
const actionRow = 'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-paper/70 motion-reduce:transition-none'

export default function DashboardPage() {
  const { user } = useAuth()
  const { profile, current } = useAccount()
  const est = current!.establishment
  const tz = est.timezone
  const { toast, notify } = useToast()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async (silent = false) => {
    if (!silent) setError(null)
    try { setData(await loadDashboard(est.id, tz)); setNow(new Date()) }
    catch (e) { if (!silent) setError(describeError(e, 'Não foi possível carregar os dados do painel.')) }
  }, [est.id, tz])

  useEffect(() => { setData(null); void load() }, [load])
  // Relógio e agenda se atualizam sozinhos (outros usuários também mexem na agenda).
  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); void load(true) }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const retry = () => { setData(null); void load() }
  const publicPath = `/agendar/${est.slug}`

  async function advance(a: AppointmentRow, status: AppointmentStatus) {
    setBusyId(a.id)
    try { await setAppointmentStatus(est.id, a.id, status); notify(`Agendamento ${STATUS_LABEL[status].toLowerCase()}.`); await load(true) }
    catch (e) { notify(describeError(e, 'Não foi possível atualizar o agendamento.'), 'danger'); await load(true) }
    finally { setBusyId(null) }
  }

  async function copyBookingLink() {
    const url = `${window.location.origin}${publicPath}`
    try { await navigator.clipboard.writeText(url); notify('Link de reserva copiado.') }
    catch { notify(`Não foi possível copiar. Endereço: ${url}`, 'danger') }
  }

  const stats = useMemo(() => {
    let confirmed = 0, pending = 0, completed = 0, revenue = 0, expected = 0, cancelled = 0
    for (const r of data?.agenda ?? []) {
      if (r.status === 'cancelled') { cancelled++; continue }
      if (r.status === 'no_show') continue
      expected += r.price_cents
      if (r.status === 'confirmed') confirmed++
      else if (r.status === 'scheduled') pending++
      else { completed++; revenue += r.price_cents }
    }
    return { total: confirmed + pending + completed, confirmed, pending, completed, revenue, expected, cancelled }
  }, [data])

  const base = useMemo(() => (data?.agenda ?? []).filter((r) => r.status !== 'cancelled'), [data])
  const rows = useMemo(() => base.filter((r) => matches(filter, r.status)), [base, filter])
  const upcoming = useMemo(() => base.filter((r) => isActive(r.status) && new Date(r.ends_at) > now).slice(0, 4), [base, now])
  const nowIndex = useMemo(() => {
    const i = rows.findIndex((r) => new Date(r.starts_at) > now)
    return i === -1 ? rows.length : i
  }, [rows, now])

  const firstName = (profile?.full_name ?? '').split(' ')[0] || 'por aqui'
  const loading = !data && !error
  const dash = (v: string) => (data ? v : '—')
  const clock = zoned(now.toISOString(), tz).time
  const pct = (n: number) => (stats.total ? `${(n / stats.total) * 100}%` : '0%')
  const toReceive = stats.expected - stats.revenue
  const needsSetup = !!data && (data.counts.services === 0 || data.counts.professionals === 0)

  const reviewPending = () => {
    setFilter('pending')
    document.getElementById('agenda-hoje')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-slate">{est.name} <span aria-hidden="true" className="px-0.5 text-hairline">/</span> Visão geral</p>
          <h1 className="mt-1 font-display text-xl font-semibold leading-tight tracking-tight first-letter:uppercase sm:text-2xl">{formatLongDate(now, tz)}</h1>
          <p className="mt-0.5 text-sm text-slate">{greeting(now, tz)}, {firstName}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm tabular-nums text-slate sm:inline" aria-label={`Hora atual ${clock}`}>{clock}</span>
          <Link to="/app/agenda" className="inline-flex h-9 items-center gap-2 rounded-md bg-orbit px-3.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-orbit-deep active:scale-[0.98] motion-reduce:transition-none">
            <Icon name="plus" className="size-4" />Novo agendamento
          </Link>
        </div>
      </header>

      <section aria-label="Indicadores de hoje" className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-hairline bg-surface lg:grid-cols-4">
        <Stat label="Agendamentos hoje" loading={loading} value={dash(String(stats.total))} className="border-b border-r lg:border-b-0"
          hint={stats.completed ? `${stats.completed} já concluído${stats.completed > 1 ? 's' : ''}` : 'Não inclui cancelados'}>
          {data && stats.total > 0 && (
            <div aria-hidden="true" className="mt-2.5 flex h-1 overflow-hidden rounded-full bg-hairline">
              <span className="bg-ink" style={{ width: pct(stats.completed) }} />
              <span className="bg-orbit" style={{ width: pct(stats.confirmed) }} />
              <span className="bg-signal" style={{ width: pct(stats.pending) }} />
            </div>
          )}
        </Stat>
        <Stat label="Confirmados" loading={loading} value={dash(String(stats.confirmed))} className="border-b lg:border-b-0 lg:border-r"
          hint={stats.total ? `de ${stats.total} no dia` : 'Nenhum no dia'} />
        <Stat label="Pendentes" loading={loading} value={dash(String(stats.pending))} className="border-r"
          hint={stats.pending ? <button type="button" onClick={reviewPending} className={textLink}>Revisar agora</button> : 'Nada a confirmar'} />
        <Stat label="Faturamento" loading={loading} value={dash(formatBRL(stats.revenue))}
          hint={`Previsto: ${formatBRL(stats.expected)}`} />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
        <section id="agenda-hoje" aria-label="Agenda de hoje" className="min-w-0 scroll-mt-4 rounded-lg border border-hairline bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline px-4 py-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold">Agenda de hoje</h2>
              {data && <span className="text-xs text-slate">{base.length} {base.length === 1 ? 'atendimento' : 'atendimentos'}{stats.cancelled ? ` · ${stats.cancelled} cancelado${stats.cancelled > 1 ? 's' : ''} oculto${stats.cancelled > 1 ? 's' : ''}` : ''}</span>}
            </div>
            <Link to="/app/agenda" className={`${textLink} inline-flex items-center gap-1 text-sm`}>Abrir agenda<Icon name="arrow" className="size-3.5" /></Link>
          </header>

          {data && base.length > 0 && (
            <div role="group" aria-label="Filtrar agenda" className="flex flex-wrap gap-1 border-b border-hairline px-3 py-2">
              {FILTERS.map((f) => {
                const n = f.key === 'all' ? base.length : f.key === 'pending' ? stats.pending : f.key === 'confirmed' ? stats.confirmed : stats.completed
                return (
                  <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                    className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors duration-150 motion-reduce:transition-none ${filter === f.key ? 'bg-ink text-white' : 'text-slate hover:bg-paper hover:text-ink'}`}>
                    {f.label}<span className="tabular-nums opacity-60">{n}</span>
                  </button>
                )
              })}
            </div>
          )}

          {error ? (
            <Note title="Painel indisponível">
              <p>{error}</p>
              <button type="button" onClick={retry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-hairline bg-surface px-3.5 text-sm font-medium hover:border-slate/50">
                <Icon name="refresh" className="size-4" />Tentar novamente
              </button>
            </Note>
          ) : !data ? (
            <AgendaSkeleton />
          ) : base.length === 0 ? (
            needsSetup ? (
              <Note title="Falta pouco para receber reservas">
                <p>Cadastre ao menos um <Link to="/app/servicos" className={textLink}>serviço</Link> e um <Link to="/app/profissionais" className={textLink}>profissional</Link> para começar a agendar.</p>
              </Note>
            ) : (
              <Note title="Agenda livre por enquanto">
                <p>Nenhum atendimento hoje. <Link to="/app/agenda" className={textLink}>Agende um horário</Link> ou divulgue seu <button type="button" onClick={() => void copyBookingLink()} className={textLink}>link de reserva</button>.</p>
              </Note>
            )
          ) : rows.length === 0 ? (
            <Note title="Nenhum atendimento nesta situação">
              <button type="button" onClick={() => setFilter('all')} className={textLink}>Ver todos</button>
            </Note>
          ) : (
            <>
              <div aria-hidden="true" className={`hidden gap-x-3 border-b border-l-2 border-hairline border-l-transparent px-4 py-2 text-xs text-slate md:grid ${COLS}`}>
                <span>Horário</span><span>Cliente e serviço</span><span>Profissional</span><span className="text-right">Valor</span><span>Situação</span><span />
              </div>
              <ul className="divide-y divide-hairline">
                {rows.flatMap((a, i) => {
                  const item = <AgendaRow key={a.id} a={a} tz={tz} now={now} busy={busyId === a.id} onAdvance={(row, s) => void advance(row, s)} />
                  return i === nowIndex ? [<NowLine key="now" time={clock} />, item] : [item]
                })}
                {nowIndex === rows.length && <NowLine key="now" time={clock} />}
              </ul>
            </>
          )}
        </section>

        <div className="grid min-w-0 gap-4 md:grid-cols-2 md:items-start xl:grid-cols-1">
          <Panel title="Próximos atendimentos" meta={data ? `${upcoming.length} de hoje` : undefined}>
            {!data ? (
              <div className="space-y-3 p-4" role="status" aria-label="Carregando próximos"><span className={`${bar} h-4 w-full`} /><span className={`${bar} h-4 w-5/6`} /><span className={`${bar} h-4 w-2/3`} /></div>
            ) : upcoming.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate">Nenhum atendimento pendente até o fim do dia.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {upcoming.map((a) => {
                  const mins = Math.ceil((new Date(a.starts_at).getTime() - now.getTime()) / 60_000)
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-11 shrink-0 font-display text-[0.95rem] font-semibold tabular-nums">{zoned(a.starts_at, tz).time}</span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm font-medium">{a.customer_name}</span>
                        <span className="block truncate text-xs text-slate">{a.service_name} · {a.professional_name}</span>
                      </span>
                      <span className={`shrink-0 text-xs tabular-nums ${mins <= 0 ? 'font-medium text-orbit' : 'text-slate'}`}>{mins <= 0 ? 'agora' : `em ${formatDuration(mins)}`}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Financeiro do dia">
            {!data ? (
              <div className="space-y-3 p-4" role="status" aria-label="Carregando financeiro"><span className={`${bar} h-8 w-32`} /><span className={`${bar} h-1.5 w-full`} /><span className={`${bar} h-4 w-full`} /></div>
            ) : (
              <div className="px-4 py-4">
                <p className="text-xs text-slate">Realizado</p>
                <p className="mt-1 font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums">{formatBRL(stats.revenue)}</p>
                <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline">
                  <span className="block h-full bg-ink transition-[width] duration-500 motion-reduce:transition-none" style={{ width: stats.expected ? `${(stats.revenue / stats.expected) * 100}%` : '0%' }} />
                </div>
                <dl className="mt-3 divide-y divide-hairline text-sm">
                  {([
                    ['A receber', formatBRL(toReceive)],
                    ['Previsto no dia', formatBRL(stats.expected)],
                    ['Ticket médio previsto', formatBRL(stats.total ? Math.round(stats.expected / stats.total) : 0)],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-2"><dt className="text-slate">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
                  ))}
                </dl>
              </div>
            )}
          </Panel>

          <div className="md:col-span-2 xl:col-span-1">
            <Panel title="Ações">
              <div className="divide-y divide-hairline">
                {stats.pending > 0 && (
                  <button type="button" onClick={reviewPending} className={actionRow}>
                    <span>Revisar pendentes</span>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-800">{stats.pending}</span>
                  </button>
                )}
                <button type="button" onClick={() => void copyBookingLink()} className={actionRow}>
                  <span className="min-w-0"><span className="block">Copiar link de reserva</span><span className="block truncate text-xs text-slate">{publicPath}</span></span>
                  <Icon name="copy" className="size-4 shrink-0 text-slate" />
                </button>
                <a href={publicPath} target="_blank" rel="noopener noreferrer" className={actionRow}>
                  <span>Abrir página pública</span><Icon name="external" className="size-4 shrink-0 text-slate" />
                </a>
                <Link to="/app/horarios" className={actionRow}><span>Bloquear horário ou folga</span><Icon name="arrow" className="size-4 shrink-0 text-slate" /></Link>
                <Link to="/app/clientes" className={actionRow}><span>Cadastrar cliente</span><Icon name="arrow" className="size-4 shrink-0 text-slate" /></Link>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 md:items-start xl:grid-cols-3">
        <Panel title="Linha do dia">
          <div className="p-4">
            {data ? (
              <div className="mx-auto max-w-[16rem]"><DayOrbit appointments={data.today} timezone={tz} now={now} /></div>
            ) : (
              <div className="mx-auto grid aspect-square w-full max-w-[16rem] place-items-center" role="status" aria-label="Carregando linha do dia">
                <span className="size-full animate-pulse rounded-full border-[10px] border-paper motion-reduce:animate-none" />
              </div>
            )}
            <p className="mt-3 text-center text-xs text-slate">Cada arco é um atendimento; o ponto marca a hora atual.</p>
          </div>
        </Panel>

        <Panel title="Configuração da casa">
          {!data ? (
            <div className="space-y-3 p-4" role="status" aria-label="Carregando configuração">{Array.from({ length: 4 }, (_, i) => <span key={i} className={`${bar} h-4 w-full`} />)}</div>
          ) : (
            <>
              <dl className="divide-y divide-hairline px-4 text-sm">
                {([
                  ['Profissionais ativos', data.counts.professionals],
                  ['Serviços ativos', data.counts.services],
                  ['Clientes cadastrados', data.counts.customers],
                  ['Horários de atendimento', data.counts.workingHours],
                ] as const).map(([label, n]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-graphite">{label}</dt>
                    <dd className="flex items-center gap-2.5">
                      <span className="font-display font-semibold tabular-nums">{n}</span>
                      <span className={`inline-flex w-16 items-center gap-1.5 text-xs ${n > 0 ? 'text-ok' : 'text-slate'}`}>
                        <span aria-hidden="true" className={`size-1.5 rounded-full ${n > 0 ? 'bg-ok' : 'border border-slate/60'}`} />{n > 0 ? 'Pronto' : 'Pendente'}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              {data.counts.professionals + data.counts.services === 0 && (
                <p className="border-t border-hairline px-4 py-3 text-sm leading-relaxed text-slate">
                  Comece cadastrando seus <Link to="/app/servicos" className={textLink}>serviços</Link> e <Link to="/app/profissionais" className={textLink}>profissionais</Link>.
                </p>
              )}
            </>
          )}
        </Panel>

        <div className="md:col-span-2 xl:col-span-1">
          <Panel title="Equipe com acesso">
            {!data ? (
              <div className="space-y-3 p-4" role="status" aria-label="Carregando equipe">{Array.from({ length: 2 }, (_, i) => <span key={i} className={`${bar} h-8 w-full`} />)}</div>
            ) : data.team.length === 0 ? (
              <p className="px-4 py-5 text-sm text-slate">Os vínculos da sua equipe aparecem nesta lista.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {data.team.map((m) => (
                  <li key={m.membershipId} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-paper text-xs font-semibold text-graphite">{initials(m.name)}</span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-medium">{m.name}{m.userId === user?.id ? ' (você)' : ''}</p>
                      <p className="text-xs text-slate">{roleLabel[m.role]}{m.isActive ? '' : ' (inativo)'}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-hairline px-4 py-3">
              <button type="button" disabled title="Convites chegam na próxima etapa" className="inline-flex h-8 items-center rounded-md border border-hairline px-3 text-[0.8125rem] font-medium disabled:cursor-not-allowed disabled:opacity-60">Convidar funcionário</button>
            </div>
          </Panel>
        </div>
      </div>
      {toast}
    </div>
  )
}