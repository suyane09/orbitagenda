import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { dayLabel } from '@/lib/agenda'
import { describeError } from '@/lib/errors'
import { blockFormToRpc, blockKindLabel, blockToForm, formatBlockPeriod, validateBlockForm, type BlockFormValues, type ScheduleBlock } from '@/lib/schedule'
import { deleteScheduleBlock, saveScheduleBlock } from '@/features/schedule/api'
import type { AgendaOptions, AppointmentRow } from './api'

// ---- Reagendar (arrastar e soltar) --------------------------------------------------
export interface MoveState {
  a: AppointmentRow
  professionalId: string
  professionalName: string
  date: string
  time: string
  phase: 'checking' | 'ok' | 'unavailable' | 'saving'
  error?: string
}

export function MoveModal({ m, fromTime, fromProfessional, onClose, onConfirm }: {
  m: MoveState; fromTime: string; fromProfessional: string; onClose: () => void; onConfirm: () => void
}) {
  const busy = m.phase === 'saving'
  const samePro = m.professionalId === m.a.professional_id
  return (
    <Modal title="Reagendar atendimento" onClose={onClose} busy={busy}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>{m.phase === 'unavailable' ? 'Fechar' : 'Cancelar'}</Button>
        {m.phase !== 'unavailable' && <Button variant="accent" onClick={onConfirm} loading={busy} disabled={m.phase === 'checking'}>Confirmar reagendamento</Button>}
      </>}>
      <div className="space-y-4">
        <p className="text-sm"><strong>{m.a.customer_name}</strong> · {m.a.service_name}</p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
          <div className="rounded-control border border-hairline px-3 py-2.5"><p className="text-xs text-slate">De</p><p className="font-medium tabular-nums">{fromTime}</p><p className="truncate text-slate">{fromProfessional}</p></div>
          <span aria-hidden="true" className="text-slate">→</span>
          <div className="rounded-control border border-orbit/40 bg-orbit-soft/50 px-3 py-2.5"><p className="text-xs text-slate">Para</p><p className="font-medium tabular-nums">{m.time}</p><p className="truncate text-slate">{m.professionalName}</p></div>
        </div>
        <p className="text-xs capitalize text-slate">{dayLabel(m.date)}{samePro ? '' : ' · troca de profissional'}</p>
        {m.phase === 'checking' && <p className="flex items-center gap-2 text-sm text-slate"><Spinner className="size-4" />Conferindo disponibilidade…</p>}
        {m.phase === 'ok' && <p className="text-sm text-ok">Horário livre. Nada é alterado até você confirmar.</p>}
        {m.phase === 'unavailable' && <Alert>{m.error ?? 'Esse horário não está disponível para este serviço e profissional.'}</Alert>}
        {m.error && m.phase !== 'unavailable' && <Alert>{m.error}</Alert>}
      </div>
    </Modal>
  )
}

// ---- Bloquear horário -------------------------------------------------------------
export function BlockModal({ estId, tz, options, initial, id, onClose, onSaved }: {
  estId: string; tz: string; options: AgendaOptions; initial: BlockFormValues; id: string | null
  onClose: () => void; onSaved: () => void
}) {
  const [v, setV] = useState<BlockFormValues>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<BlockFormValues>) => setV((s) => ({ ...s, ...p }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = { ...v, kind: 'block' as const, endDate: v.startDate }
    const found = validateBlockForm(value, tz, new Date())
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true); setErr(null)
    try { await saveScheduleBlock(estId, id, blockFormToRpc(value)); onSaved() }
    catch (x) { setErr(describeError(x, 'Não foi possível salvar o bloqueio.')) }
    finally { setBusy(false) }
  }

  return (
    <Modal title={id ? 'Editar bloqueio' : 'Bloquear horário'} onClose={onClose} busy={busy}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
        <Button variant="accent" type="submit" form="block-form" loading={busy}>Salvar bloqueio</Button>
      </>}>
      <form id="block-form" onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert>{err}</Alert>}
        <SelectField label="Profissional" value={v.professionalId} onChange={(e) => set({ professionalId: e.target.value })}
          options={[{ value: '', label: 'Todos os profissionais' }, ...options.professionals.map((p) => ({ value: p.id, label: p.name }))]} />
        <TextField label="Data" type="date" value={v.startDate} error={errors.startDate ?? errors.endDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value })} />
        <Switch checked={v.allDay} onChange={(allDay) => set({ allDay })} label="Dia inteiro" />
        {!v.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Início" type="time" step={900} value={v.startTime} error={errors.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            <TextField label="Fim" type="time" step={900} value={v.endTime} error={errors.endTime} onChange={(e) => set({ endTime: e.target.value })} />
          </div>
        )}
        <TextField label="Motivo (opcional)" value={v.reason} maxLength={120} error={errors.reason} onChange={(e) => set({ reason: e.target.value })} />
        <p className="text-xs text-slate">O servidor recusa o bloqueio se houver atendimento ativo no período.</p>
      </form>
    </Modal>
  )
}

// ---- Detalhes do bloqueio ------------------------------------------------------------
export function BlockDetails({ b, tz, professionals, estId, onClose, onEdit, onRemoved }: {
  b: ScheduleBlock; tz: string; professionals: AgendaOptions['professionals']; estId: string
  onClose: () => void; onEdit: (b: ScheduleBlock) => void; onRemoved: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const f = blockToForm(b, tz)
  const editable = b.kind === 'block' && f.startDate === f.endDate
  const pro = professionals.find((p) => p.id === b.professional_id)

  async function remove() {
    setBusy(true); setErr(null)
    try { await deleteScheduleBlock(b.id, estId); onRemoved() }
    catch (x) { setErr(describeError(x, 'Não foi possível remover o bloqueio.')); setBusy(false) }
  }
  return (
    <Modal title={blockKindLabel(b.kind)} onClose={onClose} busy={busy}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
        {editable && <Button variant="outline" onClick={() => onEdit(b)} disabled={busy}>Editar</Button>}
        <Button variant="primary" loading={busy} onClick={() => (confirm ? void remove() : setConfirm(true))}>{confirm ? 'Confirmar remoção' : 'Remover'}</Button>
      </>}>
      <div className="space-y-3 text-sm">
        {err && <Alert>{err}</Alert>}
        <dl className="divide-y divide-hairline rounded-control border border-hairline">
          <div className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="text-slate">Profissional</dt><dd className="font-medium">{pro?.name ?? 'Todos os profissionais'}</dd></div>
          <div className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="text-slate">Período</dt><dd className="text-right font-medium">{formatBlockPeriod(b, tz)}</dd></div>
          {b.reason && <div className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="text-slate">Motivo</dt><dd className="text-right font-medium">{b.reason}</dd></div>}
        </dl>
        {!editable && <p className="text-xs text-slate">Folgas, férias e bloqueios de vários dias são editados em <Link to="/app/horarios" className="text-orbit hover:underline">Horários</Link>.</p>}
        {confirm && <p className="text-xs text-slate">Ao remover, o horário volta a ficar disponível para agendamento.</p>}
      </div>
    </Modal>
  )
}
