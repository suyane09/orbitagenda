import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useAccount } from '@/features/establishments/AccountProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { describeError } from '@/lib/errors'
import { acceptInvite } from './api'

export default function AcceptInvitePage() {
  const { token } = useParams<{token:string}>()
  const { user } = useAuth()
  const { refresh } = useAccount()
  const navigate = useNavigate()
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState(false)

  async function accept() {
    if(!token || busy) return
    setBusy(true);setError('')
    try {
      const establishmentId = await acceptInvite(token)
      await refresh(establishmentId)
      setSuccess(true)
    } catch(e) {
      setError(describeError(e,'O convite expirou, já foi utilizado ou não pertence ao e-mail desta conta.'))
    } finally {setBusy(false)}
  }
  return <main className="flex min-h-dvh items-center justify-center bg-paper p-5">
    <div className="w-full max-w-lg rounded-2xl border border-hairline bg-surface p-7 shadow-sm sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orbit">Orbit Agenda · Equipe</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Convite para colaborar</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate">O proprietário convidou você para trabalhar no painel de um estabelecimento. Para aceitar, sua conta precisa ter o mesmo e-mail confirmado do convite.</p>
      <div className="mt-5 rounded-xl bg-paper p-4 text-sm"><p className="text-xs text-slate">Conta conectada</p><p className="mt-1 break-all font-medium">{user?.email ?? 'Sem e-mail'}</p></div>
      {error&&<p role="alert" className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {success ? <div className="mt-6">
        <p className="font-medium text-ok">Acesso concedido. Seu estabelecimento já está disponível.</p>
        <Button type="button" onClick={()=>navigate('/app',{replace:true})}>Entrar no painel</Button>
      </div> : <div className="mt-6 space-y-3">
        <Button type="button" full onClick={()=>void accept()} loading={busy} disabled={!token || token.length!==64}>Aceitar convite</Button>
        <p className="text-xs leading-relaxed text-slate">Se você acabou de criar sua conta, confirme primeiro o e-mail e volte a este link. Convites expiram após 7 dias.</p>
        <Link to="/app" className="block text-center text-sm font-medium text-orbit hover:underline">Voltar para o painel</Link>
      </div>}
    </div>
  </main>
}
