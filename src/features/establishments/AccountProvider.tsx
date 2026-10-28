import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ErrorState, FullScreenLoader } from '@/components/ui/States'
import { Button } from '@/components/ui/Button'
import { describeError } from '@/lib/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Membership, Profile } from '@/types/models'
import { loadAccount } from './api'
import { pickCurrent } from './portalAccess'

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
const keyFor = (userId: string) => `${STORAGE_KEY}:${userId}`

function readStored(userId: string): string | null {
  try { return userId ? localStorage.getItem(keyFor(userId)) : null } catch { return null }
}
function writeStored(userId: string, id: string) {
  try { if (userId) localStorage.setItem(keyFor(userId), id) } catch { /* modo privado: ignorar */ }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const userId = user?.id ?? ''
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<{ profile: Profile | null; memberships: Membership[]; isSuperadmin: boolean }>({ profile: null, memberships: [], isSuperadmin: false })
  const [selectedId, setSelectedId] = useState<string | null>(() => readStored(userId))

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const next = await loadAccount(userId)
      setData(next)
      if (selectId) { setSelectedId(selectId); writeStored(userId, selectId) }
      setError('')
      setStatus('ready')
    } catch (e) {
      setError(describeError(e, 'Não foi possível carregar sua conta.'))
      setStatus('error')
    }
  }, [userId])

  useEffect(() => {
    setData({ profile: null, memberships: [], isSuperadmin: false })
    setSelectedId(readStored(userId))
    setStatus('loading')
    void refresh()
  }, [refresh, userId])

  const current = useMemo(
    () => pickCurrent(data.memberships, data.isSuperadmin, selectedId),
    [data.memberships, data.isSuperadmin, selectedId],
  )

  const value = useMemo<AccountState>(() => ({
    ...data,
    current,
    selectEstablishment: (id) => {
      if (!data.memberships.some((m) => m.establishment.id === id)) return
      setSelectedId(id); writeStored(userId, id)
    },
    refresh,
  }), [data, current, refresh, userId])

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
