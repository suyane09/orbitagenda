/**
 * Homologacao financeira E2E - EXCLUSIVAMENTE Asaas Sandbox + Supabase Docker local.
 * Uso: node scripts/asaas-sandbox-e2e.mjs --execute
 * Opcional: --customer cus_... --scenario overdue|refund|cancel
 * Retomada segura: node scripts/asaas-sandbox-e2e.mjs --resume-refund
 * Alternativa UI: --prepare-refund-sim / --check-refund-sim
 * NAO usa Vercel, Supabase remoto, nem chave de producao.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const resumeRefund = args.includes('--resume-refund')
const prepareRefundSimulation = args.includes('--prepare-refund-sim')
const checkRefundSimulation = args.includes('--check-refund-sim')
if (!args.includes('--execute') && !resumeRefund && !prepareRefundSimulation && !checkRefundSimulation) {
  console.error('Use --execute, --resume-refund, --prepare-refund-sim ou --check-refund-sim')
  process.exit(2)
}
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}
const mode = option('--scenario', 'all')
assert.ok(['all', 'overdue', 'refund', 'cancel'].includes(mode), 'Cenario invalido')
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
assert.equal(env.ASAAS_ENVIRONMENT, 'sandbox', 'PROIBIDO: ASAAS_ENVIRONMENT diferente de sandbox')
assert.ok(env.ASAAS_API_KEY, 'ASAAS_API_KEY ausente em .env.local')
assert.ok(env.ASAAS_RECONCILE_TOKEN && env.ASAAS_RECONCILE_TOKEN.length >= 32, 'Token local de conciliacao ausente')
assert.match(env.VITE_SUPABASE_URL || '', /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/, 'VITE_SUPABASE_URL deve apontar APENAS para Supabase local')
if (env.SUPABASE_URL) {
  assert.match(env.SUPABASE_URL, /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/, 'SUPABASE_URL aponta fora do ambiente local')
}
const customerId = option('--customer', null) || sql("SELECT asaas_customer_id FROM public.establishment_subscriptions WHERE asaas_environment='sandbox' AND asaas_customer_id IS NOT NULL AND asaas_subscription_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1")
assert.match(customerId, /^cus_[A-Za-z0-9]+$/, 'Customer ID Sandbox invalido')
const BASE = 'https://api-sandbox.asaas.com/v3'
const LOCAL = 'http://127.0.0.1:54321'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const localDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

async function api(path, method = 'GET', data) {
  const res = await fetch(BASE + path, {
    method, headers: {
      access_token: env.ASAAS_API_KEY,
      'User-Agent': 'OrbitAgenda-Sandbox-Homologacao/1.0',
      'Content-Type': 'application/json', Accept: 'application/json',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* empty/non-JSON */ }
  if (!res.ok) {
    const providerMessage = body?.errors?.map((x) => x.description).join('; ') || body?.message || ''
    throw new Error('Asaas HTTP ' + res.status + ' em ' + method + ' ' + path + ' ' + String(providerMessage).slice(0, 200))
  }
  return body
}
function sql(query) {
  return execFileSync('docker', [
    'exec', 'supabase_db_orbit-agenda', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-At', '-c', query,
  ], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
const safeId = (v, kind) => {
  assert.match(v || '', kind === 'sub' ? /^sub_[A-Za-z0-9]+$/ : /^pay_[A-Za-z0-9]+$/, 'ID Asaas inesperado')
  return v
}
async function reconcile() {
  const res = await fetch(LOCAL + '/functions/v1/asaas-reconcile', {
    method: 'POST',
    headers: { 'x-reconcile-token': env.ASAAS_RECONCILE_TOKEN, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(90000),
  })
  const body = await res.json()
  assert.equal(res.status, 200, 'Conciliacao HTTP ' + res.status + ': ' + JSON.stringify(body))
  assert.equal(body.errors, 0, 'Erros na conciliacao')
  return body
}
function state(f) {
  const v = sql("SELECT status || '|' || COALESCE(payment_due_at::text,'') || '|' || private.billing_allows_write(establishment_id)::text FROM public.establishment_subscriptions WHERE establishment_id='" + f.estId + "' AND asaas_subscription_id='" + f.subId + "' AND asaas_environment='sandbox';")
  assert.ok(v, 'Assinatura local nao encontrada')
  const [status, dueAt, canWrite] = v.split('|')
  return { status, dueAt, allowed: canWrite === 'true' || canWrite === 't' }
}
function expectState(f, status, allowed) {
  const actual = state(f)
  assert.equal(actual.status, status, 'Estado financeiro incorreto de ' + f.name)
  if (allowed !== undefined) assert.equal(actual.allowed, allowed, 'Guarda de escrita incorreta de ' + f.name)
  console.log('OK banco:', f.name, status, 'escrita=' + actual.allowed)
}
async function getPayment(subId) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const page = await api('/subscriptions/' + subId + '/payments?limit=20')
    const found = page?.data?.find((p) => p.subscription === subId && p.id?.startsWith('pay_'))
    if (found) return found
    await sleep(1250)
  }
  throw new Error('Asaas nao gerou a primeira cobranca no periodo de consulta')
}
async function verifyPaymentStatus(id, expected, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const p = await api('/payments/' + id)
    if (expected.includes(p.status)) return p
    await sleep(1250)
  }
  throw new Error('Pagamento ' + id + ' nao atingiu status ' + expected.join('/') + ' no Asaas')
}
async function webhookSeen(payId, eventTypes) {
  for (let i = 0; i < 12; i++) {
    const n = Number(sql("SELECT count(*) FROM public.asaas_payment_events WHERE payment_id='" + payId + "' AND environment='sandbox' AND event_type=ANY(ARRAY[" + eventTypes.map((x) => "'" + x + "'").join(',') + "]);"))
    if (n > 0) return true
    await sleep(1500)
  }
  return false
}
const fixtures = []
async function fixture(name) {
  const estId = randomUUID()
  const slug = 'orbit-homolog-' + estId.slice(0, 12)
  const sub = await api('/subscriptions', 'POST', {
    customer: customerId, billingType: 'PIX', value: 49.9,
    cycle: 'MONTHLY', nextDueDate: localDate,
    description: 'TESTE ISOLADO OrbitAgenda ' + name,
    externalReference: estId,
  })
  const subId = safeId(sub?.id, 'sub')
  console.log('Sandbox criado:', name, subId, '(NAO e assinatura principal)')
  // Somente banco Docker local. IDs sao gerados/verificados; nenhum dado real e alterado.
  sql("BEGIN; INSERT INTO public.establishments(id,name,slug,business_type,timezone) VALUES ('" + estId + "','Orbit Teste " + name + "','" + slug + "','barbershop','America/Maceio'); INSERT INTO public.establishment_subscriptions(establishment_id,plan_id,status,notes,asaas_customer_id,asaas_subscription_id,asaas_environment) SELECT '" + estId + "',id,'past_due','HOMOLOGACAO DESCARTAVEL','" + customerId + "','" + subId + "','sandbox' FROM public.subscription_plans WHERE code='inicial_4990' AND monthly_price_cents=4990 LIMIT 1; COMMIT;")
  const f = { name, estId, subId, payId: safeId((await getPayment(subId)).id, 'pay') }
  fixtures.push(f)
  expectState(f, 'past_due', false)
  return f
}
async function testOverdue() {
  const f = await fixture('Vencimento')
  await api('/sandbox/payment/' + f.payId + '/overdue', 'POST')
  await verifyPaymentStatus(f.payId, ['OVERDUE'])
  const webhook = await webhookSeen(f.payId, ['PAYMENT_OVERDUE'])
  await reconcile()
  expectState(f, 'past_due', true) // cinco dias de tolerancia
  sql("UPDATE public.establishment_subscriptions SET payment_due_at=((now() AT TIME ZONE 'America/Sao_Paulo')::date-10)::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'past_due', false) // atraso superior a 5 dias
  await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
  await verifyPaymentStatus(f.payId, ['CONFIRMED', 'RECEIVED'])
  await webhookSeen(f.payId, ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
  await reconcile()
  expectState(f, 'active', true)
  console.log(webhook ? 'OK: webhook de vencimento entregue' : 'AVISO: vencimento corrigido por conciliacao; webhook de vencimento NAO comprovado')
}
class RefundPendingError extends Error {
  constructor(message) { super(message); this.name = 'RefundPendingError' }
}
async function refundSnapshot(paymentId, details = true) {
  const payment = await api('/payments/' + paymentId)
  let refunds = Array.isArray(payment?.refunds) ? payment.refunds : []
  if (details && refunds.length === 0) {
    try {
      const list = await api('/payments/' + paymentId + '/refunds')
      refunds = Array.isArray(list?.data) ? list.data : Array.isArray(list?.refunds) ? list.refunds : Array.isArray(list) ? list : []
    } catch (err) {
      console.log('Aviso: historico de estorno nao consultavel:', err.message)
    }
  }
  const stateLabel = refunds.length
    ? refunds.map((r) => String(r.status || 'DESCONHECIDO') + ':' + String(r.value ?? '?')).join(', ')
    : 'nenhum item de estorno retornado'
  if (details) console.log('Diagnostico Asaas:', paymentId, 'pagamento=' + String(payment.status),
    'estornos=' + stateLabel)
  return { payment, refunds, stateLabel }
}
async function waitForCompleteRefund(paymentId, tries = 32) {
  let last
  for (let attempt = 0; attempt < tries; attempt++) {
    const snapshot = await refundSnapshot(paymentId, attempt === 0 || attempt === tries - 1)
    last = snapshot
    if (snapshot.payment?.status === 'REFUNDED') {
      // O estado final deve vir diretamente do provedor. Um pedido de
      // devolucao aceito, ou refunds.status=PENDING, nao basta.
      return snapshot
    }
    if (snapshot.refunds.some((r) => r?.status === 'AWAITING_CRITICAL_ACTION_AUTHORIZATION')) {
      throw new RefundPendingError('Estorno aguarda AUTORIZACAO DE ACAO CRITICA no Asaas Sandbox. '
        + 'Abra https://sandbox.asaas.com e localize a cobranca ' + paymentId
        + ' (R$ 49,90), confira a solicitacao e conclua a validacao de seguranca. '
        + 'No Sandbox, o token de homologacao e 000000 quando solicitado. '
        + 'Nao repita o POST de estorno. Depois execute --resume-refund.')
    }
    if (snapshot.refunds.some((r) => r?.status === 'CANCELLED')) {
      throw new RefundPendingError('Solicitacao de estorno CANCELADA no Asaas. '
        + 'Nao e permitido declarar REFUNDED; revise o historico da cobranca no Sandbox.')
    }
    if (attempt < tries - 1) await sleep(1250)
  }
  throw new RefundPendingError('Asaas ainda nao confirmou REFUNDED. Ultimo status='
    + String(last?.payment?.status ?? 'DESCONHECIDO')
    + '; estornos=' + String(last?.stateLabel ?? 'desconhecido')
    + '. Nao repetir POST de estorno. Reconsultar com --resume-refund.')
}
async function resumePreviousRefund() {
  // Usa exclusivamente a fixture isolada criada pelo roteiro de homologacao.
  // Nao cria assinatura, nao confirma pagamento e NAO solicita outro estorno.
  const row = sql("SELECT e.id::text || '|' || s.asaas_subscription_id FROM public.establishments e"
    + " JOIN public.establishment_subscriptions s ON s.establishment_id=e.id"
    + " WHERE e.name='Orbit Teste Estorno' AND s.notes='HOMOLOGACAO DESCARTAVEL'"
    + " AND s.asaas_environment='sandbox' AND s.asaas_subscription_id IS NOT NULL"
    + " ORDER BY e.created_at DESC LIMIT 1")
  if (!row) throw Error('Fixture Estorno nao encontrada no Docker local')
  const [estId, subId] = row.split('|')
  assert.match(estId, /^[0-9a-f-]{36}$/i, 'Estabelecimento local invalido')
  safeId(subId, 'sub')
  const f = { name: 'Estorno', estId, subId, payId: safeId((await getPayment(subId)).id, 'pay') }
  const remotePayment = await api('/payments/' + f.payId)
  assert.equal(remotePayment.subscription, subId, 'Pagamento nao pertence a fixture Estorno')
  console.log('Retomando estorno JA SOLICITADO da fixture', subId)
  await waitForCompleteRefund(f.payId, 3)
  const webhook = await webhookSeen(f.payId, ['PAYMENT_REFUNDED'])
  await reconcile()
  expectState(f, 'past_due', true)
  sql("UPDATE public.establishment_subscriptions SET payment_due_at=((now() AT TIME ZONE 'America/Sao_Paulo')::date-10)::timestamp AT TIME ZONE 'America/Sao_Paulo'"
    + " WHERE establishment_id='" + f.estId + "' AND asaas_subscription_id='" + f.subId + "'"
    + " AND notes='HOMOLOGACAO DESCARTAVEL' AND asaas_environment='sandbox';")
  expectState(f, 'past_due', false)
  console.log(webhook ? 'PASSOU estorno: webhook confirmado' :
    'PASSOU estorno: conciliacao corrigiu estado; webhook PAYMENT_REFUNDED nao comprovado')
}

// Alternativa sem suporte e sem repetir pedido de estorno do provedor.
// Cria/reutiliza uma assinatura descartavel propria para a ACAO DE SANDBOX
// "Estornar cobranca" (botao laranja), distinta de "Solicitar estorno".
async function sandboxRefundFixture(allowCreate = false) {
  const existing = sql("SELECT e.id::text || '|' || s.asaas_subscription_id FROM public.establishments e"
    + " JOIN public.establishment_subscriptions s ON s.establishment_id=e.id"
    + " WHERE e.name='Orbit Teste Estorno UI Sandbox' AND s.notes='HOMOLOGACAO DESCARTAVEL'"
    + " AND s.asaas_environment='sandbox' AND s.asaas_subscription_id IS NOT NULL"
    + " ORDER BY e.created_at DESC LIMIT 1")
  if (existing) {
    const [estId, subId] = existing.split('|')
    assert.match(estId, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i)
    safeId(subId, 'sub')
    const f = { name: 'Estorno UI Sandbox', estId, subId,
      payId: safeId((await getPayment(subId)).id, 'pay') }
    const payment = await api('/payments/' + f.payId)
    assert.equal(payment.subscription, subId, 'Cobranca nao pertence a fixture correta')
    return f
  }
  if (!allowCreate) throw Error('Fixture de simulacao nao encontrada. Execute --prepare-refund-sim primeiro.')
  return fixture('Estorno UI Sandbox')
}
async function prepareRefundUiSimulation() {
  const f = await sandboxRefundFixture(true)
  const remote = await api('/payments/' + f.payId)
  if (remote.status === 'PENDING') {
    await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
    await verifyPaymentStatus(f.payId, ['RECEIVED', 'CONFIRMED'])
  } else if (!['RECEIVED', 'CONFIRMED', 'REFUNDED'].includes(remote.status)) {
    throw Error('Status inesperado, nenhuma nova operacao solicitada: ' + remote.status)
  }
  await reconcile()
  const refreshed = await api('/payments/' + f.payId)
  if (refreshed.status === 'REFUNDED') {
    console.log('Esta fixture ja foi estornada. Execute --check-refund-sim')
    return
  }
  expectState(f, 'active', true)
  console.log('PRONTO PARA SIMULACAO PELO PAINEL ASAAS SANDBOX')
  console.log('Cobranca:', f.payId, 'R$ 49,90')
  console.log('Descricao: TESTE ISOLADO OrbitAgenda Estorno UI Sandbox')
  console.log('Abra os detalhes desta cobranca. Use SOMENTE o botao na faixa laranja')
  console.log('"Acoes de Sandbox > Estornar cobranca". NAO use "Solicitar estorno".')
  console.log('Depois execute --check-refund-sim; nao repita o preparo.')
}
async function checkRefundUiSimulation() {
  const f = await sandboxRefundFixture()
  const payment = await api('/payments/' + f.payId)
  assert.equal(payment.subscription, f.subId)
  console.log('Conferindo SIMULACAO de estorno da cobranca', f.payId)
  if (payment.status !== 'REFUNDED') {
    const snapshot = await refundSnapshot(f.payId)
    throw new RefundPendingError('Sandbox nao confirmou REFUNDED para fixture UI. Status='
      + payment.status + '; refunds=' + snapshot.stateLabel
      + '. Nao solicite estorno via API; confira acao na faixa laranja do Sandbox.')
  }
  const seen = await webhookSeen(f.payId, ['PAYMENT_REFUNDED'])
  await reconcile()
  expectState(f, 'past_due', true)
  // Exclusivamente assinatura de teste no banco Docker local; nunca move o
  // calendario da assinatura principal e nunca envia nova ordem ao Asaas.
  sql("UPDATE public.establishment_subscriptions"
    + " SET payment_due_at=((now() AT TIME ZONE 'America/Sao_Paulo')::date-10)::timestamp"
    + " AT TIME ZONE 'America/Sao_Paulo'"
    + " WHERE establishment_id='" + f.estId + "' AND asaas_subscription_id='" + f.subId + "'"
    + " AND notes='HOMOLOGACAO DESCARTAVEL' AND asaas_environment='sandbox';")
  expectState(f, 'past_due', false)
  console.log(seen ? 'WEBHOOK PAYMENT_REFUNDED comprovado' :
    'WEBHOOK ainda nao comprovado; conciliacao corrigiu o estado')
  console.log('PASSOU: estorno via simulacao do Sandbox refletido no OrbitAgenda local')
}

async function testRefund() {
  const f = await fixture('Estorno')
  // O Sandbox pode exigir saldo adicional para estorno integral; esta cobranca
  // avulsa NAO e vinculada ao OrbitAgenda e nao movimenta dinheiro real.
  const reserve = await api('/payments', 'POST', {
    customer: customerId, billingType: 'PIX', value: 100,
    dueDate: localDate, description: 'SALDO FICTICIO teste estorno OrbitAgenda',
  })
  const reserveId = safeId(reserve?.id, 'pay')
  await api('/sandbox/payment/' + reserveId + '/confirm', 'POST')
  await verifyPaymentStatus(reserveId, ['CONFIRMED', 'RECEIVED'])
  await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
  await verifyPaymentStatus(f.payId, ['CONFIRMED', 'RECEIVED'])
  await webhookSeen(f.payId, ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'])
  await reconcile()
  expectState(f, 'active', true)
  const refundRequest = await api('/payments/' + f.payId + '/refund', 'POST', {})
  console.log('Pedido de estorno aceito pelo Asaas; status inicial:',
    String(refundRequest?.status ?? 'nao retornado'))
  await waitForCompleteRefund(f.payId, 32)
  const webhook = await webhookSeen(f.payId, ['PAYMENT_REFUNDED'])
  await reconcile()
  expectState(f, 'past_due', true)
  sql("UPDATE public.establishment_subscriptions SET payment_due_at=((now() AT TIME ZONE 'America/Sao_Paulo')::date-10)::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'past_due', false)
  console.log(webhook ? 'OK: webhook de estorno entregue' : 'AVISO: estorno corrigido por conciliacao; webhook de estorno NAO comprovado')
}
async function testCancel() {
  const f = await fixture('Cancelamento')
  await api('/sandbox/payment/' + f.payId + '/confirm', 'POST')
  await verifyPaymentStatus(f.payId, ['CONFIRMED', 'RECEIVED'])
  await reconcile()
  expectState(f, 'active', true)
  await api('/subscriptions/' + f.subId, 'DELETE')
  await reconcile()
  expectState(f, 'canceled', false)
  // Simula um periodo pago ate o futuro somente na assinatura da fixture local.
  sql("UPDATE public.establishment_subscriptions SET current_period_end=now()+interval '7 days' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'canceled', true)
  // Sem alteracao do relogio real nem do provedor: periodo encerrado no banco de TESTE.
  sql("UPDATE public.establishment_subscriptions SET started_at=now()-interval '30 days', current_period_end=now()-interval '1 day' WHERE establishment_id='" + f.estId + "' AND asaas_environment='sandbox';")
  expectState(f, 'canceled', false)
}
async function main() {
  console.log('Ambiente protegido: Asaas SANDBOX e Docker Supabase LOCAL')
  assert.equal(sql("SELECT current_database()"), 'postgres', 'Banco local incorreto')
  assert.equal(sql("SELECT count(*) FROM public.subscription_plans WHERE code='inicial_4990' AND monthly_price_cents=4990"), '1', 'Plano local inicial 49,90 indisponivel')
  const c = await api('/customers/' + customerId)
  assert.equal(c?.id, customerId, 'Cliente Sandbox nao identificado')
  // Endpoint local autenticado: um teste de credencial e configuracao, sem modificar estado.
  const probe = await fetch(LOCAL + '/functions/v1/asaas-reconcile', { method: 'GET', signal: AbortSignal.timeout(5000) })
  assert.equal(probe.status, 405, 'Edge Function asaas-reconcile nao esta servida localmente')
  if (prepareRefundSimulation || checkRefundSimulation) {
    try {
      if (prepareRefundSimulation) await prepareRefundUiSimulation()
      else await checkRefundUiSimulation()
    } catch (err) {
      if (err instanceof RefundPendingError) {
        console.log('PENDENTE: ' + err.message)
        process.exitCode = 3
      } else throw err
    }
    return
  }
  if (resumeRefund) {
    try {
      await resumePreviousRefund()
      console.log('PASSOU: estorno confirmado e regras de bloqueio validadas')
    } catch (err) {
      if (err instanceof RefundPendingError) {
        console.log('PENDENTE: ' + err.message)
        process.exitCode = 3
      } else {
        throw err
      }
    }
    return
  }
  const cases = {
    overdue: testOverdue, refund: testRefund, cancel: testCancel,
  }
  let failed = 0
  let pending = 0
  for (const [key, test] of Object.entries(cases)) {
    if (mode !== 'all' && mode !== key) continue
    try {
      console.log('\nTESTE ' + key.toUpperCase())
      await test()
      console.log('PASSOU: ' + key)
    } catch (error) {
      if (error instanceof RefundPendingError) {
        pending++
        console.log('INCONCLUSIVO ' + key + ': ' + error.message)
      } else {
        failed++
        console.error('FALHOU ' + key + ': ' + error.message)
      }
    }
  }
  const executed = mode === 'all' ? Object.keys(cases).length : 1
  console.log('\nResumo: ' + (executed - failed - pending) + ' aprovado(s); '
    + pending + ' pendente(s) no Asaas; ' + failed + ' falha(s).')
  console.log('Fixtures Sandbox criadas:', fixtures.map((f) => f.subId).join(', ') || 'nenhuma')
  console.log('Assinatura principal de homologacao NAO foi modificada pelo script.')
  if (failed) process.exitCode = 1
  else if (pending) process.exitCode = 3
}
main().catch((err) => { console.error('PRECHECK FALHOU:', err.message); process.exitCode = 1 })
