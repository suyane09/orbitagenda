import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAccount } from './AccountProvider'
import { supabase } from '@/lib/supabase'

type BillingGuardState = {
  id: string
  blocked: boolean
  error: boolean
}

/**
 * Consulta a decisão do banco (mesma regra usada pelas políticas RLS).
 * Funciona também para funcionários, que não têm acesso de leitura à
 * tabela de assinaturas. A interface não substitui as políticas RLS.
 */
export function RequireEstablishment() {
  const { current, isSuperadmin } = useAccount()
  const location = useLocation()
  const establishmentId = current?.establishment.id
  const [state, setState] = useState<BillingGuardState | null>(null)

  useEffect(() => {
    if (!establishmentId || isSuperadmin) return
    let cancelled = false
    void supabase.rpc('is_establishment_billing_blocked', {
      p_establishment_id: establishmentId,
    }).then(({ data, error }) => {
      if (cancelled) return
      setState({
        id: establishmentId,
        blocked: data === true,
        error: !!error || typeof data !== 'boolean',
      })
    })
    return () => { cancelled = true }
  }, [establishmentId, isSuperadmin, location.pathname])

  // Administração da plataforma e operação de um estabelecimento são áreas distintas.
  // Uma pessoa que também seja proprietária de um estabelecimento usa somente
  // a Central da Plataforma enquanto tiver o papel de superadministradora.
  if (isSuperadmin) {
    return <Navigate to="/plataforma" replace />
  }

  if (!current) {
    return <Navigate to="/criar-estabelecimento" replace />
  }

  // A área de assinatura permanece acessível para regularização.
  if (!isSuperadmin && location.pathname !== '/app/assinatura') {
    if (!state || state.id !== establishmentId) {
      return <div className="mx-auto mt-16 max-w-xl p-8 text-center text-sm text-slate">
        Validando acesso ao estabelecimento...
      </div>
    }

    if (state.error) {
      return <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
        <h1 className="font-display text-2xl font-semibold">Não foi possível validar a assinatura</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate">Tente novamente em instantes. Seus dados permanecem preservados.</p>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-6 inline-flex rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-white">
          Tentar novamente
        </button>
      </div>
    }

    if (state.blocked) {
      return <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
        <h1 className="font-display text-2xl font-semibold">Assinatura com acesso suspenso</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate">
          O prazo de tolerância terminou ou a assinatura foi suspensa.
          Seus dados continuam preservados. O proprietário pode regularizar a cobrança para restabelecer o acesso.
        </p>
        <Link to="/app/assinatura" className="mt-6 inline-flex rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-white">
          Ver plano e cobrança
        </Link>
      </div>
    }
  }

  return <Outlet />
}

export function RequireSuperadmin() {
  const { isSuperadmin } = useAccount()
  if (!isSuperadmin) return <Navigate to="/app" replace />
  return <Outlet />
}
