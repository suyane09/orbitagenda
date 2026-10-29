import { useCallback, useEffect, useState } from 'react'
import { useAccount } from '@/features/establishments/AccountProvider'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

const cloudEnabled = import.meta.env.VITE_WHATSAPP_CLOUD_ENABLED === 'true'
type Connection = {
  backend?: 'local' | 'cloud'
  phone_e164?: string | null
  phone_pair_code?: string | null
  phone_pair_expires_at?: string | null
  establishment_id: string
  state: 'pending' | 'connecting' | 'qr' | 'connected' | 'disconnected' | 'error'
  enabled: boolean
  qr_image: string | null
  qr_expires_at: string | null
  worker_last_seen: string | null
}
type Notification = {
  id: string
  kind: 'confirmation' | 'reminder' | 'cancellation'
  state: 'queued' | 'sending' | 'accepted' | 'failed' | 'cancelled'
  created_at: string
  due_at: string
}
const label: Record<Notification['kind'],string> = {
  confirmation: 'Confirmação', reminder: 'Lembrete', cancellation: 'Cancelamento',
}
const stateLabel: Record<Connection['state'], string> = {
  pending: 'Aguardando configuração', connecting: 'Preparando conexão',
  qr: 'Aguardando leitura do QR Code', connected: 'WhatsApp conectado',
  disconnected: 'Desconectado', error: 'Erro de conexão',
}
const statusLabel: Record<Notification['state'], string> = {
  queued: 'Programada', sending: 'Envio iniciado', accepted: 'Aceita pela API',
  failed: 'Falhou', cancelled: 'Cancelada',
}

export default function WhatsAppPage() {
  const { current } = useAccount()
  const establishmentId = current?.establishment.id
  const owner = current?.role === 'owner'
  const [connection,setConnection] = useState<Connection | null>(null)
  const [messages,setMessages] = useState<Notification[]>([])
  const [pairing,setPairing] = useState('')
  const [phone,setPhone] = useState('')
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')

  const load=useCallback(async(silent=false)=>{
    if(!establishmentId || !owner) return
    if(!silent) setLoading(true)
    try {
      const [con,history]=await Promise.all([
        supabase.from('whatsapp_connections').select(
          cloudEnabled
           ? 'establishment_id,backend,phone_e164,phone_pair_code,phone_pair_expires_at,state,enabled,qr_image,qr_expires_at,worker_last_seen'
           : 'establishment_id,state,enabled,qr_image,qr_expires_at,worker_last_seen'
        ).eq('establishment_id',establishmentId).maybeSingle(),
        supabase.from('whatsapp_outbox').select('id,kind,state,created_at,due_at')
          .eq('establishment_id',establishmentId).order('created_at',{ascending:false}).limit(20),
      ])
      if(con.error) throw con.error
      if(history.error) throw history.error
      setConnection((con.data as Connection|null)??null)
      setMessages((history.data??[]) as Notification[])
      if(!silent) setError('')
    } catch(e) {
      if(!silent) setError(describeError(e,'Não foi possível consultar o WhatsApp.'))
    } finally {if(!silent) setLoading(false)}
  },[establishmentId,owner])
  useEffect(()=>{
    void load()
    const timer=window.setInterval(()=>{void load(true)},8000)
    return ()=>window.clearInterval(timer)
  },[load])

  async function beginPairing(){
    if(!establishmentId || busy)return
    setBusy(true);setError('');setNotice('');setPairing('')
    try {
      if (cloudEnabled) {
        if (!/^((55)?[1-9][0-9]{9,10})$/.test(phone.replace(/[^0-9]/g,''))) {
          throw Error('Informe o número do WhatsApp com DDD.')
        }
        const {error:err}=await supabase.rpc('whatsapp_cloud_request',{
          p_establishment_id:establishmentId,p_phone:phone,
        })
        if(err)throw err
        setNotice('Conexão solicitada. O código aparecerá nesta página quando o servidor estiver disponível.')
      } else {
        const {data,error:err}=await supabase.rpc('whatsapp_begin_pairing',{p_establishment_id:establishmentId})
        if(err)throw err
        if(typeof data!=='string'||! /^[a-f0-9]{64}$/.test(data))throw Error('Código de conexão inválido.')
        setPairing(data)
        setNotice('Código válido por 10 minutos. Use-o somente no worker local da Evolution API.')
      }
      await load()
    } catch(e){setError(describeError(e,'Não foi possível iniciar a conexão.'))}
    finally{setBusy(false)}
  }
  async function toggle(){
    if(!establishmentId || !connection || busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const target=!connection.enabled
      const {error:err}=await supabase.rpc('whatsapp_set_enabled',{
        p_establishment_id:establishmentId,p_enabled:target,
      })
      if(err)throw err
      setNotice(target?'Envios automáticos ativados apenas para clientes que autorizarem notificações.':'Envios desativados. Mensagens pendentes foram canceladas.')
      await load()
    }catch(e){setError(describeError(e,'Não foi possível alterar os envios.'))}
    finally{setBusy(false)}
  }

  if(!owner) return <div className="mx-auto max-w-3xl p-8 text-sm text-slate">
    Somente o proprietário pode configurar o WhatsApp da empresa.
  </div>
  const online=connection?.state==='connected' && connection.worker_last_seen &&
    Date.now()-new Date(connection.worker_last_seen).getTime()<180_000
  const showPhoneCode=cloudEnabled && connection?.backend==='cloud' && !!connection.phone_pair_code &&
    !!connection.phone_pair_expires_at && new Date(connection.phone_pair_expires_at).getTime()>Date.now()
  const showQr=connection?.state==='qr' && connection.qr_image?.startsWith('data:image/') &&
    connection.qr_expires_at && new Date(connection.qr_expires_at).getTime()>Date.now()

  return <div className="w-full min-w-0 space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <header>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate">Automações</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">WhatsApp automático</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate">
        Conecte o WhatsApp do estabelecimento e envie confirmações e lembretes somente
        a clientes que aceitarem receber notificações.
      </p>
    </header>
    {error&&<p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>}
    {notice&&<p role="status" className="rounded-xl bg-ok-soft p-4 text-sm text-ok">{notice}</p>}
    <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Conexão da empresa</h2>
          <p className="mt-2 text-sm text-slate">{connection?stateLabel[connection.state]:'Nenhuma conexão configurada'}</p>
          {connection?.state==='connected'&&!online&&<p className="mt-2 text-sm text-danger">
            {cloudEnabled?'Servidor de WhatsApp indisponível. Os envios estão pausados.':'Worker desconectado ou parado. Reinicie o processo no computador.'}
          </p>}
        </div>
        <Button type="button" variant="outline" onClick={()=>void load()} disabled={busy}>Atualizar</Button>
      </div>

      {loading?<div className="mt-6 flex items-center gap-2 text-sm text-slate"><Spinner/> Consultando conexão…</div>:<>
        {cloudEnabled && <>
          <label htmlFor="cloud-whatsapp-number" className="mt-5 block text-sm font-semibold">
            Número do WhatsApp da barbearia
          </label>
          <input id="cloud-whatsapp-number" type="tel" inputMode="tel" autoComplete="tel"
            value={phone} onChange={event=>setPhone(event.target.value)}
            placeholder="(82) 99999-9999"
            className="mt-2 w-full max-w-sm rounded-xl border border-hairline bg-surface px-4 py-3 text-sm" />
          {showPhoneCode && <div className="mt-5 rounded-xl border border-hairline bg-paper p-4">
            <p className="text-sm font-semibold">Código para conectar pelo próprio celular</p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-widest" aria-label="Código temporário">
              {connection?.phone_pair_code}
            </p>
            <p className="mt-3 text-sm text-slate">
              Abra o WhatsApp no celular principal → Dispositivos conectados → Conectar
              dispositivo → Conectar com número de telefone. Informe esse código temporário.
            </p>
            <p className="mt-2 text-xs text-slate">Confira no WhatsApp se reconhece a solicitação antes de confirmar.</p>
          </div>}
        </>}
        {showQr&&connection?.qr_image&&
          <div className="mt-6 flex flex-col items-start gap-2 rounded-xl border border-hairline bg-paper p-4">
            <p className="text-sm font-medium">Escaneie com o WhatsApp deste estabelecimento</p>
            <img src={connection.qr_image} alt="QR Code temporário de conexão do WhatsApp" className="h-64 w-64 rounded-lg bg-white p-2" />
            <p className="text-xs text-slate">WhatsApp → Dispositivos conectados → Conectar dispositivo. Código temporário e privado.</p>
          </div>}
        {!cloudEnabled&&pairing&&
          <div className="mt-6 rounded-xl bg-paper p-4">
            <p className="text-sm font-semibold">Código para vincular o worker local</p>
            <p className="mt-2 text-xs text-slate">Este código é de uso único e expira em 10 minutos. Não compartilhe.</p>
            <input type="text" aria-label="Código de vinculação" className="mt-3 w-full rounded-lg border border-hairline bg-surface p-3 font-mono text-xs"
              readOnly value={pairing} onFocus={e=>e.currentTarget.select()}/>
            <Button type="button" variant="outline" onClick={()=>void navigator.clipboard.writeText(pairing).then(()=>setNotice('Código copiado.')).catch(()=>setError('Selecione e copie o código manualmente.'))}>Copiar código</Button>
          </div>}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" variant="outline" loading={busy} onClick={()=>void beginPairing()}>
            {cloudEnabled?'Conectar pelo celular':connection?'Gerar nova vinculação':'Conectar WhatsApp'}
          </Button>
          {connection&&<Button type="button" disabled={busy||(!connection.enabled&&!online)}
            onClick={()=>void toggle()}>{connection.enabled?'Desativar envios':'Ativar envios'}</Button>}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate">
          Piloto sem mensalidade de API, mas não oficial do WhatsApp: pode desconectar ou sofrer restrições.
          {cloudEnabled
            ? 'O servidor central precisa estar ativo; você não precisa instalar programas. Uma nova vinculação revoga a conexão anterior.'
            : 'Exige Docker e worker ligados. Ao gerar nova vinculação, a conexão anterior é revogada.'}
          Nunca envie mensagens sem consentimento do destinatário.
        </p>
      </>}
    </section>
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface">
      <header className="border-b border-hairline p-5">
        <h2 className="font-display text-xl font-semibold">Últimas notificações</h2>
        <p className="mt-1 text-xs text-slate">Resultados dos 20 envios mais recentes. Aceite pela API não comprova entrega.</p>
      </header>
      {messages.length===0
        ? <p className="p-5 text-sm text-slate">Ainda não há notificações registradas.</p>
        : <ul className="divide-y divide-hairline">{messages.map(m=>
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div><strong>{label[m.kind]}</strong>
              <p className="mt-1 text-xs text-slate">Programada: {new Date(m.due_at).toLocaleString('pt-BR')}</p>
            </div>
            <span className="rounded-full bg-paper px-3 py-1 text-xs text-slate">{statusLabel[m.state]}</span>
          </li>
        )}</ul>}
    </section>
  </div>
}
