import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon, type IconName } from '@/components/ui/Icon'
import { OrbitMark, Wordmark } from '@/components/ui/Logo'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAccount } from '@/features/establishments/AccountProvider'
import { roleLabel } from '@/lib/labels'

interface NavEntry { label: string; to: string; icon: IconName; end?: boolean }

const operation: NavEntry[] = [
  { label: 'Visão geral', to: '/app', icon: 'home', end: true },
  { label: 'Agenda', to: '/app/agenda', icon: 'calendar' },
  { label: 'Clientes', to: '/app/clientes', icon: 'users' },
  { label: 'Financeiro', to: '/app/financeiro', icon: 'cash' },
  { label: 'Comissões', to: '/app/comissoes', icon: 'cash' },
  { label: 'Relatórios', to: '/app/relatorios', icon: 'chart' },
]
const catalog: NavEntry[] = [
  { label: 'Serviços', to: '/app/servicos', icon: 'service' },
  { label: 'Profissionais', to: '/app/profissionais', icon: 'user' },
  { label: 'Horários', to: '/app/horarios', icon: 'clock' },
  { label: 'Equipe', to: '/app/equipe', icon: 'users' },
]

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'

function NavItem({ entry, onNavigate }: { entry: NavEntry; onNavigate?: (() => void) | undefined }) {
  return (
    <NavLink to={entry.to} end={entry.end} onClick={onNavigate}
      className={({ isActive }) => `group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150 motion-reduce:transition-none ${isActive ? 'bg-white/[0.07] font-medium text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white'}`}>
      {({ isActive }) => (
        <>
          <span aria-hidden="true" className={`absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-orbit-glow transition-opacity duration-150 motion-reduce:transition-none ${isActive ? 'opacity-100' : 'opacity-0'}`} />
          <Icon name={entry.icon} className={`size-4 shrink-0 transition-colors duration-150 motion-reduce:transition-none ${isActive ? 'text-orbit-glow' : 'text-white/40 group-hover:text-white/70'}`} />
          {entry.label}
        </>
      )}
    </NavLink>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const { profile, memberships, current, isSuperadmin, selectEstablishment } = useAccount()
  const ownedCount = memberships.filter((m) => m.role === 'owner').length
  const name = profile?.full_name ?? 'Usuário'

  return (
    <div className="flex h-full flex-col overflow-y-auto border-r border-white/5 bg-ink px-3 pb-3 pt-4 text-white">
      <div className="px-1.5"><Wordmark tone="dark" /></div>

      {current && (
        <div className="mt-5 flex items-center gap-2.5 rounded-md border border-white/10 bg-white/[0.03] p-2">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded bg-white/10 text-xs font-semibold">{initials(current.establishment.name)}</span>
          <div className="min-w-0 flex-1 leading-tight">
            {memberships.length > 1 ? (
              <select aria-label="Trocar de estabelecimento" value={current.establishment.id}
                onChange={(e) => selectEstablishment(e.target.value)}
                className="w-full truncate rounded bg-transparent text-sm font-medium text-white focus:outline-none">
                {memberships.map((m) => <option key={m.id} value={m.establishment.id} className="text-ink">{m.establishment.name}</option>)}
              </select>
            ) : (
              <p className="truncate text-sm font-medium">{current.establishment.name}</p>
            )}
            <p className="mt-0.5 text-xs text-white/45">{roleLabel[current.role]}</p>
          </div>
        </div>
      )}

      <nav aria-label="Principal" className="mt-6 flex-1">
        {current && (
          <>
            <p className="px-2.5 pb-1.5 text-xs text-white/30">Operação</p>
            <div className="space-y-0.5">{operation.filter((e) => !['/app/financeiro', '/app/comissoes', '/app/relatorios'].includes(e.to) || current.role === 'owner').map((e) => <NavItem key={e.to} entry={e} onNavigate={onNavigate} />)}</div>
            <p className="px-2.5 pb-1.5 pt-5 text-xs text-white/30">Catálogo</p>
            <div className="space-y-0.5">{catalog.filter(e => e.to !== '/app/equipe' || current.role === 'owner').map((e) => <NavItem key={e.to} entry={e} onNavigate={onNavigate} />)}</div>
          </>
        )}
        {isSuperadmin && (
          <div className="mt-5 space-y-0.5">
            <p className="px-2.5 pb-1.5 text-xs text-white/30">Administração</p>
            <NavItem entry={{ label: 'Plataforma', to: '/plataforma', icon: 'shield' }} onNavigate={onNavigate} />
          </div>
        )}
        {ownedCount < 3 && (
          <Link to="/criar-estabelecimento" onClick={onNavigate} className="mt-5 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-white/45 transition-colors duration-150 hover:bg-white/[0.04] hover:text-white motion-reduce:transition-none">
            <Icon name="plus" className="size-4 shrink-0" />Novo estabelecimento
          </Link>
        )}
      </nav>

      <div className="mt-4 flex items-center gap-2.5 border-t border-white/10 pt-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initials(name)}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-white/45">{isSuperadmin ? 'Superadmin da plataforma' : user?.email}</p>
        </div>
        <button type="button" onClick={() => void signOut()} aria-label="Sair" title="Sair"
          className="grid size-8 shrink-0 place-items-center rounded-md text-white/50 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white motion-reduce:transition-none">
          <Icon name="logout" className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { current } = useAccount()
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block"><Sidebar /></aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline bg-surface pl-4 pr-2 pt-[env(safe-area-inset-top)] lg:hidden">
          {current ? (
            <span className="inline-flex min-w-0 items-center gap-2.5">
              <OrbitMark size={24} />
              <span className="truncate font-display text-[0.95rem] font-semibold tracking-tight">{current.establishment.name}</span>
            </span>
          ) : <Wordmark />}
          <button type="button" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}
            className="grid size-10 shrink-0 place-items-center rounded-md hover:bg-ink/5">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto"><Outlet /></main>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]"><Sidebar onNavigate={() => setOpen(false)} /></div>
        </div>
      )}
    </div>
  )
}