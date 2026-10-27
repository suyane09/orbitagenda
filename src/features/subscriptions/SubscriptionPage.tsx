import { useCallback, useEffect, useState } from 'react'
import { useAccount } from '@/features/establishments/AccountProvider'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import { AsaasBillingPanel } from './AsaasBillingPanel'

type Subscription = {
  status: string; started_at: string; current_period_end: string | null; payment_due_at: string | null;
  plan_id: string; notes: string; asaas_subscription_id: string | null; asaas_provisioning_started_at: string | null; asaas_environment: string | null
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
  const [refreshing,setRefreshing] = useState(false)
  const [checkingSandbox,setCheckingSandbox] = useState(false)
  const [sandboxNotice,setSandboxNotice] = useState('')
  const [sandboxError,setSandboxError] = useState('')
  const load = useCallback(async()=>{
    if(!owner||!id) {setLoading(false);return}
    setLoading(true);setError('')
    try {
      const s=await supabase.from('establishment_subscriptions')
        .select('status,started_at,current_period_end,payment_due_at,plan_id,notes,asaas_subscription_id,asaas_provisioning_started_at,asaas_environment')
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
  async function checkSandboxPayment() {
    if(!owner || !id || !sub?.asaas_subscription_id || sub.asaas_environment !== 'sandbox'
      || sub.status !== 'past_due' || checkingSandbox) return
    setSandboxNotice('');setSandboxError('');setCheckingSandbox(true)
    try {
      const {data,error:invokeError}=await supabase.functions.invoke('asaas-sandbox-sync',{
        body:{establishmentId:id},
      })
      if(invokeError) {
        const response=(invokeError as {context?:Response}).context
        const result=response && typeof response.json==='function'
          ? await response.json().catch(()=>null) : null
        throw new Error(typeof result?.message==='string'
          ? result.message : 'Não foi possível consultar o Asaas Sandbox.')
      }
      if(!data || typeof data.message!=='string')throw Error('Resposta inválida do servidor.')
      setSandboxNotice(data.message)
      await load()
    } catch(err) {
      setSandboxError(err instanceof Error?err.message:'Não foi possível consultar o Asaas Sandbox.')
    } finally {setCheckingSandbox(false)}
  }
  if(!owner)return <p className="text-sm text-slate">Área disponível apenas para o proprietário.</p>
  const awaitingFirstPayment = sub?.status === 'past_due' && !sub?.asaas_subscription_id
  const statusTone = sub?.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : sub?.status === 'trialing' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-paper text-slate border-hairline'
  return <div className="w-full min-w-0 space-y-3 px-4 py-6 sm:space-y-5 sm:px-6 lg:px-8 lg:py-8">
    <header className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end sm:gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-slate">Financeiro · Assinatura</p>
        <h1 className="mt-1 font-display text-xl font-semibold tracking-tight sm:text-2xl">Plano e assinatura</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate">Acompanhe seu plano, pagamentos e vencimentos.</p>
      </div>
      <button type="button" disabled={loading||refreshing} onClick={async()=>{setRefreshing(true);try{await load()}finally{setRefreshing(false)}}} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm font-medium transition hover:bg-paper disabled:opacity-50">↻ Atualizar dados</button>
    </header>
    {error&&<p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>}
    {loading?<section className="rounded-2xl border border-hairline bg-surface p-8 text-sm text-slate" role="status">Carregando seu plano…</section>:
    !sub?<section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-6">
      <span className="rounded-full bg-paper px-3 py-1 text-xs font-semibold text-slate">Aguardando atribuição</span>
      <h2 className="mt-5 font-display text-2xl font-semibold">Seu plano ainda não foi atribuído</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate">Seu estabelecimento já está cadastrado. A administração precisa atribuir um plano antes da contratação. Nenhuma cobrança é criada automaticamente.</p>
    </section>:
    <>
      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-hairline p-4 sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-slate">Seu plano atual</p>
            <h2 className="mt-1 font-display text-xl font-semibold sm:text-2xl">{plan?.name ?? 'Plano cadastrado'}</h2>
            
          </div>
          <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone}`}>{awaitingFirstPayment ? 'Aguardando contratação' : (names[sub.status]??sub.status)}</span>
        </div>
        <div className="grid gap-0 sm:grid-cols-2">
          <div className="border-b border-hairline p-4 sm:border-b-0 sm:border-r sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate">Mensalidade</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{plan?.monthly_price_cents==null?'A definir':formatBRL(plan.monthly_price_cents)}</span>
              {plan?.monthly_price_cents!=null&&<span className="text-sm text-slate">/ mês</span>}
            </div>
            <p className="mt-1 text-xs text-slate">Valor definido pelo plano contratado.</p>
          </div>
          <div className="p-4 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate">{awaitingFirstPayment ? 'Primeira mensalidade' : 'Próximo vencimento pendente'}</p>
            <p className="mt-1 font-display text-lg font-semibold sm:text-xl">{awaitingFirstPayment ? 'Nenhuma cobrança emitida' : sub.payment_due_at ? new Date(sub.payment_due_at).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'}) : 'Sem cobrança em atraso'}</p>
            <p className="mt-2 text-xs text-slate">{awaitingFirstPayment ? 'O acesso será liberado após a confirmação do primeiro pagamento.' : 'Se houver atraso, o acesso às operações é suspenso após cinco dias. A confirmação do pagamento pode levar alguns instantes.'}</p>
          </div>
        </div>
        {sub.notes&&!sub.asaas_subscription_id&&<p className="mx-6 mb-6 rounded-xl bg-paper px-4 py-3 text-sm leading-relaxed text-slate sm:mx-8">{sub.notes}</p>}
      </section>
      {sub.asaas_environment==='sandbox' && !!sub.asaas_subscription_id && sub.status==='past_due' && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
          <h3 className="font-display text-lg font-semibold">Pagamento confirmado no Sandbox, mas ainda pendente aqui?</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate">
            Consulte a cobrança existente diretamente no Asaas. Só será registrada se o provedor
            confirmar pagamento, assinatura, proprietário e valor. Nenhuma cobrança nova será criada.
          </p>
          <button type="button" disabled={checkingSandbox}
            onClick={()=>void checkSandboxPayment()}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-50">
            {checkingSandbox?'Verificando pagamento…':'Conferir pagamento no Asaas Sandbox'}
          </button>
          {sandboxNotice && <p role="status" className="mt-3 text-sm text-emerald-700">{sandboxNotice}</p>}
          {sandboxError && <p role="alert" className="mt-3 text-sm text-red-700">{sandboxError}</p>}
        </section>
      )}
      <div className="grid gap-3 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,.65fr)]">
        {plan?.monthly_price_cents != null && plan.monthly_price_cents > 0
          ? <AsaasBillingPanel establishmentId={id} planPrice={plan.monthly_price_cents} linked={!!sub.asaas_subscription_id} provisioning={!!sub.asaas_provisioning_started_at} onFinished={load}/>
          : <section className="rounded-2xl border border-hairline bg-surface p-6"><h3 className="font-display text-lg font-semibold">Contratação indisponível</h3><p className="mt-2 text-sm leading-relaxed text-slate">A administração ainda precisa definir o valor mensal deste plano.</p></section>}
        <aside className="h-fit rounded-2xl border border-hairline bg-surface p-6">
          <h3 className="font-display text-lg font-semibold">Como funciona</h3>
          <ol className="mt-4 space-y-4 text-sm leading-relaxed text-slate">
            <li><span className="mr-2 font-semibold text-foreground">01.</span> Confira o valor do seu plano.</li>
            <li><span className="mr-2 font-semibold text-foreground">02.</span> Autorize a assinatura quando a contratação estiver disponível.</li>
            <li><span className="mr-2 font-semibold text-foreground">03.</span> Acompanhe a confirmação do pagamento nesta página.</li>
          </ol>
          <p className="mt-5 border-t border-hairline pt-4 text-xs leading-relaxed text-slate">A mensalidade é recorrente. O prazo de tolerância previsto é de cinco dias após o vencimento; a suspensão automática depende da sincronização do vencimento e da proteção no servidor. Em caso de divergência, procure o suporte.</p>
        </aside>
      </div>
    </>}
  </div>
}
