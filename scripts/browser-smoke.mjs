// Smoke tests do frontend renderizado no Chromium real, sem conta nem dados de produção.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4173
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', String(port), '--strictPort',
], { stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stderr.on('data', (data) => { serverOutput += data.toString() })
server.stdout.on('data', (data) => { serverOutput += data.toString() })

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite encerrou: ' + serverOutput)
    try {
      const res = await fetch(base + '/entrar')
      if (res.ok) return
    } catch { /* servidor iniciando */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Vite indisponível: ' + serverOutput)
}
const check = async (label, fn) => {
  await fn()
  console.log('PASS navegador:', label)
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await check('login carrega e valida os dois campos sem acessar API', async () => {
    await page.goto(base + '/entrar')
    await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.getByText('Informe um e-mail válido.').waitFor()
    await page.getByText('Informe sua senha.').waitFor()
    assert.equal(await page.locator('input[name=email]').getAttribute('aria-invalid'), 'true')
  })
  await check('cadastro rejeita senhas diferentes sem criar conta', async () => {
    await page.getByRole('link', { name: 'Criar conta' }).click()
    await page.getByRole('heading', { name: 'Criar conta', exact: true }).waitFor()
    await page.locator('input[name=fullName]').fill('Pessoa Teste')
    await page.locator('input[name=email]').fill('teste@example.invalid')
    await page.locator('input[name=password]').fill('Senha123456')
    await page.locator('input[name=confirm]').fill('Outra123456')
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await page.getByText('As senhas não coincidem.').waitFor()
  })
  await check('recuperação de senha valida e-mail localmente', async () => {
    await page.goto(base + '/recuperar-senha')
    await page.getByRole('heading', { name: 'Recuperar senha' }).waitFor()
    await page.getByRole('button', { name: 'Enviar link' }).click()
    await page.getByText('Informe um e-mail válido.').waitFor()
  })
  await check('página protegida exige autenticação', async () => {
    await page.goto(base + '/app')
    await page.waitForURL('**/entrar')
    await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  })
  await check('rota inválida exibe página não encontrada', async () => {
    await page.goto(base + '/rota-que-nao-existe')
    await page.getByText('Página não encontrada').waitFor()
  })
  await check('login e cadastro mobile sem rolagem horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const path of ['/entrar', '/cadastro']) {
      await page.goto(base + path)
      await page.locator('input[name=email]').waitFor()
      const width = await page.evaluate(() => document.documentElement.scrollWidth)
      assert.ok(width <= 391, `${path}: largura ${width}px excedeu viewport mobile`)
    }
  })
  await check('agendamento publico: catalogo, servico, profissional, horario e trava de CAPTCHA', async () => {
    const timeZone = 'America/Manaus'
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const [year, month, day] = parts.split('-').map(Number)
    const targetDate = new Date(Date.UTC(year, month - 1, day + 2))
    const iso = targetDate.toISOString().slice(0, 10)
    const dateLabel = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(targetDate)
    const service = '11111111-1111-4111-8111-111111111111'
    const professional = '22222222-2222-4222-8222-222222222222'
    let booked = false
    await page.route('**/functions/v1/public-booking', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      let payload
      if (body.action === 'catalog') {
        payload = {
          establishment: { name: 'Barbearia Piloto', slug: 'barbearia-piloto',
            business_type: 'barbershop', timezone: timeZone },
          services: [{ id: service, name: 'Corte tradicional', description: null,
            duration_minutes: 30, price_cents: 5000 }],
          professionals: [{ id: professional, name: 'Barbeiro Piloto', bio: null }],
          professional_services: [{ professional_id: professional, service_id: service }],
        }
      } else if (body.action === 'availability') {
        payload = { slots: body.date === iso
          ? [{ slot_start: iso + 'T14:00:00.000Z', slot_end: iso + 'T14:30:00.000Z' }]
          : [] }
      } else {
        if (body.action === 'book') booked = true
        payload = { error: 'acao_desconhecida' }
      }
      await route.fulfill({ status: body.action === 'book' ? 503 : 200,
        contentType: 'application/json', body: JSON.stringify(payload) })
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(base + '/agendar/barbearia-piloto')
    await page.getByRole('heading', { name: 'Reserve seu horário' }).waitFor()
    await page.getByRole('button', { name: /Corte tradicional/ }).click()
    await page.getByRole('button', { name: /Barbeiro Piloto/ }).click()
    const todayMonth = new Intl.DateTimeFormat('en-CA', { timeZone, month: '2-digit' }).format(new Date())
    if (String(month).padStart(2, '0') !== iso.slice(5, 7)) {
      await page.getByRole('button', { name: 'Próximo mês' }).click()
    }
    await page.getByRole('button', { name: dateLabel, exact: true }).click()
    await page.getByRole('button', { name: '10:00', exact: true }).waitFor()
    await page.getByRole('button', { name: '10:00', exact: true }).click()
    await page.getByRole('heading', { name: 'Seus dados' }).waitFor()
    await page.getByText('Verificação de segurança não configurada. Tente novamente mais tarde.').waitFor()
    assert.equal(await page.getByRole('button', { name: /Confirmar agendamento/ }).isDisabled(), true)
    assert.equal(booked, false, 'Teste de interface nao pode reservar sem CAPTCHA')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 391,
      'Fluxo publico nao deve ter rolagem horizontal no celular')
  })
  assert.deepEqual(errors, [], 'Exceções JavaScript no navegador')
  console.log('PASS navegador: nenhuma exceção JavaScript')
} catch (err) {
  console.error('FALHA smoke navegador:', err)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
