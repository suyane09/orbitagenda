import { useEffect, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import { todayInZone } from '@/lib/schedule'
import { setAppointmentStatus, type AppointmentRow } from './api'
import { createEntry, listAppointmentEntries, type PaymentMethod } from '@/features/finance/api'

// ---- Conclusão e pagamento (lançamentos financeiros são independentes do status) ----
export function CompletePaymentModal({ a, estId, tz, onClose, onCompleted }: {
  a: AppointmentRow; estId: string; tz: string; onClose: () => void; onCompleted: (paid: boolean) => void
}) {
  const [paid, setPaid] = useState<'no' | 'yes'>('yes')
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [amount, setAmount] = useState((a.price_cents / 100).toFixed(2).replace('.', ','))
  const [remaining, setRemaining] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    listAppointmentEntries(estId, a.id)
      .then((entries) => {
        if (!active) return
        const balance = entries.filter((e) => e.appointment_id === a.id)
          .reduce((sum, e) => sum + (e.kind === 'income' ? e.amount_cents : e.kind === 'refund' ? -e.amount_cents : 0), 0)
        const left = Math.max(0, a.price_cents - balance)
        setRemaining(left); setAmount((left / 100).toFixed(2).replace('.', ','))
      }).catch(() => { if (active) setError('Não foi possível verificar pagamentos anteriores. Não registre outro pagamento até conferir o Financeiro.') })
    return () => { active = false }
  }, [a.id, a.price_cents, estId])
  async function submit() {
    if (remaining === null) return
    const cents = Math.round(Number(amount.replace(/\s/g, '').replace(',', '.')) * 100)
    if (paid === 'yes' && remaining > 0 && (!Number.isSafeInteger(cents) || cents <= 0 || cents > remaining)) {
      setError('Informe um valor maior que zero e não superior ao saldo pendente.'); return
    }
    setBusy(true); setError(null)
    try {
      if (!completed) { await setAppointmentStatus(estId, a.id, 'completed'); setCompleted(true) }
      if (paid === 'yes' && remaining > 0) {
        try {
          await createEntry(estId, { kind: 'income', description: `${a.service_name} — ${a.customer_name}`.slice(0, 180), amount_cents: cents, method, occurred_on: todayInZone(new Date(), tz), appointment_id: a.id })
        } catch (e) {
          setError(`Atendimento concluído, mas o pagamento NÃO foi registrado: ${describeError(e)}. Tente novamente aqui ou registre pelo Financeiro, verificando antes se já existe.`)
          return
        }
      }
      onCompleted(paid === 'yes' && remaining > 0)
    } catch (e) { setError(describeError(e, 'Não foi possível concluir o atendimento.')) }
    finally { setBusy(false) }
  }
  return <Modal title="Concluir atendimento" onClose={onClose} busy={busy} footer={<>
    <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
    <Button variant="accent" onClick={() => void submit()} loading={busy} disabled={remaining === null || (completed && paid === 'no')}>{completed ? 'Tentar registrar pagamento' : 'Concluir atendimento'}</Button>
  </>}>
    <div className="space-y-4 text-sm">
      <p className="font-medium">{a.customer_name} · {a.service_name}</p>
      <p>Valor do serviço: <strong>{formatBRL(a.price_cents)}</strong></p>
      <p>Saldo ainda não recebido: <strong>{remaining === null ? 'Verificando…' : formatBRL(remaining)}</strong></p>
      {error && <Alert>{error}</Alert>}
      {!completed && <SelectField label="Pagamento" value={paid} onChange={(e) => setPaid(e.target.value as 'yes' | 'no')}
        options={[{value:'yes',label:'Registrar pagamento agora'},{value:'no',label:'Concluir sem receber (pendente)'}]} />}
      {(paid === 'yes' || completed) && remaining !== null && remaining > 0 && <>
        <TextField label="Valor recebido (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <SelectField label="Forma de pagamento" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          options={[{value:'pix',label:'Pix'},{value:'cash',label:'Dinheiro'},{value:'card',label:'Cartão'},{value:'other',label:'Outro'}]} />
      </>}
      {remaining === 0 && <p className="text-ok">Pagamento integral já registrado. Conclua sem novo lançamento.</p>}
      <p className="text-xs text-slate">A conclusão não cria receita automaticamente. Se o pagamento falhar, o atendimento continuará concluído e você verá o aviso para regularizar.</p>
    </div>
  </Modal>
}

