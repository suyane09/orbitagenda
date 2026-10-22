import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const respond = (data: unknown, status = 200) =>
  Response.json(data, { status, headers })
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
    if (Number(req.headers.get('content-length') || 0) > 4096)
      return respond({ error: 'payload_too_large' }, 413)

    let body: Record<string, unknown>
    try {
      body = await req.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error()
    } catch { return respond({ error: 'invalid_json' }, 400) }

    const { action, slug } = body
    if (!validSlug(slug)) return respond({ error: 'invalid_slug' }, 400)
    const db = ctx.supabaseAdmin
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
      // IMPORTANTE: adicionar rate limiting persistente e CAPTCHA antes de produção.
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
        if (error.code === 'P0001') return respond({ error: 'slot_unavailable' }, 409)
        return respond({ error: 'booking_failed' }, 500)
      }
      return respond({ booking_id: data, status: 'scheduled' }, 201)
    }
    return respond({ error: 'unknown_action' }, 400)
  }),
}
