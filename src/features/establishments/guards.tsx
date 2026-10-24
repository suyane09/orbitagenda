import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAccount } from './AccountProvider'
import { supabase } from '@/lib/supabase'

/**
 * Aviso/bloqueio de navegação. A proteção de dados também precisa ser aplicada
 * pelas políticas RLS no banco: uma guarda React sozinha não é segurança.
 */
export function RequireEstablishment() {
  const { current, isSuperadmin } = useAccount()
  const location = useLocation()
  const establishmentId = current?.establishment.id
  const [state, setState] = useState<{ id: string; blocked: boolean; error: boolean } | null>(null)

  useEffect(() => {
    if (!establishmentId || isSuperadmin) return
    let cancelled = false
    void supabase.from('establishment_subscriptions')
      .select('status,payment_due_at,asaas_subscription_id')
      .eq('establishment_id', establishmentId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setState({ id: establishmentId, blocked: false, error: true }); return }
        // O vencimento deve ser preenchido a partir da cobrança real do Asaas.
        // Sem vencimento confirmado, nunca bloquear por inferência.
        const due = data?.payment_due_at ? Date.parse(data.payment_due_at) : NaN
        const graceDeadline = due + 5 * 86400000
        const blocked = !!data?.asaas_subscription_id
          && data.status === 'past_due'
          && Number.isFinite(due)
          && Date.now() > graceDeadline
        setState({ id: establishmentId, blocked, error: false })
      })
    return () => { cancelled = true }
  }, [establishmentId, isSuperadmin, location.pathname])

  if (!current) return <Navigate to={isSuperadmin ? '/plataforma' : '/criar-estabelecimento'} replace />
  if (!isSuperadmin && state?.id === establishmentId && state.blocked && location.pathname !== '/app/assinatura') {
    return <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
      <h1 className="font-display text-2xl font-semibold">Assinatura com pagamento pendente</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate">O prazo de tolerância de cinco dias terminou. Seus dados permanecem preservados. Regularize a mensalidade para voltar a utilizar o sistema.</p>
      <Link to="/app/assinatura" className="mt-6 inline-flex rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-white">Ver plano e cobrança</Link>
    </div>
  }
  return <Outlet />
}

export function RequireSuperadmin() {
  const { isSuperadmin } = useAccount()
  if (!isSuperadmin) return <Navigate to="/app" replace />
  return <Outlet />
}
