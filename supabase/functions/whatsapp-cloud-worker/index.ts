import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

// Never expose this route to a browser. A cloud worker must supply the secret
// separately from the publishable Supabase API key.
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const instance=(v:unknown)=>typeof v==='string'&&/^oa_[a-f0-9]{32}$/.test(v)
const safeEqual=(a:string,b:string)=>{
 if(a.length!==b.length)return false
 let mismatch=0
 for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i)
 return mismatch===0
}
export default {
 fetch:withSupabase({auth:['publishable']},async(req,ctx)=>{
   if(req.method!=='POST')return reply({error:'method_not_allowed'},405)
   const secret=Deno.env.get('ORBIT_WHATSAPP_CLOUD_SECRET')||''
   const supplied=req.headers.get('x-orbit-cloud-secret')||''
   if(!/^[a-f0-9]{64}$/.test(secret))return reply({error:'not_configured'},503)
   if(!/^[a-f0-9]{64}$/.test(supplied)||!safeEqual(supplied,secret))
     return reply({error:'forbidden'},403)
   let body:Record<string,unknown>
   try {
     if(Number(req.headers.get('content-length')||0)>260000)return reply({error:'payload_too_large'},413)
     const raw=await req.text()
     if(raw.length>260000)return reply({error:'payload_too_large'},413)
     const data=JSON.parse(raw)
     if(!data||typeof data!=='object'||Array.isArray(data))throw Error()
     body=data
   }catch{return reply({error:'invalid_json'},400)}
   let name:string
   let params:Record<string,unknown>
   switch(body.action){
    case 'list':name='whatsapp_cloud_list';params={};break
    case 'claim':name='whatsapp_cloud_claim';params={};break
    case 'report':
      if(!uuid(body.p_establishment_id)||!instance(body.p_instance_name)||
         !['connecting','qr','connected','disconnected','error'].includes(String(body.p_state)))
        return reply({error:'invalid_input'},400)
      if(body.p_qr!==null&&body.p_qr!==undefined&&
       (typeof body.p_qr!=='string'||body.p_qr.length>240000||
        !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.p_qr)))
        return reply({error:'invalid_qr'},400)
      if(body.p_pairing_code!==null&&body.p_pairing_code!==undefined&&
       (typeof body.p_pairing_code!=='string'||!/^[A-Za-z0-9]{6,12}$/.test(body.p_pairing_code)))
        return reply({error:'invalid_pair_code'},400)
      name='whatsapp_cloud_report'
      params={p_establishment_id:body.p_establishment_id,p_instance_name:body.p_instance_name,
        p_state:body.p_state,p_qr:body.p_qr??null,p_pairing_code:body.p_pairing_code??null}
      break
    case 'finish':
      if(!uuid(body.p_establishment_id)||!uuid(body.p_job_id)||typeof body.p_accepted!=='boolean')
        return reply({error:'invalid_input'},400)
      name='whatsapp_cloud_finish'
      params={p_establishment_id:body.p_establishment_id,p_job_id:body.p_job_id,
        p_accepted:body.p_accepted,
        p_provider_id:typeof body.p_provider_id==='string'?body.p_provider_id.slice(0,180):null,
        p_error:typeof body.p_error==='string'?body.p_error.slice(0,60):null}
      break
    default:return reply({error:'unknown_action'},400)
   }
   const {data,error}=await ctx.supabaseAdmin.rpc(name,params)
   if(error) {
     // Never log cloud secret, customer numbers or provider messages.
     console.error('whatsapp-cloud-worker RPC failure',name,error.code)
     return reply({error:'rpc_failed'},error.code==='42501'?403:503)
   }
   return reply(data??{ok:true})
 }),
}
