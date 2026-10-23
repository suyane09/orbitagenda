import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { ACTION_LABEL, STATUS_CHIP, STATUS_LABEL, addDays, dayLabel, groupByDate, isActive, minutesToTime, timeToMinutes, weekDays, weekdayOf, zoned } from '@/lib/agenda'
import { describeError } from '@/lib/errors'
import { formatBRL, formatDuration } from '@/lib/money'
import { emptyBlockForm, blockToForm, todayInZone, type ScheduleBlock } from '@/lib/schedule'
import { useAccount } from '@/features/establishments/AccountProvider'
import {
  NEXT_STATUS, getAvailableSlots, listAppointments, listBlocksInRange, loadAgendaOptions, loadWorkingSegments, saveAppointment, searchCustomers, setAppointmentStatus,
  type AgendaOptions, type AppointmentRow, type AppointmentStatus, type Slot, type WorkSegment,
} from './api'
import { DayTimeline, StatusMark, initials, type WorkRange } from './AgendaGrid'
import { BlockDetails, BlockModal, MoveModal, type MoveState } from './AgendaModals'
import { CompletePaymentModal } from './CompletePaymentModal'

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
  const [requestedTime, setRequestedTime] = useState(initial.id ? '' : initial.time)
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

  useEffect(() => {
    if (!requestedTime || slots === null || !f.serviceId || !f.professionalId) return
    if (times.includes(requestedTime)) setF((prev) => prev.time === requestedTime ? prev : { ...prev, time: requestedTime })
    else setF((prev) => prev.time === '' ? prev : { ...prev, time: '' })
  }, [requestedTime, slots, times, f.serviceId, f.professionalId])

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
          {requestedTime && f.serviceId && slots !== null && !slotError && !times.includes(requestedTime) && (
            <p className="mb-2 text-xs text-amber-700">O horário {requestedTime} não está disponível para este serviço. Escolha outro horário abaixo.</p>
          )}
          {!f.serviceId || !f.professionalId ? <p className="text-sm text-slate">Escolha serviço e profissional para ver os horários livres.</p>
            : slots === null ? <Spinner className="size-5" />
            : times.length === 0 ? <p className="text-sm text-slate">Sem horários livres neste dia (expediente, intervalo, folga ou agenda cheia).</p>
            : <div role="radiogroup" aria-label="Horários disponíveis" className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {times.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={f.time === t} onClick={() => { setRequestedTime(''); set({ time: t }) }}
                    className={`h-10 rounded-control border text-sm tabular-nums ${f.time === t ? 'border-orbit bg-orbit text-white' : 'border-hairline hover:border-orbit'}`}>{t}</button>
                ))}
              </div>}
        </div>
        <TextAreaField label="Observações" value={f.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
      </form>
    </Modal>
  )
}

// ---- Cartão compacto (visão semanal) ----------------------------------------------
function ApptCard({ a, tz, onOpen }: { a: AppointmentRow; tz: string; onOpen: (a: AppointmentRow) => void }) {
  const range = `${zoned(a.starts_at, tz).time}–${zoned(a.ends_at, tz).time}`
  return (
    <button type="button" onClick={() => onOpen(a)} style={{ borderLeftColor: a.professional_color }}
      className={`block w-full rounded-[10px] border border-hairline border-l-4 bg-white px-2.5 py-2.5 text-left text-xs shadow-[0_1px_2px_rgb(17_20_26/0.05)] transition hover:border-orbit hover:shadow-md focus-visible:outline-2 focus-visible:outline-orbit ${a.status === 'cancelled' ? 'opacity-60 saturate-50' : ''}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{range}</span>
        <span className={`inline-flex items-center gap-1 rounded-full py-px pl-0.5 pr-1.5 text-[10px] font-medium ${STATUS_CHIP[a.status]}`}><StatusMark status={a.status} className="size-3.5!" />{STATUS_LABEL[a.status]}</span>
      </span>
      <span className={`mt-1 block truncate font-medium ${a.status === 'cancelled' ? 'line-through' : ''}`}>{a.customer_name}</span>
      <span className="block truncate text-slate">{a.service_name}</span>
    </button>
  )
}

// ---- Detalhes e ações (abre ao clicar em um agendamento) ------------------------------
function ApptDetails({ a, tz, busyId, onClose, onEdit, onAction }: {
  a: AppointmentRow; tz: string; busyId: string | null
  onClose: () => void; onEdit: (a: AppointmentRow) => void; onAction: (a: AppointmentRow, s: AppointmentStatus) => void
}) {
  const started = new Date(a.starts_at).getTime() <= Date.now()
  const start = zoned(a.starts_at, tz)
  const rows: Array<[string, string]> = [
    ['Serviço', a.service_name],
    ['Profissional', a.professional_name],
    ['Data', `${dayLabel(start.date)} · ${start.time}–${zoned(a.ends_at, tz).time}`],
    ['Valor', formatBRL(a.price_cents)],
    ...(a.customer_phone ? [['Telefone', a.customer_phone] as [string, string]] : []),
  ]
  return (
    <Modal title="Detalhes do agendamento" onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Fechar</Button>
        <Button variant="accent" onClick={() => onEdit(a)}>Editar</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: a.professional_color }}>{initials(a.customer_name)}</span>
            <p className="min-w-0 break-words font-display text-lg font-semibold leading-tight">{a.customer_name}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-xs font-medium ${STATUS_CHIP[a.status]}`}><StatusMark status={a.status} />{STATUS_LABEL[a.status]}</span>
        </div>
        <dl className="divide-y divide-hairline rounded-control border border-hairline text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="text-slate">{k}</dt><dd className="min-w-0 text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        {a.notes && <p className="rounded-control bg-paper px-3.5 py-2.5 text-sm text-graphite">{a.notes}</p>}
        {isActive(a.status) && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate">Ações</p>
            <div className="flex flex-wrap gap-2">
              {NEXT_STATUS[a.status].map((s) => (
                <Button key={s} variant={s === 'confirmed' ? 'accent' : 'outline'} className="h-9 px-3"
                  disabled={busyId === a.id || ((s === 'completed' || s === 'no_show') && !started)}
                  title={(s === 'completed' || s === 'no_show') && !started ? 'Disponível após o horário de início' : undefined}
                  onClick={() => onAction(a, s)}>{ACTION_LABEL[s]}</Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
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
  const [detail, setDetail] = useState<AppointmentRow | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<AppointmentRow | null>(null)
  const [completePayment, setCompletePayment] = useState<AppointmentRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([])
  const [segments, setSegments] = useState<WorkSegment[] | null>(null)
  const [blockMode, setBlockMode] = useState(false)
  const [blockModal, setBlockModal] = useState<{ id: string | null; form: ReturnType<typeof emptyBlockForm> } | null>(null)
  const [blockDetail, setBlockDetail] = useState<ScheduleBlock | null>(null)
  const [move, setMove] = useState<MoveState | null>(null)

  const days = useMemo(() => (view === 'week' ? weekDays(date) : [date]), [view, date])
  const from = days[0]!; const to = days[days.length - 1]!

  const load = useCallback(async () => {
    setError(null)
    try {
      const [r, b] = await Promise.all([listAppointments(est.id, from, to, proFilter || null), listBlocksInRange(est.id, from, to)])
      setRows(r); setBlocks(b)
    }
    catch (e) { setError(describeError(e, 'Não foi possível carregar a agenda.')) }
  }, [est.id, from, to, proFilter])

  useEffect(() => { setRows(null); void load() }, [load])
  useEffect(() => { loadAgendaOptions(est.id).then(setOptions).catch((e) => setError(describeError(e))) }, [est.id])
  // Expediente cadastrado (só leitura, para sombrear "fora do expediente"); se falhar, a grade simplesmente não sombreia.
  useEffect(() => { loadWorkingSegments(est.id).then(setSegments).catch(() => setSegments(null)) }, [est.id])
  // Atualiza sozinho a cada minuto (outros usuários também mexem na agenda).
  useEffect(() => { const t = setInterval(() => { void load() }, 60_000); return () => clearInterval(t) }, [load])

  const visible = useMemo(() => (rows ?? []).filter((r) => statusFilter === 'all' || (statusFilter === 'active' ? isActive(r.status) : r.status === statusFilter)), [rows, statusFilter])
  const counts = useMemo(() => ({ total: (rows ?? []).length, active: (rows ?? []).filter((r) => isActive(r.status)).length, confirmed: (rows ?? []).filter((r) => r.status === 'confirmed').length, completed: (rows ?? []).filter((r) => r.status === 'completed').length }), [rows])
  const byDay = useMemo(() => groupByDate(visible, tz), [visible, tz])

  const step = view === 'week' ? 7 : 1
  const today = todayInZone(new Date(), tz)

  const openNew = (d: string) => setModal({ original: null, form: { id: null, customer: null, serviceId: '', professionalId: proFilter, date: d < today ? today : d, time: '', notes: '' } })
  const openAt = (professionalId: string, time: string) => {
    if (!options) return
    setModal({ original: null, form: { id: null, customer: null, serviceId: '', professionalId, date, time: date < today ? '' : time, notes: '' } })
  }
  const openEdit = (a: AppointmentRow) => setModal({ original: a, form: {
    id: a.id, customer: { id: a.customer_id, name: a.customer_name }, serviceId: a.service_id, professionalId: a.professional_id,
    date: zoned(a.starts_at, tz).date, time: zoned(a.starts_at, tz).time, notes: a.notes ?? '' } })

  async function changeStatus(a: AppointmentRow, s: AppointmentStatus) {
    setBusyId(a.id)
    try { await setAppointmentStatus(est.id, a.id, s); notify(`Agendamento ${STATUS_LABEL[s].toLowerCase()}.`); await load() }
    catch (e) { notify(describeError(e, 'Não foi possível atualizar o agendamento.'), 'danger'); await load() }
    finally { setBusyId(null); setConfirmCancel(null) }
  }
  const onAction = (a: AppointmentRow, s: AppointmentStatus) => (s === 'cancelled' ? setConfirmCancel(a) : s === 'completed' ? setCompletePayment(a) : void changeStatus(a, s))
  const actFromDetail = (a: AppointmentRow, s: AppointmentStatus) => { setDetail(null); onAction(a, s) }
  const editFromDetail = (a: AppointmentRow) => { setDetail(null); openEdit(a) }

  const proGroups = options?.professionals.filter((p) => !proFilter || p.id === proFilter) ?? []
  const hoursToday = useMemo<Record<string, WorkRange[]> | null>(() => {
    if (!segments) return null
    const wd = weekdayOf(date)
    const out: Record<string, WorkRange[]> = {}
    for (const sg of segments) if (sg.weekday === wd) (out[sg.professional_id] ??= []).push({ start: timeToMinutes(sg.start_time), end: timeToMinutes(sg.end_time) })
    return out
  }, [segments, date])

  // ---- Reagendar por arrastar: confere a disponibilidade real no servidor antes de pedir confirmação ----
  async function requestMove(a: AppointmentRow, professionalId: string, startMin: number) {
    const time = minutesToTime(startMin)
    const pro = options?.professionals.find((p) => p.id === professionalId)
    if (!pro) return
    const base: MoveState = { a, professionalId, professionalName: pro.name, date, time, phase: 'checking' }
    setMove(base)
    try {
      const slots = await getAvailableSlots(est.id, professionalId, a.service_id, date, a.id)
      const ok = slots.some((sl) => zoned(sl.slot_start, tz).time === time && zoned(sl.slot_start, tz).date === date)
      setMove((m) => (m && m.a.id === a.id ? { ...m, phase: ok ? 'ok' : 'unavailable' } : m))
    } catch (e) {
      setMove((m) => (m && m.a.id === a.id ? { ...m, phase: 'unavailable', error: describeError(e, 'Não foi possível conferir a disponibilidade.') } : m))
    }
  }
  async function confirmMove() {
    if (!move || move.phase !== 'ok') return
    const m = move
    setMove({ ...m, phase: 'saving' })
    try {
      // O servidor valida de novo (expediente, bloqueios, conflitos) dentro da transação.
      await saveAppointment(est.id, { id: m.a.id, customerId: m.a.customer_id, professionalId: m.professionalId, serviceId: m.a.service_id, date: m.date, time: m.time, notes: m.a.notes })
      setMove(null); notify('Atendimento reagendado.'); await load()
    } catch (e) {
      setMove({ ...m, phase: 'unavailable', error: describeError(e, 'Não foi possível reagendar o atendimento.') })
      await load()
    }
  }

  // ---- Bloqueio de horários ----
  const openBlockForm = (professionalId: string, startMin: number | null, endMin: number | null) => {
    const f = emptyBlockForm(date < today ? today : date)
    setBlockModal({ id: null, form: { ...f, kind: 'block', professionalId, allDay: startMin === null, startTime: startMin === null ? '12:00' : minutesToTime(startMin), endTime: endMin === null ? '13:00' : minutesToTime(Math.min(endMin, 1439)) } })
  }
  const onBlockRange = (professionalId: string, startMin: number, endMin: number) => { setBlockMode(false); openBlockForm(professionalId === 'unassigned' ? '' : professionalId, startMin, endMin) }
  const editBlock = (b: ScheduleBlock) => { setBlockDetail(null); setBlockModal({ id: b.id, form: blockToForm(b, tz) }) }
  const daily = byDay[date] ?? []

  return (
    <div className={`mx-auto max-w-7xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:pt-6 ${view === 'day' && !error && rows !== null ? 'flex h-full min-h-[46rem] flex-col gap-4' : 'space-y-5'}`}>
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orbit">Operação / Agendamentos</p>
          <h1 className="font-display text-[1.6rem] font-semibold leading-tight tracking-tight sm:text-[2rem]">Agenda</h1>
          <p className="hidden text-sm text-slate [@media(min-height:900px)]:block">Organize os atendimentos e acompanhe sua equipe em um só lugar.</p>
        </div>
        <Button variant="accent" onClick={() => openNew(date)} disabled={!options}>+ Novo agendamento</Button>
      </header>

      <div className="hidden shrink-0 flex-wrap items-center gap-3 text-xs text-slate [@media(min-height:900px)]:flex">
        <span className="rounded-full border border-hairline bg-white px-3 py-1.5"><strong className="mr-1 text-graphite">{rows === null ? '—' : counts.total}</strong> agendamentos no período</span>
        <span className="rounded-full border border-hairline bg-white px-3 py-1.5"><strong className="mr-1 text-graphite">{rows === null ? '—' : counts.confirmed}</strong> confirmados</span>
        <span className="rounded-full border border-hairline bg-white px-3 py-1.5"><strong className="mr-1 text-graphite">{rows === null ? '—' : counts.completed}</strong> concluídos</span>
      </div>

      <section aria-label="Controles da agenda" className="shrink-0 rounded-xl border border-hairline bg-surface p-3 shadow-[0_1px_2px_rgb(17_20_26/0.04)] sm:p-4">
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
        {view === 'day' && (
          <div role="group" aria-label="Dias da semana" className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-3">
            {weekDays(date).map((d) => {
              const active = d === date
              return (
                <button key={d} type="button" aria-pressed={active} aria-label={dayLabel(d)} onClick={() => setDate(d)}
                  className={`relative flex min-w-[3.1rem] flex-1 flex-col items-center rounded-lg px-2 py-1.5 text-center transition ${active ? 'bg-ink text-white' : 'text-graphite hover:bg-paper'}`}>
                  <span className={`text-[10px] font-medium uppercase tracking-wider ${active ? 'text-white/70' : 'text-slate'}`}>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${d}T00:00:00Z`)).replace('.', '')}</span>
                  <span className="text-base font-semibold tabular-nums leading-tight">{d.slice(8)}</span>
                  {d === today && <span aria-hidden="true" className={`absolute bottom-0.5 size-1 rounded-full ${active ? 'bg-white' : 'bg-orbit'}`} />}
                </button>
              )
            })}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-3 sm:pt-4"><div className="col-span-2 sm:col-span-1">
          <TextField label="Selecionar data" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <SelectField label="Profissional" value={proFilter} onChange={(e) => setProFilter(e.target.value)}
            options={[{ value: '', label: 'Todos os profissionais' }, ...(options?.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          <SelectField label="Situação" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            options={[{ value: 'all', label: 'Todas as situações' }, { value: 'active', label: 'Em andamento' }, { value: 'scheduled', label: 'Agendados' }, { value: 'confirmed', label: 'Confirmados' }, { value: 'completed', label: 'Concluídos' }, { value: 'cancelled', label: 'Cancelados' }, { value: 'no_show', label: 'Faltas' }]} />
        </div>
      </section>

      {error ? <ErrorState title="Agenda indisponível" message={error} onRetry={() => void load()} />
        : rows === null ? <div className="grid place-items-center rounded-xl border border-hairline bg-white py-20" role="status" aria-label="Carregando agenda"><Spinner className="size-6" /></div>
        : view === 'day' ? (
          <section aria-label="Atendimentos do dia" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-[0_1px_2px_rgb(17_20_26/0.04)]">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
              <div><h2 className="font-display text-base font-semibold">Atendimentos do dia</h2><p className="mt-0.5 text-xs text-slate">{daily.length} {daily.length === 1 ? 'agendamento' : 'agendamentos'} nos filtros selecionados</p></div>
              <div className="flex items-center gap-1">
                <button type="button" aria-pressed={blockMode} onClick={() => setBlockMode((v) => !v)} disabled={!options} className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${blockMode ? 'bg-slate/15 text-ink' : 'text-slate hover:bg-ink/5 hover:text-ink'}`}>Bloquear horário</button>
                <button type="button" onClick={() => openNew(date)} disabled={!options} className="rounded-lg px-3 py-2 text-sm font-medium text-orbit hover:bg-orbit-soft disabled:opacity-50">+ Adicionar</button>
              </div>
            </div>
            {blockMode && (
              <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline bg-slate/10 px-4 py-2.5 text-sm text-graphite">
                <span>Modo bloqueio: toque ou arraste na grade para escolher o período.</span>
                <span className="flex gap-2">
                  <button type="button" className="rounded-md px-2.5 py-1.5 font-medium text-orbit hover:bg-orbit-soft" onClick={() => { setBlockMode(false); openBlockForm(proFilter, null, null) }}>Dia inteiro / formulário</button>
                  <button type="button" className="rounded-md px-2.5 py-1.5 font-medium hover:bg-ink/5" onClick={() => setBlockMode(false)}>Cancelar</button>
                </span>
              </div>
            )}
            <DayTimeline date={date} today={today} appointments={daily} professionals={proGroups} blocks={blocks} hours={hoursToday} tz={tz} blockMode={blockMode}
              onOpen={setDetail} onOpenBlock={setBlockDetail} onCreate={openAt} onMove={(a, pro, start) => void requestMove(a, pro, start)} onBlockRange={onBlockRange} />
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
                  <div className="space-y-2">{(byDay[d] ?? []).map((a) => <ApptCard key={a.id} a={a} tz={tz} onOpen={setDetail} />)}
                    {!(byDay[d] ?? []).length && <p className="py-4 text-center text-[11px] text-slate">Sem agendamentos</p>}</div>
                </div>
              ))}
            </div>
          </section>
        )}

      {detail && (
        <ApptDetails a={detail} tz={tz} busyId={busyId} onClose={() => setDetail(null)} onEdit={editFromDetail} onAction={actFromDetail} />
      )}
      {blockDetail && options && (
        <BlockDetails b={blockDetail} tz={tz} professionals={options.professionals} estId={est.id} onClose={() => setBlockDetail(null)} onEdit={editBlock}
          onRemoved={() => { setBlockDetail(null); notify('Bloqueio removido.'); void load() }} />
      )}
      {blockModal && options && (
        <BlockModal estId={est.id} tz={tz} options={options} initial={blockModal.form} id={blockModal.id} onClose={() => setBlockModal(null)}
          onSaved={() => { setBlockModal(null); notify('Horário bloqueado.'); void load() }} />
      )}
      {move && (
        <MoveModal m={move} fromTime={`${zoned(move.a.starts_at, tz).time}`} fromProfessional={move.a.professional_name}
          onClose={() => setMove(null)} onConfirm={() => void confirmMove()} />
      )}
      {modal && options && (
        <AppointmentModal estId={est.id} tz={tz} options={options} initial={modal.form} original={modal.original}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); notify('Agendamento salvo.'); void load() }} />
      )}
      {completePayment && <CompletePaymentModal a={completePayment} estId={est.id} tz={tz} onClose={() => { setCompletePayment(null); void load() }} onCompleted={(paid) => { setCompletePayment(null); notify(paid ? 'Atendimento concluído e pagamento registrado.' : 'Atendimento concluído. Confira os pagamentos pendentes no Financeiro.'); void load() }} />}
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
