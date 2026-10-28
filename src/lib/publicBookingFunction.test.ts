import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/functions-js/edge-runtime.d.ts', () => ({}))
vi.mock('@supabase/server', () => ({ withSupabase: (_o: unknown, fn: unknown) => fn }))

const rpc = vi.fn()
const db = {
  rpc,
  from: () => { const q: any = { select: () => q, eq: () => q, order: () => q, maybeSingle: async () => ({ data: { id: 'e1', name: 'Barbearia', slug: 'barbearia', timezone: 'America/Maceio', business_type: 'barbershop' }, error: null }) }; return q },
}
const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222'
const valid = { action: 'book', slug: 'barbearia', professional_id: ID1, service_id: ID2, date: '2026-11-02', time: '10:00',
  customer_name: 'Maria', customer_phone: '82999990000', turnstile_token: 'x'.repeat(30) }
let handler: (req: Request, ctx: unknown) => Promise<Response>
const env: Record<string, string | undefined> = {}
const call = (body: unknown) => handler(new Request('http://x.invalid', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(body) }), { supabaseAdmin: db })
const turnstile = (out: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ok ? new Response(JSON.stringify(out)) : new Response('', { status: 500 })))
const okCaptcha = { success: true, action: 'public_booking', hostname: 'orbitagenda.vercel.app' }

describe('public-booking · CAPTCHA, limites, conflito e assinatura', () => {
  beforeEach(async () => {
    Object.assign(env, { TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_ALLOWED_HOSTNAMES: 'orbitagenda.vercel.app' })
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } })
    rpc.mockReset().mockImplementation(async (name: string) =>
      name === 'check_rate_limit' ? { data: [{ allowed: true, retry_after: 0 }], error: null } : { data: 'booking-1', error: null })
    turnstile(okCaptcha)
    vi.resetModules()
    const edge = '../../supabase/functions/public-booking/index.ts'
    handler = (await import(/* @vite-ignore */ edge)).default.fetch
  })
  const booked = () => rpc.mock.calls.some((c) => c[0] === 'create_public_booking')

  it('reserva válida com CAPTCHA válido retorna 201', async () => {
    const r = await call(valid); expect(r.status).toBe(201); expect(booked()).toBe(true)
  })
  it('sem token de CAPTCHA: 400 e nada é reservado', async () => {
    const r = await call({ ...valid, turnstile_token: undefined })
    expect(r.status).toBe(400); expect(booked()).toBe(false)
  })
  it('CAPTCHA reprovado: 403; indisponível: 503; nada reservado', async () => {
    turnstile({ success: false }); expect((await call(valid)).status).toBe(403)
    turnstile({}, false); expect((await call(valid)).status).toBe(503); expect(booked()).toBe(false)
  })
  it('hostname do CAPTCHA diferente do permitido é recusado', async () => {
    turnstile({ ...okCaptcha, hostname: 'outro-site.com' }); expect((await call(valid)).status).toBe(403)
  })
  it('falha fechada sem segredo ou sem hostnames permitidos', async () => {
    env.TURNSTILE_ALLOWED_HOSTNAMES = ''; expect((await call(valid)).status).toBe(503)
    env.TURNSTILE_ALLOWED_HOSTNAMES = 'orbitagenda.vercel.app'; env.TURNSTILE_SECRET_KEY = undefined
    expect((await call(valid)).status).toBe(503); expect(booked()).toBe(false)
  })
  it('limite de taxa excedido: 429 antes de validar CAPTCHA ou reservar', async () => {
    rpc.mockImplementation(async (n: string) => n === 'check_rate_limit' ? { data: [{ allowed: false, retry_after: 60 }], error: null } : { data: 'x', error: null })
    const r = await call(valid)
    expect(r.status).toBe(429); expect(r.headers.get('Retry-After')).toBe('60')
    expect(fetch).not.toHaveBeenCalled(); expect(booked()).toBe(false)
  })
  it('armazenamento do limite indisponível bloqueia a reserva (fail-closed)', async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { code: 'XX000' } }))
    expect((await call(valid)).status).toBe(503)
  })
  it('conflito de horário retorna 409', async () => {
    for (const code of ['23P01', '23505', 'P0001']) {
      rpc.mockImplementation(async (n: string) => n === 'check_rate_limit' ? { data: [{ allowed: true }], error: null } : { data: null, error: { code, message: 'x' } })
      expect((await call(valid)).status).toBe(409)
    }
  })
  it('assinatura suspensa bloqueia a reserva com 403', async () => {
    rpc.mockImplementation(async (n: string) => n === 'check_rate_limit' ? { data: [{ allowed: true }], error: null } : { data: null, error: { code: '42501', message: 'subscription_suspended' } })
    const r = await call(valid); expect(r.status).toBe(403); expect((await r.json()).error).toBe('subscription_suspended')
  })
  it('entradas inválidas: horário, data e telefone gigante', async () => {
    for (const patch of [{ time: '25:99' }, { date: '2026-13-45' }, { customer_phone: '9'.repeat(40) }, { professional_id: 'x' }])
      expect((await call({ ...valid, ...patch })).status).toBe(400)
    expect(booked()).toBe(false)
  })
})
