import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { verifyPaidSandboxCharge } from './verify.ts'

// On-demand recovery for Sandbox only. NEVER creates Asaas customers,
// subscriptions, invoices, charges, or refunds. Never reads the API key from a user.
const env = Deno.env.get('ASAAS_ENVIRONMENT') ?? ''
const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
const url = Deno.env.get('SUPABASE_URL') ?? ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const allowedOrigins = new Set([
  'https://orbitagenda.vercel.app',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])
const uuid = (v:unknown):v is string =>
  typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const providerId = (v:unknown,prefix:string):v is string =>
  typeof v==='string' && new RegExp('^'+prefix+'_[a-zA-Z0-9]+$').test(v)

Deno.serve(async (req) => {
  const origin=req.headers.get('origin')||''
  const cors={
    'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://orbitagenda.vercel.app',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin',
    'Cache-Control':'no-store',
    'Content-Type':'application/json; charset=utf-8',
  }
  const respond=(status:number,body:Record<string,unknown>)=>
    new Response(JSON.stringify(body),{status,headers:cors})
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
  if(req.method!=='POST')return respond(405,{message:'method_not_allowed'})
  if(origin && !allowedOrigins.has(origin))return respond(403,{message:'origin_not_allowed'})
  if(env!=='sandbox' || !apiKey || !url || !serviceKey)
    return respond(503,{message:'Sandbox ainda não configurado no servidor.'})
  if(Number(req.headers.get('content-length')||0)>1500) return respond(413,{message:'payload_too_large'})
  const bearer=req.headers.get('authorization')||''
  if(!/^Bearer [a-zA-Z0-9_.-]+$/.test(bearer))
    return respond(401,{message:'Faça login novamente.'})
  const jwt=bearer.slice(7)
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:auth,error:authError}=await admin.auth.getUser(jwt)
  if(authError || !auth.user?.id) return respond(401,{message:'Sessão inválida.'})

  let body:unknown
  try{
    const raw=await req.text()
    if(raw.length>1500)return respond(413,{message:'payload_too_large'})
    body=JSON.parse(raw)
  }catch{return respond(400,{message:'invalid_json'})}
  if(!body || typeof body!=='object'||Array.isArray(body))
    return respond(400,{message:'invalid_input'})
  const establishmentId=(body as Record<string,unknown>).establishmentId
  if(!uuid(establishmentId))return respond(400,{message:'invalid_establishment'})
  // A valid JWT alone never authorizes reconciliation for an unrelated company.
  const {data:owner,error:ownerError}=await admin.from('memberships')
    .select('id').eq('user_id',auth.user.id).eq('establishment_id',establishmentId)
    .eq('role','owner').eq('is_active',true).maybeSingle()
  if(ownerError)return respond(503,{message:'Não foi possível verificar o proprietário.'})
  if(!owner)return respond(403,{message:'Acesso permitido somente ao proprietário.'})
  const {data:sub,error:subErr}=await admin.from('establishment_subscriptions')
    .select('plan_id,status,asaas_subscription_id,asaas_customer_id,asaas_environment')
    .eq('establishment_id',establishmentId).maybeSingle()
  if(subErr)return respond(503,{message:'Não foi possível consultar a assinatura.'})
  if(!sub || sub.asaas_environment!=='sandbox' ||
    !providerId(sub.asaas_subscription_id,'sub') || !providerId(sub.asaas_customer_id,'cus'))
    return respond(409,{message:'Esta empresa não possui assinatura Sandbox vinculada.'})
  if(!['past_due','active','trialing'].includes(sub.status))
    return respond(409,{message:'Essa assinatura requer análise do suporte.'})
  const {data:plan,error:planErr}=await admin.from('subscription_plans')
    .select('monthly_price_cents').eq('id',sub.plan_id).maybeSingle()
  if(planErr || !plan || typeof plan.monthly_price_cents!=='number'
    || !Number.isSafeInteger(plan.monthly_price_cents)||plan.monthly_price_cents<=0)
    return respond(409,{message:'Plano ou valor inválido para conciliação.'})

  // Only pre-existing Sandbox payment GETs. No mutation is ever sent to Asaas.
  async function asaas(path:string):Promise<Record<string,unknown>>{
    const response=await fetch('https://api-sandbox.asaas.com/v3'+path,{
      method:'GET',
      headers:{access_token:apiKey,'User-Agent':'OrbitAgenda/1.0','Accept':'application/json'},
      signal:AbortSignal.timeout(14000),
    })
    if(!response.ok)throw new Error('asaas_get_'+response.status)
    const data=await response.json()
    if(!data || typeof data!=='object'||Array.isArray(data))throw new Error('invalid_asaas_payload')
    return data as Record<string,unknown>
  }
  const subscriptionId=sub.asaas_subscription_id as string
  const customerId=sub.asaas_customer_id as string
  try {
    const provider=await asaas('/subscriptions/'+encodeURIComponent(subscriptionId))
    if(provider.id!==subscriptionId || provider.customer!==customerId ||
      (provider.externalReference!=null && provider.externalReference!==establishmentId) ||
      provider.deleted===true)
      return respond(409,{message:'Assinatura divergente no Asaas. Acione o suporte.'})

    // List no more than 200 existing payments. Do not silently process a truncated list.
    const candidates:string[]=[]
    let exhausted=false
    for(let offset=0;offset<200;offset+=100){
      const page=await asaas('/subscriptions/'+encodeURIComponent(subscriptionId)
        +'/payments?limit=100&offset='+offset)
      if(!Array.isArray(page.data)||typeof page.hasMore!=='boolean')
        throw new Error('asaas_invalid_listing')
      for(const row of page.data){
        if(!row || typeof row!=='object'||Array.isArray(row))throw new Error('asaas_invalid_payment')
        const item=row as Record<string,unknown>
        if(!providerId(item.id,'pay'))throw new Error('asaas_invalid_payment')
        if(item.subscription!=null && item.subscription!==subscriptionId)
          throw new Error('asaas_other_subscription')
        if(item.status==='RECEIVED'||item.status==='CONFIRMED')candidates.push(item.id)
      }
      if(!page.hasMore){exhausted=true;break}
    }
    if(!exhausted)throw new Error('asaas_pagination_limit')
    if(!candidates.length)return respond(200,{message:'O Asaas ainda não confirmou uma cobrança paga dessa assinatura.',confirmed:false,applied:0})
    const verified=[]
    for(const paymentId of [...new Set(candidates)]){
      const detail=await asaas('/payments/'+encodeURIComponent(paymentId))
      const match=verifyPaidSandboxCharge(detail,{
        subscriptionId,customerId,establishmentId,amountCents:plan.monthly_price_cents,
      })
      if(match)verified.push(match)
    }
    if(!verified.length)
      return respond(409,{message:'Existe cobrança, mas os dados pagos não coincidem com a assinatura. Acione o suporte.'})
    verified.sort((a,b)=>a.dueDate.localeCompare(b.dueDate))
    let applied=0
    for(const paid of verified){
      // Deterministic, idempotent synthetic event ID; same provider charge never
      // creates a second record on repeated button presses.
      const {data,error}=await admin.rpc('record_asaas_billing_event',{
        p_event_id:'sandbox_reconcile_'+paid.paymentId+'_'+paid.status,
        p_asaas_subscription_id:subscriptionId,
        p_payment_id:paid.paymentId,
        p_event_type:'PAYMENT_'+paid.status,
        p_payment_status:paid.status,
        p_amount_cents:paid.amountCents,
        p_environment:'sandbox',
        p_due_date:paid.dueDate,
      })
      if(error)throw new Error('sync_rpc_'+error.code)
      if(data===true)applied++
    }
    const {data:updated,error:updatedErr}=await admin.from('establishment_subscriptions')
      .select('status').eq('establishment_id',establishmentId).maybeSingle()
    if(updatedErr || !updated)throw new Error('sync_status_unavailable')
    return respond(200,{
      confirmed:true,applied,status:updated.status,
      message:updated.status==='active'
        ? 'Pagamento Sandbox confirmado no Asaas e assinatura atualizada.'
        : 'Pagamento Sandbox registrado. O status requer conferência da assinatura.',
    })
  }catch(e){
    console.error('asaas sandbox reconciliation:',e instanceof Error?e.message:'unknown')
    return respond(503,{message:'Não foi possível conferir o pagamento no Asaas. Nenhuma nova cobrança foi criada.'})
  }
})
