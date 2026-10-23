import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField, SelectField } from '@/components/ui/Field'
import { useAccount } from '@/features/establishments/AccountProvider'
import { formatBRL, parseBRL } from '@/lib/money'
import { describeError } from '@/lib/errors'
import { createEntry, listEntries, type Entry, type EntryKind, type PaymentMethod } from './api'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const startMonth = () => today().slice(0, 7) + '-01'
const methods: Record<PaymentMethod, string> = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão', other: 'Outro' }
const kinds: Record<EntryKind, string> = { income: 'Recebimento', expense: 'Despesa', refund: 'Estorno' }
const card = 'min-w-0 rounded-xl border border-hairline bg-surface shadow-[0_1px_2px_rgb(17_20_26/0.04)]'

export default function FinancePage() {
  const { current } = useAccount()
  const establishmentId = current?.establishment.id ?? ''
  const allowed = current?.role === 'owner'
  const [from, setFrom] = useState(startMonth)
  const [to, setTo] = useState(today)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState<EntryKind>('income')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [date, setDate] = useState(today)
  const [appointmentId, setAppointmentId] = useState('')

  const reload = useCallback(async () => {
    if (!allowed || !establishmentId) { setLoading(false); return }
    setLoading(true); setError('')
    try { setEntries(await listEntries(establishmentId, from, to)) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar o financeiro.')) }
    finally { setLoading(false) }
  }, [allowed, establishmentId, from, to])
  useEffect(() => { void reload() }, [reload])

  const totals = useMemo(() => entries.reduce((t, e) => {
    if (e.kind === 'income') t.income += e.amount_cents
    if (e.kind === 'expense') t.expense += e.amount_cents
    if (e.kind === 'refund') t.refund += e.amount_cents
    return t
  }, { income: 0, expense: 0, refund: 0 }), [entries])
  const net = totals.income - totals.expense - totals.refund

  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage(''); setError('')
    const cents = parseBRL(amount)
    if (!cents || cents <= 0 || !Number.isSafeInteger(cents)) { setError('Informe um valor válido maior que zero.'); return }
    if (description.trim().length < 2 || description.trim().length > 180) { setError('Descrição deve ter de 2 a 180 caracteres.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Data inválida.'); return }
    if (appointmentId.trim() && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(appointmentId.trim())) { setError('ID do agendamento inválido.'); return }
    setSaving(true)
    try {
      await createEntry(establishmentId, { kind, description: description.trim(), amount_cents: cents, method, occurred_on: date, appointment_id: kind === 'expense' ? null : appointmentId.trim() || null })
      setDescription(''); setAmount(''); setAppointmentId(''); setMessage('Lançamento registrado.'); await reload()
    } catch (err) { setError(describeError(err, 'Não foi possível registrar o lançamento.')) }
    finally { setSaving(false) }
  }

  if (!allowed) return <div className={`${card} p-6`}><h1 className="font-display text-xl font-semibold">Financeiro</h1><p className="mt-2 text-sm text-slate">Acesso reservado ao proprietário do estabelecimento.</p></div>
  return <div className="mx-auto max-w-6xl space-y-5 pb-12">
    <header>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-slate">Gestão</p>
      <h1 className="mt-1 font-display text-[1.875rem] font-semibold leading-tight tracking-tight sm:text-[2.125rem]">Financeiro</h1>
      <p className="mt-1 text-sm text-slate">Controle de recebimentos, despesas e estornos. Agendamentos só entram na receita quando pagos.</p>
    </header>

    <section aria-label="Filtros do financeiro" className={`${card} flex flex-wrap items-end gap-3 p-4 sm:p-5`}>
      <div className="min-w-[145px] flex-1 sm:max-w-[190px]"><TextField label="De" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></div>
      <div className="min-w-[145px] flex-1 sm:max-w-[190px]"><TextField label="Até" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
      <Button type="button" variant="outline" onClick={() => void reload()}>Atualizar</Button>
    </section>

    <section aria-label="Indicadores financeiros" className={`${card} grid grid-cols-2 divide-x divide-y divide-hairline overflow-hidden lg:grid-cols-4 lg:divide-y-0`}>
      {([['Recebimentos', totals.income, 'bg-orbit'], ['Despesas', totals.expense, 'bg-signal'], ['Estornos', totals.refund, 'bg-danger'], ['Saldo do período', net, 'bg-ok']] as const).map(([label, value, tone]) =>
        <div key={label} className="min-w-0 px-4 py-5 sm:px-5">
          <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-slate"><span className={`size-1.5 shrink-0 rounded-full ${tone}`} />{label}</p>
          <p className="mt-3 truncate font-display text-[1.65rem] font-semibold leading-none tracking-tight tabular-nums sm:text-[1.875rem]">{formatBRL(value)}</p>
        </div>)}
    </section>

    {error && <div role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</div>}
    {message && <div role="status" className="rounded-control border border-ok/20 bg-ok-soft p-3 text-sm text-ok">{message}</div>}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
      <section className={`${card} p-5`}>
        <h2 className="font-display text-base font-semibold tracking-tight">Novo lançamento</h2>
        <form onSubmit={e => void submit(e)} className="mt-5 space-y-4">
          <SelectField label="Tipo" value={kind} onChange={e => setKind(e.target.value as EntryKind)} options={Object.entries(kinds).map(([value,label]) => ({value,label}))} />
          <TextField label="Descrição" value={description} maxLength={180} required onChange={e => setDescription(e.target.value)} placeholder="Ex.: Corte masculino" />
          <TextField label="Valor (R$)" value={amount} required inputMode="decimal" onChange={e => setAmount(e.target.value)} placeholder="35,00" />
          <SelectField label="Forma de pagamento" value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} options={Object.entries(methods).map(([value,label]) => ({value,label}))} />
          <TextField label="Data" type="date" value={date} required onChange={e => setDate(e.target.value)} />
          {kind !== 'expense' && <TextField label="ID do agendamento (opcional)" value={appointmentId} onChange={e => setAppointmentId(e.target.value)} placeholder="UUID do agendamento" hint="Vincule para validar o valor pago. Lançamentos avulsos não alteram agendamentos." />}
          <Button type="submit" full loading={saving}>Registrar lançamento</Button>
        </form>
      </section>

      <section className={`${card} min-w-0 p-5`}>
        <h2 className="font-display text-base font-semibold tracking-tight">Movimentações</h2>
        {loading ? <p className="mt-5 text-sm text-slate">Carregando…</p> : entries.length === 0 ? <p className="mt-5 text-sm text-slate">Nenhuma movimentação neste período.</p> :
          <div className="mt-4 divide-y divide-hairline">{entries.map(e => <div key={e.id} className="flex items-center justify-between gap-3 py-3.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{e.description}</p><p className="mt-1 text-xs text-slate">{e.occurred_on.split('-').reverse().join('/')} · {kinds[e.kind]} · {methods[e.method]}</p></div><p className={'shrink-0 font-display text-sm font-semibold tabular-nums '+(e.kind === 'income' ? 'text-ok' : 'text-danger')}>{e.kind === 'income' ? '+' : '−'} {formatBRL(e.amount_cents)}</p></div>)}</div>}
        {entries.length === 1000 && <p className="mt-3 text-xs text-signal">Limite de 1.000 registros no período. Reduza o intervalo para conferir todos os lançamentos.</p>}
      </section>
    </div>
  </div>
}
