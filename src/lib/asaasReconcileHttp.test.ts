import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const updateEq = vi.fn()
const limit = vi.fn()
let handler: (req: Request) => Promise<Response>
const TOKEN = 'recon_'.repeat(8)
const linked = {
  establishment_id: '5b308808-6e7d-4bd8-8698-5ecf07d79406',
  asaas_subscription_id: 'sub_reconcile_test',
  status: 'active', payment_due_at: null, last_paid_due_date: null,
}
vi.mock('npm:@supabase/supabase-js@2.118.0', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: function () { return this },
        not: function () { return this },
        neq: function () { return this },
        order: function () { return this },
        limit,
      }),
      update: () => ({ eq: updateEq }),
    }),
    rpc,
  }),
}))

const reply = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status })
function mockProvider({
  paymentStatus = 'RECEIVED', deleted = false, listHasId = true,
}: { paymentStatus?: string; deleted?: boolean; listHasId?: boolean } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const u = String(input)
    if (u.includes('/subscriptions/sub_reconcile_test/payments')) {
      return reply({ data: [{ id: 'pay_test', subscription: 'sub_reconcile_test', status: paymentStatus, value: 49.9, dueDate: '2026-10-24' }], hasMore: false })
    }
    if (u.includes('/subscriptions/sub_reconcile_test')) {
      return deleted ? reply({}, 404) : reply({ id: 'sub_reconcile_test', status: 'ACTIVE' })
    }
    if (u.includes('deletedOnly=true')) {
      return reply({ data: [{ id: listHasId ? 'sub_reconcile_test' : 'sub_outro', deleted: true }] })
    }
    throw new Error('Unexpected Asaas URL: ' + u)
  })
}
const post = (token = TOKEN) => handler(new Request('http://localhost/', {
  method: 'POST', headers: { 'x-reconcile-token': token },
  body: '{}',
}))
describe('asaas-reconcile · HTTP, erros e exclusão confirmada', () => {
  beforeEach(async () => {
    vi.resetModules()
    rpc.mockReset().mockResolvedValue({ data: true, error: null })
    limit.mockReset().mockResolvedValue({ data: [linked], error: null })
    updateEq.mockReset().mockResolvedValue({ error: null })
    vi.stubGlobal('Deno', { env: { get: (key: string) => ({
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: 'sandbox_key',
      ASAAS_RECONCILE_TOKEN: TOKEN,
      SUPABASE_URL: 'http://local.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'fake_service_role_key',
    } as Record<string, string>)[key] }, serve: (fn: typeof handler) => { handler = fn } })
    vi.stubGlobal('fetch', mockProvider())
    const edgeFunction = '../../supabase/functions/asaas-reconcile/index.ts'
    await import(/* @vite-ignore */ edgeFunction)
  })

  it('recusa token ausente/incorreto e metodo GET', async () => {
    expect((await post('x'.repeat(40))).status).toBe(401)
    expect((await handler(new Request('http://localhost/', { method: 'GET' }))).status).toBe(405)
    expect(limit).not.toHaveBeenCalled()
  })
  it('processa pagamento verificado, registra auditoria e timestamp de sync', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ checked: 1, applied: 1, errors: 0 })
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_event',
      expect.objectContaining({ p_asaas_subscription_id: 'sub_reconcile_test', p_payment_status: 'RECEIVED' }))
    expect(rpc).toHaveBeenCalledWith('record_asaas_reconciliation_run', expect.objectContaining({ p_checked: 1, p_errors: 0 }))
    expect(updateEq).toHaveBeenCalledTimes(1)
  })
  it('404 com ID na lista de deletadas cancela, nao depende de JSON do webhook', async () => {
    vi.stubGlobal('fetch', mockProvider({ deleted: true }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_reversal', expect.objectContaining({
      p_event_type: 'SUBSCRIPTION_DELETED', p_payment_id: 'sub_reconcile_test',
    }))
  })
  it('404 sem prova de exclusao registra divergencia e nao cancela', async () => {
    vi.stubGlobal('fetch', mockProvider({ deleted: true, listHasId: false }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ checked: 1, applied: 0, divergences: 1 })
    expect(rpc).not.toHaveBeenCalledWith('record_asaas_billing_reversal', expect.anything())
  })
  it('erro da RPC financeira e reportado 503 e nao atualiza ultimo sync', async () => {
    rpc.mockImplementation(async (name: string) => name === 'record_asaas_reconciliation_run'
      ? { data: 'audit', error: null } : { data: null, error: { message: 'sql_error' } })
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, errors: 1 })
    expect(updateEq).not.toHaveBeenCalled()
  })
  it('erro de gravacao da auditoria nao e um sucesso silencioso', async () => {
    rpc.mockImplementation(async (name: string) => name === 'record_asaas_reconciliation_run'
      ? { data: null, error: { message: 'audit_error' } } : { data: true, error: null })
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ message: 'reconciliation_audit_failed' })
  })
  it('recusa assinatura que a API devolve com ID diferente', async () => {
    const original = mockProvider()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/subscriptions/sub_reconcile_test')
        && !String(input).includes('/payments')
        ? reply({ id: 'sub_other', status: 'ACTIVE' })
        : original(input)))
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, errors: 1 })
    expect(updateEq).not.toHaveBeenCalled()
  })
  it('404 ao listar pagamentos nao e interpretado como nenhum pagamento', async () => {
    const original = mockProvider()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/payments') ? reply({}, 404) : original(input)))
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, errors: 1 })
    expect(updateEq).not.toHaveBeenCalled()
  })
  it('rejeita cobranca de outra assinatura sem registrar nenhum evento', async () => {
    const original = mockProvider()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/payments')
        ? reply({ data: [{ id: 'pay_foreign', subscription: 'sub_foreign', status: 'RECEIVED',
          value: 49.9, dueDate: '2026-10-24' }], hasMore: false })
        : original(input)))
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, applied: 0, errors: 1 })
    expect(updateEq).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith('record_asaas_billing_event', expect.anything())
  })
  it('nao considera a conciliacao completa quando Asaas tem mais de mil cobrancas', async () => {
    const original = mockProvider()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/payments')
        ? reply({ data: [{ id: 'pay_one', subscription: 'sub_reconcile_test',
          status: 'RECEIVED', value: 49.9, dueDate: '2026-10-24' }], hasMore: true })
        : original(input)))
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, errors: 1 })
    expect(updateEq).not.toHaveBeenCalled()
  })
  it('erro ao atualizar timestamp de sync e registrado, sem resposta de sucesso', async () => {
    updateEq.mockResolvedValue({ error: { message: 'db_update_error' } })
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, errors: 1 })
  })
  it('erro da API Asaas e registrado e retorna 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Error('offline') }))
    // The handler's provider fetch is mocked. Restore it only after handler call,
    // so this test never performs a network request.
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ checked: 1, errors: 1 })
    expect(updateEq).not.toHaveBeenCalled()
  })
})
