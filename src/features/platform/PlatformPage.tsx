import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/features/establishments/AccountProvider'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { BUSINESS_TYPES } from '@/lib/validation'

type Summary = {
  establishments: number
  registered_users: number
  active_team_members: number
  customers: number
  active_professionals: number
  appointments_30d: number
  active_contracts: number
  past_due_contracts: number
  canceled_contracts: number
  contracted_mrr_cents: number
}
type Establishment = {
  id: string
  name: string
  slug: string
  business_type: string
  created_at: string
  plan_name: string | null
  monthly_price_cents: number | null
  subscription_status: string | null
  current_period_end: string | null
  payment_due_at: string | null
  team_members: number
  professionals: number
  customers: number
  appointments_30d: number
}
type Overview = {
  updated_at: string
  summary: Summary
  establishments: Establishment[]
  listed_limit: number
}

const count = new Intl.NumberFormat('pt-BR')
const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const statusLabel: Record<string, string> = {
  trialing: 'Em avaliação', active: 'Ativa', past_due: 'Pagamento pendente',
  suspended: 'Suspensa', canceled: 'Cancelada',
}
const statusTone: Record<string, string> = {
  active: 'bg-ok-soft text-ok',
  trialing: 'bg-slate-100 text-slate-700',
  past_due: 'bg-amber-50 text-amber-800',
  suspended: 'bg-danger-soft text-danger',
  canceled: 'bg-slate-100 text-slate-600',
}
const formatDate = (value: string | null) => value ? date.format(new Date(value)) : 'Não informado'

function Kpi({ label, value, icon, hint }: {
  label: string; value: number; icon: IconName; hint?: string
}) {
  return <div className="rounded-xl border border-hairline bg-surface p-5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-medium text-slate">{label}</p>
      <Icon name={icon} className="size-4 text-slate" />
    </div>
    <p className="mt-3 font-display text-3xl font-semibold tracking-tight tabular-nums">{count.format(value)}</p>
    {hint && <p className="mt-2 text-xs text-slate">{hint}</p>}
  </div>
}

export default function PlatformPage() {
  const { memberships, selectEstablishment } = useAccount()
  const ownerMembership = memberships.find((m) => m.role === 'owner')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: apiError } = await supabase.rpc('platform_overview')
      if (apiError) throw apiError
      if (!data || typeof data !== 'object' || !('summary' in data) || !('establishments' in data) ||
          !Array.isArray((data as Overview).establishments)) throw new Error('Resposta de indicadores inválida.')
      setOverview(data as Overview)
    } catch (err) {
      setError(describeError(err, 'Não foi possível carregar os indicadores da plataforma.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (error && !overview) return <ErrorState title="Central indisponível" message={error} onRetry={() => void load()} />

  const s = overview?.summary

  return <div className="mx-auto w-full max-w-7xl space-y-7 px-5 py-8 sm:px-8 lg:py-12">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orbit">Visão da proprietária</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Central da plataforma</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate">
          Acompanhe o OrbitAgenda inteiro sem cadastrar empresas nem alterar contratos.
          Os números são consultados diretamente no banco de dados.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ownerMembership && (
          <Link to="/app" onClick={() => selectEstablishment(ownerMembership.establishment.id)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
            <Icon name="store" className="size-4" />
            Abrir minha barbearia
          </Link>
        )}
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" className="mr-2 inline-block size-4" />Atualizar
        </Button>
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
      {error} {overview && 'Exibindo os últimos dados carregados.'}
    </p>}

    {!overview ? <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-8 text-sm text-slate">
      <Spinner /> Consultando indicadores...
    </div> : <>
      <section aria-labelledby="volume-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="volume-title" className="font-display text-xl font-semibold">Operação em números</h2>
          <p className="text-xs text-slate">Atualizado em {date.format(new Date(overview.updated_at))}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Kpi label="Estabelecimentos cadastrados" value={s!.establishments} icon="store" />
          <Kpi label="Usuários com conta" value={s!.registered_users} icon="users" hint="Cadastros de acesso à plataforma" />
          <Kpi label="Profissionais ativos" value={s!.active_professionals} icon="user" />
          <Kpi label="Clientes cadastrados" value={s!.customers} icon="users" hint="Cadastros de clientes nos estabelecimentos" />
          <Kpi label="Agendamentos criados em 30 dias" value={s!.appointments_30d} icon="calendar" />
          <Kpi label="Membros de equipe ativos" value={s!.active_team_members} icon="user" hint="Pessoas com vínculo ativo; não soma vínculos repetidos" />
        </div>
      </section>

      <section aria-labelledby="revenue-title" className="space-y-3">
        <h2 id="revenue-title" className="font-display text-xl font-semibold">Planos e contratos</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl bg-ink p-6 text-white">
            <p className="text-sm text-white/65">Receita recorrente contratada (MRR)</p>
            <p className="mt-3 font-display text-4xl font-semibold tabular-nums">{formatBRL(s!.contracted_mrr_cents)}</p>
            <p className="mt-3 max-w-lg text-xs leading-relaxed text-white/65">
              Soma das mensalidades de contratos com situação ativa e preço definido.
              Não representa pagamentos recebidos no Asaas ou dinheiro em caixa.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-hairline bg-surface p-4 sm:gap-4 sm:p-6">
            {[
              { title: 'Ativos', value: s!.active_contracts },
              { title: 'Pendentes', value: s!.past_due_contracts },
              { title: 'Cancelados', value: s!.canceled_contracts },
            ].map(item => <div key={item.title} className="min-w-0 text-center">
              <p className="text-xs text-slate">{item.title}</p>
              <p className="mt-3 font-display text-2xl font-semibold tabular-nums sm:text-3xl">{count.format(item.value)}</p>
            </div>)}
          </div>
        </div>
      </section>

      <section aria-labelledby="companies-title" className="overflow-hidden rounded-xl border border-hairline bg-surface">
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-5 py-5">
          <div>
            <h2 id="companies-title" className="font-display text-xl font-semibold">Estabelecimentos</h2>
            <p className="mt-1 text-xs text-slate">
              {count.format(s!.establishments)} cadastrados
              {s!.establishments > overview.establishments.length
                ? ` · exibindo os ${overview.establishments.length} mais recentes`
                : ''}
            </p>
          </div>
          <span className="rounded-full border border-hairline px-3 py-1 text-xs font-medium text-slate">Somente consulta</span>
        </header>

        {overview.establishments.length === 0
          ? <div className="p-6"><EmptyState title="Nenhuma empresa cadastrada">Os cadastros aparecerão aqui quando houver estabelecimentos.</EmptyState></div>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-hairline bg-ink/[0.02] text-xs text-slate">
                <tr>
                  {['Estabelecimento','Equipe','Profissionais','Clientes','Agendamentos · 30 dias','Plano / mensalidade','Situação','Vencimento'].map(label =>
                    <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium first:pl-5 last:pr-5">{label}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {overview.establishments.map(est => <tr key={est.id} className="align-top">
                  <td className="max-w-56 px-4 py-4 first:pl-5">
                    <p className="font-medium">{est.name}</p>
                    <p className="mt-1 break-words text-xs text-slate">{BUSINESS_TYPES.find(b=>b.value===est.business_type)?.label ?? est.business_type} · {est.slug}</p>
                  </td>
                  <td className="px-4 py-4 tabular-nums">{count.format(est.team_members)}</td>
                  <td className="px-4 py-4 tabular-nums">{count.format(est.professionals)}</td>
                  <td className="px-4 py-4 tabular-nums">{count.format(est.customers)}</td>
                  <td className="px-4 py-4 tabular-nums">{count.format(est.appointments_30d)}</td>
                  <td className="px-4 py-4">
                    <p className="font-medium">{est.plan_name ?? 'Sem plano'}</p>
                    <p className="mt-1 whitespace-nowrap text-xs text-slate">{est.monthly_price_cents == null ? 'Valor não definido' : `${formatBRL(est.monthly_price_cents)}/mês`}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[est.subscription_status ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
                      {statusLabel[est.subscription_status ?? ''] ?? 'Sem contrato'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-slate last:pr-5">
                    {formatDate(est.payment_due_at ?? est.current_period_end)}
                    <p className="mt-1 text-[11px]">Prazo registrado</p>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>}
      </section>
      <p className="text-xs leading-relaxed text-slate">
        Indicadores administrativos para acompanhamento. Os valores de mensalidade são estimativas
        contratuais, não uma conciliação de recebimentos. Esta área não cria empresas, planos ou cobranças.
      </p>
    </>}
  </div>
}
