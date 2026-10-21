import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenLoader } from '@/components/ui/States'
import { AccountProvider } from '@/features/establishments/AccountProvider'
import { useAuth } from './AuthProvider'

/** Exige sessão. A conta (perfil + vínculos) só é carregada depois disso. */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return <AccountProvider><Outlet /></AccountProvider>
}

/** Telas públicas (entrar/cadastro): quem já está logado vai direto ao painel. */
export function PublicOnly() {
  const { session, loading, recovery } = useAuth()
  if (loading) return <FullScreenLoader />
  if (session && !recovery) return <Navigate to="/app" replace />
  return <Outlet />
}
