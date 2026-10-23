import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import { todayInZone } from '@/lib/schedule'
import { setAppointmentStatus, type AppointmentRow } from './api'
import { createEntry, listAppointmentEntries, type Entry, type PaymentMethod } from '@/features/finance/api'

const fmtInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/** Saldo pendente = valor do serviço − (recebimentos − estornos) já lançados para o atendimento. */
function balanceLeft(entries: Entry[], appointmentId: string, price: number) {
  const balance = entries.filter((e) => e.appointment_id === appointmentId)
    .reduce((sum, e) => sum + (e.kind === 'income' ? e.amount_cents : e.kind === 'refund' ? -e.amount_cents : 0), 0)
  return Math.max(0, price - balance)
}

// ---- Conclusão e pagamento (lançamentos financeiros são independentes do status) ----
// receiveOnly: atendimento já concluído; o modal apenas recebe o saldo restante (sem mexer no status).
export function CompletePaymentModal({ a, estId, tz, receiveOnly = false, onClose, onCompleted }: {
  a: Pick<AppointmentRow, 'id' | 'price_cents' | 'service_name' | 'customer_name'>; estId: string; tz: string
  receiveOnly?: boolean; onClose: () => void; onCompleted: (paid: boolean) => void
}) {
  const [paid, setPaid] = useState<'no' | 'yes'>('yes')
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [amount, setAmount] = useState(fmtInput(a.price_cents))
  const [remaining, setRemaining] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(receiveOnly)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    listAppointmentEntries(estId, a.id)
      .then((entries) => {
        if (!active) return
        const left = balanceLeft(entries, a.id, a.price_cents)
        setRemaining(left); setAmount(fmtInput(left))
      }).catch(() => { if (active) setError('Não foi possível verificar pagamentos anteriores. Não registre outro pagamento até conferir o Financeiro.') })
    return () => { active = false }
  }, [a.id, a.price_cents, estId])
  async function submit() {
    if (remaining === null || lock.current) return
    const cents = Math.round(Number(amount.replace(/\s/g, '').replace(',', '.')) * 100)
    if (paid === 'yes' && remaining > 0 && (!Number.isSafeInteger(cents) || cents <= 0 || cents > remaining)) {
      setError('Informe um valor maior que zero e não superior ao saldo pendente.'); return
    }
    lock.current = true; setBusy(true); setError(null)
    try {
      if (paid === 'yes' && remaining > 0) {
        // Reconfere o saldo imediatamente antes de lançar: evita duplicar caso outro lançamento tenha entrado (ou a tentativa anterior tenha gravado).
        let left: number
        try { left = balanceLeft(await listAppointmentEntries(estId, a.id), a.id, a.price_cents) }
        catch { setError('Não foi possível confirmar o saldo atual. Nenhum pagamento foi registrado agora; tente novamente.'); return }
        if (left !== remaining) {
          setRemaining(left); setAmount(fmtInput(left))
          setError(left === 0 ? 'O pagamento integral já consta no Financeiro. Nenhum novo lançamento foi criado.' : 'O saldo pendente mudou (há outro pagamento registrado). Confira o valor e tente novamente.')
          return
        }
      }
      if (!completed) { await setAppointmentStatus(estId, a.id, 'completed'); setCompleted(true) }
      if (paid === 'yes' && remaining > 0) {
        try {
          await createEntry(estId, { kind: 'income', description: `${a.service_name} — ${a.customer_name}`.slice(0, 180), amount_cents: cents, method, occurred_on: todayInZone(new Date(), tz), appointment_id: a.id })
        } catch (e) {
          setError(receiveOnly
            ? `O pagamento NÃO foi registrado: ${describeError(e)}. Tente novamente; o saldo é conferido antes de lançar.`
            : `Atendimento concluído, mas o pagamento NÃO foi registrado: ${describeError(e)}. Tente novamente aqui ou registre pelo Financeiro, verificando antes se já existe.`)
          return
        }
      }
      onCompleted(paid === 'yes' && remaining > 0)
    } catch (e) { setError(describeError(e, 'Não foi possível concluir o atendimento.')) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Modal title={receiveOnly ? 'Receber pagamento' : 'Concluir atendimento'} onClose={onClose} busy={busy} footer={<>
    <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
    <Button variant="accent" onClick={() => void submit()} loading={busy} disabled={remaining === null || (completed && paid === 'no') || (receiveOnly && remaining === 0)}>{receiveOnly ? 'Registrar pagamento' : completed ? 'Tentar registrar pagamento' : 'Concluir atendimento'}</Button>
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
      {remaining === 0 && <p className="text-ok">{receiveOnly ? 'Pagamento integral já registrado. Não há saldo a receber.' : 'Pagamento integral já registrado. Conclua sem novo lançamento.'}</p>}
      <p className="text-xs text-slate">{receiveOnly
        ? 'O atendimento já está concluído. O valor informado é somado aos pagamentos anteriores; pagamentos parciais podem ser completados depois.'
        : 'A conclusão não cria receita automaticamente. Se o pagamento falhar, o atendimento continuará concluído e você verá o aviso para regularizar.'}</p>
    </div>
  </Modal>
}