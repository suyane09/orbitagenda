import { Navigate, Outlet } from 'react-router-dom'
import { useAccount } from './AccountProvider'

/** Painel exige um vínculo ativo. Sem ele: superadmin → plataforma; demais → onboarding. */
export function RequireEstablishment() {
  const { current, isSuperadmin } = useAccount()
  if (!current) return <Navigate to={isSuperadmin ? '/plataforma' : '/criar-estabelecimento'} replace />
  return <Outlet />
}

/** A UI esconde o que não é do usuário, mas a barreira real é o RLS no banco. */
export function RequireSuperadmin() {
  const { isSuperadmin } = useAccount()
  if (!isSuperadmin) return <Navigate to="/app" replace />
  return <Outlet />
}
