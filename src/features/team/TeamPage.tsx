import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/features/establishments/AccountProvider'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { cancelInvite, inviteMember, loadTeam, setMemberActive, type TeamInvite, type TeamMember } from './api'

const panel = 'rounded-xl border border-hairline bg-surface p-5 sm:p-6'
function inviteStatus(row:TeamInvite): string {
  if (row.accepted_at) return 'Aceito'
  if (row.revoked_at) return 'Cancelado'
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'Expirado'
  return 'Aguardando'
}

export default function TeamPage() {
  const { current } = useAccount()
  const estId = current?.establishment.id ?? ''
  const owner = current?.role === 'owner'
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites,setInvites]=useState<TeamInvite[]>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState('')
  const [email,setEmail]=useState('')
  const [link,setLink]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const refresh = useCallback(async () => {
    if (!owner || !estId) return
    setLoading(true);setError('')
    try { const result=await loadTeam(estId);setMembers(result.members);setInvites(result.invites) }
    catch(e) { setError(describeError(e,'Não foi possível carregar a equipe.')) }
    finally {setLoading(false)}
  },[owner,estId])
  useEffect(()=>{void refresh()},[refresh])

  async function create(e:FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy('invite');setError('');setNotice('');setLink('')
    try {
      const token=await inviteMember(estId,email.trim().toLowerCase())
      setLink(`${window.location.origin}/aceitar-convite/${token}`)
      setEmail('')
      setNotice('Convite criado. Copie o link agora e envie apenas ao destinatário indicado. Ele não será exibido novamente.')
      await refresh()
    } catch(err) {setError(describeError(err,'Não foi possível criar o convite.'))}
    finally {setBusy('')}
  }
  async function changeMember(member:TeamMember) {
    if (busy || !window.confirm(member.is_active ? 'Desativar o acesso deste funcionário?' : 'Reativar o acesso deste funcionário?')) return
    setBusy(member.id);setError('');setNotice('')
    try {await setMemberActive(estId,member.id,!member.is_active);await refresh();setNotice('Acesso atualizado.')}
    catch(err){setError(describeError(err,'Não foi possível alterar o acesso.'))}
    finally{setBusy('')}
  }
  async function revoke(invite:TeamInvite) {
    if(busy || !window.confirm('Cancelar este convite? O link deixará de funcionar.'))return
    setBusy(invite.id);setError('')
    try{await cancelInvite(invite.id);await refresh();setNotice('Convite cancelado.')}
    catch(err){setError(describeError(err,'Não foi possível cancelar o convite.'))}
    finally{setBusy('')}
  }
  if(!owner)return <div className={panel}><h1 className="font-display text-xl font-semibold">Equipe</h1><p className="mt-2 text-slate">Somente o proprietário pode gerenciar os acessos.</p></div>
  return <div className="w-full min-w-0 space-y-5 px-4 py-6 pb-12 sm:px-6 lg:px-8 lg:py-8">
    <header>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-slate">Configurações do estabelecimento</p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Equipe e acessos</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate">Convide funcionários com segurança e controle quem pode operar a agenda. Somente proprietários acessam financeiro, comissões e relatórios.</p>
    </header>
    {error&&<p role="alert" className="rounded-lg border border-danger/25 bg-danger-soft p-4 text-sm text-danger">{error}</p>}
    {notice&&<p role="status" className="rounded-lg border border-ok/20 bg-ok-soft p-4 text-sm text-ok">{notice}</p>}
    <section className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-lg font-semibold">Convidar funcionário</h2>
          <p className="mt-1 text-sm text-slate">O convite vale por 7 dias e só funciona com uma conta que tenha o mesmo e-mail confirmado.</p></div>
        <Link to="/app" className="text-sm font-medium text-orbit hover:underline">Voltar ao painel</Link>
      </div>
      <form onSubmit={e=>void create(e)} className="mt-5 flex flex-col items-end gap-3 sm:flex-row">
        <div className="w-full flex-1"><TextField label="E-mail do funcionário" type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="funcionario@empresa.com.br" /></div>
        <Button type="submit" loading={busy==='invite'} disabled={!!busy}>Gerar convite</Button>
      </form>
      {link&&<div className="mt-5 rounded-xl border border-orbit/25 bg-orbit-soft p-4">
        <p className="font-medium text-sm">Link privado pronto para enviar</p>
        <p className="mt-1 text-xs text-slate">Compartilhe apenas com a pessoa convidada. O link permite aceitar o convite somente para o e-mail indicado.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input readOnly value={link} aria-label="Link de convite" onFocus={e=>e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm" />
          <Button type="button" variant="outline" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice('Link copiado.')).catch(()=>setNotice('Selecione o link acima e copie manualmente.'))}>Copiar link</Button>
        </div>
      </div>}
    </section>
    <section className={panel}>
      <h2 className="font-display text-lg font-semibold">Membros do estabelecimento</h2>
      {loading?<p className="mt-4 text-sm text-slate">Carregando equipe…</p>:
      <div className="mt-4 divide-y divide-hairline">
        {members.map(m=><div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="font-medium">{m.name}</p>
            <p className="mt-1 text-xs text-slate">{m.role==='owner'?'Proprietário':'Funcionário'} · {m.is_active?'Acesso ativo':'Acesso desativado'}</p>
          </div>
          {m.role==='staff'&&<Button type="button" variant="outline" disabled={!!busy} loading={busy===m.id} onClick={()=>void changeMember(m)}>{m.is_active?'Desativar':'Reativar'}</Button>}
        </div>)}
      </div>}
    </section>
    <section className={panel}>
      <h2 className="font-display text-lg font-semibold">Histórico de convites</h2>
      {!invites.length?<p className="mt-3 text-sm text-slate">Nenhum convite criado ainda.</p>:
      <div className="mt-4 divide-y divide-hairline">
        {invites.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <div className="min-w-0"><p className="break-all text-sm font-medium">{i.email}</p><p className="mt-1 text-xs text-slate">{inviteStatus(i)} · Expira {new Date(i.expires_at).toLocaleDateString('pt-BR')}</p></div>
          {inviteStatus(i)==='Aguardando'&&<Button type="button" variant="outline" disabled={!!busy} loading={busy===i.id} onClick={()=>void revoke(i)}>Cancelar</Button>}
        </div>)}
      </div>}
    </section>
  </div>
}
