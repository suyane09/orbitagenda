import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { ACTION_LABEL, STATUS_CHIP, STATUS_LABEL, addDays, dayLabel, groupByDate, isActive, weekDays, zoned } from '@/lib/agenda'
import { describeError } from '@/lib/errors'
import { formatBRL, formatDuration } from '@/lib/money'
import { todayInZone } from '@/lib/schedule'
import { useAccount } from '@/features/establishments/AccountProvider'
import {
  NEXT_STATUS, getAvailableSlots, listAppointments, loadAgendaOptions, saveAppointment, searchCustomers, setAppointmentStatus,
  type AgendaOptions, type AppointmentRow, type AppointmentStatus, type Slot,
} from './api'

interface FormState { id: string | null; customer: { id: string; name: string } | null; serviceId: string; professionalId: string; date: string; time: string; notes: string }

// ---- Formulário -----------------------------------------------------------------
function AppointmentModal({ estId, tz, options, initial, original, onClose, onSaved }: {
  estId: string; tz: string; options: AgendaOptions; initial: FormState; original: AppointmentRow | null
  onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState<FormState>(initial)
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Array<{ id: string; full_name: string; phone: string | null }>>([])
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }))

  const pros = useMemo(() => options.professionals.filter((p) => !f.serviceId || (options.offered[f.serviceId] ?? []).includes(p.id)), [options, f.serviceId])
  const service = options.services.find((s) => s.id === f.serviceId)

  useEffect(() => {
    if (f.customer) return
    const t = setTimeout(() => { searchCustomers(estId, term).then(setFound).catch(() => setFound([])) }, 250)
    return () => clearTimeout(t)
  }, [estId, term, f.customer])

  const loadSlots = useCallback(async () => {
    if (!f.serviceId || !f.professionalId || !f.date) { setSlots(null); return }
    setSlotError(null); setSlots(null)
    try { setSlots(await getAvailableSlots(estId, f.professionalId, f.serviceId, f.date, f.id)) }
    catch (e) { setSlots([]); setSlotError(describeError(e, 'Não foi possível carregar os horários.')) }
  }, [estId, f.serviceId, f.professionalId, f.date, f.id])
  useEffect(() => { void loadSlots() }, [loadSlots])

  // Se o profissional escolhido não faz o serviço, limpa a escolha.
  useEffect(() => { if (f.professionalId && !pros.some((p) => p.id === f.professionalId)) set({ professionalId: '', time: '' }) }, [pros, f.professionalId])

  const times = useMemo(() => {
    const list = (slots ?? []).map((s) => zoned(s.slot_start, tz).time)
    // Edição sem mudar profissional/serviço/dia: o horário atual continua válido mesmo que já tenha passado.
    if (original && f.id && original.professional_id === f.professionalId && original.service_id === f.serviceId && zoned(original.starts_at, tz).date === f.date) {
      const cur = zoned(original.starts_at, tz).time
      if (!list.includes(cur)) list.push(cur)
    }
    return list.sort()
  }, [slots, original, f, tz])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.customer) return setErr('Escolha o cliente.')
    if (!f.serviceId) return setErr('Escolha o serviço.')
    if (!f.professionalId) return setErr('Escolha o profissional.')
    if (!f.time) return setErr('Escolha um horário disponível.')
    setBusy(true); setErr(null)
    try {
      await saveAppointment(estId, { id: f.id, customerId: f.customer.id, professionalId: f.professionalId, serviceId: f.serviceId, date: f.date, time: f.time, notes: f.notes.trim() || null })
      onSaved()
    } catch (x) {
      setErr(describeError(x, 'Não foi possível salvar o agendamento.'))
      set({ time: '' }); void loadSlots() // outro usuário pode ter ocupado o horário: recarrega as opções
    } finally { setBusy(false) }
  }

  return (
    <Modal title={f.id ? 'Editar agendamento' : 'Novo agendamento'} onClose={onClose} busy={busy}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
        <Button variant="accent" type="submit" form="appt-form" loading={busy}>Salvar</Button>
      </>}>
      <form id="appt-form" onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        {f.customer ? (
          <div className="flex items-center justify-between rounded-control border border-hairline px-3.5 py-2.5 text-sm">
            <span><span className="text-slate">Cliente: </span><strong>{f.customer.name}</strong></span>
            <button type="button" className="text-orbit hover:underline" onClick={() => set({ customer: null })}>Trocar</button>
          </div>
        ) : (
          <div>
            <TextField label="Cliente" placeholder="Buscar por nome ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
            <ul className="mt-1.5 max-h-40 divide-y divide-hairline overflow-auto rounded-control border border-hairline text-sm">
              {found.map((c) => (
                <li key={c.id}><button type="button" className="flex w-full justify-between px-3.5 py-2 text-left hover:bg-paper" onClick={() => set({ customer: { id: c.id, name: c.full_name } })}>
                  <span>{c.full_name}</span><span className="text-slate">{c.phone ?? ''}</span></button></li>
              ))}
              {found.length === 0 && <li className="px-3.5 py-2 text-slate">Nenhum cliente. <Link to="/app/clientes" className="text-orbit hover:underline">Cadastrar cliente</Link></li>}
            </ul>
          </div>
        )}
        <SelectField label="Serviço" value={f.serviceId} onChange={(e) => set({ serviceId: e.target.value, time: '' })}
          options={[{ value: '', label: 'Selecione…' }, ...options.services.map((s) => ({ value: s.id, label: `${s.name} · ${formatDuration(s.duration_minutes)} · ${formatBRL(s.price_cents)}` }))]} />
        <SelectField label="Profissional" value={f.professionalId} onChange={(e) => set({ professionalId: e.target.value, time: '' })}
          options={[{ value: '', label: pros.length ? 'Selecione…' : 'Nenhum profissional faz este serviço' }, ...pros.map((p) => ({ value: p.id, label: p.name }))]} />
        <TextField label="Data" type="date" value={f.date} onChange={(e) => set({ date: e.target.value, time: '' })} />
        <div>
          <p className="mb-1.5 text-sm font-medium text-graphite">Horário{service ? ` (${formatDuration(service.duration_minutes)})` : ''}</p>
          {slotError && <Alert>{slotError}</Alert>}
          {!f.serviceId || !f.professionalId ? <p className="text-sm text-slate">Escolha serviço e profissional para ver os horários livres.</p>
            : slots === null ? <Spinner className="size-5" />
            : times.length === 0 ? <p className="text-sm text-slate">Sem horários livres neste dia (expediente, intervalo, folga ou agenda cheia).</p>
            : <div role="radiogroup" aria-label="Horários disponíveis" className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {times.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={f.time === t} onClick={() => set({ time: t })}
                    className={`h-10 rounded-control border text-sm tabular-nums ${f.time === t ? 'border-orbit bg-orbit text-white' : 'border-hairline hover:border-orbit'}`}>{t}</button>
                ))}
              </div>}
        </div>
        <TextAreaField label="Observações" value={f.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
      </form>
    </Modal>
  )
}

// ---- Cartão de agendamento --------------------------------------------------------
function ApptCard({ a, tz, compact, busyId, onEdit, onAction }: {
  a: AppointmentRow; tz: string; compact?: boolean; busyId: string | null
  onEdit: (a: AppointmentRow) => void; onAction: (a: AppointmentRow, s: AppointmentStatus) => void
}) {
  const started = new Date(a.starts_at).getTime() <= Date.now()
  const range = `${zoned(a.starts_at, tz).time}–${zoned(a.ends_at, tz).time}`
  if (compact) {
    return (
      <button type="button" onClick={() => onEdit(a)} style={{ borderLeftColor: a.professional_color }}
        className={`block w-full rounded-lg border border-hairline border-l-[3px] bg-white px-2.5 py-2.5 text-left text-xs shadow-[0_1px_2px_rgb(17_20_26/0.04)] transition hover:border-orbit hover:shadow-sm ${a.status === 'cancelled' ? 'opacity-60' : ''}`}>
        <span className="font-medium tabular-nums">{range}</span> <span className={`ml-1 rounded px-1 ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
        <span className="mt-0.5 block truncate">{a.customer_name} · {a.service_name}</span>
      </button>
    )
  }
  return (
    <li style={{ borderLeftColor: a.professional_color }} className={`rounded-xl border border-l-[3px] border-hairline bg-surface p-4 shadow-[0_1px_2px_rgb(17_20_26/0.04)] transition hover:shadow-md sm:p-5 ${a.status === 'cancelled' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium"><span className="tabular-nums">{range}</span> · {a.customer_name}</p>
          <p className="text-sm text-slate">{a.service_name} com {a.professional_name} · {formatBRL(a.price_cents)}{a.customer_phone ? ` · ${a.customer_phone}` : ''}</p>
          {a.notes && <p className="mt-1 text-sm text-graphite">{a.notes}</p>}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
      </div>
      {(isActive(a.status)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {NEXT_STATUS[a.status].map((s) => (
            <Button key={s} variant={s === 'confirmed' ? 'accent' : 'outline'} className="h-9 px-3"
              disabled={busyId === a.id || ((s === 'completed' || s === 'no_show') && !started)}
              title={(s === 'completed' || s === 'no_show') && !started ? 'Disponível após o horário de início' : undefined}
              onClick={() => onAction(a, s)}>{ACTION_LABEL[s]}</Button>
          ))}
          <Button variant="ghost" className="h-9 px-3" disabled={busyId === a.id} onClick={() => onEdit(a)}>Editar</Button>
        </div>
      )}
    </li>
  )
}

// Grade de atendimentos: a escala representa horas, não disponibilidade.
// Blocos e durações são calculados exclusivamente dos agendamentos reais.
function DayTimeline({ appointments, professionals, tz, busyId, onEdit, onAction }: {
  appointments: AppointmentRow[]
  professionals: AgendaOptions['professionals']
  tz: string
  busyId: string | null
  onEdit: (a: AppointmentRow) => void
  onAction: (a: AppointmentRow, s: AppointmentStatus) => void
}) {
  const minutes = (iso: string) => {
    const t = zoned(iso, tz).time
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const minStart = appointments.length ? Math.min(...appointments.map((a) => minutes(a.starts_at))) : 8 * 60
  const maxEnd = appointments.length ? Math.max(...appointments.map((a) => minutes(a.ends_at))) : 19 * 60
  const startHour = Math.max(0, Math.min(8, Math.floor(minStart / 60)))
  const endHour = Math.min(24, Math.max(20, Math.ceil(maxEnd / 60)))
  const hourHeight = 76
  const height = (endHour - startHour) * hourHeight
  const hourLabels = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)
  const columns = professionals.length ? professionals : [{ id: 'unassigned', name: 'Atendimentos', color: '#4435d7' }]
  return (
    <div className="overflow-x-auto" aria-label="Grade de horários por profissional">
      <div style={{ minWidth: Math.max(560, columns.length * 210 + 70) }}>
        <div className="sticky top-0 z-20 grid border-b border-hairline bg-white" style={{ gridTemplateColumns: `70px repeat(${columns.length}, minmax(0, 1fr))` }}>
          <div className="flex items-center justify-center border-r border-hairline py-4 text-[11px] font-medium uppercase tracking-wider text-slate">Hora</div>
          {columns.map((pro) => <div key={pro.id} className="flex items-center gap-2 border-r border-hairline px-4 py-4 last:border-r-0">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: pro.color }} />
            <span className="truncate text-sm font-semibold">{pro.name}</span>
            <span className="ml-auto text-xs tabular-nums text-slate">{appointments.filter((a) => pro.id === 'unassigned' || a.professional_id === pro.id).length}</span>
          </div>)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `70px repeat(${columns.length}, minmax(0, 1fr))` }}>
          <div className="relative border-r border-hairline bg-[#fafbfe]" style={{ height }}>
            {hourLabels.map((hour, i) => <span key={hour} className="absolute right-3 -translate-y-1/2 text-[11px] tabular-nums text-slate" style={{ top: i * hourHeight + (i === 0 ? 9 : 0) }}>{String(hour).padStart(2, '0')}:00</span>)}
          </div>
          {columns.map((pro) => {
            const appts = appointments.filter((a) => pro.id === 'unassigned' || a.professional_id === pro.id)
            return <div key={pro.id} className="relative border-r border-hairline last:border-r-0" style={{ height }}>
              {hourLabels.slice(0, -1).map((hour) => <div key={hour} className="absolute inset-x-0 border-t border-[#e9ecf3]" style={{ top: (hour - startHour) * hourHeight, height: hourHeight }} />)}
              {appts.map((a) => {
                const top = (minutes(a.starts_at) - startHour * 60) / 60 * hourHeight
                const duration = Math.max(15, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)
                const blockHeight = Math.max(35, duration / 60 * hourHeight)
                return <button key={a.id} type="button" onClick={() => onEdit(a)}
                  title={`${a.customer_name} · ${a.service_name} · ${STATUS_LABEL[a.status]}`}
                  style={{ top, height: blockHeight, borderLeftColor: pro.color }}
                  className={`absolute left-1 right-1 z-10 overflow-hidden rounded-md border border-l-[3px] border-[#deddf6] bg-[#f2f0ff] px-2 py-1.5 text-left text-xs shadow-sm transition hover:z-20 hover:border-orbit hover:shadow-md focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-orbit ${a.status === 'cancelled' ? 'opacity-55' : ''}`}>
                  <span className="block truncate font-semibold tabular-nums text-[#332a86]">{zoned(a.starts_at, tz).time} · {a.customer_name}</span>
                  {blockHeight >= 55 && <span className="mt-0.5 block truncate text-[#554b8c]">{a.service_name}</span>}
                  {blockHeight >= 75 && <span className="mt-1 inline-block rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-[#554b8c]">{STATUS_LABEL[a.status]}</span>}
                </button>
              })}
              {!appts.length && <span className="absolute inset-x-2 top-6 text-center text-[11px] text-slate">Sem agendamentos</span>}
            </div>
          })}
        </div>
        {appointments.length > 0 && <div className="border-t border-hairline bg-[#fafbfe] px-4 py-2 text-xs text-slate">Selecione um atendimento para editar. As linhas indicam apenas a escala de horas, não horários livres.</div>}
      </div>
    </div>
  )
}

// ---- Página -------------------------------------------------------------------------
export default function AgendaPage() {
  const { current } = useAccount()
  const est = current!.establishment
  const tz = est.timezone
  const { toast, notify } = useToast()

  const [view, setView] = useState<'day' | 'week'>('day')
  const [date, setDate] = useState(() => todayInZone(new Date(), tz))
  const [proFilter, setProFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | AppointmentStatus>('all')
  const [rows, setRows] = useState<AppointmentRow[] | null>(null)
  const [options, setOptions] = useState<AgendaOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ form: FormState; original: AppointmentRow | null } | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<AppointmentRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const days = useMemo(() => (view === 'week' ? weekDays(date) : [date]), [view, date])
  const from = days[0]!; const to = days[days.length - 1]!

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await listAppointments(est.id, from, to, proFilter || null)) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar a agenda.')) }
  }, [est.id, from, to, proFilter])

  useEffect(() => { setRows(null); void load() }, [load])
  useEffect(() => { loadAgendaOptions(est.id).then(setOptions).catch((e) => setError(describeError(e))) }, [est.id])
  // Atualiza sozinho a cada minuto (outros usuários também mexem na agenda).
  useEffect(() => { const t = setInterval(() => { void load() }, 60_000); return () => clearInterval(t) }, [load])

  const visible = useMemo(() => (rows ?? []).filter((r) => statusFilter === 'all' || (statusFilter === 'active' ? isActive(r.status) : r.status === statusFilter)), [rows, statusFilter])
  const counts = useMemo(() => ({ total: (rows ?? []).length, active: (rows ?? []).filter((r) => isActive(r.status)).length, confirmed: (rows ?? []).filter((r) => r.status === 'confirmed').length, completed: (rows ?? []).filter((r) => r.status === 'completed').length }), [rows])
  const byDay = useMemo(() => groupByDate(visible, tz), [visible, tz])

  const step = view === 'week' ? 7 : 1
  const today = todayInZone(new Date(), tz)

  const openNew = (d: string) => setModal({ original: null, form: { id: null, customer: null, serviceId: '', professionalId: proFilter, date: d < today ? today : d, time: '', notes: '' } })
  const openEdit = (a: AppointmentRow) => setModal({ original: a, form: {
    id: a.id, customer: { id: a.customer_id, name: a.customer_name }, serviceId: a.service_id, professionalId: a.professional_id,
    date: zoned(a.starts_at, tz).date, time: zoned(a.starts_at, tz).time, notes: a.notes ?? '' } })

  async function changeStatus(a: AppointmentRow, s: AppointmentStatus) {
    setBusyId(a.id)
    try { await setAppointmentStatus(est.id, a.id, s); notify(`Agendamento ${STATUS_LABEL[s].toLowerCase()}.`); await load() }
    catch (e) { notify(describeError(e, 'Não foi possível atualizar o agendamento.'), 'danger'); await load() }
    finally { setBusyId(null); setConfirmCancel(null) }
  }
  const onAction = (a: AppointmentRow, s: AppointmentStatus) => (s === 'cancelled' ? setConfirmCancel(a) : void changeStatus(a, s))

  const proGroups = options?.professionals.filter((p) => !proFilter || p.id === proFilter) ?? []
  const daily = byDay[date] ?? []

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orbit">Operação / Agendamentos</p>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">Agenda</h1>
          <p className="text-sm text-slate">Organize os atendimentos e acompanhe sua equipe em um só lugar.</p>
        </div>
        <Button variant="accent" onClick={() => openNew(date)} disabled={!options}>+ Novo agendamento</Button>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate">
        <span className="rounded-full border border-hairline bg-white px-3 py-1.5"><strong className="mr-1 text-graphite">{rows === null ? '—' : counts.total}</strong> agendamentos no período</span>
        <span className="rounded-full border border-hairline bg-white px-3 py-1.5"><strong className="mr-1 text-graphite">{rows === null ? '—' : counts.confirmed}</strong> confirmados</span>
        <span className="rounded-full border border-hairline bg-white px-3 py-1.5"><strong className="mr-1 text-graphite">{rows === null ? '—' : counts.completed}</strong> concluídos</span>
      </div>

      <section aria-label="Controles da agenda" className="rounded-xl border border-hairline bg-surface p-3 shadow-[0_1px_2px_rgb(17_20_26/0.04)] sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <div role="group" aria-label="Visualização" className="flex rounded-lg bg-paper p-1">
              {(['day', 'week'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                  className={`min-h-9 rounded-md px-4 text-sm font-medium transition ${view === v ? 'bg-white text-ink shadow-sm' : 'text-slate hover:text-ink'}`}>{v === 'day' ? 'Dia' : 'Semana'}</button>
              ))}
            </div>
            <span className="hidden h-7 w-px bg-hairline sm:block" aria-hidden="true" />
            <button type="button" aria-label="Período anterior" onClick={() => setDate(addDays(date, -step))} className="grid size-9 place-items-center rounded-lg border border-hairline text-lg hover:bg-paper">‹</button>
            <button type="button" aria-label="Próximo período" onClick={() => setDate(addDays(date, step))} className="grid size-9 place-items-center rounded-lg border border-hairline text-lg hover:bg-paper">›</button>
            <button type="button" onClick={() => setDate(today)} className="min-h-9 rounded-lg border border-hairline px-3 text-sm font-medium hover:bg-paper">Hoje</button>
          </div>
          <p className="font-display text-sm font-semibold capitalize sm:text-base">{view === 'day' ? dayLabel(date) : `${dayLabel(from, 'short')} — ${dayLabel(to, 'short')}`}</p>
        </div>
        <div className="grid gap-3 pt-4 sm:grid-cols-3">
          <TextField label="Selecionar data" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <SelectField label="Profissional" value={proFilter} onChange={(e) => setProFilter(e.target.value)}
            options={[{ value: '', label: 'Todos os profissionais' }, ...(options?.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          <SelectField label="Situação" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            options={[{ value: 'all', label: 'Todas as situações' }, { value: 'active', label: 'Em andamento' }, { value: 'scheduled', label: 'Agendados' }, { value: 'confirmed', label: 'Confirmados' }, { value: 'completed', label: 'Concluídos' }, { value: 'cancelled', label: 'Cancelados' }, { value: 'no_show', label: 'Faltas' }]} />
        </div>
      </section>

      {error ? <ErrorState title="Agenda indisponível" message={error} onRetry={() => void load()} />
        : rows === null ? <div className="grid place-items-center rounded-xl border border-hairline bg-white py-20" role="status" aria-label="Carregando agenda"><Spinner className="size-6" /></div>
        : view === 'day' ? (
          <section aria-label="Atendimentos do dia" className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-[0_1px_2px_rgb(17_20_26/0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-4 sm:px-5">
              <div><h2 className="font-display text-base font-semibold">Atendimentos do dia</h2><p className="mt-0.5 text-xs text-slate">{daily.length} {daily.length === 1 ? 'agendamento' : 'agendamentos'} nos filtros selecionados</p></div>
              <button type="button" onClick={() => openNew(date)} disabled={!options} className="rounded-lg px-3 py-2 text-sm font-medium text-orbit hover:bg-orbit-soft disabled:opacity-50">+ Adicionar</button>
            </div>
            <DayTimeline appointments={daily} professionals={proGroups} tz={tz} busyId={busyId} onEdit={openEdit} onAction={onAction} />
            {daily.length > 0 && <div className="border-t border-hairline p-4 sm:p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate">Detalhes e ações</h3>
              <ul className="space-y-2">{daily.map((a) => <ApptCard key={a.id} a={a} tz={tz} busyId={busyId} onEdit={openEdit} onAction={onAction} />)}</ul>
            </div>}
          </section>
        ) : (
          <section aria-label="Agenda semanal" className="overflow-hidden rounded-xl border border-hairline bg-white shadow-[0_1px_2px_rgb(17_20_26/0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-4 sm:px-5"><h2 className="font-display text-base font-semibold">Visão semanal</h2><span className="text-xs text-slate">Selecione um dia para ver detalhes</span></div>
            <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-7">
              {days.map((d) => (
                <div key={d} className={`min-h-32 bg-white p-3 ${d === today ? 'bg-orbit-soft/40' : ''}`}>
                  <div className="mb-3 flex items-center justify-between gap-1">
                    <button type="button" className={`text-left text-xs font-semibold capitalize hover:text-orbit ${d === today ? 'text-orbit' : 'text-graphite'}`} onClick={() => { setDate(d); setView('day') }}>{dayLabel(d, 'short')}</button>
                    <button type="button" aria-label={`Novo agendamento em ${dayLabel(d)}`} className="grid size-7 shrink-0 place-items-center rounded-md text-orbit hover:bg-orbit-soft" onClick={() => openNew(d)}>+</button>
                  </div>
                  <div className="space-y-2">{(byDay[d] ?? []).map((a) => <ApptCard key={a.id} a={a} tz={tz} compact busyId={busyId} onEdit={openEdit} onAction={onAction} />)}
                    {!(byDay[d] ?? []).length && <p className="py-4 text-center text-[11px] text-slate">Sem agendamentos</p>}</div>
                </div>
              ))}
            </div>
          </section>
        )}

      {modal && options && (
        <AppointmentModal estId={est.id} tz={tz} options={options} initial={modal.form} original={modal.original}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); notify('Agendamento salvo.'); void load() }} />
      )}
      {confirmCancel && (
        <Modal title="Cancelar agendamento" onClose={() => setConfirmCancel(null)} busy={busyId !== null}
          footer={<>
            <Button variant="outline" onClick={() => setConfirmCancel(null)}>Voltar</Button>
            <Button variant="primary" loading={busyId === confirmCancel.id} onClick={() => void changeStatus(confirmCancel, 'cancelled')}>Cancelar agendamento</Button>
          </>}>
          <p className="text-sm">{confirmCancel.customer_name} · {confirmCancel.service_name}, {dayLabel(zoned(confirmCancel.starts_at, tz).date, 'short')} às {zoned(confirmCancel.starts_at, tz).time}. O horário volta a ficar livre.</p>
        </Modal>
      )}
      {toast}
    </div>
  )
}
