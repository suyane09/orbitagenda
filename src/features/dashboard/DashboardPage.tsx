import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAccount } from '@/features/establishments/AccountProvider'
import { setAppointmentStatus, type AppointmentRow, type AppointmentStatus } from '@/features/appointments/api'
import { STATUS_CHIP, STATUS_LABEL, isActive, zoned } from '@/lib/agenda'
import { describeError } from '@/lib/errors'
import { roleLabel } from '@/lib/labels'
import { formatBRL, formatDuration } from '@/lib/money'
import { formatLongDate } from '@/lib/time'
import { loadDashboard, type DashboardData } from './api'

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
const textLink = 'font-medium text-orbit underline-offset-2 hover:underline'
const card = 'min-w-0 rounded-xl border border-hairline bg-surface shadow-[0_1px_2px_rgb(17_20_26/0.04)]'
const pill = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100'
const pillPrimary = `${pill} bg-orbit text-white hover:bg-orbit-deep`
const pillOutline = `${pill} border border-hairline bg-surface text-ink hover:border-slate/50`

/* Na agenda, o layout muda pela largura DELA (container query @[40rem]), não pela da tela.
   As classes precisam estar escritas por extenso para o Tailwind gerá-las. */

function Panel({ title, meta, children, className = '' }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`${card} ${className}`}>
      <header className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
        {meta && <div className="text-xs text-slate">{meta}</div>}
      </header>
      {children}
    </section>
  )
}

// ── Indicadores ─────────────────────────────────────────────────────────────────
function Kpi({ label, tone, value, hint, loading, primary = false, className = '', children }: {
  label: string; tone?: string; value: string; hint?: ReactNode; loading: boolean; primary?: boolean; className?: string; children?: ReactNode
}) {
  return (
    <div className={`min-w-0 border-hairline px-4 py-4 sm:px-5 sm:py-5 ${className}`}>
      <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-slate">
        {tone && <span aria-hidden="true" className={`size-1.5 rounded-full ${tone}`} />}{label}
      </p>
      {loading ? (
        <div className="mt-3 space-y-2.5" role="status" aria-label={`Carregando ${label}`}>
          <span className={`${bar} ${primary ? 'h-10 w-20' : 'h-8 w-16'}`} /><span className={`${bar} h-3 w-24`} />
        </div>
      ) : (
        <>
          <p className={`mt-2 truncate font-display font-semibold leading-none tracking-tight tabular-nums ${primary ? 'text-[1.875rem] sm:text-[2.5rem] xl:text-[2.75rem]' : 'text-[1.75rem] sm:text-[2rem]'}`}>{value}</p>
          {children}
          <p className="mt-2.5 truncate text-xs text-slate">{hint}</p>
        </>
      )}
    </div>
  )
}

// ── Linha do tempo da agenda ────────────────────────────────────────────────────
/** Trilho vertical: o nó fica alinhado à primeira linha (empilhado) ou ao centro (colunas). */
function Rail({ first, last, centered = false, children }: { first: boolean; last: boolean; centered?: boolean; children: ReactNode }) {
  const top = centered ? 'top-1/2' : `top-[1.375rem] @[40rem]:top-1/2`
  const half = centered ? 'h-1/2' : `h-[1.375rem] @[40rem]:h-1/2`
  return (
    <div aria-hidden="true" className="relative">
      {!(first && last) && (
        <span className={`absolute left-1/2 w-px -translate-x-1/2 bg-hairline ${first ? `bottom-0 ${top}` : last ? `top-0 ${half}` : 'inset-y-0'}`} />
      )}
      <span className={`absolute left-1/2 z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center ${top}`}>{children}</span>
    </div>
  )
}

function Node({ status, live }: { status: AppointmentStatus; live: boolean }) {
  if (live) {
    return (
      <span className="relative grid size-4 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-orbit/30 motion-reduce:animate-none" />
        <span className="relative size-3 rounded-full bg-orbit ring-[3px] ring-surface" />
      </span>
    )
  }
  if (status === 'completed') return <span className="grid size-4 place-items-center rounded-full bg-ok text-white ring-[3px] ring-surface"><Icon name="check" className="size-2.5" /></span>
  if (status === 'confirmed') return <span className="size-3 rounded-full bg-orbit ring-[3px] ring-surface" />
  if (status === 'scheduled') return <span className="size-3 rounded-full border-2 border-signal bg-surface ring-[3px] ring-surface" />
  return <span className="size-3 rounded-full bg-slate/40 ring-[3px] ring-surface" />
}

function AdvanceButton({ advance, busy, waiting, onClick }: { advance: AppointmentStatus; busy: boolean; waiting: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy || waiting} onClick={onClick}
      title={waiting ? 'Disponível após o horário de início' : undefined}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 ${
        advance === 'confirmed' ? 'bg-ink text-white hover:bg-graphite' : 'border border-hairline bg-surface hover:border-slate/50'
      }`}>
      {busy && <Spinner className="size-3.5" />}{advance === 'confirmed' ? 'Confirmar' : 'Concluir'}
    </button>
  )
}

const ROW_COLS = `grid-cols-[2.75rem_1.25rem_minmax(0,1fr)] @[40rem]:grid-cols-[3rem_1.5rem_minmax(0,1fr)_6.5rem_5.5rem]`

function NowRow({ time, first, last }: { time: string; first: boolean; last: boolean }) {
  return (
    <li aria-label={`Agora, ${time}`} className={`grid items-center gap-x-2 px-1 @[40rem]:gap-x-3 @[40rem]:px-2 ${ROW_COLS}`}>
      <span className="justify-self-start rounded-md bg-orbit px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-white">{time}</span>
      <div className="relative h-7"><Rail first={first} last={last} centered>
        <span className="size-2.5 rounded-full bg-orbit-glow ring-[3px] ring-surface" />
      </Rail></div>
      <span aria-hidden="true" className={`h-px bg-gradient-to-r from-orbit/50 to-transparent @[40rem]:col-span-3`} />
    </li>
  )
}

function AgendaRow({ a, tz, now, busy, first, last, onAdvance }: {
  a: AppointmentRow; tz: string; now: Date; busy: boolean; first: boolean; last: boolean; onAdvance: (a: AppointmentRow, s: AppointmentStatus) => void
}) {
  const start = new Date(a.starts_at)
  const end = new Date(a.ends_at)
  const started = start <= now
  const live = isActive(a.status) && started && now < end
  const total = end.getTime() - start.getTime()
  const minutes = Math.max(0, Math.round(total / 60_000))
  const elapsed = live && total > 0 ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / total) * 100)) : 0
  const advance: AppointmentStatus | null = a.status === 'scheduled' ? 'confirmed' : a.status === 'confirmed' ? 'completed' : null
  const waiting = advance === 'completed' && !started
  const done = a.status === 'completed' || a.status === 'no_show' || a.status === 'cancelled'
  const go = advance ? () => onAdvance(a, advance) : undefined

  return (
    <li className={`group grid gap-x-2 rounded-lg px-1 transition-colors duration-150 motion-reduce:transition-none @[40rem]:gap-x-3 @[40rem]:px-2 ${ROW_COLS} ${live ? 'bg-orbit-soft/60' : 'hover:bg-paper/80'}`}>
      <div className={`py-3 @[40rem]:flex @[40rem]:flex-col @[40rem]:justify-center @[40rem]:py-0`}>
        <p className={`font-display text-[0.9375rem] font-semibold leading-5 tabular-nums ${done ? 'text-slate' : ''}`}>{zoned(a.starts_at, tz).time}</p>
        <p className="text-xs tabular-nums text-slate">{zoned(a.ends_at, tz).time}</p>
      </div>

      <Rail first={first} last={last}><Node status={a.status} live={live} /></Rail>

      <div className="min-w-0 py-3">
        <div className="flex items-center gap-2">
          <p className={`truncate text-[0.9375rem] font-medium leading-5 ${done ? 'text-graphite' : ''}`}>{a.customer_name}</p>
          {live && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-orbit">Em andamento</span>
          )}
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-slate">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: a.professional_color }} />
          <span className="truncate">
            {a.professional_name} · {a.service_name} · {formatDuration(minutes)}
            {a.customer_phone && <span className={`hidden @[40rem]:inline`}> · {a.customer_phone}</span>}
          </span>
        </p>
        {live && (
          <span aria-hidden="true" className="mt-2 block h-1 max-w-[14rem] overflow-hidden rounded-full bg-orbit/15">
            <span className="block h-full rounded-full bg-orbit transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${elapsed}%` }} />
          </span>
        )}
        {/* Empilhado: situação, valor e ação ficam logo abaixo */}
        <div className={`mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 @[40rem]:hidden`}>
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
          <span className="text-[0.8125rem] font-medium tabular-nums">{formatBRL(a.price_cents)}</span>
          {go && advance && <span className="ml-auto"><AdvanceButton advance={advance} busy={busy} waiting={waiting} onClick={go} /></span>}
        </div>
      </div>

      <div className={`hidden flex-col items-end justify-center gap-1 @[40rem]:flex`}>
        <span className="text-sm font-medium tabular-nums">{formatBRL(a.price_cents)}</span>
        <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
      </div>
      <div className={`hidden items-center justify-end @[40rem]:flex`}>
        {go && advance && <AdvanceButton advance={advance} busy={busy} waiting={waiting} onClick={go} />}
      </div>
    </li>
  )
}

function AgendaSkeleton() {
  return (
    <ul className="px-3 py-2" role="status" aria-label="Carregando agenda de hoje">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="grid grid-cols-[2.75rem_1.25rem_minmax(0,1fr)] gap-x-2 px-1 py-3">
          <span className="space-y-1.5"><span className={`${bar} h-4 w-10`} /><span className={`${bar} h-3 w-7`} /></span>
          <span className="mx-auto mt-1 size-3 rounded-full bg-paper" />
          <span className="space-y-2"><span className={`${bar} h-4 w-40 max-w-full`} /><span className={`${bar} h-3 w-56 max-w-full`} /></span>
        </li>
      ))}
    </ul>
  )
}

function OrbitArt() {
  return (
    <svg viewBox="0 0 96 96" className="size-24" aria-hidden="true">
      <circle cx="48" cy="48" r="45" fill="var(--color-orbit-soft)" />
      <ellipse cx="48" cy="48" rx="30" ry="15" transform="rotate(-28 48 48)" fill="none" stroke="var(--color-orbit)" strokeWidth="2.5" />
      <circle cx="48" cy="48" r="5.5" fill="var(--color-ink)" />
      <circle cx="67.4" cy="29.2" r="6.5" fill="var(--color-orbit-glow)" />
    </svg>
  )
}

function EmptyAgenda({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-5 pb-8 pt-9 text-center">
      <OrbitArt />
      <p className="mt-5 font-display text-lg font-semibold tracking-tight">{title}</p>
      <div className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate">{children}</div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">{actions}</div>
      <ul aria-hidden="true" className="mt-8 w-full max-w-xs space-y-2 [mask-image:linear-gradient(to_bottom,#000,transparent)]">
        {['09:00', '10:00', '11:00'].map((t) => (
          <li key={t} className="flex items-center gap-3">
            <span className="w-10 text-right text-xs tabular-nums text-slate">{t}</span>
            <span className="flex h-9 flex-1 items-center rounded-lg border border-dashed border-hairline px-3 text-xs text-slate">Horário livre</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-display text-base font-semibold tracking-tight">{title}</p>
      <div className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate">{children}</div>
    </div>
  )
}

// ── Painel lateral ──────────────────────────────────────────────────────────────
const tile = 'group flex flex-col items-start gap-2.5 rounded-lg border border-hairline bg-surface p-3 text-left text-[0.8125rem] font-medium transition-[background-color,border-color,transform] duration-150 hover:border-orbit/40 hover:bg-orbit-soft/40 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100'
const tileIcon = 'size-4 text-slate transition-colors duration-150 group-hover:text-orbit motion-reduce:transition-none'

function Suggestion({ icon, title, hint, onClick, to }: { icon: IconName; title: string; hint: string; onClick?: () => void; to?: string }) {
  const body = (
    <>
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800"><Icon name={icon} className="size-4" /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-slate">{hint}</span>
      </span>
      <Icon name="arrow" className="size-4 shrink-0 text-slate transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </>
  )
  const cls = 'group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-paper/80 motion-reduce:transition-none'
  return to ? <Link to={to} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { current } = useAccount()
  const est = current!.establishment
  const tz = est.timezone
  const { toast, notify } = useToast()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

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
    try {
      await navigator.clipboard.writeText(url)
      notify('Link de reserva copiado.')
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch { notify(`Não foi possível copiar. Endereço: ${url}`, 'danger') }
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
  const liveNow = useMemo(() => base.find((r) => isActive(r.status) && new Date(r.starts_at) <= now && now < new Date(r.ends_at)), [base, now])
  const nextUp = useMemo(() => base.find((r) => isActive(r.status) && new Date(r.starts_at) > now), [base, now])
  const nowIndex = useMemo(() => {
    const i = rows.findIndex((r) => new Date(r.starts_at) > now)
    return i === -1 ? rows.length : i
  }, [rows, now])
  const items = useMemo(() => {
    const out: Array<{ kind: 'now' } | { kind: 'row'; a: AppointmentRow }> = rows.map((a) => ({ kind: 'row', a }))
    out.splice(nowIndex, 0, { kind: 'now' })
    return out
  }, [rows, nowIndex])
  const byPro = useMemo(() => {
    const m = new Map<string, { name: string; color: string; expected: number }>()
    for (const r of base) {
      if (r.status === 'no_show') continue
      const e = m.get(r.professional_id) ?? { name: r.professional_name, color: r.professional_color, expected: 0 }
      e.expected += r.price_cents
      m.set(r.professional_id, e)
    }
    return [...m.values()].sort((a, b) => b.expected - a.expected)
  }, [base])

  const loading = !data && !error
  const dash = (v: string) => (data ? v : '—')
  const clock = zoned(now.toISOString(), tz).time
  const pct = (n: number) => (stats.total ? `${(n / stats.total) * 100}%` : '0%')
  const toReceive = stats.expected - stats.revenue
  const noServices = !!data && data.counts.services === 0
  const noPros = !!data && data.counts.professionals === 0
  const needsSetup = noServices || noPros

  const reviewPending = () => {
    setFilter('pending')
    document.getElementById('agenda-hoje')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  const steps = data ? [
    { key: 'svc', todo: 'Cadastrar serviços', done: 'Serviços cadastrados', ok: data.counts.services > 0, n: data.counts.services, to: '/app/servicos' },
    { key: 'pro', todo: 'Adicionar profissionais', done: 'Profissionais ativos', ok: data.counts.professionals > 0, n: data.counts.professionals, to: '/app/profissionais' },
    { key: 'hrs', todo: 'Definir horários de atendimento', done: 'Horários definidos', ok: data.counts.workingHours > 0, n: data.counts.workingHours, to: '/app/horarios' },
    { key: 'cus', todo: 'Cadastrar clientes', done: 'Clientes cadastrados', ok: data.counts.customers > 0, n: data.counts.customers, to: '/app/clientes' },
  ] : []
  const stepsDone = steps.filter((s) => s.ok).length
  const allDone = steps.length > 0 && stepsDone === steps.length

  const copyActions = (
    <button type="button" onClick={() => void copyBookingLink()} className={pillOutline}>
      <Icon name={copied ? 'check' : 'copy'} className="size-4" />{copied ? 'Link copiado' : 'Copiar link de reserva'}
    </button>
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-semibold leading-none tracking-tight sm:text-[2rem]">Visão geral</h1>
          <p className="mt-2.5 flex min-w-0 items-center gap-2 text-sm text-slate">
            <span className="shrink-0 first-letter:uppercase">{formatLongDate(now, tz)}</span>
            <span aria-hidden="true" className="size-[3px] shrink-0 rounded-full bg-slate/60" />
            <span className="truncate">{est.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-3 text-sm font-medium tabular-nums sm:inline-flex" aria-label={`Hora atual ${clock}`}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-orbit" />{clock}
          </span>
          <Link to="/app/agenda" className={pillPrimary}><Icon name="plus" className="size-4" />Novo agendamento</Link>
        </div>
      </header>

      <section aria-label="Indicadores de hoje" className={`${card} mt-6 grid grid-cols-2 overflow-hidden lg:grid-cols-[1.35fr_1fr_1fr_1.35fr]`}>
        <Kpi primary label="Atendimentos hoje" loading={loading} value={dash(String(stats.total))} className="border-b border-r lg:border-b-0"
          hint={stats.total ? `${stats.completed} concluído${stats.completed === 1 ? '' : 's'} · ${stats.total - stats.completed} a fazer` : 'Não inclui cancelados'}>
          {data && stats.total > 0 && (
            <div aria-hidden="true" className="mt-3.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-hairline">
              <span className="rounded-full bg-ok transition-[width] duration-500 motion-reduce:transition-none" style={{ width: pct(stats.completed) }} />
              <span className="rounded-full bg-orbit transition-[width] duration-500 motion-reduce:transition-none" style={{ width: pct(stats.confirmed) }} />
              <span className="rounded-full bg-signal transition-[width] duration-500 motion-reduce:transition-none" style={{ width: pct(stats.pending) }} />
            </div>
          )}
        </Kpi>
        <Kpi label="Confirmados" tone="bg-orbit" loading={loading} value={dash(String(stats.confirmed))} className="border-b lg:border-b-0 lg:border-r"
          hint={stats.total ? `de ${stats.total} no dia` : 'Nenhum no dia'} />
        <Kpi label="Pendentes" tone="bg-signal" loading={loading} value={dash(String(stats.pending))} className="border-r"
          hint={stats.pending ? <button type="button" onClick={reviewPending} className={`${textLink} inline-flex items-center gap-1`}>Revisar agora<Icon name="arrow" className="size-3" /></button> : 'Nada a confirmar'} />
        <Kpi primary label="Faturamento" tone="bg-ok" loading={loading} value={dash(formatBRL(stats.revenue))}
          hint={`de ${formatBRL(stats.expected)} previsto`}>
          {data && (
            <div aria-hidden="true" className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-hairline">
              <span className="block h-full rounded-full bg-ok transition-[width] duration-500 motion-reduce:transition-none" style={{ width: stats.expected ? `${(stats.revenue / stats.expected) * 100}%` : '0%' }} />
            </div>
          )}
        </Kpi>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <section id="agenda-hoje" aria-label="Agenda de hoje" className={`${card} @container scroll-mt-4 xl:col-start-1`}>
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-4">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-display text-lg font-semibold tracking-tight">Agenda de hoje</h2>
              {data && <span className="text-xs text-slate">{base.length} {base.length === 1 ? 'atendimento' : 'atendimentos'}{stats.cancelled ? ` · ${stats.cancelled} cancelado${stats.cancelled > 1 ? 's' : ''} oculto${stats.cancelled > 1 ? 's' : ''}` : ''}</span>}
            </div>
            <Link to="/app/agenda" className={`${textLink} group inline-flex items-center gap-1 text-sm`}>Abrir agenda<Icon name="arrow" className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" /></Link>
          </header>

          {data && (liveNow || nextUp) && (
            <div className={`relative mx-4 mb-3 flex items-center gap-3 overflow-hidden rounded-lg border px-3.5 py-2.5 ${liveNow ? 'border-orbit/20 bg-orbit-soft' : 'border-hairline bg-paper/60'}`}>
              {(() => {
                const a = (liveNow ?? nextUp)!
                const mins = Math.ceil((new Date(a.starts_at).getTime() - now.getTime()) / 60_000)
                return (
                  <>
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${liveNow ? 'animate-pulse bg-orbit motion-reduce:animate-none' : 'bg-signal'}`} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm"><span className={`font-medium ${liveNow ? 'text-orbit' : ''}`}>{liveNow ? 'Em andamento' : 'Próximo'}</span><span className="text-slate"> · </span>{a.customer_name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate">{a.service_name} · {a.professional_name}</p>
                    </div>
                    <p className="shrink-0 text-right leading-tight">
                      <span className="block font-display text-base font-semibold tabular-nums">{liveNow ? zoned(a.ends_at, tz).time : zoned(a.starts_at, tz).time}</span>
                      <span className="block text-xs text-slate">{liveNow ? 'termina' : `em ${formatDuration(Math.max(mins, 1))}`}</span>
                    </p>
                  </>
                )
              })()}
            </div>
          )}

          {data && base.length > 0 && (
            <div role="group" aria-label="Filtrar agenda" className="flex flex-wrap gap-1 px-4 pb-2">
              {FILTERS.map((f) => {
                const n = f.key === 'all' ? base.length : f.key === 'pending' ? stats.pending : f.key === 'confirmed' ? stats.confirmed : stats.completed
                return (
                  <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                    className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-medium transition-colors duration-150 motion-reduce:transition-none ${filter === f.key ? 'bg-ink text-white' : 'text-slate hover:bg-paper hover:text-ink'}`}>
                    {f.label}<span className={`tabular-nums ${filter === f.key ? 'text-white/70' : 'text-slate'}`}>{n}</span>
                  </button>
                )
              })}
            </div>
          )}

          {error ? (
            <Note title="Painel indisponível">
              <p>{error}</p>
              <button type="button" onClick={retry} className={`${pillOutline} mt-4`}><Icon name="refresh" className="size-4" />Tentar novamente</button>
            </Note>
          ) : !data ? (
            <AgendaSkeleton />
          ) : base.length === 0 ? (
            needsSetup ? (
              <EmptyAgenda title="Falta pouco para receber reservas"
                actions={<>
                  {noServices && <Link to="/app/servicos" className={pillPrimary}>Cadastrar serviço</Link>}
                  {noPros && <Link to="/app/profissionais" className={noServices ? pillOutline : pillPrimary}>Cadastrar profissional</Link>}
                </>}>
                <p>Cadastre ao menos um serviço e um profissional para começar a agendar.</p>
              </EmptyAgenda>
            ) : (
              <EmptyAgenda title="Agenda livre por enquanto"
                actions={<><Link to="/app/agenda" className={pillPrimary}><Icon name="plus" className="size-4" />Novo agendamento</Link>{copyActions}</>}>
                <p>Nenhum atendimento hoje. Crie um horário ou divulgue seu link para receber reservas online.</p>
              </EmptyAgenda>
            )
          ) : rows.length === 0 ? (
            <Note title="Nenhum atendimento nesta situação">
              <button type="button" onClick={() => setFilter('all')} className={textLink}>Ver todos</button>
            </Note>
          ) : (
            <ul className="px-3 pb-3 pt-1">
              {items.map((it, i) => it.kind === 'now'
                ? <NowRow key="now" time={clock} first={i === 0} last={i === items.length - 1} />
                : <AgendaRow key={it.a.id} a={it.a} tz={tz} now={now} busy={busyId === it.a.id} first={i === 0} last={i === items.length - 1}
                    onAdvance={(row, s) => void advance(row, s)} />)}
            </ul>
          )}
        </section>

        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 md:items-start xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:grid-cols-1">
          <Panel title="Ações">
            <div className="px-3 pb-3 pt-1">
              {data && (stats.pending > 0 || (!needsSetup && base.length === 0)) && (
                <div className="mb-2 border-b border-hairline pb-2">
                  {stats.pending > 0 && <Suggestion icon="check" title="Confirmar pendentes" hint={`${stats.pending} aguardando confirmação`} onClick={reviewPending} />}
                  {!needsSetup && base.length === 0 && <Suggestion icon="link" title="Divulgar link de reserva" hint="Agenda livre hoje" onClick={() => void copyBookingLink()} />}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void copyBookingLink()} title={publicPath} className={tile}>
                  <Icon name={copied ? 'check' : 'copy'} className={copied ? 'size-4 text-ok' : tileIcon} />{copied ? 'Link copiado' : 'Copiar link'}
                </button>
                <a href={publicPath} target="_blank" rel="noopener noreferrer" className={tile}>
                  <Icon name="external" className={tileIcon} />Página pública
                </a>
                <Link to="/app/horarios" className={tile}><Icon name="clock" className={tileIcon} />Bloquear horário</Link>
                <Link to="/app/clientes" className={tile}><Icon name="users" className={tileIcon} />Novo cliente</Link>
              </div>
            </div>
          </Panel>

          <Panel title="Financeiro">
            {!data ? (
              <div className="space-y-3 p-5" role="status" aria-label="Carregando financeiro"><span className={`${bar} h-8 w-32`} /><span className={`${bar} h-4 w-full`} /><span className={`${bar} h-4 w-full`} /></div>
            ) : (
              <div className="px-5 pb-5 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-slate">A receber</p>
                    <p className="mt-1.5 truncate font-display text-[1.625rem] font-semibold leading-none tracking-tight tabular-nums">{formatBRL(toReceive)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate">Ticket médio</p>
                    <p className="mt-1.5 truncate font-display text-[1.625rem] font-semibold leading-none tracking-tight tabular-nums">{formatBRL(stats.total ? Math.round(stats.expected / stats.total) : 0)}</p>
                  </div>
                </div>
                <div className="mt-5 border-t border-hairline pt-4">
                  <p className="text-xs text-slate">Por profissional</p>
                  {byPro.length === 0 ? (
                    <p className="mt-2 text-sm text-slate">Sem valores previstos hoje.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {byPro.map((p) => (
                        <li key={p.name}>
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate">{p.name}</span>
                            <span className="shrink-0 font-medium tabular-nums">{formatBRL(p.expected)}</span>
                          </div>
                          <div aria-hidden="true" className="mt-1.5 h-1 overflow-hidden rounded-full bg-hairline">
                            <span className="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: stats.expected ? `${(p.expected / stats.expected) * 100}%` : '0%', backgroundColor: p.color }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 md:items-start xl:col-start-1">
          <Panel title="Ativação" meta={data ? (allDone ? <span className="font-medium text-ok">Completa</span> : `${stepsDone} de ${steps.length}`) : undefined}>
            {!data ? (
              <div className="space-y-3 p-5" role="status" aria-label="Carregando ativação">{Array.from({ length: 4 }, (_, i) => <span key={i} className={`${bar} h-4 w-full`} />)}</div>
            ) : (
              <div className="px-5 pb-4 pt-2">
                <div aria-hidden="true" className="flex gap-1">
                  {steps.map((s) => <span key={s.key} className={`h-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none ${s.ok ? 'bg-ok' : 'bg-hairline'}`} />)}
                </div>
                {allDone ? (
                  <details className="group mt-3 text-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded text-slate [&::-webkit-details-marker]:hidden">
                      <span>Tudo pronto para receber reservas.</span>
                      <span className="text-xs font-medium text-orbit group-open:hidden">Ver detalhes</span>
                    </summary>
                    <ol className="mt-2 divide-y divide-hairline">
                      {steps.map((s) => (
                        <li key={s.key} className="flex items-center justify-between gap-3 py-2 text-slate"><span>{s.done}</span><span className="font-medium tabular-nums text-ink">{s.n}</span></li>
                      ))}
                    </ol>
                  </details>
                ) : (
                  <ol className="mt-2 divide-y divide-hairline text-sm">
                    {steps.map((s) => s.ok ? (
                      <li key={s.key} className="flex items-center gap-2.5 py-2 text-slate">
                        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded-full bg-ok text-white"><Icon name="check" className="size-2.5" /></span>
                        <span className="min-w-0 flex-1 truncate">{s.done}</span><span className="font-medium tabular-nums text-ink">{s.n}</span>
                      </li>
                    ) : (
                      <li key={s.key}>
                        <Link to={s.to} className="group flex items-center gap-2.5 py-2 font-medium transition-colors duration-150 hover:text-orbit motion-reduce:transition-none">
                          <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-[1.5px] border-slate/50" />
                          <span className="min-w-0 flex-1 truncate">{s.todo}</span>
                          <Icon name="arrow" className="size-3.5 shrink-0 text-slate transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-orbit motion-reduce:transition-none" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Equipe">
            {!data ? (
              <div className="space-y-3 p-5" role="status" aria-label="Carregando equipe">{Array.from({ length: 2 }, (_, i) => <span key={i} className={`${bar} h-8 w-full`} />)}</div>
            ) : (
              <>
                {data.team.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate">Os vínculos da sua equipe aparecem nesta lista.</p>
                ) : (
                  <ul className="px-5 pt-1">
                    {data.team.map((m) => (
                      <li key={m.membershipId} className="flex items-center gap-3 py-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold text-graphite">{initials(m.name)}</span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <p className="truncate text-sm font-medium">{m.name}{m.userId === user?.id ? ' (você)' : ''}</p>
                          <p className="text-xs text-slate">{roleLabel[m.role]}{m.isActive ? '' : ' (inativo)'}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-5 pb-4 pt-2">
                  <button type="button" disabled title="Convites chegam na próxima etapa" className={`${pillOutline} h-8 text-[0.8125rem] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-hairline`}>Convidar funcionário</button>
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
      {toast}
    </div>
  )
}
