import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { clientIp, hashKey, verifyTurnstile } from './security.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Cache-Control': 'no-store',
}
const respond = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { ...headers, ...extra } })
const tooMany = (retryAfter: number) =>
  respond({ error: 'rate_limited', retry_after: retryAfter }, 429, { 'Retry-After': String(retryAfter) })

// Limites (janela fixa, contadores persistentes no Postgres via public.check_rate_limit).
const LIMITS = {
  read:      { limit: 120, window: 60 },          // catalog/availability por IP
  bookIpMin: { limit: 5,   window: 600 },         // tentativas de reserva por IP / 10 min (inclui falhas de CAPTCHA)
  bookIpDay: { limit: 30,  window: 86400 },       // por IP / dia
  bookPhone: { limit: 3,   window: 3600 },        // por telefone+estabelecimento / hora
  bookPhoneDay: { limit: 6, window: 86400 },      // por telefone+estabelecimento / dia
  bookEst:   { limit: 200, window: 3600 },        // por estabelecimento / hora (freio global)
}
const validSlug = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-z0-9-]{3,80}$/.test(s)
const validId = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
const validDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + 'T12:00:00Z'))

export default {
  fetch: withSupabase({ auth: ['publishable'] }, async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405)
    if (Number(req.headers.get('content-length') || 0) > 8192)
      return respond({ error: 'payload_too_large' }, 413)

    let body: Record<string, unknown>
    try {
      body = await req.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error()
    } catch { return respond({ error: 'invalid_json' }, 400) }

    const { action, slug } = body
    if (!validSlug(slug)) return respond({ error: 'invalid_slug' }, 400)
    const db = ctx.supabaseAdmin
    const ip = clientIp(req.headers)
    // Sal das chaves de limite. Cai para o segredo do Turnstile se RATE_LIMIT_SALT não existir.
    const salt = Deno.env.get('RATE_LIMIT_SALT') ?? Deno.env.get('TURNSTILE_SECRET_KEY') ?? ''

    /** Consome 1 uso do contador. Retorna segundos de espera se estourou; 'error' se o armazenamento falhou. */
    async function limited(scope: string, value: string, rule: { limit: number; window: number }): Promise<number | 'error' | null> {
      try {
        const key = await hashKey(salt, scope, value)
        const { data, error } = await db.rpc('check_rate_limit', { p_key: key, p_limit: rule.limit, p_window_seconds: rule.window })
        const row = Array.isArray(data) ? data[0] : data
        if (error || !row) return 'error'
        return row.allowed ? null : Number(row.retry_after) || rule.window
      } catch { return 'error' }
    }
    // Leituras: limite generoso por IP (se o armazenamento falhar, não derruba a página pública).
    if (action === 'catalog' || action === 'availability') {
      const r = await limited('read', ip, LIMITS.read)
      if (typeof r === 'number') return tooMany(r)
    }
    const { data: est, error: estError } = await db.from('establishments')
      .select('id,name,slug,timezone,business_type').eq('slug', slug).maybeSingle()
    if (estError) return respond({ error: 'server_error' }, 500)
    if (!est) return respond({ error: 'not_found' }, 404)

    if (action === 'catalog') {
      const [services, professionals, links] = await Promise.all([
        db.from('services').select('id,name,description,category,duration_minutes,price_cents')
          .eq('establishment_id', est.id).eq('is_active', true).order('name'),
        db.from('professionals').select('id,name,bio,color')
          .eq('establishment_id', est.id).eq('is_active', true).order('name'),
        db.from('professional_services').select('professional_id,service_id')
          .eq('establishment_id', est.id),
      ])
      if (services.error || professionals.error || links.error)
        return respond({ error: 'server_error' }, 500)
      return respond({ establishment: { name: est.name, slug: est.slug, business_type: est.business_type },
        services: services.data, professionals: professionals.data, professional_services: links.data })
    }

    if (action === 'availability') {
      const { professional_id, service_id, date } = body
      if (!validId(professional_id) || !validId(service_id) || !validDate(date))
        return respond({ error: 'invalid_input' }, 400)
      const { data: service } = await db.from('services').select('duration_minutes')
        .eq('establishment_id', est.id).eq('id', service_id).eq('is_active', true).maybeSingle()
      const { data: pro } = await db.from('professionals').select('id')
        .eq('establishment_id', est.id).eq('id', professional_id).eq('is_active', true).maybeSingle()
      const { data: link } = await db.from('professional_services').select('professional_id')
        .eq('establishment_id', est.id).eq('professional_id', professional_id)
        .eq('service_id', service_id).maybeSingle()
      if (!service || !pro || !link) return respond({ slots: [] })
     const { data: slots, error: slotsError } = await db.rpc(
  'get_public_available_slots',
  {
    p_slug: slug,
    p_professional_id: professional_id,
    p_service_id: service_id,
    p_date: date,
  }
)

if (slotsError) {
  if (slotsError.code === '22023' || slotsError.code === 'P0002') {
    return respond({ error: 'invalid_or_unavailable' }, 400)
  }
  return respond({ error: 'availability_failed' }, 500)
}

return respond({ slots: slots ?? [] })
    }

    if (action === 'book') {
      const { professional_id, service_id, date, time, customer_name, customer_phone } = body
      if (!validId(professional_id) || !validId(service_id) || !validDate(date) ||
        typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
        typeof customer_name !== 'string' || typeof customer_phone !== 'string' ||
        customer_name.length > 120 || customer_phone.length > 30)
        return respond({ error: 'invalid_input' }, 400)

      // 1) Limites por IP ANTES de qualquer custo (inclusive validação do CAPTCHA). Falha do armazenamento = bloqueia.
      for (const [scope, rule] of [['bip10', LIMITS.bookIpMin], ['bipd', LIMITS.bookIpDay]] as const) {
        const r = await limited(scope, ip, rule)
        if (r === 'error') return respond({ error: 'service_unavailable' }, 503)
        if (r !== null) return tooMany(r)
      }

      // 2) CAPTCHA (Cloudflare Turnstile) validado SEMPRE no servidor. Sem segredo configurado, nada é reservado.
      const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
      if (!secret) { console.error('public-booking: TURNSTILE_SECRET_KEY ausente'); return respond({ error: 'service_unavailable' }, 503) }
      const token = body.turnstile_token
      if (typeof token !== 'string' || token.length < 10 || token.length > 2048) return respond({ error: 'captcha_required' }, 400)
      const hosts = (Deno.env.get('TURNSTILE_ALLOWED_HOSTNAMES') ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
      if (hosts.length === 0) { console.error('public-booking: TURNSTILE_ALLOWED_HOSTNAMES ausente'); return respond({ error: 'service_unavailable' }, 503) }
      const human = await verifyTurnstile({ secret, token, ip, allowedHostnames: hosts })
      if (human === 'unavailable') return respond({ error: 'service_unavailable' }, 503)
      if (human !== 'ok') return respond({ error: 'captcha_failed' }, 403)

      // 3) Limites por telefone e por estabelecimento (impedem spam com IPs diferentes).
      const phoneId = `${slug}:${customer_phone.replace(/\D/g, '')}`
      for (const [scope, value, rule] of [
        ['bph', phoneId, LIMITS.bookPhone], ['bphd', phoneId, LIMITS.bookPhoneDay], ['best', slug, LIMITS.bookEst],
      ] as const) {
        const r = await limited(scope, value, rule)
        if (r === 'error') return respond({ error: 'service_unavailable' }, 503)
        if (r !== null) return tooMany(r)
      }

      const { data, error } = await db.rpc('create_public_booking', {
        p_slug: slug, p_professional_id: professional_id, p_service_id: service_id,
        p_date: date, p_time: time, p_customer_name: customer_name,
        p_customer_phone: customer_phone,
      })
      if (error) {
        if (error.code === '23P01' || error.code === '23505')
          return respond({ error: 'slot_unavailable' }, 409)
        if (error.code === '22023' || error.code === 'P0002')
          return respond({ error: 'invalid_or_unavailable' }, 400)
        if (error.code === '42501' && error.message === 'subscription_suspended')
          return respond({ error: 'subscription_suspended' }, 403)
        if (error.code === 'P0001') return respond({ error: 'slot_unavailable' }, 409)
        console.error('public-booking: create_public_booking falhou', error.code) // só o código; nunca a mensagem/dados
        return respond({ error: 'booking_failed' }, 500)
      }
      // Consent is strictly optional, per booking and explicitly given on the public
      // form. Store server-side only AFTER Turnstile, rate limits and successful booking.
      // If unavailable, preserve the booking but never send WhatsApp without consent.
      if (body.whatsapp_opt_in === true) {
        const { error: consentError } = await db.from('whatsapp_appointment_consents')
          .insert({ appointment_id: data, establishment_id: est.id })
        if (consentError) {
          // Do not log customer data; an unavailable feature must not undo a booking.
          console.error('public-booking: whatsapp consent unavailable', consentError.code)
        }
      }
      return respond({ booking_id: data, status: 'scheduled' }, 201)
    }
    return respond({ error: 'unknown_action' }, 400)
  }),
}
