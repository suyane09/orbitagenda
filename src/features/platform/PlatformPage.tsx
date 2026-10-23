import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { TextField, SelectField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { parseBRL, formatBRL } from '@/lib/money'
import { supabase } from '@/lib/supabase'
import { BUSINESS_TYPES } from '@/lib/validation'

interface Row { id: string; name: string; slug: string; business_type: string; created_at: string }
interface Plan { id: string; name: string; code: string; monthly_price_cents: number | null; is_public: boolean }
interface Subscription { establishment_id: string; plan_id: string; status: string; current_period_end: string | null }
const options = [
  {value:'trialing',label:'Em avaliação'}, {value:'active',label:'Ativa'},
  {value:'past_due',label:'Pagamento pendente'}, {value:'suspended',label:'Suspensa'},
  {value:'canceled',label:'Cancelada'},
]
export default function PlatformPage() {
  const [rows,setRows]=useState<Row[]|null>(null)
  const [plans,setPlans]=useState<Plan[]>([])
  const [contracts,setContracts]=useState<Subscription[]>([])
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [planCode,setPlanCode]=useState('')
  const [planName,setPlanName]=useState('')
  const [planPrice,setPlanPrice]=useState('')
  const [selectedEst,setSelectedEst]=useState('')
  const [selectedPlan,setSelectedPlan]=useState('')
  const [selectedStatus,setSelectedStatus]=useState('trialing')
  const [notes,setNotes]=useState('')
  const load=useCallback(async()=>{
    setError('')
    try {
      const [est,p,s]=await Promise.all([
        supabase.from('establishments').select('id,name,slug,business_type,created_at')
          .order('created_at',{ascending:false}).limit(200),
        supabase.from('subscription_plans').select('id,name,code,monthly_price_cents,is_public')
          .order('created_at',{ascending:true}),
        supabase.from('establishment_subscriptions')
          .select('establishment_id,plan_id,status,current_period_end'),
      ])
      if(est.error)throw est.error
      if(p.error)throw p.error
      if(s.error)throw s.error
      setRows((est.data??[]) as Row[])
      setPlans((p.data??[]) as Plan[])
      setContracts((s.data??[]) as Subscription[])
    }catch(e){setError(describeError(e,'Não foi possível carregar os estabelecimentos.'))}
  },[])
  useEffect(()=>{void load()},[load])
  async function createPlan(e:FormEvent) {
    e.preventDefault()
    if(busy)return
    const cents=parseBRL(planPrice)
    if(!cents||cents<=0||!Number.isSafeInteger(cents))return setError('Informe um valor mensal válido.')
    setBusy(true);setError('');setNotice('')
    try{
      const {error:e}=await supabase.rpc('admin_create_subscription_plan',{
        p_code:planCode.trim().toLowerCase(),p_name:planName.trim(),
        p_monthly_price_cents:cents,p_is_public:false,
      })
      if(e)throw e
      setNotice('Plano administrativo criado. Nenhuma cobrança iniciada.')
      setPlanCode('');setPlanName('');setPlanPrice('')
      await load()
    }catch(e){setError(describeError(e,'Não foi possível criar o plano.'))}
    finally{setBusy(false)}
  }
  async function assign(e:FormEvent) {
    e.preventDefault()
    if(busy||!selectedEst||!selectedPlan)return
    setBusy(true);setError('');setNotice('')
    try {
      const {error:e}=await supabase.rpc('admin_set_establishment_subscription',{
        p_establishment_id:selectedEst,p_plan_id:selectedPlan,
        p_status:selectedStatus,p_period_end:null,p_notes:notes.trim(),
      })
      if(e)throw e
      setNotice('Registro de assinatura atualizado. Esta ação não cobra nem bloqueia clientes.')
      await load()
    }catch(e){setError(describeError(e,'Não foi possível atualizar a assinatura.'))}
    finally{setBusy(false)}
  }
  if(error && !rows)return <ErrorState title="Plataforma indisponível" message={error} onRetry={()=>void load()}/>
  return <div className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8 sm:px-8 lg:py-12">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-slate">Administração</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Central da plataforma</h1>
      <p className="mt-2 text-sm text-slate">Empresas, planos e contratos. Somente o administrador da plataforma pode registrar alterações.</p></header>
    {error&&<p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>}
    {notice&&<p role="status" className="rounded-xl bg-ok-soft p-4 text-sm text-ok">{notice}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-hairline bg-surface p-5">
        <h2 className="font-display text-xl font-semibold">Novo plano comercial</h2>
        <p className="mt-1 text-xs text-slate">Defina seus próprios valores. Os planos permanecem internos até a configuração do checkout.</p>
        <form onSubmit={e=>void createPlan(e)} className="mt-5 space-y-4">
          <TextField label="Identificador" value={planCode} required onChange={e=>setPlanCode(e.target.value)} placeholder="ex.: profissional" />
          <TextField label="Nome do plano" value={planName} required onChange={e=>setPlanName(e.target.value)} placeholder="ex.: Profissional" />
          <TextField label="Valor mensal (R$)" value={planPrice} required onChange={e=>setPlanPrice(e.target.value)} placeholder="0,00" inputMode="decimal" />
          <Button type="submit" loading={busy}>Cadastrar plano</Button>
        </form>
        <div className="mt-5 divide-y divide-hairline">
          {plans.map(p=><div key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span>{p.name} <span className="text-xs text-slate">({p.code})</span></span>
            <strong className="tabular-nums">{p.monthly_price_cents==null?'Valor não definido':formatBRL(p.monthly_price_cents)}</strong>
          </div>)}
        </div>
      </section>
      <section className="rounded-xl border border-hairline bg-surface p-5">
        <h2 className="font-display text-xl font-semibold">Registrar situação contratual</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate">Controle administrativo sem movimentação de dinheiro. Não substitui cobrança recorrente pelo provedor de pagamentos.</p>
        <form onSubmit={e=>void assign(e)} className="mt-5 space-y-4">
          <SelectField label="Estabelecimento" value={selectedEst} onChange={e=>setSelectedEst(e.target.value)} options={[{value:'',label:'Selecionar empresa'},...(rows??[]).map(x=>({value:x.id,label:x.name}))]}/>
          <SelectField label="Plano" value={selectedPlan} onChange={e=>setSelectedPlan(e.target.value)} options={[{value:'',label:'Selecionar plano'},...plans.map(x=>({value:x.id,label:x.name}))]}/>
          <SelectField label="Situação" value={selectedStatus} onChange={e=>setSelectedStatus(e.target.value)} options={options}/>
          <TextField label="Observação (opcional)" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={500}/>
          <Button type="submit" disabled={!selectedEst||!selectedPlan||busy} loading={busy}>Salvar situação</Button>
        </form>
      </section>
    </div>
    <section className="rounded-xl border border-hairline bg-surface">
      <header className="border-b border-hairline p-5"><h2 className="font-display text-xl font-semibold">Estabelecimentos</h2>
        <p className="mt-1 text-xs text-slate">{rows?.length??0} empresas listadas</p></header>
      {!rows?<div className="flex items-center gap-3 p-8 text-slate"><Spinner/>Carregando…</div>:
        rows.length===0?<div className="p-6"><EmptyState title="Nenhum estabelecimento ainda">Os cadastros aparecerão aqui.</EmptyState></div>:
        <ul className="divide-y divide-hairline">{rows.map(r=>{
          const subscription=contracts.find(s=>s.establishment_id===r.id)
          const plan=plans.find(p=>p.id===subscription?.plan_id)
          return <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div><p className="font-medium">{r.name}</p><p className="mt-1 text-xs text-slate">{r.slug} · {BUSINESS_TYPES.find(x=>x.value===r.business_type)?.label}</p></div>
            <div className="text-right"><p className="text-sm font-medium">{plan?.name??'Sem plano'}</p>
              <p className="text-xs text-slate">{options.find(x=>x.value===subscription?.status)?.label??'Não atribuído'}</p></div>
          </li>
        })}</ul>}
    </section>
  </div>
}
