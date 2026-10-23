import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

/** Cloudflare Turnstile (sem dependências). Só a chave PÚBLICA (site key) vive no navegador; a validação é no servidor. */
interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

export const TURNSTILE_ACTION = 'public_booking'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC; s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => { scriptPromise = null; s.remove(); reject(new Error('turnstile_script')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export interface TurnstileHandle { reset: () => void }

export function TurnstileWidget({ siteKey, onToken, onUnavailable, handle }: {
  siteKey: string
  /** token válido, ou null quando expirou/falhou (o token é de uso único). */
  onToken: (token: string | null) => void
  onUnavailable: () => void
  handle?: Ref<TurnstileHandle>
}) {
  const box = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const cb = useRef({ onToken, onUnavailable })
  cb.current = { onToken, onUnavailable }

  useImperativeHandle(handle, () => ({
    reset: () => { cb.current.onToken(null); if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current) },
  }), [])

  useEffect(() => {
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !box.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(box.current, {
        sitekey: siteKey, action: TURNSTILE_ACTION, language: 'pt-br', theme: 'light',
        callback: (t: string) => cb.current.onToken(t),
        'expired-callback': () => cb.current.onToken(null),
        'timeout-callback': () => cb.current.onToken(null),
        'error-callback': () => { cb.current.onToken(null); cb.current.onUnavailable() },
      })
    }).catch(() => { if (!cancelled) cb.current.onUnavailable() })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [siteKey])

  return <div ref={box} className="flex min-h-[65px] justify-center" aria-label="Verificação de segurança" />
}
