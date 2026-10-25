// OrbitAgenda Evolution API OUTBOUND worker. Node.js 20+.
// This process runs on the same computer as Docker, polls Supabase over HTTPS.
// No incoming ports, tunnels, Edge secrets, service_role keys or public APIs.
// One worker pairing token grants access to exactly one establishment.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

const home = dirname(fileURLToPath(import.meta.url))
const envPath = join(home, '.env')
const tokenPath = join(home, '.worker.json')
const evoBase = 'http://127.0.0.1:8088'
const origin = 'http://localhost:8088'
const args = process.argv.slice(2)
let quitting = false
process.on('SIGINT', () => { quitting = true })

function clean(value) { return String(value || '').replace(/^\s+|\s+$/g, '') }
async function readEnv() {
  if (!existsSync(envPath)) throw Error('Arquivo .env nao encontrado. Execute primeiro testar.ps1 -Acao iniciar.')
  const obj = {}
  for (const line of (await readFile(envPath,'utf8')).split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line)
    if (match) obj[match[1]] = clean(match[2])
  }
  return obj
}
async function readPairing() {
  if (!existsSync(tokenPath)) throw Error('Conexao nao vinculada. Execute node worker.mjs pair CODIGO primeiro.')
  return JSON.parse(await readFile(tokenPath,'utf8'))
}
function validateEnv(e) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(e.SUPABASE_URL || ''))
    throw Error('SUPABASE_URL deve ser https://SEU-PROJETO.supabase.co (configure no .env local).')
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(e.SUPABASE_PUBLISHABLE_KEY || '') &&
      !/^eyJ[a-zA-Z0-9_.-]+$/.test(e.SUPABASE_PUBLISHABLE_KEY || ''))
    throw Error('SUPABASE_PUBLISHABLE_KEY ausente. Use chave PUBLICA/PUBLISHABLE, nunca secret ou service_role.')
  if (!/^[0-9a-f]{64}$/.test(e.AUTHENTICATION_API_KEY || ''))
    throw Error('AUTHENTICATION_API_KEY local invalida.')
}
async function rpc(e, name, data) {
  const response = await fetch(`${e.SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:'POST',signal:AbortSignal.timeout(15000),
    headers:{apikey:e.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
    body:JSON.stringify(data),
  })
  if (!response.ok) throw Error(`Supabase RPC ${name}: HTTP ${response.status} (verifique migracao e token)`)
  return response.json()
}
async function evo(e, method, path, body) {
  const response = await fetch(`${evoBase}${path}`,{
    method,signal:AbortSignal.timeout(12000),
    headers:{'apikey':e.AUTHENTICATION_API_KEY,'Origin':origin,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),
  })
  if (!response.ok) throw Error(`Evolution API ${path.split('/').slice(0,3).join('/')}: HTTP ${response.status}`)
  return response.json()
}
function extractQr(data) {
  const qr = data?.qrcode?.base64 || data?.base64 || ''
  if (typeof qr!=='string'||!qr) return null
  const raw = qr.startsWith('data:') ? qr : 'data:image/png;base64,'+qr
  return /^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(raw) && raw.length<240000 ? raw : null
}
async function status(e, instance) {
  try {
    const data = await evo(e,'GET',`/instance/connectionState/${instance}`)
    return data?.instance?.state || data?.state || 'close'
  } catch { return 'missing' }
}
async function ensureConnection(e, pair) {
  let state = await status(e,pair.instance_name)
  let created
  if (state==='missing') {
    try {
      created = await evo(e,'POST','/instance/create',{
        instanceName:pair.instance_name,integration:'WHATSAPP-BAILEYS',qrcode:true,
      })
    } catch (err) {
      // If another worker just created the instance, the next poll will see it.
      console.log('Conexao ainda nao disponivel:',err.message)
      await rpc(e,'whatsapp_worker_report',{p_token:pair.token,p_state:'connecting'})
      return
    }
    state = await status(e,pair.instance_name)
  }
  if (state==='open') {
    await rpc(e,'whatsapp_worker_report',{p_token:pair.token,p_state:'connected'})
    return
  }
  let qr = extractQr(created)
  if (!qr) {
    try { qr=extractQr(await evo(e,'GET',`/instance/connect/${pair.instance_name}`)) }
    catch { /* QR may not be ready; next poll retries */ }
  }
  if (qr) await rpc(e,'whatsapp_worker_report',{p_token:pair.token,p_state:'qr',p_qr:qr})
  else await rpc(e,'whatsapp_worker_report',{p_token:pair.token,p_state:'connecting'})
}
async function tick(e,pair) {
  let state = await status(e,pair.instance_name)
  if (state !== 'open') {
    await ensureConnection(e,pair)
    return
  }
  // Verify Evolution is really connected before asking Supabase for a message.
  await rpc(e,'whatsapp_worker_report',{p_token:pair.token,p_state:'connected'})
  const job = await rpc(e,'whatsapp_worker_poll',{p_token:pair.token})
  if(job?.action!=='send') return
  if(job.instance_name!==pair.instance_name || !/^55[1-9][0-9]{9,10}$/.test(job.recipient||'') ||
     typeof job.body!=='string'||job.body.length>1200)
    throw Error('Dados da fila invalidos; envio interrompido.')
  try {
    const result = await evo(e,'POST',`/message/sendText/${pair.instance_name}`,{
      number:job.recipient,text:job.body,
    })
    await rpc(e,'whatsapp_worker_finish',{
      p_token:pair.token,p_job_id:job.id,p_accepted:true,
      p_provider_id:result?.key?.id || '',
    })
    console.log(`Aceito pela API: job ${job.id}. Entrega ainda nao confirmada.`)
  } catch(err) {
    // A transport timeout may mean the provider received it. We never auto-retry
    // the same send: at-most-once intention avoids duplicate customer messages.
    try {
      await rpc(e,'whatsapp_worker_finish',{
        p_token:pair.token,p_job_id:job.id,p_accepted:false,p_error:'send_unconfirmed',
      })
    }catch{/* keep sending state if reporting failed; no automatic resend */}
    console.error(`Falha/resultado incerto no job ${job.id}:`,err.message)
  }
}
async function main() {
  const e = await readEnv()
  validateEnv(e)
  if (args[0]==='pair') {
    const code = args[1]
    if (!/^[a-f0-9]{64}$/.test(code || '')) throw Error('Copie o codigo de 64 caracteres exibido no painel WhatsApp da barbearia.')
    if (existsSync(tokenPath)) throw Error('Este computador ja esta vinculado. Revogue/reconfigure a conexao antes de parear outra.')
    const data=await rpc(e,'whatsapp_worker_pair',{p_code:code})
    if (!/^[a-f0-9]{64}$/.test(data?.token||'') || !/^oa_[a-f0-9]{32}$/.test(data?.instance_name||''))
      throw Error('Resposta de pareamento invalida.')
    await writeFile(tokenPath,JSON.stringify(data),{mode:0o600,flag:'wx'})
    console.log('Barbearia vinculada a este worker. Execute: node worker.mjs run')
    return
  }
  if(args[0]!=='run') throw Error('Uso: node worker.mjs pair CODIGO | node worker.mjs run')
  const pair=await readPairing()
  console.log('Worker outbound iniciado. Ctrl+C para parar. Docker deve permanecer ligado.')
  while (!quitting) {
    try {await tick(e,pair)}
    catch (err) {console.error('Worker:',err.message)}
    if (!quitting) await pause(8000)
  }
  console.log('Worker encerrado; Docker permanece ligado.')
}
main().catch(err=>{console.error('Erro:',err.message);process.exitCode=1})
