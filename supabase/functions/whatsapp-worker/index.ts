import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

// Outbound-only worker bridge. The local Evolution process never receives any
// Supabase secret key or an inbound URL. Publishable callers only reach a tiny
// allowlist; per-establishment 256-bit worker tokens are verified in Postgres.
// The underlying worker RPCs are NOT executable by anon/authenticated.
const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': 'https://orbitagenda.vercel.app',
  'Access-Control-Allow-Headers': 'apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (value: unknown, status=200) => Response.json(value,{status,headers})
const secretCode = (v: unknown) => typeof v==='string' && /^[a-f0-9]{64}$/.test(v)
const uuid = (v: unknown) => typeof v==='string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

export default {
  fetch: withSupabase({auth:['publishable']},async(req,ctx)=>{
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
    if(req.method!=='POST')return json({error:'method_not_allowed'},405)
    if(Number(req.headers.get('content-length')||0)>270000)
      return json({error:'payload_too_large'},413)
    let body: Record<string,unknown>
    try {
      const raw=await req.text()
      if(raw.length>260000) return json({error:'payload_too_large'},413)
      const data=JSON.parse(raw)
      if(!data||typeof data!=='object'||Array.isArray(data))throw Error()
      body=data
    }catch{return json({error:'invalid_json'},400)}
    const action=body.action
    if(!['pair','poll','report','finish'].includes(String(action)))
      return json({error:'unknown_action'},400)
    // Persistent per-IP limiter; one-time 256-bit codes are unguessable,
    // but unsolicited requests must not cause unbounded database work.
    const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0]?.trim()||'unknown'
    const salt=Deno.env.get('RATE_LIMIT_SALT') || 'whatsapp_worker_v1'
    const rawKey=new TextEncoder().encode(salt+':'+action+':'+ip)
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rawKey)))
      .map(x=>x.toString(16).padStart(2,'0')).join('')
    const {data:limited,error:limitErr}=await ctx.supabaseAdmin.rpc('check_rate_limit',{
      p_key:hash,p_limit:action==='pair'?12:180,p_window_seconds:60,
    })
    const limit=Array.isArray(limited)?limited[0]:limited
    if(limitErr||!limit)return json({error:'service_unavailable'},503)
    if(!limit.allowed)return json({error:'rate_limited'},429)

    let rpcName:string
    let params:Record<string,unknown>
    if(action==='pair') {
      if(!secretCode(body.p_code))return json({error:'invalid_input'},400)
      rpcName='whatsapp_worker_pair';params={p_code:body.p_code}
    } else {
      if(!secretCode(body.p_token))return json({error:'forbidden'},403)
      if(action==='poll'){
        rpcName='whatsapp_worker_poll';params={p_token:body.p_token}
      } else if(action==='report') {
        if(!['connecting','qr','connected','disconnected','error'].includes(String(body.p_state)))return json({error:'invalid_state'},400)
        if(body.p_qr!==undefined&&body.p_qr!==null&&
          (typeof body.p_qr!=='string'||body.p_qr.length>240000 ||
           !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.p_qr)))
          return json({error:'invalid_qr'},400)
        rpcName='whatsapp_worker_report'
        params={p_token:body.p_token,p_state:body.p_state,p_qr:body.p_qr??null}
      }else{
        if(!uuid(body.p_job_id)||typeof body.p_accepted!=='boolean')return json({error:'invalid_job'},400)
        rpcName='whatsapp_worker_finish';params={
          p_token:body.p_token,p_job_id:body.p_job_id,p_accepted:body.p_accepted,
          p_provider_id:typeof body.p_provider_id==='string'?body.p_provider_id.slice(0,180):null,
          p_error:typeof body.p_error==='string'?body.p_error.slice(0,60):null,
        }
      }
    }
    const {data,error}=await ctx.supabaseAdmin.rpc(rpcName,params)
    if(error) {
      // Deliberately do not expose SQL messages, tokens, customers or secrets.
      if(error.code==='42501')return json({error:'forbidden'},403)
      if(error.code==='22023')return json({error:'invalid_input'},400)
      console.error('whatsapp-worker RPC failed',rpcName,error.code)
      return json({error:'service_unavailable'},503)
    }
    return json(data??{ok:true})
  }),
}
