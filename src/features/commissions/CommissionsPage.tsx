import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/features/establishments/AccountProvider'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatBRL } from '@/lib/money'
import { describeError } from '@/lib/errors'
import { loadCommissionBalances, loadProfessionalNames, type CommissionBalance } from './balances'

export default function CommissionsPage() {
  const { current } = useAccount()
  const establishmentId = current?.establishment.id ?? ''
  const isOwner = current?.role === 'owner'
  const [items, setItems] = useState<CommissionBalance[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    if (!isOwner || !establishmentId) return
    setLoading(true)
    setError('')
    try {
      const [balances, professionals] = await Promise.all([
        loadCommissionBalances(establishmentId),
        loadProfessionalNames(establishmentId),
      ])
      setItems(balances)
      setNames(professionals)
    } catch (err) {
      setError(describeError(err, 'Não foi possível carregar as comissões.'))
    } finally { setLoading(false) }
  }, [establishmentId, isOwner])
  useEffect(() => { setItems([]); setNames(new Map()); void refresh() }, [refresh])
  const totals = useMemo(() => {
    const byProfessional = new Map<string, { count: number; paid: number; accrued: number }>()
    for (const row of items) {
      const current = byProfessional.get(row.professional_id) ?? { count: 0, paid: 0, accrued: 0 }
      current.count += 1
      current.paid += Number(row.net_received_cents)
      current.accrued += Number(row.accrued_cents)
      byProfessional.set(row.professional_id, current)
    }
    return [...byProfessional.entries()].sort((a,b) =>
      (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? '', 'pt-BR'))
  }, [items, names])

  if (!isOwner) return <ErrorState title="Acesso restrito" message="Somente o proprietário pode visualizar comissões." />
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-2xl font-semibold text-ink">Comissões</h1>
          <p className="mt-1 text-sm text-slate">Demonstrativo de comissões calculadas sobre valores recebidos.</p></div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>Atualizar</Button>
      </div>
      <Alert tone="info">Esta tela é somente de consulta. Ainda não registra repasses aos profissionais.
        Atendimentos concluídos antes da ativação do módulo não entram neste demonstrativo.</Alert>
      {error && <Alert>{error} Confira se a migração de comissões 2C está instalada e se sua conta possui permissão de proprietário.</Alert>}
      {loading ? <p className="text-sm text-slate">Carregando comissões…</p> : !error && totals.length === 0 ?
        <EmptyState title="Nenhuma comissão calculada">Conclua um novo atendimento e registre o recebimento para visualizar os valores.</EmptyState>
        : !error && <>
          <div className="rounded-xl border border-hairline bg-surface p-5">
            <p className="text-sm text-slate">Comissões geradas sobre recebimentos (sem repasses)</p>
            <p className="mt-2 font-display text-3xl font-semibold">{formatBRL(items.reduce((sum, r) => sum + Number(r.accrued_cents), 0))}</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-hairline text-slate"><tr>
                <th className="px-4 py-3 font-medium">Profissional</th>
                <th className="px-4 py-3 font-medium">Atendimentos</th>
                <th className="px-4 py-3 font-medium">Recebido</th>
                <th className="px-4 py-3 font-medium">Comissão gerada</th>
              </tr></thead>
              <tbody>{totals.map(([id, t]) => <tr key={id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3 font-medium">{names.get(id) ?? 'Profissional removido'}</td>
                <td className="px-4 py-3">{t.count}</td>
                <td className="px-4 py-3">{formatBRL(t.paid)}</td>
                <td className="px-4 py-3 font-semibold">{formatBRL(t.accrued)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>}
      <p className="text-sm text-slate">Para alterar a regra de um profissional, acesse <Link className="font-medium underline" to="/app/profissionais">Profissionais</Link>.</p>
    </div>
  )
}
