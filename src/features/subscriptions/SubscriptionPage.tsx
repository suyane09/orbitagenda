import { useCallback, useEffect, useState } from 'react'
import { useAccount } from '@/features/establishments/AccountProvider'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'

type Subscription = {
  status: string; started_at: string; current_period_end: string | null;
  plan_id: string; notes: string
}
type Plan = { id: string; name: string; monthly_price_cents: number | null }

const names: Record<string,string> = {
  trialing:'Em avaliação',active:'Ativa',past_due:'Pagamento pendente',
  suspended:'Suspensa',canceled:'Cancelada',
}
export default function SubscriptionPage() {
  const {current} = useAccount()
  const owner = current?.role === 'owner'
  const id = current?.establishment.id ?? ''
  const [sub,setSub] = useState<Subscription | null>(null)
  const [plan,setPlan] = useState<Plan | null>(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const load = useCallback(async()=>{
    if(!owner||!id) {setLoading(false);return}
    setLoading(true);setError('')
    try {
      const s=await supabase.from('establishment_subscriptions')
        .select('status,started_at,current_period_end,plan_id,notes')
        .eq('establishment_id',id).maybeSingle()
      if(s.error)throw s.error
      setSub(s.data as Subscription|null)
      if(s.data?.plan_id) {
        const p=await supabase.from('subscription_plans').select('id,name,monthly_price_cents')
          .eq('id',s.data.plan_id).maybeSingle()
        if(p.error)throw p.error
        setPlan(p.data as Plan|null)
      } else setPlan(null)
    }catch(e){setError(describeError(e,'Não foi possível carregar seu contrato.'))}
    finally{setLoading(false)}
  },[id,owner])
  useEffect(()=>{void load()},[load])
  if(!owner)return <p className="text-sm text-slate">Área disponível apenas para o proprietário.</p>
  return <div className="mx-auto max-w-4xl space-y-5 pb-12">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-slate">Minha conta</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Plano e assinatura</h1>
      <p className="mt-2 text-sm text-slate">Acompanhe a situação contratual do seu estabelecimento.</p>
    </header>
    {error&&<p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>}
    <section className="rounded-xl border border-hairline bg-surface p-6">
      {loading?<p className="text-sm text-slate">Carregando informações…</p>:
      !sub?<div><h2 className="font-display text-xl font-semibold">Acesso ainda não vinculado a um plano</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate">Seu cadastro existe, mas ainda não há uma assinatura comercial atribuída. Entre em contato com a administração para definir um plano. Nenhuma cobrança foi gerada automaticamente.</p></div>:
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm text-slate">Plano atual</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{plan?.name ?? 'Plano cadastrado'}</h2></div>
          <span className="rounded-full bg-paper px-4 py-2 text-sm font-semibold">{names[sub.status]??sub.status}</span>
        </div>
        <div className="grid gap-4 border-t border-hairline pt-5 sm:grid-cols-2">
          <div><p className="text-xs text-slate">Valor de referência mensal</p>
            <p className="mt-1 font-display text-xl font-semibold">{plan?.monthly_price_cents==null?'A definir':formatBRL(plan.monthly_price_cents)}</p></div>
          <div><p className="text-xs text-slate">Fim do período registrado</p>
            <p className="mt-1 font-display text-xl font-semibold">{sub.current_period_end
              ? new Date(sub.current_period_end).toLocaleDateString('pt-BR')
              : 'Não informado'}</p></div>
        </div>
        {sub.notes&&<p className="rounded-lg bg-paper p-3 text-sm text-slate">{sub.notes}</p>}
        <p className="text-xs leading-relaxed text-slate">Este painel apresenta informações administrativas. O Orbit Agenda não cobra automaticamente, não processa Pix e não bloqueia sua empresa com base nesses registros. Uma integração de pagamentos precisa ser ativada separadamente.</p>
      </div>}
    </section>
  </div>
}
