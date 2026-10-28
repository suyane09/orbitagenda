import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/errors'
import { formatDuration } from '@/lib/money'
import {
  BLOCK_KINDS, BLOCK_REASON_MAX, DEFAULT_END, DEFAULT_START, MAX_BREAKS, WEEKDAY_LABELS, WEEKDAY_ORDER,
  blockFormToRpc, blockKindLabel, blockStatus, blockToForm, emptyBlockForm, formatBlockPeriod, segmentsToWeek,
  sameWeek, todayInZone, validateBlockForm, validateWeek, weekToSegments, workedMinutes,
  type BlockFormValues, type DaySchedule, type ScheduleBlock, type SegmentRow, type WeekSchedule,
} from '@/lib/schedule'
import { BRAZIL_TIMEZONES } from '@/lib/validation'
import { useAccount } from '@/features/establishments/AccountProvider'
import { deleteScheduleBlock, loadSchedule, saveScheduleBlock, saveWeeklySchedule, type SchedulePro, type ScheduleData } from './api'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
const tzLabel = (tz: string) => BRAZIL_TIMEZONES.find((t) => t.value === tz)?.label ?? tz

const timeInput =
  'h-11 w-[7.25rem] rounded-control border border-hairline bg-surface px-3 text-[0.95rem] tabular-nums focus:border-orbit focus:outline-none focus:ring-2 focus:ring-orbit/20 disabled:cursor-not-allowed disabled:bg-paper disabled:text-slate'

function ProAvatar({ pro, size = 'size-8' }: { pro: Pick<SchedulePro, 'name' | 'color'>; size?: string }) {
  return <span aria-hidden="true" style={{ backgroundColor: pro.color }} className={`grid ${size} shrink-0 place-items-center rounded-full text-xs font-semibold text-white`}>{initials(pro.name)}</span>
}

// ---- Expediente semanal ---------------------------------------------------------

function CopyDayModal({ source, week, onClose, onApply }: {
  source: number
  week: WeekSchedule
  onClose: () => void
  onApply: (targets: number[]) => void
}) {
  const [targets, setTargets] = useState<number[]>([])
  const toggle = (wd: number) => setTargets((t) => (t.includes(wd) ? t.filter((x) => x !== wd) : [...t, wd]))
  const others = WEEKDAY_ORDER.filter((wd) => wd !== source)
  const weekdays = others.filter((wd) => wd >= 1 && wd <= 5)
  return (
    <Modal title={`Copiar ${WEEKDAY_LABELS[source]!.toLowerCase()}`} onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button variant="accent" disabled={targets.length === 0} onClick={() => onApply(targets)}>Copiar para {targets.length || ''} {targets.length === 1 ? 'dia' : 'dias'}</Button>
      </>}>
      <p className="text-sm text-slate">
        {week[source]!.start} às {week[source]!.end}{week[source]!.breaks.length > 0 && ` com ${week[source]!.breaks.length} ${week[source]!.breaks.length === 1 ? 'intervalo' : 'intervalos'}`}. Os dias escolhidos serão substituídos.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="h-9 px-3" onClick={() => setTargets(weekdays)}>Dias úteis</Button>
        <Button variant="outline" className="h-9 px-3" onClick={() => setTargets(others)}>Todos</Button>
        <Button variant="ghost" className="h-9 px-3" onClick={() => setTargets([])}>Limpar</Button>
      </div>
      <ul className="mt-4 divide-y divide-hairline rounded-control border border-hairline">
        {others.map((wd) => (
          <li key={wd}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 hover:bg-paper">
              <input type="checkbox" checked={targets.includes(wd)} onChange={() => toggle(wd)} className="size-4 accent-orbit" />
              <span className="text-[0.95rem]">{WEEKDAY_LABELS[wd]}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function WeeklyEditor({ pro, rows, establishmentId, canEdit, onSaved, onDirtyChange }: {
  pro: SchedulePro
  rows: SegmentRow[]
  establishmentId: string
  canEdit: boolean
  onSaved: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}) {
  const signature = JSON.stringify(rows)
  const baseline = useMemo(() => segmentsToWeek(rows), [signature]) // eslint-disable-line react-hooks/exhaustive-deps
  const [week, setWeek] = useState<WeekSchedule>(baseline)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [copying, setCopying] = useState<number | null>(null)
  const { toast, notify } = useToast()

  useEffect(() => { setWeek(baseline) }, [baseline])
  const dirty = !sameWeek(week, baseline)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const errors = useMemo(() => validateWeek(week), [week])
  const hasErrors = Object.keys(errors).length > 0
  const totalMinutes = week.reduce((acc, d) => acc + workedMinutes(d), 0)

  const setDay = (wd: number, patch: Partial<DaySchedule>) =>
    setWeek((w) => w.map((d, i) => (i === wd ? { ...d, ...patch } : d)))

  async function save() {
    setFormError(''); setNotice('')
    if (hasErrors) { setFormError('Corrija os dias marcados antes de salvar.'); return }
    setSaving(true)
    try {
      const r = await saveWeeklySchedule(establishmentId, pro.id, weekToSegments(week))
      await onSaved()
      notify('Expediente salvo.')
      if (r.outside_appointments > 0) {
        setNotice(`${r.outside_appointments} ${r.outside_appointments === 1 ? 'agendamento futuro ficou' : 'agendamentos futuros ficaram'} fora do novo expediente. Foram mantidos; remarque se necessário.`)
      }
    } catch (e) { setFormError(describeError(e, 'Não foi possível salvar o expediente.')) }
    finally { setSaving(false) }
  }

  return (
    <section aria-label={`Expediente de ${pro.name}`} className="rounded-panel border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <ProAvatar pro={pro} size="size-10" />
          <div>
            <h2 className="font-display text-lg font-semibold leading-tight">{pro.name}</h2>
            <p className="text-sm text-slate">{totalMinutes > 0 ? `${formatDuration(totalMinutes)} de atendimento por semana` : 'Sem expediente definido'}</p>
          </div>
        </div>
        {!pro.is_active && <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-slate">Profissional inativo</span>}
      </div>

      <div className="space-y-4 px-5 pt-4 sm:px-6">
        {formError && <Alert>{formError}</Alert>}
        {notice && <Alert tone="info">{notice}</Alert>}
        {!canEdit && <Alert tone="info">Somente proprietários editam o expediente. Você pode consultar.</Alert>}
      </div>

      <ul className="px-5 sm:px-6">
        {WEEKDAY_ORDER.map((wd) => {
          const d = week[wd]!
          const label = WEEKDAY_LABELS[wd]!
          return (
            <li key={wd} className="border-b border-hairline py-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex w-44 items-center gap-3">
                  <Switch checked={d.open} disabled={!canEdit} label={`${label}: ${d.open ? 'fechar' : 'abrir'}`}
                    onChange={(open) => setDay(wd, open ? { open, start: d.start || DEFAULT_START, end: d.end || DEFAULT_END } : { open })} />
                  <span className={`font-medium ${d.open ? '' : 'text-slate'}`}>{label}</span>
                </div>
                {d.open ? (
                  <>
                    <div className="flex items-center gap-2">
                      <input type="time" step={300} aria-label={`${label}: início do expediente`} value={d.start} disabled={!canEdit}
                        onChange={(e) => setDay(wd, { start: e.target.value })} className={timeInput} aria-invalid={!!errors[wd]} />
                      <span className="text-sm text-slate">às</span>
                      <input type="time" step={300} aria-label={`${label}: fim do expediente`} value={d.end} disabled={!canEdit}
                        onChange={(e) => setDay(wd, { end: e.target.value })} className={timeInput} aria-invalid={!!errors[wd]} />
                    </div>
                    <span className="text-sm tabular-nums text-slate">{workedMinutes(d) > 0 ? formatDuration(workedMinutes(d)) : ''}</span>
                    <span className="flex-1" />
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" className="h-9 px-3" disabled={d.breaks.length >= MAX_BREAKS}
                          aria-label={`${label}: adicionar intervalo`}
                          onClick={() => setDay(wd, { breaks: [...d.breaks, { start: '12:00', end: '13:00' }] })}>+ Intervalo</Button>
                        <Button variant="ghost" className="h-9 px-3" aria-label={`Copiar ${label} para outros dias`} onClick={() => setCopying(wd)}>Copiar</Button>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-slate">Folga semanal · sem atendimento</span>
                )}
              </div>

              {d.open && d.breaks.length > 0 && (
                <ul aria-label={`Intervalos de ${label}`} className="mt-3 space-y-2 pl-0 sm:pl-[3.75rem]">
                  {d.breaks.map((b, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span className="w-20 text-sm text-slate">Intervalo</span>
                      <input type="time" step={300} aria-label={`${label}: início do intervalo ${i + 1}`} value={b.start} disabled={!canEdit}
                        onChange={(e) => setDay(wd, { breaks: d.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} className={timeInput} />
                      <span className="text-sm text-slate">às</span>
                      <input type="time" step={300} aria-label={`${label}: fim do intervalo ${i + 1}`} value={b.end} disabled={!canEdit}
                        onChange={(e) => setDay(wd, { breaks: d.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} className={timeInput} />
                      {canEdit && (
                        <Button variant="ghost" className="h-9 px-3 hover:!text-danger" aria-label={`${label}: remover intervalo ${i + 1}`}
                          onClick={() => setDay(wd, { breaks: d.breaks.filter((_, j) => j !== i) })}>Remover</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {errors[wd] && <p role="alert" className="mt-2 text-[0.8125rem] text-danger sm:pl-[3.75rem]">{errors[wd]}</p>}
            </li>
          )
        })}
      </ul>

      {canEdit && (
        <div className="flex flex-col-reverse gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {dirty && <span className="text-sm text-slate sm:mr-auto">Alterações não salvas</span>}
          <Button variant="outline" disabled={!dirty || saving} onClick={() => { setWeek(baseline); setFormError(''); setNotice('') }}>Descartar</Button>
          <Button variant="accent" loading={saving} disabled={!dirty} onClick={() => void save()}>Salvar expediente</Button>
        </div>
      )}

      {copying !== null && (
        <CopyDayModal source={copying} week={week} onClose={() => setCopying(null)}
          onApply={(targets) => {
            const src = week[copying]!
            setWeek((w) => w.map((d, i) => (targets.includes(i) ? { open: src.open, start: src.start, end: src.end, breaks: src.breaks.map((b) => ({ ...b })) } : d)))
            setCopying(null)
          }} />
      )}
      {toast}
    </section>
  )
}

// ---- Folgas, férias e bloqueios ------------------------------------------------

function BlockForm({ block, professionals, establishmentId, timeZone, onClose, onSaved }: {
  block: ScheduleBlock | null
  professionals: SchedulePro[]
  establishmentId: string
  timeZone: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [v, setV] = useState<BlockFormValues>(() => (block ? blockToForm(block, timeZone) : emptyBlockForm(todayInZone(new Date(), timeZone))))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof BlockFormValues>(k: K, val: BlockFormValues[K]) => setV((cur) => ({ ...cur, [k]: val }))

  const proOptions = [
    { value: '', label: v.kind === 'vacation' ? 'Selecione o profissional' : 'Todo o estabelecimento' },
    ...professionals.map((p) => ({ value: p.id, label: p.is_active ? p.name : `${p.name} (inativo)` })),
  ]
  const partial = v.kind === 'block' && !v.allDay

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const found = validateBlockForm(v, timeZone, new Date())
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    try {
      await saveScheduleBlock(establishmentId, block?.id ?? null, blockFormToRpc(v))
      onSaved(block ? 'Alteração salva.' : `${blockKindLabel(v.kind)} registrada.`)
    } catch (err) {
      setFormError(describeError(err, 'Não foi possível salvar.'))
      setSaving(false)
    }
  }

  return (
    <Modal title={block ? 'Editar período' : 'Novo período indisponível'} onClose={onClose} busy={saving}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button type="submit" form="block-form" variant="accent" loading={saving}>{block ? 'Salvar alterações' : 'Registrar'}</Button>
      </>}>
      <form id="block-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}

        <fieldset>
          <legend className="text-sm font-medium text-graphite">Tipo</legend>
          <div role="radiogroup" aria-label="Tipo" className="mt-2 grid grid-cols-3 gap-2">
            {BLOCK_KINDS.map((k) => (
              <button key={k.value} type="button" role="radio" aria-checked={v.kind === k.value} title={k.hint}
                onClick={() => setV((cur) => ({ ...cur, kind: k.value, allDay: k.value === 'block' ? cur.allDay : true }))}
                className={`h-11 rounded-control border text-sm font-medium transition-colors ${v.kind === k.value ? 'border-orbit bg-orbit-soft text-orbit-deep' : 'border-hairline hover:border-slate/50'}`}>
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[0.8125rem] text-slate">{BLOCK_KINDS.find((k) => k.value === v.kind)?.hint}</p>
        </fieldset>

        <SelectField label="Quem" value={v.professionalId} onChange={(e) => set('professionalId', e.target.value)}
          options={proOptions} error={errors.professionalId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="De" type="date" value={v.startDate} error={errors.startDate}
            onChange={(e) => setV((cur) => ({ ...cur, startDate: e.target.value, endDate: cur.endDate < e.target.value ? e.target.value : cur.endDate }))} />
          <TextField label="Até" type="date" value={v.endDate} min={v.startDate} error={errors.endDate}
            onChange={(e) => set('endDate', e.target.value)} />
        </div>

        {v.kind === 'block' && (
          <div className="flex items-center justify-between gap-4 rounded-control border border-hairline px-4 py-3">
            <div>
              <p className="text-sm font-medium text-graphite">Dia inteiro</p>
              <p className="text-[0.8125rem] text-slate">Desative para bloquear só um horário.</p>
            </div>
            <Switch checked={v.allDay} onChange={(on) => set('allDay', on)} label="Dia inteiro" />
          </div>
        )}
        {partial && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Hora inicial" type="time" step={300} value={v.startTime} error={errors.startTime} onChange={(e) => set('startTime', e.target.value)} />
            <TextField label="Hora final" type="time" step={300} value={v.endTime} error={errors.endTime} onChange={(e) => set('endTime', e.target.value)} />
          </div>
        )}

        <TextField label="Motivo (opcional)" value={v.reason} maxLength={BLOCK_REASON_MAX} error={errors.reason}
          onChange={(e) => set('reason', e.target.value)} placeholder="Ex.: Consulta médica, feriado local"
          hint={`Datas e horas no fuso do estabelecimento: ${tzLabel(timeZone)}.`} />
      </form>
    </Modal>
  )
}

function BlocksPanel({ data, establishmentId, timeZone, onChanged, notify }: {
  data: ScheduleData
  establishmentId: string
  timeZone: string
  onChanged: () => Promise<void>
  notify: (text: string, tone?: 'ok' | 'danger') => void
}) {
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<ScheduleBlock | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ScheduleBlock | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const proById = useMemo(() => new Map(data.professionals.map((p) => [p.id, p])), [data.professionals])
  const now = new Date()
  const visible = data.blocks.filter((b) => filter === 'all' || (filter === 'est' ? b.professional_id === null : b.professional_id === filter))

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await deleteScheduleBlock(deleting.id, establishmentId)
      setDeleting(null)
      notify('Período removido.')
      await onChanged()
    } catch (e) { setDeleteError(describeError(e, 'Não foi possível remover.')) }
    finally { setDeleteBusy(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full sm:w-72">
          <SelectField label="Mostrar" value={filter} onChange={(e) => setFilter(e.target.value)}
            options={[{ value: 'all', label: 'Todos' }, { value: 'est', label: 'Estabelecimento inteiro' }, ...data.professionals.map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
        <Button variant="accent" onClick={() => setEditing('new')}>Novo período indisponível</Button>
      </div>

      {data.blocks.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nenhum período indisponível">Registre folgas, férias ou bloqueios de horário. Eles impedem novos agendamentos no período.</EmptyState></div>
      ) : visible.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nada neste filtro">Escolha outro profissional ou mostre todos.</EmptyState></div>
      ) : (
        <ul aria-label="Períodos indisponíveis" className="mt-6 space-y-3">
          {visible.map((b) => {
            const pro = b.professional_id ? proById.get(b.professional_id) : undefined
            const st = blockStatus(b, now)
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-panel border border-hairline bg-surface p-4 sm:px-5">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                  {pro ? <ProAvatar pro={pro} /> : <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">★</span>}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{pro ? pro.name : 'Estabelecimento inteiro'}</p>
                    <p className="text-sm text-slate">{formatBlockPeriod(b, timeZone)}</p>
                    {b.reason && <p className="mt-0.5 truncate text-sm text-graphite">{b.reason}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-orbit-soft px-2.5 py-0.5 text-xs font-medium text-orbit-deep">{blockKindLabel(b.kind)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st === 'current' ? 'bg-ok-soft text-ok' : 'bg-paper text-slate'}`}>{st === 'current' ? 'Em andamento' : 'Próximo'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing(b)} aria-label={`Editar ${blockKindLabel(b.kind).toLowerCase()} de ${pro?.name ?? 'estabelecimento inteiro'}`}>Editar</Button>
                  <Button variant="ghost" className="h-9 px-3 hover:!text-danger" onClick={() => { setDeleteError(''); setDeleting(b) }} aria-label={`Remover ${blockKindLabel(b.kind).toLowerCase()} de ${pro?.name ?? 'estabelecimento inteiro'}`}>Remover</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <BlockForm block={editing === 'new' ? null : editing} professionals={data.professionals} establishmentId={establishmentId} timeZone={timeZone}
          onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); notify(m); void onChanged() }} />
      )}
      {deleting && (
        <Modal title="Remover período?" onClose={() => setDeleting(null)} busy={deleteBusy}
          footer={<>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancelar</Button>
            <Button onClick={() => void confirmDelete()} loading={deleteBusy} className="!bg-danger hover:!bg-danger/90">Remover</Button>
          </>}>
          <div className="space-y-4">
            {deleteError && <Alert>{deleteError}</Alert>}
            <p className="text-sm leading-relaxed text-graphite">
              {blockKindLabel(deleting.kind)} de <strong>{deleting.professional_id ? proById.get(deleting.professional_id)?.name ?? 'profissional' : 'todo o estabelecimento'}</strong> ({formatBlockPeriod(deleting, timeZone)}).
              O horário volta a ficar disponível para agendamento.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---- Página --------------------------------------------------------------------

type Tab = 'hours' | 'blocks'

export default function SchedulePage() {
  const { current } = useAccount()
  const est = current!.establishment
  const isOwner = current!.role === 'owner'
  const { toast, notify } = useToast()

  const [data, setData] = useState<ScheduleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('hours')
  const [proId, setProId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try { setData(await loadSchedule(est.id)) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar os horários.')) }
  }, [est.id])

  useEffect(() => { setData(null); setProId(null); void load() }, [load])

  const selected = data?.professionals.find((p) => p.id === proId) ?? data?.professionals.find((p) => p.is_active) ?? data?.professionals[0] ?? null

  function choosePro(id: string) {
    if (id === selected?.id) return
    if (dirty && !window.confirm('Há alterações não salvas neste expediente. Descartar e trocar de profissional?')) return
    setProId(id)
  }

  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'hours', label: 'Expediente semanal' }, { id: 'blocks', label: 'Folgas, férias e bloqueios' }]
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    setTab((t) => (t === 'hours' ? 'blocks' : 'hours'))
  }

  if (error) return <ErrorState title="Horários indisponíveis" message={error} onRetry={() => void load()} />

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">Horários</h1>
          <p className="mt-1.5 text-slate">Quando cada profissional atende em {est.name}, e quando não atende.</p>
        </div>
        <p className="rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-sm text-slate">Fuso: <span className="font-medium text-graphite">{tzLabel(est.timezone)}</span></p>
      </header>

      {!data ? (
        <div className="mt-16 flex items-center justify-center gap-3 text-slate"><Spinner />Carregando horários…</div>
      ) : data.professionals.length === 0 ? (
        <div className="mt-10">
          <EmptyState title="Cadastre um profissional primeiro">Os horários pertencem a cada profissional.</EmptyState>
          <div className="mt-5 flex justify-center">
            <Link to="/app/profissionais" className="inline-flex h-11 items-center rounded-control bg-orbit px-5 text-sm font-medium text-white hover:bg-orbit-deep">Ir para Profissionais</Link>
          </div>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Seções de horários" className="mt-8 flex gap-1 overflow-x-auto border-b border-hairline">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={onTabKey}
                className={`-mb-px h-11 shrink-0 border-b-2 px-4 text-sm font-medium transition-colors ${tab === t.id ? 'border-orbit text-ink' : 'border-transparent text-slate hover:text-ink'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="panel-hours" aria-labelledby="tab-hours" hidden={tab !== 'hours'} className="mt-6">
            <div role="group" aria-label="Profissional" className="flex gap-2 overflow-x-auto pb-1">
              {data.professionals.map((p) => (
                <button key={p.id} type="button" aria-pressed={selected?.id === p.id} onClick={() => choosePro(p.id)}
                  className={`flex h-11 shrink-0 items-center gap-2.5 rounded-full border pl-1.5 pr-4 text-sm font-medium transition-colors ${selected?.id === p.id ? 'border-orbit bg-orbit-soft text-orbit-deep' : 'border-hairline bg-surface hover:border-slate/50'} ${p.is_active ? '' : 'opacity-70'}`}>
                  <ProAvatar pro={p} />{p.name}
                </button>
              ))}
            </div>
            {selected && (
              <div className="mt-4">
                <WeeklyEditor key={selected.id} pro={selected} rows={data.hours[selected.id] ?? []} establishmentId={est.id} canEdit={isOwner}
                  onSaved={load} onDirtyChange={setDirty} />
              </div>
            )}
          </div>

          <div role="tabpanel" id="panel-blocks" aria-labelledby="tab-blocks" hidden={tab !== 'blocks'} className="mt-6">
            <BlocksPanel data={data} establishmentId={est.id} timeZone={est.timezone} onChanged={load} notify={notify} />
          </div>
        </>
      )}
      {toast}
    </div>
  )
}
