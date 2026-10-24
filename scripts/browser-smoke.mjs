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
  assert.deepEqual(errors, [], 'Exceções JavaScript no navegador')
  console.log('PASS navegador: nenhuma exceção JavaScript')
} catch (err) {
  console.error('FALHA smoke navegador:', err)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
