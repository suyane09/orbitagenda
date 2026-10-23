import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/features/establishments/AccountProvider'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { TextField, SelectField } from '@/components/ui/Field'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatBRL, parseBRL } from '@/lib/money'
import { describeError } from '@/lib/errors'
import { loadCommissionBalances, loadProfessionalNames, type CommissionBalance } from './balances'
import { loadCommissionPayouts, recordCommissionPayout, type CommissionPayout } from './payouts'

const methods = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão', other: 'Outro' } as const
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Maceio' })

export default function CommissionsPage() {
  const { current } = useAccount()
  const establishmentId = current?.establishment.id ?? ''
  const isOwner = current?.role === 'owner'
  const [items, setItems] = useState<CommissionBalance[]>([])
  const [payouts, setPayouts] = useState<CommissionPayout[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingLock = useRef(false)
  const [payProfessional, setPayProfessional] = useState('')
  const [payValue, setPayValue] = useState('')
  const [payMethod, setPayMethod] = useState<CommissionPayout['method']>('pix')
  const [payDate, setPayDate] = useState(today)
  const [payNote, setPayNote] = useState('')

  const refresh = useCallback(async () => {
    if (!isOwner || !establishmentId) return
    setLoading(true)
    setError('')
    try {
      const [balances, professionals, existingPayouts] = await Promise.all([
        loadCommissionBalances(establishmentId),
        loadProfessionalNames(establishmentId),
        loadCommissionPayouts(establishmentId),
      ])
      setItems(balances)
      setNames(professionals)
      setPayouts(existingPayouts)
    } catch (err) {
      setError(describeError(err, 'Não foi possível carregar as comissões.'))
    } finally { setLoading(false) }
  }, [establishmentId, isOwner])
  useEffect(() => { setItems([]); setPayouts([]); setNames(new Map()); void refresh() }, [refresh])

  const totals = useMemo(() => {
    const byProfessional = new Map<string, { count: number; received: number; accrued: number; paid: number }>()
    for (const row of items) {
      const v = byProfessional.get(row.professional_id) ?? { count: 0, received: 0, accrued: 0, paid: 0 }
      v.count += 1
      v.received += Number(row.net_received_cents)
      v.accrued += Number(row.accrued_cents)
      byProfessional.set(row.professional_id, v)
    }
    for (const row of payouts) {
      const v = byProfessional.get(row.professional_id) ?? { count: 0, received: 0, accrued: 0, paid: 0 }
      v.paid += Number(row.amount_cents)
      byProfessional.set(row.professional_id, v)
    }
    return [...byProfessional.entries()].sort((a,b) =>
      (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? '', 'pt-BR'))
  }, [items, payouts, names])
  const totalAccrued = totals.reduce((t,[,v]) => t + v.accrued, 0)
  const totalPaid = totals.reduce((t,[,v]) => t + v.paid, 0)
  const selected = totals.find(([id]) => id === payProfessional)
  const available = selected ? Math.max(0, selected[1].accrued - selected[1].paid) : 0

  async function submitPayout() {
    if (!isOwner || !establishmentId || savingLock.current || !payProfessional) return
    const amountCents = parseBRL(payValue)
    if (!amountCents || amountCents <= 0 || amountCents > available || !Number.isSafeInteger(amountCents)) {
      setError('Informe um valor maior que zero e até o saldo disponível.'); return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate) || payDate > today()) {
      setError('Informe uma data válida, que não esteja no futuro.'); return
    }
    if (payNote.length > 500) { setError('A observação deve ter até 500 caracteres.'); return }
    savingLock.current = true; setSaving(true); setError(''); setMessage('')
    try {
      await recordCommissionPayout({
        establishmentId, professionalId: payProfessional, amountCents,
        method: payMethod, paidOn: payDate, note: payNote.trim(),
      })
      setPayValue(''); setPayNote(''); setMessage('Repasse registrado com sucesso.')
      await refresh()
    } catch (e) { setError(describeError(e, 'Não foi possível registrar o repasse.')) }
    finally { savingLock.current = false; setSaving(false) }
  }

  if (!isOwner) return <ErrorState title="Acesso restrito" message="Somente o proprietário pode visualizar comissões." />
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold text-ink">Comissões</h1>
          <p className="mt-1 text-sm text-slate">Comissões geradas, repasses e saldo por profissional.</p></div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading || saving}>Atualizar</Button>
      </div>
      <Alert tone="info">As comissões são calculadas sobre os recebimentos líquidos. Só entram atendimentos concluídos após a ativação do módulo.
        Registre um repasse aqui apenas quando o pagamento ao profissional já tiver sido feito. Esta ação não transfere dinheiro nem lança uma despesa no caixa.</Alert>
      {error && <Alert>{error}</Alert>}
      {message && <p className="text-sm text-ok" role="status">{message}</p>}
      {loading ? <p className="text-sm text-slate">Carregando comissões…</p> : <>
        <div className="grid gap-4 sm:grid-cols-3">
          {([['Comissões geradas',totalAccrued],['Repasses registrados',totalPaid],['Saldo a repassar',totalAccrued-totalPaid]] as const).map(([label,value]) =>
            <div key={label} className="rounded-xl border border-hairline bg-surface p-5">
              <p className="text-sm text-slate">{label}</p>
              <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{formatBRL(value)}</p>
            </div>)}
        </div>
        {totals.length === 0 ? <EmptyState title="Nenhuma comissão calculada">Conclua um novo atendimento e registre o recebimento para visualizar os valores.</EmptyState> :
          <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
            <table className="w-full min-w-[690px] text-left text-sm">
              <thead className="border-b border-hairline text-slate"><tr>
                <th className="px-4 py-3 font-medium">Profissional</th>
                <th className="px-4 py-3 font-medium">Atendimentos</th>
                <th className="px-4 py-3 font-medium">Recebido</th>
                <th className="px-4 py-3 font-medium">Comissão gerada</th>
                <th className="px-4 py-3 font-medium">Repassado</th>
                <th className="px-4 py-3 font-medium">Saldo</th>
              </tr></thead>
              <tbody>{totals.map(([id, t]) => <tr key={id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3 font-medium">{names.get(id) ?? 'Profissional removido'}</td>
                <td className="px-4 py-3">{t.count}</td>
                <td className="px-4 py-3">{formatBRL(t.received)}</td>
                <td className="px-4 py-3">{formatBRL(t.accrued)}</td>
                <td className="px-4 py-3">{formatBRL(t.paid)}</td>
                <td className="px-4 py-3 font-semibold">{formatBRL(t.accrued-t.paid)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        <section className="rounded-xl border border-hairline bg-surface p-5">
          <h2 className="font-display text-lg font-semibold">Registrar repasse já realizado</h2>
          <p className="mt-1 text-sm text-slate">O registro é permanente. Estornos posteriores podem reduzir o saldo e torná-lo negativo.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SelectField label="Profissional" value={payProfessional} onChange={e => { setPayProfessional(e.target.value); setPayValue('') }}
              options={[{value:'',label:'Selecione o profissional'},...totals.filter(([,t])=>t.accrued-t.paid>0).map(([id])=>({value:id,label:names.get(id)??'Profissional'}))]} />
            <TextField label={`Valor (R$) · disponível ${formatBRL(available)}`} value={payValue} inputMode="decimal" onChange={e=>setPayValue(e.target.value)} placeholder="Ex.: 20,00" />
            <SelectField label="Forma de pagamento" value={payMethod} onChange={e=>setPayMethod(e.target.value as CommissionPayout['method'])}
              options={Object.entries(methods).map(([value,label])=>({value,label}))} />
            <TextField label="Data do repasse" type="date" value={payDate} max={today()} onChange={e=>setPayDate(e.target.value)} />
            <div className="sm:col-span-2"><TextField label="Observação (opcional)" value={payNote} maxLength={500} onChange={e=>setPayNote(e.target.value)} placeholder="Ex.: Pix confirmado" /></div>
          </div>
          <div className="mt-4 flex justify-end"><Button variant="accent" disabled={!payProfessional || available <= 0 || loading} loading={saving} onClick={() => void submitPayout()}>Registrar repasse</Button></div>
        </section>
        <section className="rounded-xl border border-hairline bg-surface p-5">
          <h2 className="font-display text-lg font-semibold">Histórico de repasses</h2>
          {payouts.length === 0 ? <p className="mt-3 text-sm text-slate">Nenhum repasse registrado.</p> :
            <div className="mt-3 divide-y divide-hairline">{payouts.map(p=><div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div><p className="font-medium">{names.get(p.professional_id) ?? 'Profissional removido'}</p>
                <p className="text-slate">{p.paid_on.split('-').reverse().join('/')} · {methods[p.method]}{p.note ? ` · ${p.note}` : ''}</p></div>
              <p className="font-semibold tabular-nums">{formatBRL(Number(p.amount_cents))}</p>
            </div>)}</div>}
        </section>
      </>}
      <p className="text-sm text-slate">Para alterar a regra de um profissional, acesse <Link className="font-medium underline" to="/app/profissionais">Profissionais</Link>.</p>
    </div>
  )
}
