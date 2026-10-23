// Utilidades de segurança da Edge Function public-booking. Sem APIs do Deno: recebem tudo por parâmetro (testável).

/** Valida IPv4/IPv6 (sem aceitar lixo) e normaliza para minúsculas. */
function parseIp(raw: string | null | undefined): string | null {
  const ip = (raw ?? '').trim()
  if (!ip || ip.length > 45) return null
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip)
  const v6 = ip.includes(':') && /^[0-9a-fA-F:.]+$/.test(ip) && (ip.match(/::/g)?.length ?? 0) <= 1 && ip.split(':').length <= 8
  return v4 || v6 ? ip.toLowerCase() : null
}

/**
 * IP do cliente para rate limit/Turnstile. Só usa cabeçalhos que a infraestrutura (Cloudflare/gateway do
 * Supabase) sobrescreve ou anexa: cf-connecting-ip, depois x-real-ip. Como último recurso usa o ÚLTIMO item de
 * x-forwarded-for (o anexado pelo proxy confiável); o primeiro item é controlado pelo cliente e nunca é usado.
 * Sem IP confiável retorna 'unknown' (bucket compartilhado: falha fechada; limites por telefone/estabelecimento seguem valendo).
 */
export function clientIp(h: Pick<Headers, 'get'>): string {
  const xff = h.get('x-forwarded-for')?.split(',').pop()
  return parseIp(h.get('cf-connecting-ip')) ?? parseIp(h.get('x-real-ip')) ?? parseIp(xff) ?? 'unknown'
}

/** HMAC-SHA256 em hex: identifica IP/telefone sem guardá-los em claro. Chaves ficam com o prefixo do escopo. */
export async function hashKey(secret: string, scope: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${scope}:${value}`)))
  return `${scope}:` + Array.from(sig.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const TURNSTILE_ACTION = 'public_booking'

export type TurnstileResult = 'ok' | 'failed' | 'unavailable'

/** Valida o token no servidor (siteverify). Fecha por padrão: qualquer dúvida = não cria reserva. */
export async function verifyTurnstile(opts: {
  secret: string; token: string; ip: string; allowedHostnames?: string[]; fetchFn?: typeof fetch
}): Promise<TurnstileResult> {
  const { secret, token, ip, allowedHostnames = [], fetchFn = fetch } = opts
  if (!token || token.length > 2048) return 'failed'
  const form = new URLSearchParams({ secret, response: token, idempotency_key: crypto.randomUUID() })
  if (ip !== 'unknown') form.set('remoteip', ip)
  try {
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return 'unavailable'
    const out = await res.json() as { success?: boolean; action?: string; hostname?: string }
    if (out.success !== true) return 'failed'
    if (out.action !== TURNSTILE_ACTION) return 'failed'
    if (allowedHostnames.length && !allowedHostnames.includes(String(out.hostname ?? '').toLowerCase())) return 'failed'
    return 'ok'
  } catch { return 'unavailable' }
}
