import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { formatBRL } from '@/lib/money'
import { describeError } from '@/lib/errors'
import { listDayEntries, type Entry, type PaymentMethod } from './api'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const methods: { key: PaymentMethod; label: string }[] = [
  { key: 'pix', label: 'Pix' }, { key: 'cash', label: 'Dinheiro' },
  { key: 'card', label: 'Cartão' }, { key: 'other', label: 'Outros' },
]
const sum = (entries: Entry[], kind: Entry['kind']) => entries.filter(e => e.kind === kind).reduce((n, e) => n + e.amount_cents, 0)
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function CashClosingPanel({ establishmentId }: { establishmentId: string }) {
  const [date, setDate] = useState(today)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    if (!establishmentId) return
    setLoading(true)
    setError('')
    setUpdatedAt(null)
    try {
      const result = await listDayEntries(establishmentId, date)
      setEntries(result)
      setUpdatedAt(new Date())
    } catch (err) {
      setEntries([])
      setError(describeError(err, 'Não foi possível calcular o fechamento.'))
    } finally { setLoading(false) }
  }, [establishmentId, date])

  useEffect(() => { void refresh() }, [refresh])
  const totals = useMemo(() => {
    const income = sum(entries, 'income')
    const expense = sum(entries, 'expense')
    const refund = sum(entries, 'refund')
    return { income, expense, refund, net: income - expense - refund }
  }, [entries])
  const byMethod = useMemo(() => methods.map(({ key, label }) => {
    const subset = entries.filter(e => e.method === key)
    return { key, label, income: sum(subset, 'income'), expense: sum(subset, 'expense'), refund: sum(subset, 'refund') }
  }), [entries])

  function exportCsv() {
    if (!updatedAt || loading || error) return
    const header = ['Data do fechamento', 'Método', 'Recebimentos (R$)', 'Despesas (R$)', 'Estornos (R$)', 'Saldo (R$)']
    const lines = [header, ...byMethod.map(m => [date, m.label, (m.income / 100).toFixed(2), (m.expense / 100).toFixed(2), (m.refund / 100).toFixed(2), ((m.income - m.expense - m.refund) / 100).toFixed(2)]),
      [date, 'TOTAL', (totals.income / 100).toFixed(2), (totals.expense / 100).toFixed(2), (totals.refund / 100).toFixed(2), (totals.net / 100).toFixed(2)]]
    const content = '\uFEFF' + lines.map(line => line.map(csvCell).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `orbit-agenda-resumo-caixa-${date}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return <section className="rounded-xl border border-hairline bg-surface p-4 shadow-[0_1px_2px_rgb(17_20_26/0.04)] sm:p-5" aria-label="Resumo diário de caixa">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">Resumo diário de caixa</h2>
        <p className="mt-1 text-xs text-slate">Pré-fechamento: visão dos lançamentos registrados na data, sem bloquear ou encerrar o caixa.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[150px]"><TextField label="Dia" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <Button type="button" variant="outline" disabled={loading} onClick={() => void refresh()}>Atualizar</Button>
        <Button type="button" variant="outline" disabled={!updatedAt || loading || !!error} onClick={exportCsv}>Exportar CSV</Button>
      </div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-control border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate">Calculando resumo…</p> : updatedAt && !error && <>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Recebido', totals.income], ['Despesas', totals.expense], ['Estornos', totals.refund], ['Saldo líquido', totals.net]] as const).map(([label, value]) =>
          <div key={label} className="min-w-0 rounded-lg border border-hairline p-3">
            <p className="text-xs text-slate">{label}</p>
            <p className="mt-2 break-words font-display text-lg font-semibold tabular-nums sm:text-xl">{formatBRL(value)}</p>
          </div>)}
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead><tr className="border-b border-hairline text-xs text-slate"><th className="py-3 pr-3 font-medium">Forma</th><th className="px-3 py-3 text-right font-medium">Recebido</th><th className="px-3 py-3 text-right font-medium">Despesas</th><th className="px-3 py-3 text-right font-medium">Estornos</th><th className="pl-3 py-3 text-right font-medium">Saldo</th></tr></thead>
          <tbody>{byMethod.map(m => <tr key={m.key} className="border-b border-hairline/70">
            <td className="py-3 pr-3 font-medium">{m.label}</td><td className="px-3 py-3 text-right tabular-nums">{formatBRL(m.income)}</td><td className="px-3 py-3 text-right tabular-nums">{formatBRL(m.expense)}</td><td className="px-3 py-3 text-right tabular-nums">{formatBRL(m.refund)}</td><td className="pl-3 py-3 text-right font-semibold tabular-nums">{formatBRL(m.income - m.expense - m.refund)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate">{entries.length} lançamento(s) no dia · Atualizado às {updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Valores por data de lançamento, não por data do atendimento. Não inclui dinheiro inicial do caixa nem valores ainda a receber.</p>
    </>}
  </section>
}
