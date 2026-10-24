import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
const webhookToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
const environment = Deno.env.get('ASAAS_ENVIRONMENT') ?? 'sandbox'
const apiBase = environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
const getAdmin = () => createClient(Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth:{ persistSession:false, autoRefreshToken:false } })
const response = (status:number,message:string) => new Response(JSON.stringify({message}),
  {status,headers:{'content-type':'application/json'}})
async function tokenMatches(received:string):Promise<boolean> {
  const encoder=new TextEncoder()
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(webhookToken)))
  const b=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(received)))
  let difference=0
  for(let i=0;i<a.length;i++) difference|=a[i]^b[i]
  return difference===0
}

Deno.serve(async req=>{
  if(req.method!=='POST') return response(405,'method_not_allowed')
  if(!apiKey || !webhookToken || webhookToken.length<32
    || !['sandbox','production'].includes(environment)
    || (environment==='production' && Deno.env.get('ASAAS_PRODUCTION_CONFIRMED')!=='true')
    || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || !Deno.env.get('SUPABASE_URL')) return response(503,'not_configured')
  const submitted=req.headers.get('asaas-access-token') ?? ''
  if(!submitted || !(await tokenMatches(submitted))) return response(401,'unauthorized')
  const raw=await req.text()
  if(raw.length>80000) return response(413,'payload_too_large')
  let input:Record<string,unknown>
  try{input=JSON.parse(raw)}catch{return response(400,'invalid_json')}
  const event=input.event
  const payment=input.payment as Record<string,unknown>|undefined
  if(typeof event!=='string' || typeof input.id!=='string' || !input.id) return response(400,'invalid_event')
  const REVERSALS=['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_DELETED']
  if(event==='SUBSCRIPTION_DELETED' || event==='SUBSCRIPTION_INACTIVATED') return await handleSubscriptionDeleted(input)
  if(!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_OVERDUE',...REVERSALS].includes(event))
    return response(200,'ignored')
  if(!payment || typeof payment.id!=='string') return response(400,'invalid_payment_event')
  let actual:Record<string,unknown>
  try{
    const res=await fetch(apiBase+'/payments/'+encodeURIComponent(payment.id),{
      headers:{access_token:apiKey,'User-Agent':'OrbitAgenda/1.0'},
      signal:AbortSignal.timeout(14000),
    })
    if(res.status===404) return response(404,'asaas_payment_not_found')
    if(res.status===401 || res.status===403) return response(502,'asaas_auth_failed')
    if(!res.ok) return response(502,'asaas_unavailable')
    actual=await res.json()
  }catch{return response(502,'asaas_unavailable')}
  if(typeof actual.id!=='string' || actual.id!==payment.id) return response(422,'invalid_payment')
  if(typeof actual.subscription!=='string' || !actual.subscription.startsWith('sub_')) return response(200,'ignored')
  if(typeof actual.status!=='string' || typeof actual.value!=='number'
    || !Number.isFinite(actual.value) || actual.value<0) return response(422,'invalid_payment')
  const CHARGEBACK=['CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL']
  const verifiedEvent=actual.deleted===true ? 'PAYMENT_DELETED'
    : actual.status==='REFUNDED' ? 'PAYMENT_REFUNDED'
    : CHARGEBACK.includes(actual.status) ? 'PAYMENT_CHARGEBACK_REQUESTED'
    : actual.status==='RECEIVED' ? 'PAYMENT_RECEIVED'
    : actual.status==='CONFIRMED' ? 'PAYMENT_CONFIRMED'
    : actual.status==='OVERDUE' ? 'PAYMENT_OVERDUE' : null
  if(!verifiedEvent) return response(200,'ignored')
  const admin=getAdmin()
  const {data: linked, error: lookupError}=await admin.from('establishment_subscriptions')
    .select('establishment_id').eq('asaas_subscription_id',actual.subscription)
    .eq('asaas_environment',environment).maybeSingle()
  if(lookupError)return response(503,'database_unavailable')
  if(!linked)return response(200,'ignored')
  const rpcName=(REVERSALS.includes(verifiedEvent)) ? 'record_asaas_billing_reversal' : 'record_asaas_billing_event'
  const {error} = await admin.rpc(rpcName,{
    p_event_id:input.id,
    p_asaas_subscription_id:actual.subscription,
    p_payment_id:actual.id,
    p_event_type:verifiedEvent,
    p_payment_status:actual.status,
    p_amount_cents:Math.round(actual.value*100),
    p_environment:environment,
    p_due_date:typeof actual.dueDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(actual.dueDate) ? actual.dueDate : null,
  })
  if(error)return response(503,'database_unavailable')
  return response(200,'ok')
})

async function handleSubscriptionDeleted(input:Record<string,unknown>):Promise<Response>{
  const sub=input.subscription as Record<string,unknown>|undefined
  if(!sub || typeof sub.id!=='string' || !sub.id.startsWith('sub_')) return response(400,'invalid_subscription_event')
  const admin=getAdmin()
  const {data: linked, error: lookupError}=await admin.from('establishment_subscriptions')
    .select('establishment_id').eq('asaas_subscription_id',sub.id)
    .eq('asaas_environment',environment).maybeSingle()
  if(lookupError)return response(503,'database_unavailable')
  if(!linked)return response(200,'ignored')
  let actual:Record<string,unknown>
  try{
    const headers={access_token:apiKey,'User-Agent':'OrbitAgenda/1.0'}
    const res=await fetch(apiBase+'/subscriptions/'+encodeURIComponent(sub.id),{
      headers,signal:AbortSignal.timeout(14000),
    })
    if(res.status===404){
      // A deleted subscription may return 404 on the detail endpoint.
      // Confirm deletion with the provider's deleted-only list, not just a webhook body.
      const deleted=await fetch(apiBase+'/subscriptions?deletedOnly=true&externalReference='
        +encodeURIComponent(linked.establishment_id)+'&limit=100',{
        headers,signal:AbortSignal.timeout(14000),
      })
      if(!deleted.ok)return response(502,'asaas_unavailable')
      const body=await deleted.json()
      if(!Array.isArray(body?.data))return response(502,'asaas_unavailable')
      if(!body.data.some((item:{id?:string})=>item?.id===sub.id))return response(502,'asaas_unavailable')
      actual={id:sub.id,deleted:true}
    }else{
      if(!res.ok)return response(502,'asaas_unavailable')
      actual=await res.json()
    }
  }catch{return response(502,'asaas_unavailable')}
  if(actual.id!==sub.id) return response(422,'invalid_subscription')
  if(actual.deleted!==true && actual.status!=='INACTIVE') return response(200,'ignored')
  const {error}=await admin.rpc('record_asaas_billing_reversal',{
    p_event_id:input.id,p_asaas_subscription_id:sub.id,p_payment_id:sub.id,
    p_event_type:'SUBSCRIPTION_DELETED',p_payment_status:'DELETED',
    p_amount_cents:0,p_environment:environment,p_due_date:null,
  })
  if(error)return response(503,'database_unavailable')
  return response(200,'ok')
}
