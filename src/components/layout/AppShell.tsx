import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Wordmark } from '@/components/ui/Logo'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAccount } from '@/features/establishments/AccountProvider'
import { roleLabel } from '@/lib/labels'

const items: Array<{ label: string; to?: string }> = [
  { label: 'Agenda' },
  { label: 'Clientes', to: '/app/clientes' },
  { label: 'Serviços', to: '/app/servicos' },
  { label: 'Profissionais', to: '/app/profissionais' },
  { label: 'Horários', to: '/app/horarios' },
]

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const { profile, memberships, current, isSuperadmin, selectEstablishment } = useAccount()
  const ownedCount = memberships.filter((m) => m.role === 'owner').length
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex h-10 items-center rounded-control px-3 text-[0.95rem] transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'}`

  return (
    <div className="flex h-full flex-col bg-ink p-4 text-white">
      <div className="px-1 pt-1"><Wordmark tone="dark" /></div>

      {current && (
        <div className="mt-7 rounded-control bg-white/5 p-3">
          <p className="text-xs text-white/50">Estabelecimento</p>
          {memberships.length > 1 ? (
            <select aria-label="Trocar de estabelecimento" value={current.establishment.id}
              onChange={(e) => selectEstablishment(e.target.value)}
              className="mt-1 w-full rounded bg-transparent text-[0.95rem] font-medium text-white focus:outline-none">
              {memberships.map((m) => <option key={m.id} value={m.establishment.id} className="text-ink">{m.establishment.name}</option>)}
            </select>
          ) : (
            <p className="mt-1 truncate text-[0.95rem] font-medium">{current.establishment.name}</p>
          )}
          <p className="mt-0.5 text-xs text-white/50">{roleLabel[current.role]}</p>
        </div>
      )}

      <nav aria-label="Principal" className="mt-6 flex-1 space-y-1">
        {current && <NavLink to="/app" end className={link} onClick={onNavigate}>Visão geral</NavLink>}
        {current && items.map((i) => i.to ? (
          <NavLink key={i.label} to={i.to} className={link} onClick={onNavigate}>{i.label}</NavLink>
        ) : (
          <span key={i.label} aria-disabled="true" className="flex h-10 cursor-not-allowed items-center justify-between px-3 text-[0.95rem] text-white/30">
            {i.label}<span className="text-xs">em breve</span>
          </span>
        ))}
        {isSuperadmin && <NavLink to="/plataforma" className={link} onClick={onNavigate}>Plataforma</NavLink>}
        {ownedCount < 3 && (
          <Link to="/criar-estabelecimento" onClick={onNavigate} className="mt-3 flex h-10 items-center rounded-control border border-white/15 px-3 text-sm text-white/70 hover:border-white/30 hover:text-white">
            Novo estabelecimento
          </Link>
        )}
      </nav>

      <div className="border-t border-white/10 pt-4">
        <p className="truncate text-sm font-medium">{profile?.full_name ?? 'Usuário'}</p>
        <p className="truncate text-xs text-white/50">{user?.email}</p>
        {isSuperadmin && <p className="mt-1 text-xs text-orbit-glow">Superadmin da plataforma</p>}
        <button type="button" onClick={() => void signOut()} className="mt-3 h-9 w-full rounded-control border border-white/15 text-sm text-white/80 hover:bg-white/5">Sair</button>
      </div>
    </div>
  )
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block"><Sidebar /></aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-hairline bg-surface px-4 lg:hidden">
          <Wordmark />
          <button type="button" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}
            className="grid size-10 place-items-center rounded-control hover:bg-ink/5">
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
