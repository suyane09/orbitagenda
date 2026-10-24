import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const from = vi.fn()
let handler: (req: Request) => Promise<Response>
const EST = '11111111-1111-4111-8111-111111111111'
const SUB = {
  establishment_id: EST, plan_id: 'plan_1', status: 'past_due',
  asaas_subscription_id: null, asaas_provisioning_started_at: null,
}
const lookup: Record<string, unknown> = {
  memberships: { id: 'm1' }, establishment_subscriptions: SUB,
  subscription_plans: { name: 'Inicial', monthly_price_cents: 4990 },
  establishments: { name: 'Barbearia Ficticia' },
}
let reserve: { data: unknown; error: unknown }
let saved: { data: unknown; error: unknown }
let updateCount = 0
vi.mock('npm:@supabase/supabase-js@2.118.0', () => ({
  createClient: () => ({ auth: { getUser }, from }),
}))

function stubEnv(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    SUPABASE_URL: 'http://x.invalid', SUPABASE_ANON_KEY: 'public',
    SUPABASE_SERVICE_ROLE_KEY: 'private_test_only',
    ASAAS_API_KEY: 'sandbox_test_key', ASAAS_ENVIRONMENT: 'sandbox',
    ASAAS_BILLING_ENABLED: 'true', ASAAS_ALLOWED_ORIGIN: 'http://localhost:5173',
    ...overrides,
  }
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => values[name] },
    serve: (fn: typeof handler) => { handler = fn },
  })
}
function makeFrom() {
  return (table: string) => {
    let mutation = false
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      is: () => chain,
      update: () => { mutation = true; return chain },
      maybeSingle: async () => {
        if (mutation && table === 'establishment_subscriptions') {
          updateCount++
          return updateCount === 1 ? reserve : saved
        }
        return { data: lookup[table], error: null }
      },
    }
    return chain
  }
}
function mockProvider() {
  return vi.fn(async (input: string | URL | Request) => new Response(
    JSON.stringify({ id: String(input).endsWith('/customers') ? 'cus_test1' : 'sub_test1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
}
function post(body: unknown = {
  establishmentId: EST, cpfCnpj: '12345678901', billingType: 'PIX', confirm: true,
}, headers: Record<string, string> = {}) {
  return handler(new Request('http://x.invalid', {
    method: 'POST', headers: {
      origin: 'http://localhost:5173', authorization: 'Bearer valid_jwt',
      'content-type': 'application/json', ...headers,
    },
    body: JSON.stringify(body),
  }))
}
describe('asaas-subscribe · autenticacao, idempotencia e persistencia', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'owner1', email: 'test@example.invalid' } }, error: null })
    from.mockReset().mockImplementation(makeFrom())
    Object.assign(lookup, {
      memberships: { id: 'm1' },
      establishment_subscriptions: { ...SUB },
      subscription_plans: { name: 'Inicial', monthly_price_cents: 4990 },
      establishments: { name: 'Barbearia Ficticia' },
    })
    reserve = { data: { establishment_id: EST }, error: null }
    saved = { data: { establishment_id: EST }, error: null }
    updateCount = 0
    stubEnv()
    vi.stubGlobal('fetch', mockProvider())
    const edgeFunction = '../../supabase/functions/asaas-subscribe/index.ts'
    await import(/* @vite-ignore */ edgeFunction)
  })
  it('requer token de sessao e nao chama Asaas sem JWT', async () => {
    const res = await post(undefined, { authorization: '' })
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('recusa chamada com Origin diferente do frontend permitido', async () => {
    const res = await post(undefined, { origin: 'https://malicioso.invalid' })
    expect(res.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requer CPF/CNPJ e confirmacao explicita', async () => {
    const res = await post({ establishmentId: EST, cpfCnpj: 'abc',
      billingType: 'PIX', confirm: false })
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('nega contratacao a membro sem papel de proprietario', async () => {
    lookup.memberships = null
    expect((await post()).status).toBe(403)
    expect(updateCount).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('nao gera nova assinatura se ha vinculo existente', async () => {
    lookup.establishment_subscriptions = { ...SUB, asaas_subscription_id: 'sub_existing' }
    expect((await post()).status).toBe(409)
    expect(updateCount).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('cria cliente e assinatura no Asaas e exige gravacao efetiva do vinculo', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ subscriptionId: 'sub_test1', environment: 'sandbox' })
    expect(updateCount).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('falha com 502 se o UPDATE final alterou zero linhas, sem indicar sucesso', async () => {
    saved = { data: null, error: null }
    const res = await post()
    expect(res.status).toBe(502)
    expect(updateCount).toBe(2)
    expect(await res.json()).toMatchObject({ message: expect.stringContaining('bloqueadas') })
  })
  it('impede nova tentativa quando a reserva do banco nao foi adquirida', async () => {
    reserve = { data: null, error: null }
    expect((await post()).status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('nao libera nova tentativa se o provedor falhar apos reserva', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 502 })))
    expect((await post()).status).toBe(502)
    expect(updateCount).toBe(1)
  })
  it('recusa configuracao de producao sem confirmacao administrativa', async () => {
    vi.resetModules()
    stubEnv({ ASAAS_ENVIRONMENT: 'production' })
    const edgeFunction = '../../supabase/functions/asaas-subscribe/index.ts'
    await import(/* @vite-ignore */ edgeFunction)
    expect((await post()).status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })
})
