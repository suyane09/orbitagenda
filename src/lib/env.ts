/** Variáveis públicas. Qualquer VITE_* vai para o bundle: nunca use chave secreta. */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Detecta service_role / secret key por engano (JWT legado ou formato sb_secret_). */
export function isSecretKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true
  const part = value.split('.')[1]
  if (!part) return false
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role === 'service_role'
  } catch {
    return false
  }
}

export function getEnvError(): string | null {
  if (!url || !key) {
    return 'Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).'
  }
  if (isSecretKey(key)) {
    return 'A chave configurada é secreta (service_role). Use somente a anon/publishable key no frontend e troque a chave exposta no painel do Supabase.'
  }
  return null
}

export const env = { supabaseUrl: url ?? 'http://localhost:54321', supabaseKey: key ?? 'missing' }
