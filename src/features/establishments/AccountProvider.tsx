import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ErrorState, FullScreenLoader } from '@/components/ui/States'
import { Button } from '@/components/ui/Button'
import { describeError } from '@/lib/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Membership, Profile } from '@/types/models'
import { loadAccount } from './api'

interface AccountState {
  profile: Profile | null
  memberships: Membership[]
  isSuperadmin: boolean
  /** Vínculo atual, SEMPRE escolhido entre os que o servidor devolveu. */
  current: Membership | null
  selectEstablishment: (establishmentId: string) => void
  refresh: (selectId?: string) => Promise<void>
}

const AccountContext = createContext<AccountState | null>(null)
const STORAGE_KEY = 'orbit:establishment'

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
function writeStored(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* modo privado: ignorar */ }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const userId = user?.id ?? ''
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<{ profile: Profile | null; memberships: Membership[]; isSuperadmin: boolean }>({ profile: null, memberships: [], isSuperadmin: false })
  const [selectedId, setSelectedId] = useState<string | null>(readStored)

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const next = await loadAccount(userId)
      setData(next)
      if (selectId) { setSelectedId(selectId); writeStored(selectId) }
      setError('')
      setStatus('ready')
    } catch (e) {
      setError(describeError(e, 'Não foi possível carregar sua conta.'))
      setStatus('error')
    }
  }, [userId])

  useEffect(() => {
    setStatus('loading')
    void refresh()
  }, [refresh])

  const current = useMemo(
    () => data.memberships.find((m) => m.establishment.id === selectedId) ?? data.memberships[0] ?? null,
    [data.memberships, selectedId],
  )

  const value = useMemo<AccountState>(() => ({
    ...data,
    current,
    selectEstablishment: (id) => {
      if (!data.memberships.some((m) => m.establishment.id === id)) return
      setSelectedId(id); writeStored(id)
    },
    refresh,
  }), [data, current, refresh])

  if (status === 'loading') return <FullScreenLoader label="Carregando sua conta…" />
  if (status === 'error') {
    return <ErrorState title="Não foi possível abrir sua conta" message={error}
      onRetry={() => { setStatus('loading'); void refresh() }}
      action={<Button variant="outline" onClick={() => void signOut()}>Sair</Button>} />
  }
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccount(): AccountState {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount deve ser usado dentro de <AccountProvider>')
  return ctx
}
