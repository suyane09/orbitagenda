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
        className={`block w-full rounded-control border border-hairline border-l-4 bg-surface px-2 py-1.5 text-left text-xs hover:border-orbit ${a.status === 'cancelled' ? 'opacity-60' : ''}`}>
        <span className="font-medium tabular-nums">{range}</span> <span className={`ml-1 rounded px-1 ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
        <span className="mt-0.5 block truncate">{a.customer_name} · {a.service_name}</span>
      </button>
    )
  }
  return (
    <li style={{ borderLeftColor: a.professional_color }} className={`rounded-card border border-l-4 border-hairline bg-surface p-4 ${a.status === 'cancelled' ? 'opacity-70' : ''}`}>
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

// ---- Página -------------------------------------------------------------------------
export default function AgendaPage() {
  const { current } = useAccount()
  const est = current!.establishment
  const tz = est.timezone
  const { toast, notify } = useToast()

  const [view, setView] = useState<'day' | 'week'>('day')
  const [date, setDate] = useState(() => todayInZone(new Date(), tz))
  const [proFilter, setProFilter] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
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

  const visible = useMemo(() => (rows ?? []).filter((r) => showCancelled || r.status !== 'cancelled'), [rows, showCancelled])
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

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-slate">{view === 'day' ? dayLabel(date) : `${dayLabel(from, 'short')} a ${dayLabel(to, 'short')}`}</p></div>
        <Button variant="accent" onClick={() => openNew(date)} disabled={!options}>Novo agendamento</Button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Visualização" className="flex overflow-hidden rounded-control border border-hairline">
          {(['day', 'week'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`h-11 px-4 text-sm font-medium ${view === v ? 'bg-ink text-white' : 'bg-surface hover:bg-paper'}`}>{v === 'day' ? 'Dia' : 'Semana'}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" aria-label="Anterior" onClick={() => setDate(addDays(date, -step))}>‹</Button>
          <Button variant="outline" onClick={() => setDate(today)}>Hoje</Button>
          <Button variant="outline" aria-label="Próximo" onClick={() => setDate(addDays(date, step))}>›</Button>
        </div>
        <div className="w-44"><TextField label="Ir para" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        <div className="w-48"><SelectField label="Profissional" value={proFilter} onChange={(e) => setProFilter(e.target.value)}
          options={[{ value: '', label: 'Todos' }, ...(options?.professionals ?? []).map((p) => ({ value: p.id, label: p.name }))]} /></div>
        <label className="flex h-11 items-center gap-2 text-sm text-graphite"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />Mostrar cancelados</label>
      </div>

      {error ? <ErrorState title="Agenda indisponível" message={error} onRetry={() => void load()} />
        : rows === null ? <div className="grid place-items-center py-16"><Spinner className="size-6" /></div>
        : view === 'day' ? (
          (byDay[date] ?? []).length === 0
            ? <EmptyState title="Nenhum agendamento neste dia"><Button variant="accent" onClick={() => openNew(date)} disabled={!options}>Agendar um horário</Button></EmptyState>
            : <ul className="space-y-3">{(byDay[date] ?? []).map((a) => <ApptCard key={a.id} a={a} tz={tz} busyId={busyId} onEdit={openEdit} onAction={onAction} />)}</ul>
        ) : (
          <div className="grid gap-3 md:grid-cols-7">
            {days.map((d) => (
              <section key={d} aria-label={dayLabel(d)} className={`rounded-card border p-2 ${d === today ? 'border-orbit' : 'border-hairline'} bg-paper/40`}>
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" className="text-sm font-medium capitalize hover:underline" onClick={() => { setDate(d); setView('day') }}>{dayLabel(d, 'short')}</button>
                  <button type="button" aria-label={`Novo agendamento em ${dayLabel(d)}`} className="grid size-7 place-items-center rounded-full text-orbit hover:bg-orbit/10" onClick={() => openNew(d)}>+</button>
                </div>
                <div className="space-y-1.5">{(byDay[d] ?? []).map((a) => <ApptCard key={a.id} a={a} tz={tz} compact busyId={busyId} onEdit={openEdit} onAction={onAction} />)}</div>
              </section>
            ))}
          </div>
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
