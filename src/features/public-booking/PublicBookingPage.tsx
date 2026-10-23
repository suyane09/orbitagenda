import { useEffect, useReducer, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { TextField } from '@/components/ui/Field'
import { OrbitMark } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { env } from '@/lib/env'
import { supabase } from '@/lib/supabase'
import { TurnstileWidget, type TurnstileHandle } from './Turnstile'
import { BUSINESS_TYPES } from '@/lib/validation'

type Service = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  price_cents: number
}

type Professional = {
  id: string
  name: string
  bio: string | null
}

type Link = {
  professional_id: string
  service_id: string
}

type Slot = {
  slot_start: string
  slot_end: string
}

type Catalog = {
  establishment: {
    name: string
    slug: string
    business_type: string
    /** Opcional: usado somente se a Edge Function já o devolver. */
    timezone?: string | null
  }
  services: Service[]
  professionals: Professional[]
  professional_services: Link[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Datas e fuso horário
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE = 'America/Maceio'

function resolveTimeZone(value?: string | null) {
  if (!value) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value })
    return value
  } catch {
    return DEFAULT_TIMEZONE
  }
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year: year ?? 1970, month: (month ?? 1) - 1, day: day ?? 1 }
}

/** Data (AAAA-MM-DD) de um instante no fuso do estabelecimento. */
function isoDateInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Soma dias a uma data AAAA-MM-DD sem depender do fuso do navegador. */
function addDays(iso: string, offset: number) {
  const { year, month, day } = parseIsoDate(iso)
  const d = new Date(Date.UTC(year, month, day + offset))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** "Hoje" (+ offset) no fuso do estabelecimento. */
function localDate(timeZone: string, offset = 0) {
  return addDays(isoDateInZone(new Date(), timeZone), offset)
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso))
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatLongDate(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).formatToParts(new Date(iso))
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const weekday = pick('weekday')

  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    day: pick('day'),
    monthYear: `${pick('month')} de ${pick('year')}`,
  }
}

/** Rótulo de um instante (ex.: início da reserva) no fuso do estabelecimento. */
function formatDayLabel(date: Date, timeZone: string) {
  return capitalize(
    new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone,
    }).format(date),
  )
}

/** Rótulo de uma data de calendário (AAAA-MM-DD), sem conversão de fuso. */
function formatIsoDayLabel(iso: string) {
  const { year, month, day } = parseIsoDate(iso)
  return capitalize(
    new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month, day))),
  )
}

function slotHour(iso: string, timeZone: string) {
  const hour = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso))
  return Number(hour)
}

function toCalendarStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Valida os horários devolvidos pela API:
 * - descarta inícios inválidos, duplicados, já passados ou de outro dia (no fuso do estabelecimento);
 * - recalcula o término como início + duração do serviço, garantindo que
 *   "até HH:MM" e o link do Google Agenda sempre respeitem a duração escolhida.
 */
function sanitizeSlots(raw: unknown[], durationMinutes: number, date: string, timeZone: string): Slot[] {
  if (!(durationMinutes > 0)) return []

  const now = Date.now()
  const seen = new Set<string>()
  const result: { slot: Slot; time: number }[] = []

  for (const item of raw) {
    const startIso = (item as Partial<Slot> | null)?.slot_start
    if (typeof startIso !== 'string') continue

    const start = new Date(startIso)
    const time = start.getTime()
    if (Number.isNaN(time) || time <= now || seen.has(startIso)) continue
    if (isoDateInZone(start, timeZone) !== date) continue

    seen.add(startIso)
    result.push({
      slot: {
        slot_start: startIso,
        slot_end: new Date(time + durationMinutes * 60_000).toISOString(),
      },
      time,
    })
  }

  return result.sort((a, b) => a.time - b.time).map((entry) => entry.slot)
}

type IconName =
  | 'service'
  | 'user'
  | 'store'
  | 'clock'
  | 'cash'
  | 'calendar'
  | 'arrow'
  | 'external'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'sun'
  | 'sunset'
  | 'moon'
  | 'lock'
  | 'alert'

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  service: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  store: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  external: <path d="M7 17 17 7M8 7h9v9" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  sunset: (
    <>
      <path d="M17 18a5 5 0 0 0-10 0" />
      <path d="M12 9v2M4.2 12.2l1.4 1.4M1 18h2M21 18h2M18.4 13.6l1.4-1.4M23 22H1M8 6l4-4 4 4" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5M12 16h.01" />
    </>
  ),
}

function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

function Reveal({
  show,
  delay = 0,
  className = '',
  children,
}: {
  show: boolean
  delay?: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition duration-700 ease-out motion-reduce:transition-none ${
        show ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  )
}

function SuccessMark({ show }: { show: boolean }) {
  return (
    <div className="relative mx-auto size-24">
      <div
        aria-hidden="true"
        className={`absolute inset-3 rounded-full bg-ok/15 blur-xl transition duration-1000 motion-reduce:transition-none ${
          show ? 'scale-125 opacity-100' : 'scale-75 opacity-0'
        }`}
      />
      <svg
        viewBox="0 0 96 96"
        aria-hidden="true"
        className={`relative size-24 transition duration-700 ease-out motion-reduce:transition-none ${
          show ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
        }`}
      >
        <g transform="rotate(-28 48 48)">
          <ellipse cx="48" cy="48" rx="44" ry="18" fill="none" className="stroke-ok/30" strokeWidth="1.5" />
        </g>
        <circle cx="48" cy="48" r="30" className="fill-ok-soft stroke-ok/25" strokeWidth="1.5" />
        <g transform="rotate(-28 48 48)">
          <circle cx="92" cy="48" r="4.5" className="fill-ok" />
        </g>
        <path
          d="M37 49.5l7.5 7.5L60 40"
          pathLength={1}
          fill="none"
          className="stroke-ok"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 1,
            strokeDashoffset: show ? 0 : 1,
            transition: 'stroke-dashoffset 600ms cubic-bezier(0.65, 0, 0.35, 1) 350ms',
          }}
        />
      </svg>
    </div>
  )
}

type BookingConfirmationProps = {
  establishmentName: string
  serviceName?: string | undefined
  professionalName?: string | undefined
  durationMinutes?: number | undefined
  priceCents?: number | undefined
  startIso: string
  endIso?: string | undefined
  customerName: string
  bookingId: string
  timeZone: string
  onNewBooking: () => void
}

function BookingConfirmation({
  establishmentName,
  serviceName,
  professionalName,
  durationMinutes,
  priceCents,
  startIso,
  endIso,
  customerName,
  bookingId,
  timeZone,
  onNewBooking,
}: BookingConfirmationProps) {
  const [entered, setEntered] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
    headingRef.current?.focus({ preventScroll: true })
    const timer = window.setTimeout(() => setEntered(true), 40)
    return () => window.clearTimeout(timer)
  }, [])

  const start = new Date(startIso)
  const end = endIso
    ? new Date(endIso)
    : new Date(start.getTime() + (durationMinutes ?? 0) * 60_000)
  const hasEnd = Boolean(endIso) || Boolean(durationMinutes)

  const { weekday, day, monthYear } = formatLongDate(startIso, timeZone)
  const firstName = customerName.trim().split(/\s+/)[0]
  const reference = bookingId.replace(/-/g, '').slice(0, 8).toUpperCase()

  const detailLines = [
    professionalName ? `Profissional: ${professionalName}` : '',
    durationMinutes ? `Duração: ${formatDuration(durationMinutes)}` : '',
    priceCents !== undefined ? `Valor: ${formatMoney(priceCents)}` : '',
    'Agendado via Orbit Agenda',
  ].filter(Boolean)

  const calendarParams = new URLSearchParams({
    action: 'TEMPLATE',
    text: [serviceName, establishmentName].filter(Boolean).join(' · '),
    dates: `${toCalendarStamp(start)}/${toCalendarStamp(hasEnd ? end : start)}`,
    details: detailLines.join('\n'),
    ctz: timeZone,
  })
  const calendarUrl = `https://calendar.google.com/calendar/render?${calendarParams.toString()}`

  const rows: { icon: IconName; label: string; value: string; emphasis?: boolean }[] = [
    { icon: 'service', label: 'Serviço', value: serviceName ?? '—' },
    { icon: 'user', label: 'Profissional', value: professionalName ?? '—' },
    { icon: 'store', label: 'Estabelecimento', value: establishmentName },
    {
      icon: 'clock',
      label: 'Duração',
      value: durationMinutes ? formatDuration(durationMinutes) : '—',
    },
    {
      icon: 'cash',
      label: 'Valor',
      value: priceCents !== undefined ? formatMoney(priceCents) : '—',
      emphasis: true,
    },
  ]

  const actionBase =
    'group inline-flex w-full items-center justify-center gap-2.5 rounded-control px-5 py-3.5 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0'

  return (
    <main className="relative min-h-dvh overflow-hidden bg-paper text-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-12rem] size-[34rem] -translate-x-1/2 rounded-full bg-orbit-soft blur-3xl"
      />

      <div className="relative mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-10 pt-10 sm:pt-14">
        <header className="text-center">
          <SuccessMark show={entered} />

          <Reveal show={entered} delay={150} className="mt-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-ok-soft px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ok">
              <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
              Reserva confirmada
            </span>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-4 font-display text-[2rem] font-semibold leading-tight tracking-tight outline-none sm:text-[2.5rem]"
            >
              {firstName ? `Tudo certo, ${firstName}!` : 'Tudo certo!'}
            </h1>
            <p className="mx-auto mt-3 max-w-sm text-[0.95rem] leading-relaxed text-slate">
              Seu horário em <span className="font-medium text-graphite">{establishmentName}</span> está
              reservado. Confira os detalhes abaixo.
            </p>
          </Reveal>
        </header>

        <Reveal show={entered} delay={300} className="mt-9">
          <article
            aria-label="Resumo do agendamento"
            className="overflow-hidden rounded-panel border border-hairline bg-surface shadow-[0_1px_2px_rgba(17,20,26,0.04),0_28px_56px_-28px_rgba(45,41,176,0.35)]"
          >
            <div className="relative isolate overflow-hidden bg-ink px-6 pb-7 pt-6 text-white sm:px-8">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-[radial-gradient(110%_100%_at_100%_0%,rgba(139,140,245,0.38),transparent_60%)]"
              />
              <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-white/55">
                Data e horário
              </p>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                <div className="flex items-end gap-3.5">
                  <span className="font-display text-6xl font-semibold leading-[0.85] tracking-tight tabular-nums">
                    {day}
                  </span>
                  <div className="pb-0.5 leading-snug">
                    <p className="text-base font-medium">{weekday}</p>
                    <p className="text-sm text-white/60">{monthYear}</p>
                  </div>
                </div>
                <div className="sm:text-right">
                  <p className="font-display text-3xl font-semibold leading-none tracking-tight tabular-nums">
                    {formatTime(startIso, timeZone)}
                  </p>
                  {hasEnd && (
                    <p className="mt-1.5 text-sm text-white/60">
                      até {formatTime(end.toISOString(), timeZone)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <dl className="divide-y divide-hairline px-6 sm:px-8">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="group flex items-center justify-between gap-5 py-4 transition-colors duration-200 motion-reduce:transition-none"
                >
                  <dt className="flex shrink-0 items-center gap-3 text-sm text-slate">
                    <span className="grid size-9 place-items-center rounded-lg bg-orbit-soft text-orbit transition duration-200 group-hover:scale-105 group-hover:bg-orbit group-hover:text-white motion-reduce:transition-none motion-reduce:group-hover:scale-100">
                      <Icon name={row.icon} className="size-[1.05rem]" />
                    </span>
                    {row.label}
                  </dt>
                  <dd
                    className={`min-w-0 break-words text-right ${
                      row.emphasis
                        ? 'font-display text-xl font-semibold tracking-tight tabular-nums'
                        : 'text-[0.95rem] font-semibold text-ink'
                    }`}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="relative mt-1" aria-hidden="true">
              <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full border border-hairline bg-paper" />
              <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full border border-hairline bg-paper" />
              <div className="mx-6 border-t border-dashed border-hairline sm:mx-8" />
            </div>

            <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
              <span className="inline-flex items-center gap-2 text-xs text-slate">
                <OrbitMark size={20} />
                Orbit Agenda
              </span>
              {reference && (
                <span className="text-xs text-slate">
                  Ref.{' '}
                  <span className="font-semibold tracking-[0.12em] text-graphite tabular-nums">
                    {reference}
                  </span>
                </span>
              )}
            </div>
          </article>
        </Reveal>

        <Reveal show={entered} delay={450} className="mt-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${actionBase} bg-orbit text-white shadow-[0_10px_24px_-10px_rgba(59,54,217,0.7)] hover:bg-orbit-deep`}
            >
              <Icon name="calendar" className="size-[1.1rem]" />
              Adicionar ao Google Agenda
              <Icon
                name="external"
                className="size-3.5 opacity-70 transition duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 motion-reduce:transition-none"
              />
            </a>
            <button
              type="button"
              onClick={onNewBooking}
              className={`${actionBase} border border-hairline bg-surface text-ink hover:border-graphite/40`}
            >
              Fazer outro agendamento
              <Icon
                name="arrow"
                className="size-4 text-slate transition duration-200 group-hover:translate-x-1 group-hover:text-ink motion-reduce:transition-none"
              />
            </button>
          </div>
        </Reveal>
      </div>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Fluxo de reserva (antes da confirmação)
// ─────────────────────────────────────────────────────────────────────────────

const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const PERIODS: { key: string; label: string; icon: IconName; includes: (hour: number) => boolean }[] = [
  { key: 'morning', label: 'Manhã', icon: 'sun', includes: (hour) => hour < 12 },
  { key: 'afternoon', label: 'Tarde', icon: 'sunset', includes: (hour) => hour >= 12 && hour < 18 },
  { key: 'evening', label: 'Noite', icon: 'moon', includes: (hour) => hour >= 18 },
]

// 2 colunas entre 1024 e 1100 px (coluna de horários estreita); 3 nas demais larguras com calendário ao lado.
const SLOT_GRID =
  'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-2 min-[68.75rem]:grid-cols-3'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  const first = parts[0]?.charAt(0) ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : ''
  return (first + last).toUpperCase()
}

function formatPhone(value: string) {
  let digits = value.replace(/\D/g, '')
  // Aceita números colados com código do país (+55).
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  digits = digits.slice(0, 11)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

const SURFACE_SHADOW = 'shadow-[0_1px_2px_rgba(17,20,26,0.04),0_18px_40px_-28px_rgba(17,20,26,0.22)]'

function BookingHeader({ name, typeLabel }: { name: string; typeLabel?: string | undefined }) {
  return (
    <header className="relative border-b border-hairline/80 bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink font-display text-[0.95rem] font-semibold tracking-tight text-white">
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(120%_100%_at_100%_0%,rgba(139,140,245,0.5),transparent_60%)]"
            />
            <span className="relative">{initials(name)}</span>
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-orbit-glow" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-lg font-semibold tracking-tight">{name}</p>
            {typeLabel && <p className="mt-0.5 truncate text-[0.8125rem] text-slate">{typeLabel}</p>}
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-2 rounded-full bg-orbit-soft px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-orbit-deep sm:inline-flex">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-orbit" />
          Agendamento online
        </span>
      </div>
    </header>
  )
}

function ProgressSteps({ current, done }: { current: number; done: boolean[] }) {
  const labels = ['Serviço', 'Profissional', 'Horário', 'Seus dados']
  return (
    <nav
      aria-label="Progresso do agendamento"
      className={`rounded-panel border border-hairline bg-surface px-1 py-4 min-[400px]:px-2 sm:px-6 ${SURFACE_SHADOW}`}
    >
      <ol className="flex">
        {labels.map((label, index) => {
          const isDone = done[index] === true
          const isCurrent = index === current
          const isLast = index === labels.length - 1
          return (
            <li key={label} aria-current={isCurrent ? 'step' : undefined} className="relative min-w-0 flex-1">
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-[calc(50%+1.25rem)] top-4 h-0.5 w-[calc(100%-2.5rem)] -translate-y-1/2 overflow-hidden rounded-full bg-hairline"
                >
                  <span
                    className={`block h-full origin-left bg-orbit transition-transform duration-500 ease-out motion-reduce:transition-none ${
                      isDone ? 'scale-x-100' : 'scale-x-0'
                    }`}
                  />
                </span>
              )}
              <span className="flex flex-col items-center px-0.5 text-center min-[400px]:px-1">
                <span
                  aria-hidden="true"
                  className={`relative grid size-8 place-items-center rounded-full border-2 font-display text-sm font-semibold transition duration-300 motion-reduce:transition-none ${
                    isDone
                      ? 'border-orbit bg-orbit text-white'
                      : isCurrent
                        ? 'border-orbit bg-surface text-orbit shadow-[0_0_0_4px_rgba(59,54,217,0.12)]'
                        : 'border-hairline bg-surface text-slate'
                  }`}
                >
                  {isDone ? <Icon name="check" className="size-4" /> : index + 1}
                </span>
                <span
                  className={`mt-2 block text-[0.68rem] leading-tight transition-colors duration-300 motion-reduce:transition-none min-[400px]:text-[0.72rem] sm:text-xs ${
                    isCurrent ? 'font-semibold text-ink' : isDone ? 'font-medium text-graphite' : 'text-slate'
                  }`}
                >
                  {label}
                  <span className="sr-only">{isDone ? ' (concluído)' : isCurrent ? ' (etapa atual)' : ''}</span>
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function StepSection({
  step,
  title,
  hint,
  done = false,
  autoScroll = false,
  children,
}: {
  step: number
  title: string
  hint?: string
  done?: boolean
  autoScroll?: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (autoScroll && element && element.getBoundingClientRect().top > window.innerHeight * 0.55) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }
    const timer = window.setTimeout(() => setEntered(true), 20)
    return () => window.clearTimeout(timer)
  }, [autoScroll])

  return (
    <section
      ref={ref}
      aria-labelledby={`step-${step}`}
      className={`scroll-mt-5 rounded-panel border border-hairline bg-surface p-4 transition duration-500 ease-out motion-reduce:transition-none sm:p-6 ${SURFACE_SHADOW} ${
        entered ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <header className="mb-4 flex items-center gap-3 sm:mb-5">
        <span
          aria-hidden="true"
          className={`grid size-7 shrink-0 place-items-center rounded-full font-display text-[0.8rem] font-semibold transition-colors duration-300 motion-reduce:transition-none ${
            done ? 'bg-orbit text-white' : 'bg-orbit-soft text-orbit'
          }`}
        >
          {done ? <Icon name="check" className="size-3.5" /> : step}
        </span>
        <div className="min-w-0">
          <h2 id={`step-${step}`} className="font-display text-lg font-semibold leading-tight tracking-tight sm:text-xl">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-[0.8125rem] text-slate">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

function spanLast(index: number, count: number) {
  return count % 2 === 1 && index === count - 1 ? 'sm:col-span-2' : ''
}

function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-5 shrink-0 place-items-center rounded-full border-2 transition duration-200 motion-reduce:transition-none ${
        selected
          ? 'border-orbit bg-orbit text-white'
          : 'border-hairline bg-surface text-transparent group-hover:border-graphite/40'
      }`}
    >
      <Icon name="check" className="size-3" />
    </span>
  )
}

const choiceBase =
  'group relative w-full rounded-xl border text-left transition duration-200 focus-visible:rounded-xl! motion-reduce:transition-none'
const choiceSelected =
  'border-orbit bg-orbit-soft/50 shadow-[0_0_0_1px_var(--color-orbit),0_10px_24px_-14px_rgba(59,54,217,0.55)]'
const choiceIdle = 'border-hairline bg-surface hover:border-graphite/30 hover:bg-paper/60'

function ServiceCard({
  service,
  selected,
  className = '',
  onSelect,
}: {
  service: Service
  selected: boolean
  className?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`${choiceBase} flex items-start justify-between gap-3 p-3.5 sm:p-4 ${
        selected ? choiceSelected : choiceIdle
      } ${className}`}
    >
      <span className="min-w-0">
        <span
          className={`block text-[0.95rem] font-semibold leading-snug transition-colors duration-200 motion-reduce:transition-none ${
            selected ? 'text-orbit-deep' : 'text-ink'
          }`}
        >
          {service.name}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-slate">
          <Icon name="clock" className="size-3.5" />
          {formatDuration(service.duration_minutes)}
        </span>
        {service.description && (
          <span className="mt-1.5 line-clamp-2 block text-[0.8125rem] leading-relaxed text-slate">
            {service.description}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2.5">
        <SelectMark selected={selected} />
        <span
          className={`font-display text-lg font-semibold leading-none tracking-tight tabular-nums transition-colors duration-200 motion-reduce:transition-none ${
            selected ? 'text-orbit-deep' : 'text-ink'
          }`}
        >
          {formatMoney(service.price_cents)}
        </span>
      </span>
    </button>
  )
}

function ProfessionalCard({
  professional,
  selected,
  className = '',
  onSelect,
}: {
  professional: Professional
  selected: boolean
  className?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`${choiceBase} flex items-center gap-3 p-3.5 sm:p-4 ${selected ? choiceSelected : choiceIdle} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-full font-display text-[0.9rem] font-semibold transition-colors duration-200 motion-reduce:transition-none ${
          selected ? 'bg-orbit text-white' : 'bg-paper text-graphite group-hover:bg-orbit-soft group-hover:text-orbit'
        }`}
      >
        {initials(professional.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[0.95rem] font-semibold transition-colors duration-200 motion-reduce:transition-none ${
            selected ? 'text-orbit-deep' : 'text-ink'
          }`}
        >
          {professional.name}
        </span>
        {professional.bio && (
          <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] leading-relaxed text-slate">
            {professional.bio}
          </span>
        )}
      </span>
      <SelectMark selected={selected} />
    </button>
  )
}

function EmptyNote({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-hairline bg-paper/60 px-4 py-4 text-sm text-slate">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-slate">
        <Icon name={icon} className="size-[1.05rem]" />
      </span>
      <p className="leading-relaxed">{children}</p>
    </div>
  )
}

function DatePicker({
  value,
  min,
  max,
  onChange,
}: {
  value: string
  min: string
  max: string
  onChange: (value: string) => void
}) {
  const selected = parseIsoDate(value || min)
  const [view, setView] = useState({ year: selected.year, month: selected.month })
  const minDate = parseIsoDate(min)
  const maxDate = parseIsoDate(max)

  // Mantém o mês exibido em sincronia quando a data muda por fora (ex.: ajuste de "hoje").
  useEffect(() => {
    const next = parseIsoDate(value || min)
    setView((current) =>
      current.year === next.year && current.month === next.month
        ? current
        : { year: next.year, month: next.month },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const viewIndex = view.year * 12 + view.month
  const canGoBack = viewIndex > minDate.year * 12 + minDate.month
  const canGoForward = viewIndex < maxDate.year * 12 + maxDate.month

  function shiftMonth(delta: number) {
    const index = viewIndex + delta
    setView({ year: Math.floor(index / 12), month: index % 12 })
  }

  const firstWeekday = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate()
  const monthLabel = capitalize(
    new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(view.year, view.month, 1)),
    ),
  )
  const dayLabel = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const navButton =
    'grid size-10 place-items-center rounded-lg border border-hairline text-graphite focus-visible:rounded-lg! transition duration-200 hover:border-graphite/30 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-hairline disabled:hover:bg-transparent motion-reduce:transition-none sm:size-9'

  return (
    <div className="mx-auto w-full max-w-[22rem] rounded-xl border border-hairline bg-surface p-2.5 sm:p-4 md:mx-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Mês anterior"
          className={navButton}
        >
          <Icon name="chevronLeft" className="size-4" />
        </button>
        <p aria-live="polite" className="font-display text-base font-semibold tracking-tight">
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={!canGoForward}
          aria-label="Próximo mês"
          className={navButton}
        >
          <Icon name="chevronRight" className="size-4" />
        </button>
      </div>

      <div aria-hidden="true" className="grid grid-cols-7 gap-0.5 pb-1 sm:gap-1">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={index} className="text-center text-[0.7rem] font-medium uppercase text-slate">
            {initial}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const iso = `${view.year}-${pad(view.month + 1)}-${pad(day)}`
          const disabled = iso < min || iso > max
          const isSelected = iso === value
          const isToday = iso === min

          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onChange(iso)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={dayLabel.format(new Date(Date.UTC(view.year, view.month, day)))}
              className={`aspect-square w-full touch-manipulation rounded-xl text-sm font-medium tabular-nums focus-visible:rounded-xl! transition duration-150 motion-reduce:transition-none ${
                isSelected
                  ? 'bg-orbit font-semibold text-white shadow-[0_8px_18px_-8px_rgba(59,54,217,0.7)]'
                  : disabled
                    ? 'cursor-not-allowed text-slate/35'
                    : `text-ink hover:bg-orbit-soft hover:text-orbit-deep ${
                        isToday ? 'font-semibold text-orbit ring-1 ring-inset ring-orbit/40' : ''
                      }`
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SlotPicker({
  slots,
  loading,
  selected,
  dayLabel,
  timeZone,
  onSelect,
}: {
  slots: Slot[]
  loading: boolean
  selected: string
  dayLabel: string
  timeZone: string
  onSelect: (slotStart: string) => void
}) {
  const groups = PERIODS.map((period) => ({
    ...period,
    items: slots.filter((slot) => period.includes(slotHour(slot.slot_start, timeZone))),
  })).filter((group) => group.items.length > 0)

  return (
    <div aria-live="polite" aria-busy={loading}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-semibold tracking-tight">{dayLabel}</h3>
        {!loading && slots.length > 0 && (
          <span className="shrink-0 text-xs text-slate">
            {slots.length} {slots.length === 1 ? 'horário' : 'horários'}
          </span>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="space-y-5" role="status" aria-label="Consultando horários">
            <div className={SLOT_GRID}>
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className="h-11 animate-pulse rounded-xl bg-paper" />
              ))}
            </div>
            <span className="block h-3 w-24 animate-pulse rounded-full bg-paper" />
          </div>
        ) : slots.length === 0 ? (
          <EmptyNote icon="calendar">
            Nenhum horário disponível nesta data. Escolha outro dia no calendário.
          </EmptyNote>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="mb-2.5 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate">
                  <Icon name={group.icon} className="size-3.5" />
                  {group.label}
                </p>
                <div className={SLOT_GRID}>
                  {group.items.map((slot) => {
                    const isSelected = selected === slot.slot_start
                    return (
                      <button
                        key={slot.slot_start}
                        type="button"
                        onClick={() => onSelect(slot.slot_start)}
                        aria-pressed={isSelected}
                        className={`h-11 touch-manipulation rounded-xl border text-sm font-semibold tabular-nums focus-visible:rounded-xl! transition duration-150 motion-reduce:transition-none ${
                          isSelected
                            ? 'border-orbit bg-orbit text-white shadow-[0_8px_18px_-8px_rgba(59,54,217,0.7)]'
                            : 'border-hairline bg-surface text-ink hover:border-orbit/50 hover:bg-orbit-soft/60 hover:text-orbit-deep'
                        }`}
                      >
                        {formatTime(slot.slot_start, timeZone)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, value }: { icon: IconName; label: string; value?: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="flex shrink-0 items-center gap-3 text-sm text-slate">
        <span
          aria-hidden="true"
          className={`grid size-8 place-items-center rounded-lg transition-colors duration-300 motion-reduce:transition-none ${
            value ? 'bg-orbit-soft text-orbit' : 'bg-paper text-slate'
          }`}
        >
          <Icon name={icon} className="size-4" />
        </span>
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-sm">
        {value ? (
          <span className="font-semibold text-ink">{value}</span>
        ) : (
          <span className="inline-block rounded-full border border-dashed border-hairline px-2.5 py-0.5 text-[0.68rem] font-medium uppercase tracking-[0.1em] text-slate">
            Pendente
          </span>
        )}
      </dd>
    </div>
  )
}

function BookingSummary({
  establishmentName,
  service,
  professional,
  startIso,
  endIso,
  timeZone,
}: {
  establishmentName: string
  service?: Service | undefined
  professional?: Professional | undefined
  startIso: string
  endIso?: string | undefined
  timeZone: string
}) {
  const start = startIso ? new Date(startIso) : null

  return (
    <article
      aria-label="Resumo da reserva"
      className="overflow-hidden rounded-panel border border-hairline bg-surface shadow-[0_1px_2px_rgba(17,20,26,0.04),0_28px_56px_-28px_rgba(45,41,176,0.35)]"
    >
      <div className="relative isolate overflow-hidden bg-ink px-6 pb-6 pt-5 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(110%_100%_at_100%_0%,rgba(139,140,245,0.38),transparent_60%)]"
        />
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-white/60">Sua reserva</p>
        <p className="mt-1.5 truncate font-display text-lg font-semibold tracking-tight">{establishmentName}</p>

        <div className="mt-5">
          {start ? (
            <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-4">
              <div className="min-w-0 leading-snug">
                <p className="text-xs text-white/60">Data</p>
                <p className="mt-0.5 text-[0.95rem] font-medium">{formatDayLabel(start, timeZone)}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl font-semibold leading-none tracking-tight tabular-nums">
                  {formatTime(startIso, timeZone)}
                </p>
                {endIso && <p className="mt-1.5 text-xs text-white/60">até {formatTime(endIso, timeZone)}</p>}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/20 px-3.5 py-3">
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white/80"
              >
                <Icon name="calendar" className="size-[1.05rem]" />
              </span>
              <p className="text-sm leading-snug text-white/75">Escolha a data e o horário</p>
            </div>
          )}
        </div>
      </div>

      <dl className="divide-y divide-hairline px-6">
        <SummaryRow icon="service" label="Serviço" value={service?.name} />
        <SummaryRow icon="user" label="Profissional" value={professional?.name} />
        <SummaryRow
          icon="clock"
          label="Duração"
          value={service ? formatDuration(service.duration_minutes) : undefined}
        />
      </dl>

      <div className="mx-6 border-t border-dashed border-hairline" />

      <div className="flex items-end justify-between gap-4 px-6 pb-5 pt-4">
        <p className="text-sm text-slate">Total</p>
        {service ? (
          <p className="font-display text-3xl font-semibold leading-none tracking-tight tabular-nums">
            {formatMoney(service.price_cents)}
          </p>
        ) : (
          <p className="text-sm text-slate">Selecione um serviço</p>
        )}
      </div>

      <p className="flex items-start gap-2.5 border-t border-hairline bg-paper/60 px-6 py-3.5 text-xs leading-relaxed text-slate">
        <Icon name="lock" className="mt-0.5 size-3.5 shrink-0" />
        Agendamento seguro. Seus dados serão utilizados para registrar sua reserva.
      </p>
    </article>
  )
}

function MobileSummaryBar({
  service,
  nextStepLabel,
  canConfirm,
  submitting,
}: {
  service: Service
  nextStepLabel: string
  canConfirm: boolean
  submitting: boolean
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <div className="min-w-0 leading-tight">
          <p className="truncate text-xs text-slate">{service.name}</p>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums">
            {formatMoney(service.price_cents)}
          </p>
        </div>
        {canConfirm ? (
          <button
            type="submit"
            form="booking-form"
            disabled={submitting}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control focus-visible:rounded-control! bg-orbit px-5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(59,54,217,0.7)] transition duration-200 hover:bg-orbit-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
          >
            {submitting && <Spinner className="size-4" />}
            {submitting ? 'Confirmando...' : 'Confirmar'}
          </button>
        ) : (
          <p className="shrink-0 rounded-full bg-orbit-soft px-3.5 py-2 text-xs font-semibold text-orbit-deep">
            {nextStepLabel}
          </p>
        )}
      </div>
    </div>
  )
}

function BookingSkeleton() {
  return (
    <main className="min-h-dvh bg-paper" aria-busy="true">
      <div className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3.5 px-5 py-4">
          <span className="size-11 animate-pulse rounded-xl bg-paper" />
          <span className="space-y-2">
            <span className="block h-4 w-40 animate-pulse rounded-full bg-paper" />
            <span className="block h-3 w-24 animate-pulse rounded-full bg-paper" />
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5 pt-10" role="status" aria-label="Carregando agendamento">
        <span className="block h-9 w-64 max-w-full animate-pulse rounded-full bg-hairline/70" />
        <span className="mt-4 block h-3 w-80 max-w-full animate-pulse rounded-full bg-hairline/70" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-panel border border-hairline bg-surface p-6">
            <span className="block h-6 w-48 max-w-full animate-pulse rounded-full bg-paper" />
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <span key={index} className="h-24 animate-pulse rounded-xl bg-paper" />
              ))}
            </div>
          </div>
          <span className="hidden h-96 animate-pulse rounded-panel bg-surface lg:block" />
        </div>
      </div>
    </main>
  )
}

function BookingStatus({ message }: { message: string }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-paper px-5 text-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-12rem] size-[34rem] -translate-x-1/2 rounded-full bg-orbit-soft blur-3xl"
      />
      <div
        role="alert"
        className={`relative w-full max-w-md rounded-panel border border-hairline bg-surface p-8 text-center ${SURFACE_SHADOW}`}
      >
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-danger-soft text-danger">
          <Icon name="alert" className="size-6" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">{message}</h1>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-slate">
          Confira se o endereço está correto ou tente novamente em instantes.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-control focus-visible:rounded-control! border border-hairline bg-surface px-5 text-sm font-semibold text-ink transition duration-200 hover:border-graphite/40 active:scale-[0.98] motion-reduce:transition-none"
        >
          Tentar novamente
        </button>
      </div>
    </main>
  )
}

/** Lê só o código de erro (ex.: "rate_limited") da resposta HTTP da Edge Function; nunca mostra texto técnico ao usuário. */
async function readErrorCode(err: unknown): Promise<string | null> {
  try {
    const res = (err as { context?: Response } | null)?.context
    if (!res || typeof res.clone !== 'function') return null
    const body = await res.clone().json() as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch { return null }
}

export default function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [slotsError, setSlotsError] = useState('')
  const [bookingError, setBookingError] = useState('')
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaDown, setCaptchaDown] = useState(false)
  const captchaRef = useRef<TurnstileHandle>(null)
  const [bookingId, setBookingId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [, tick] = useReducer((count: number) => count + 1, 0)
  const slotsRef = useRef<HTMLDivElement>(null)

  const timeZone = resolveTimeZone(catalog?.establishment.timezone)
  const today = localDate(timeZone)
  const maxDate = localDate(timeZone, 60)
  const selectedService = catalog?.services.find((item) => item.id === serviceId)
  const durationMinutes = selectedService?.duration_minutes ?? 0

  useEffect(() => {
    let active = true

    async function loadCatalog() {
      setLoading(true)
      setCatalogError('')

      const { data, error: requestError } = await supabase.functions.invoke(
        'public-booking',
        { body: { action: 'catalog', slug } },
      )

      if (!active) return

      if (requestError || !data?.establishment) {
        setCatalogError('Não foi possível carregar este estabelecimento.')
      } else {
        const loaded = data as Catalog
        setDate(localDate(resolveTimeZone(loaded.establishment.timezone)))
        setCatalog(loaded)
      }
      setLoading(false)
    }

    void loadCatalog()
    return () => { active = false }
  }, [slug])

  // Atualiza o "hoje" a cada minuto (virada do dia no fuso do estabelecimento) e ao voltar para a aba.
  useEffect(() => {
    const interval = window.setInterval(tick, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Nunca permite uma data anterior a "hoje".
  useEffect(() => {
    if (date && date < today) setDate(today)
  }, [date, today])

  const availableProfessionals = catalog?.professionals.filter((professional) =>
    catalog.professional_services.some(
      (link) =>
        link.professional_id === professional.id &&
        link.service_id === serviceId,
    ),
  ) ?? []

  useEffect(() => {
    setSelectedSlot('')

    if (!slug || !serviceId || !professionalId || !date || !durationMinutes) {
      setSlots([])
      setLoadingSlots(false)
      return
    }

    let active = true

    async function loadSlots() {
      setLoadingSlots(true)
      setSlots([])
      setSlotsError('')

      const { data, error: requestError } = await supabase.functions.invoke(
        'public-booking',
        {
          body: {
            action: 'availability',
            slug,
            professional_id: professionalId,
            service_id: serviceId,
            date,
          },
        },
      )

      if (!active) return

      if (requestError || !Array.isArray(data?.slots)) {
        setSlotsError('Não foi possível consultar os horários.')
        setSlots([])
      } else {
        setSlots(sanitizeSlots(data.slots as unknown[], durationMinutes, date, timeZone))
      }
      setLoadingSlots(false)
    }

    void loadSlots()
    return () => { active = false }
  }, [slug, serviceId, professionalId, date, durationMinutes, timeZone, refreshKey])

  /** Descarta horário/lista atuais; `willReload` evita piscar "sem horários" enquanto a consulta não começa. */
  function invalidateSlots(willReload: boolean) {
    setSelectedSlot('')
    setSlots([])
    setLoadingSlots(willReload)
    setSlotsError('')
    setBookingError('')
  }

  function handleServiceSelect(id: string) {
    if (id === serviceId) return
    // Mantém o profissional apenas se ele também atende o novo serviço.
    const keepProfessional =
      professionalId !== '' &&
      Boolean(
        catalog?.professional_services.some(
          (link) => link.service_id === id && link.professional_id === professionalId,
        ),
      )
    setServiceId(id)
    if (!keepProfessional) setProfessionalId('')
    invalidateSlots(keepProfessional)
  }

  function handleProfessionalSelect(id: string) {
    if (id === professionalId) return
    setProfessionalId(id)
    invalidateSlots(true)
  }

  function handleDateChange(next: string) {
    if (next === date) return
    setDate(next)
    invalidateSlots(true)

    // No mobile os horários ficam abaixo do calendário: leva a pessoa até eles.
    const element = slotsRef.current
    if (
      element &&
      window.matchMedia('(max-width: 767px)').matches &&
      element.getBoundingClientRect().top > window.innerHeight * 0.6
    ) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }
  }

  async function confirmBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!slug || !selectedSlot || submitting) return

    const slot = slots.find((item) => item.slot_start === selectedSlot)
    const start = slot ? new Date(slot.slot_start) : null

    // O horário precisa existir na lista validada e ainda estar no futuro.
    if (!slot || !start || !selectedService || start.getTime() <= Date.now()) {
      setBookingError('Este horário não está mais disponível. Escolha outro.')
      setSelectedSlot('')
      setRefreshKey((key) => key + 1)
      return
    }

    const name = customerName.trim().replace(/\s+/g, ' ')
    const phoneDigits = customerPhone.replace(/\D/g, '')

    if (name.length < 2) {
      setFormError('Informe seu nome completo.')
      return
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setFormError('Informe um WhatsApp válido, com DDD.')
      return
    }

    if (!env.turnstileSiteKey || captchaDown) {
      setFormError('A verificação de segurança está indisponível no momento. Tente novamente em instantes.')
      return
    }
    if (!captchaToken) {
      setFormError('Conclua a verificação de segurança para confirmar.')
      return
    }

    setFormError('')
    setBookingError('')
    setSubmitting(true)

    const { data, error: requestError } = await supabase.functions.invoke(
      'public-booking',
      {
        body: {
          action: 'book',
          slug,
          professional_id: professionalId,
          service_id: serviceId,
          // Data e hora derivadas do mesmo instante, no fuso do estabelecimento.
          date: isoDateInZone(start, timeZone),
          time: formatTime(slot.slot_start, timeZone),
          customer_name: name,
          customer_phone: phoneDigits,
          turnstile_token: captchaToken,
        },
      },
    )

    setSubmitting(false)
    captchaRef.current?.reset() // o token do Turnstile é de uso único

    if (requestError || !data?.booking_id) {
      const code = await readErrorCode(requestError)
      if (code === 'rate_limited') {
        setFormError('Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.')
        return
      }
      if (code === 'captcha_failed' || code === 'captcha_required') {
        setFormError('Não foi possível validar a verificação de segurança. Tente novamente.')
        return
      }
      if (code === 'service_unavailable') {
        setFormError('O agendamento online está indisponível no momento. Tente novamente em instantes.')
        return
      }
      setBookingError('Não foi possível concluir a reserva. O horário pode ter sido ocupado.')
      setSelectedSlot('')
      setRefreshKey((key) => key + 1) // recarrega a disponibilidade atualizada
      return
    }

    setBookingId(String(data.booking_id))
    setSuccess(true)
  }

  if (loading) {
    return <BookingSkeleton />
  }

  if (!catalog) {
    return <BookingStatus message={catalogError || 'Estabelecimento não encontrado.'} />
  }

  if (success) {
    const professional = catalog.professionals.find((item) => item.id === professionalId)

    return (
      <BookingConfirmation
        establishmentName={catalog.establishment.name}
        serviceName={selectedService?.name}
        professionalName={professional?.name}
        durationMinutes={selectedService?.duration_minutes}
        priceCents={selectedService?.price_cents}
        startIso={selectedSlot}
        endIso={slots.find((slot) => slot.slot_start === selectedSlot)?.slot_end}
        customerName={customerName}
        bookingId={bookingId}
        timeZone={timeZone}
        onNewBooking={() => window.location.reload()}
      />
    )
  }

  const selectedProfessional = catalog.professionals.find((item) => item.id === professionalId)
  const selectedSlotData = slots.find((slot) => slot.slot_start === selectedSlot)

  const stepsDone = [Boolean(serviceId), Boolean(professionalId), Boolean(selectedSlot)]
  const firstPending = stepsDone.findIndex((done) => !done)
  const currentStep = firstPending === -1 ? 3 : firstPending
  const nextStepLabel = ['Escolha o serviço', 'Escolha o profissional', 'Escolha o horário', 'Preencha seus dados'][
    currentStep
  ] ?? ''

  const typeLabel =
    catalog.establishment.business_type === 'other'
      ? undefined
      : BUSINESS_TYPES.find((item) => item.value === catalog.establishment.business_type)?.label

  const dayLabel = date ? formatIsoDayLabel(date) : ''
  const stepError = slotsError || bookingError

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-paper text-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-14rem] size-[38rem] -translate-x-1/2 rounded-full bg-orbit-soft blur-3xl"
      />

      <BookingHeader name={catalog.establishment.name} typeLabel={typeLabel} />

      <div className="relative mx-auto max-w-6xl px-5 pb-32 pt-8 sm:pt-12 lg:pb-16">
        <div className="max-w-2xl">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orbit">Reserva online</p>
          <h1 className="mt-2 font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.5rem]">
            Reserve seu horário
          </h1>
          <p className="mt-2.5 text-[0.95rem] leading-relaxed text-slate">
            Escolha o serviço, o profissional e o melhor horário para você.
          </p>
        </div>

        <div className="mt-7 grid gap-6 sm:mt-9 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
          <div className="min-w-0 space-y-4 sm:space-y-5">
            <ProgressSteps current={currentStep} done={stepsDone} />

            <StepSection step={1} title="Escolha o serviço" done={Boolean(serviceId)}>
              {catalog.services.length === 0 ? (
                <EmptyNote icon="service">Nenhum serviço disponível no momento.</EmptyNote>
              ) : (
                <div role="group" aria-labelledby="step-1" className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
                  {catalog.services.map((service, index) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      className={spanLast(index, catalog.services.length)}
                      selected={serviceId === service.id}
                      onSelect={() => handleServiceSelect(service.id)}
                    />
                  ))}
                </div>
              )}
            </StepSection>

            {serviceId && (
              <StepSection step={2} title="Escolha o profissional" done={Boolean(professionalId)} autoScroll>
                {availableProfessionals.length === 0 ? (
                  <EmptyNote icon="user">Nenhum profissional disponível para este serviço.</EmptyNote>
                ) : (
                  <div role="group" aria-labelledby="step-2" className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
                    {availableProfessionals.map((professional, index) => (
                      <ProfessionalCard
                        key={professional.id}
                        professional={professional}
                        className={spanLast(index, availableProfessionals.length)}
                        selected={professionalId === professional.id}
                        onSelect={() => handleProfessionalSelect(professional.id)}
                      />
                    ))}
                  </div>
                )}
              </StepSection>
            )}

            {professionalId && (
              <StepSection step={3} title="Data e horário" done={Boolean(selectedSlot)} autoScroll>
                <div className="grid gap-6 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] md:gap-8">
                  <DatePicker value={date} min={today} max={maxDate} onChange={handleDateChange} />
                  <div ref={slotsRef} className="min-w-0 scroll-mt-4">
                    <SlotPicker
                      slots={slots}
                      loading={loadingSlots}
                      selected={selectedSlot}
                      dayLabel={dayLabel}
                      timeZone={timeZone}
                      onSelect={(slotStart) => {
                        setSelectedSlot(slotStart)
                        setBookingError('')
                      }}
                    />
                  </div>
                </div>

                {stepError && !selectedSlot && (
                  <div className="mt-5">
                    <Alert>{stepError}</Alert>
                  </div>
                )}
              </StepSection>
            )}

            {selectedSlot && (
              <StepSection step={4} title="Seus dados" hint="Para registrar e identificar sua reserva." autoScroll>
                <form
                  id="booking-form"
                  onSubmit={(event) => void confirmBooking(event)}
                  className="space-y-4"
                >
                  <TextField
                    label="Nome completo"
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    value={customerName}
                    onChange={(event) => {
                      setCustomerName(event.target.value)
                      setFormError('')
                    }}
                    placeholder="Digite seu nome"
                  />
                  <TextField
                    label="WhatsApp"
                    required
                    type="tel"
                    inputMode="tel"
                    minLength={14}
                    maxLength={15}
                    autoComplete="tel-national"
                    value={customerPhone}
                    onChange={(event) => {
                      setCustomerPhone(formatPhone(event.target.value))
                      setFormError('')
                    }}
                    placeholder="(82) 99999-9999"
                  />

                  {env.turnstileSiteKey ? (
                    <TurnstileWidget siteKey={env.turnstileSiteKey} handle={captchaRef} onToken={setCaptchaToken} onUnavailable={() => setCaptchaDown(true)} />
                  ) : (
                    <Alert>Verificação de segurança não configurada. Tente novamente mais tarde.</Alert>
                  )}

                  {formError && <Alert>{formError}</Alert>}

                  <button
                    type="submit"
                    disabled={submitting || !env.turnstileSiteKey}
                    className="group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-control focus-visible:rounded-control! bg-orbit px-6 text-[0.95rem] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(59,54,217,0.7)] transition duration-200 hover:-translate-y-0.5 hover:bg-orbit-deep active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    {submitting ? (
                      <>
                        <Spinner className="size-4" />
                        Confirmando...
                      </>
                    ) : (
                      <>
                        Confirmar agendamento
                        <Icon
                          name="arrow"
                          className="size-4 transition duration-200 group-hover:translate-x-1 motion-reduce:transition-none"
                        />
                      </>
                    )}
                  </button>

                  <p className="flex items-center justify-center gap-2 text-xs text-slate">
                    <Icon name="lock" className="size-3.5 shrink-0" />
                    Seus dados serão utilizados para registrar sua reserva.
                  </p>
                </form>
              </StepSection>
            )}
          </div>

          <aside className="hidden lg:sticky lg:top-6 lg:block">
            <BookingSummary
              establishmentName={catalog.establishment.name}
              service={selectedService}
              professional={selectedProfessional}
              startIso={selectedSlot}
              endIso={selectedSlotData?.slot_end}
              timeZone={timeZone}
            />
          </aside>
        </div>
      </div>

      {selectedService && (
        <MobileSummaryBar
          service={selectedService}
          nextStepLabel={nextStepLabel}
          canConfirm={Boolean(selectedSlot)}
          submitting={submitting}
        />
      )}
    </main>
  )
}