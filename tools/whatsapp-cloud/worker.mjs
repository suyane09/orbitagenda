// OrbitAgenda cloud worker - outbound-only process for Render.
// Does not accept public requests. Never print secrets, phone numbers or QR codes.
import { setTimeout as pause } from 'node:timers/promises'

const supabase=process.env.SUPABASE_URL
const publishable=process.env.SUPABASE_PUBLISHABLE_KEY
const secret=process.env.ORBIT_WHATSAPP_CLOUD_SECRET
const hostport=process.env.EVOLUTION_INTERNAL_HOSTPORT||''
const evoUrl='http://'+hostport
const evoKey=process.env.EVOLUTION_API_KEY
const evoOrigin=evoUrl
const profile=/^https:\/\/[a-z0-9-]+\.supabase\.co$/
const instances=new Map()
let quitting=false
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{quitting=true})

function validateConfig(){
 if(!profile.test(supabase||''))throw Error('SUPABASE_URL invalida.')
 if(!/^(sb_publishable_[\w-]+|eyJ[\w.\-]+)$/.test(publishable||''))throw Error('Supabase publishable key ausente.')
 if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error('Secret de cloud worker ausente.')
 if(!/^[a-z0-9-]+:[0-9]{2,5}$/.test(hostport))throw Error('Use hostport privado de Render para Evolution.')
 if(!/^[a-f0-9]{64}$/.test(evoKey||''))throw Error('Evolution apikey ausente.')
 if(!/^http:\/\/[a-z0-9-]+:[0-9]{2,5}$/.test(evoOrigin||''))throw Error('Evolution Origin invalido.')
}
async function cloud(action,params={}){
 const res=await fetch(`${supabase}/functions/v1/whatsapp-cloud-worker`,{
  method:'POST',signal:AbortSignal.timeout(15000),
  headers:{apikey:publishable,'x-orbit-cloud-secret':secret,'Content-Type':'application/json'},
  body:JSON.stringify({action,...params}),
 })
 if(!res.ok)throw Error(`Cloud gateway ${action}: HTTP ${res.status}`)
 return res.json()
}
async function evo(method,path,body){
 const res=await fetch(evoUrl+path,{
  method,signal:AbortSignal.timeout(15000),
  headers:{apikey:evoKey,Origin:evoOrigin,'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{}),
 })
 if(!res.ok)throw Error(`Evolution HTTP ${res.status} em ${path.split('?')[0].split('/').slice(0,3).join('/')}`)
 return res.json()
}
function qrBase64(data){
 const qr=data?.qrcode?.base64||data?.base64
 if(typeof qr!=='string'||!qr)return null
 const image=qr.startsWith('data:')?qr:'data:image/png;base64,'+qr
 return /^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(image)&&image.length<=240000?image:null
}
async function state(name){
 try{
  const r=await evo('GET',`/instance/connectionState/${name}`)
  return r?.instance?.state||r?.state||'close'
 }catch(e){
  // Do not confuse API transport failure with a missing instance.
  if(!String(e.message).includes('HTTP 404'))throw e
  return 'missing'
 }
}
async function report(item,state,pairing=null,qr=null){
 await cloud('report',{
  p_establishment_id:item.establishment_id,
  p_instance_name:item.instance_name,
  p_state:state,p_pairing_code:pairing,p_qr:qr
 })
}
async function ensureConnection(item){
 if(!/^oa_[a-f0-9]{32}$/.test(item.instance_name)||
    !/^[a-f0-9-]{36}$/.test(item.establishment_id)||
    !/^55[1-9][0-9]{9,10}$/.test(item.phone_e164||''))
  throw Error('Invalid tenant configuration')
 const current=await state(item.instance_name)
 if(current==='open'){
  instances.delete(item.instance_name)
  await report(item,'connected')
  return
 }
 const last=instances.get(item.instance_name)||0
 if(Date.now()-last<45000)return  // Keep displayed code until it expires.
 instances.set(item.instance_name,Date.now())
 let initial
 if(current==='missing'){
  try{
   initial=await evo('POST','/instance/create',{
    instanceName:item.instance_name,integration:'WHATSAPP-BAILEYS',qrcode:true,
   })
  }catch(e){
   // Instance may not be initialized yet; retry later without emitting secrets.
   console.error('Creation issue for instance:',item.instance_name,e.message)
   await report(item,'connecting')
   return
  }
 }
 try{
  // Server issues short-lived phone pairing code. Works on the SAME phone
  // when supported by WhatsApp Business and the Evolution/Baileys version.
  const r=await evo('GET',
   `/instance/connect/${item.instance_name}?number=${encodeURIComponent(item.phone_e164)}`)
  const code=typeof r?.pairingCode==='string'&&/^[A-Za-z0-9]{6,12}$/.test(r.pairingCode)?
    r.pairingCode:null
  const qr=qrBase64(r)||qrBase64(initial)
  if(code)await report(item,'connecting',code)
  else if(qr)await report(item,'qr',null,qr)
  else await report(item,'connecting')
 }catch(e){
  console.error('Pairing not ready for',item.instance_name,e.message)
  await report(item,'connecting')
 }
}
async function sendJob(job){
 if(job?.action!=='send')return
 const id=job?.id,est=job?.establishment_id,name=job?.instance_name
 if(!/^[0-9a-f-]{36}$/.test(id||'')||
    !/^[0-9a-f-]{36}$/.test(est||'')||
    !/^oa_[a-f0-9]{32}$/.test(name||'')||
    !/^55[1-9][0-9]{9,10}$/.test(job?.recipient||'')||
    typeof job?.body!=='string'||job.body.length>1200){
  throw Error('Claimed job invalid: will not send')
 }
 let accepted=false
 let providerId=''
 try{
  if(await state(name)!=='open')throw Error('Disconnected after claiming; no retry')
  const r=await evo('POST',`/message/sendText/${name}`,{
   number:job.recipient,text:job.body
  })
  accepted=true
  providerId=typeof r?.key?.id==='string'?r.key.id:''
 }catch(e){console.error('Sending uncertain/failed, not retrying:',id,e.message)}
 try{
  await cloud('finish',{p_establishment_id:est,p_job_id:id,
    p_accepted:accepted,p_provider_id:providerId,p_error:accepted?null:'send_unconfirmed'})
  console.log('Message request recorded, delivery not verified:',id)
 }catch(e){
  // DO NOT RETRY a possibly accepted send; manual reconciliation required.
  console.error('Cannot finalize claimed job:',id,e.message)
 }
}
async function main(){
 validateConfig()
 console.log('OrbitAgenda cloud worker started (private-only, no customer input, no retries)')
 while(!quitting){
  try{
   const connections=await cloud('list')
   if(!Array.isArray(connections))throw Error('Cloud list payload invalid')
   for(const item of connections){
    if(quitting)break
    try{await ensureConnection(item)}catch(e){
     console.error('Instance issue:',item?.instance_name||'unknown',e.message)
    }
   }
   if(!quitting)await sendJob(await cloud('claim'))
  }catch(e){console.error('Worker cycle:',e.message)}
  if(!quitting)await pause(8000)
 }
 console.log('Worker stopped')
}
main().catch(e=>{console.error('Fatal worker configuration:',e.message);process.exitCode=1})
