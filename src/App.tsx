import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ErrorState, FullScreenLoader } from '@/components/ui/States'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { PublicOnly, RequireAuth } from '@/features/auth/guards'
import { RequireEstablishment, RequireSuperadmin } from '@/features/establishments/guards'
import { getEnvError } from '@/lib/env'

const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const SignUpPage = lazy(() => import('@/features/auth/SignUpPage'))
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'))
const OnboardingPage = lazy(() => import('@/features/establishments/OnboardingPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const PlatformPage = lazy(() => import('@/features/platform/PlatformPage'))
const WhatsAppPage = lazy(() => import('@/features/whatsapp/WhatsAppPage'))
const ServicesPage = lazy(() => import('@/features/services/ServicesPage'))
const ProfessionalsPage = lazy(() => import('@/features/professionals/ProfessionalsPage'))
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage'))
const AgendaPage = lazy(() => import('@/features/appointments/AgendaPage'))
const SchedulePage = lazy(() => import('@/features/schedule/SchedulePage'))
const FinancePage = lazy(() => import('@/features/finance/FinancePage'))
const CommissionsPage = lazy(() => import('@/features/commissions/CommissionsPage'))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
const TeamPage = lazy(() => import('@/features/team/TeamPage'))
const SubscriptionPage = lazy(() => import('@/features/subscriptions/SubscriptionPage'))
const EstablishmentSettingsPage = lazy(() => import('@/features/establishments/EstablishmentSettingsPage'))
const AcceptInvitePage = lazy(() => import('@/features/team/AcceptInvitePage'))
const PublicBookingPage = lazy(() => import('@/features/public-booking/PublicBookingPage'))

function NotFound() {
  return <ErrorState title="Página não encontrada" message="O endereço não existe ou foi movido." action={<Link to="/app" className="inline-flex h-11 items-center rounded-control border border-hairline px-5 text-sm font-medium">Ir ao painel</Link>} />
}

export default function App() {
  const envError = getEnvError()
  if (envError) return <ErrorState title="Configuração incompleta" message={envError} />

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route element={<PublicOnly />}>
                <Route path="/entrar" element={<LoginPage />} />
                <Route path="/cadastro" element={<SignUpPage />} />
                <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
              </Route>
              <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

              <Route element={<RequireAuth />}>
                <Route path="/criar-estabelecimento" element={<OnboardingPage />} />
                <Route path="/aceitar-convite/:token" element={<AcceptInvitePage />} />
                <Route element={<AppShell />}>
                  <Route element={<RequireEstablishment />}>
                    <Route path="/app" element={<DashboardPage />} />
                    <Route path="/app/servicos" element={<ServicesPage />} />
                    <Route path="/app/profissionais" element={<ProfessionalsPage />} />
                    <Route path="/app/clientes" element={<CustomersPage />} />
                    <Route path="/app/agenda" element={<AgendaPage />} />
                    <Route path="/app/horarios" element={<SchedulePage />} />
                    <Route path="/app/financeiro" element={<FinancePage />} />
                    <Route path="/app/comissoes" element={<CommissionsPage />} />
                    <Route path="/app/relatorios" element={<ReportsPage />} />
                    <Route path="/app/equipe" element={<TeamPage />} />
                    <Route path="/app/assinatura" element={<SubscriptionPage />} />
                    <Route path="/app/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/app/estabelecimento" element={<EstablishmentSettingsPage />} />
                  </Route>
                  <Route element={<RequireSuperadmin />}>
                    <Route path="/plataforma" element={<PlatformPage />} />
                    <Route path="/plataforma/whatsapp-teste" element={<WhatsAppPage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="/agendar/:slug" element={<PublicBookingPage />} />
              <Route path="/" element={<Navigate to="/app" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
