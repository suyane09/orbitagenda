import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const maybeSingle = vi.fn()
vi.mock('npm:@supabase/supabase-js@2.118.0', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
    rpc,
  }),
}))

const TOKEN = 't'.repeat(40)
let handler: (req: Request) => Promise<Response>

function stubEnv(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    ASAAS_API_KEY: 'sandbox_key', ASAAS_WEBHOOK_TOKEN: TOKEN, ASAAS_ENVIRONMENT: 'sandbox',
    SUPABASE_URL: 'http://x.invalid', SUPABASE_SERVICE_ROLE_KEY: 'srv',
    ...overrides,
  }
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h } })
}
const post = (body: unknown, token = TOKEN) => handler(new Request('http://x.invalid', {
  method: 'POST', headers: { 'asaas-access-token': token }, body: JSON.stringify(body),
}))
const asaas = (payload: Record<string, unknown>) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

describe('asaas-webhook · estornos, chargebacks e cancelamento', () => {
  beforeEach(async () => {
    vi.resetModules(); rpc.mockReset().mockResolvedValue({ error: null })
    maybeSingle.mockReset().mockResolvedValue({ data: { establishment_id: 'e1' }, error: null })
    stubEnv()
    const edgeFunction = '../../supabase/functions/asaas-webhook/index.ts'
    await import(/* @vite-ignore */ edgeFunction)
  })
  it('rejeita token inválido', async () => { expect((await post({}, 'x'.repeat(40))).status).toBe(401) })
  it('recusa acao financeira em producao sem liberacao explicita do ambiente', async () => {
    vi.resetModules()
    stubEnv({ ASAAS_ENVIRONMENT: 'production' })
    const edgeFunction = '../../supabase/functions/asaas-webhook/index.ts'
    await import(/* @vite-ignore */ edgeFunction)
    expect((await post({ id: 'evt_prod', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })
  const pay = { id: 'pay_1', subscription: 'sub_1', value: 49, dueDate: '2026-11-10' }
  it('estorno confirmado no Asaas chama a RPC de reversão', async () => {
    asaas({ ...pay, status: 'REFUNDED' })
    expect((await post({ id: 'evt_1', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_reversal', expect.objectContaining({ p_event_type: 'PAYMENT_REFUNDED', p_amount_cents: 4900 }))
  })
  it('chargeback é suspensão; status divergente do evento usa o estado real do Asaas', async () => {
    asaas({ ...pay, status: 'CHARGEBACK_DISPUTE' })
    await post({ id: 'evt_2', event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: 'pay_1' } })
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_reversal', expect.objectContaining({ p_event_type: 'PAYMENT_CHARGEBACK_REQUESTED' }))
  })
  it('evento de estorno com cobrança já paga no Asaas não reverte acesso', async () => {
    asaas({ ...pay, status: 'RECEIVED' })
    await post({ id: 'evt_3', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } })
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_event', expect.objectContaining({ p_event_type: 'PAYMENT_RECEIVED' }))
    expect(rpc).not.toHaveBeenCalledWith('record_asaas_billing_reversal', expect.anything())
  })
  it('cancelamento só é aplicado se o Asaas confirmar', async () => {
    asaas({ id: 'sub_1', status: 'ACTIVE', deleted: false })
    expect(await (await post({ id: 'evt_4', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } })).text()).toContain('ignored')
    expect(rpc).not.toHaveBeenCalled()
    asaas({ id: 'sub_1', status: 'INACTIVE', deleted: true })
    expect((await post({ id: 'evt_5', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_reversal', expect.objectContaining({ p_event_type: 'SUBSCRIPTION_DELETED' }))
  })

  it('recusa métodos indevidos, JSON inválido e payload excessivo', async () => {
    expect((await handler(new Request('http://x.invalid', { method: 'GET' }))).status).toBe(405)
    const bad = new Request('http://x.invalid', {
      method: 'POST', headers: { 'asaas-access-token': TOKEN }, body: '{oops',
    })
    expect((await handler(bad)).status).toBe(400)
    const oversized = new Request('http://x.invalid', {
      method: 'POST', headers: { 'asaas-access-token': TOKEN }, body: 'x'.repeat(81000),
    })
    expect((await handler(oversized)).status).toBe(413)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('não processa eventos desconhecidos e não consulta pagamentos de terceiros', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    expect((await post({ id: 'evt_other', event: 'PAYMENT_CREATED' })).status).toBe(200)
    expect(fetched).not.toHaveBeenCalled()
    asaas({ ...pay, status: 'RECEIVED' })
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await post({ id: 'evt_unlinked', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('vencimento confirmado pela API ativa a transição correta', async () => {
    asaas({ ...pay, status: 'OVERDUE' })
    expect((await post({ id: 'evt_overdue', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1' } })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_event',
      expect.objectContaining({ p_event_type: 'PAYMENT_OVERDUE', p_payment_status: 'OVERDUE' }))
  })
  it('resposta 404 da cobrança informa ID inexistente sem acessar banco', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const response = await post({ id: 'evt_missing', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_missing' } })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: 'asaas_payment_not_found' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('estorno em andamento não vira estorno concluído no webhook', async () => {
    asaas({ ...pay, status: 'REFUND_IN_PROGRESS' })
    expect((await post({ id: 'evt_refund_pending', event: 'PAYMENT_REFUND_IN_PROGRESS', payment: { id: 'pay_1' } })).status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('estorno parcial não é confundido com cancelamento integral de acesso', async () => {
    asaas({ ...pay, status: 'PARTIALLY_REFUNDED' })
    expect((await post({ id: 'evt_refund_partial', event: 'PAYMENT_PARTIALLY_REFUNDED', payment: { id: 'pay_1' } })).status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('erro de autenticação da API Asaas não é confundido com pagamento ausente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    expect((await post({ id: 'evt_401', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).status).toBe(502)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('não cancela por 404 até confirmar ID na lista de removidas', async () => {
    const fetched = vi.fn(async (url: string) => {
      if (url.includes('/subscriptions/sub_1')) return new Response('', { status: 404 })
      if (url.includes('deletedOnly=true')) return new Response(JSON.stringify({
        data: [{ id: 'sub_outro', deleted: true }],
      }), { status: 200 })
      throw Error('URL inesperada')
    })
    vi.stubGlobal('fetch', fetched)
    expect((await post({ id: 'evt_absent', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } })).status).toBe(502)
    expect(rpc).not.toHaveBeenCalled()
    fetched.mockImplementation(async (url: string) => {
      if (url.includes('/subscriptions/sub_1')) return new Response('', { status: 404 })
      if (url.includes('deletedOnly=true')) return new Response(JSON.stringify({
        data: [{ id: 'sub_1', deleted: true }],
      }), { status: 200 })
      throw Error('URL inesperada')
    })
    expect((await post({ id: 'evt_deleted', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_asaas_billing_reversal',
      expect.objectContaining({ p_event_type: 'SUBSCRIPTION_DELETED' }))
  })
  it('falha do banco devolve 503 para o Asaas reenviar', async () => {
    rpc.mockResolvedValue({ error: { message: 'x' } }); asaas({ ...pay, status: 'REFUNDED' })
    expect((await post({ id: 'evt_6', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } })).status).toBe(503)
  })
})
