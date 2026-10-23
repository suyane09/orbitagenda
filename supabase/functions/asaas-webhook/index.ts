import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

const apiKey = Deno.env.get('ASAAS_API_KEY') ?? ''
const webhookToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? ''
const environment = Deno.env.get('ASAAS_ENVIRONMENT') ?? 'sandbox'
const apiBase = environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth:{ persistSession:false, autoRefreshToken:false } })
const response = (status:number,message:string) => new Response(JSON.stringify({message}),
  {status,headers:{'content-type':'application/json'}})
async function tokenMatches(received:string):Promise<boolean> {
  // Compare digest bytes rather than early-exiting string equality.
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
    || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return response(503,'not_configured')
  const submitted=req.headers.get('asaas-access-token') ?? ''
  if(!submitted || !(await tokenMatches(submitted))) return response(401,'unauthorized')
  const raw=await req.text()
  if(raw.length>80000) return response(413,'payload_too_large')
  let input:Record<string,unknown>
  try{input=JSON.parse(raw)}catch{return response(400,'invalid_json')}
  const event=input.event
  const payment=input.payment as Record<string,unknown>|undefined
  if(typeof event!=='string' || typeof input.id!=='string' || !input.id) return response(400,'invalid_event')
  if(!event.startsWith('PAYMENT_')) return response(200,'ignored')
  if(!payment || typeof payment.id!=='string') return response(400,'invalid_payment_event')
  // Provider-side verification: do not trust the JSON event status alone.
  let actual:Record<string,unknown>
  try{
    const res=await fetch(apiBase+'/payments/'+encodeURIComponent(payment.id),{
      headers:{access_token:apiKey,'User-Agent':'OrbitAgenda/1.0'},
      signal:AbortSignal.timeout(14000),
    })
    if(!res.ok) return response(502,'asaas_unavailable')
    actual=await res.json()
  }catch{return response(502,'asaas_unavailable')}
  if(typeof actual.id!=='string' || actual.id!==payment.id) return response(422,'invalid_payment')
  // Ignore legitimate payments in the same Asaas account unrelated to Orbit Agenda.
  if(typeof actual.subscription!=='string' || !actual.subscription.startsWith('sub_')) return response(200,'ignored')
  if(typeof actual.status!=='string' || typeof actual.value!=='number'
    || !Number.isFinite(actual.value) || actual.value<0) return response(422,'invalid_payment')
  const {data: linked, error: lookupError}=await admin.from('establishment_subscriptions')
    .select('establishment_id').eq('asaas_subscription_id',actual.subscription)
    .eq('asaas_environment',environment).maybeSingle()
  if(lookupError)return response(503,'database_unavailable')
  if(!linked)return response(200,'ignored')
  const {error} = await admin.rpc('record_asaas_payment_event',{
    p_event_id:input.id,
    p_asaas_subscription_id:actual.subscription,
    p_payment_id:actual.id,
    p_event_type:event,
    p_payment_status:actual.status,
    p_amount_cents:Math.round(actual.value*100),
    p_environment:environment,
  })
  if(error){
    // A retry is safer than acknowledging a failed database transaction.
    return response(503,'database_unavailable')
  }
  return response(200,'ok')
})
