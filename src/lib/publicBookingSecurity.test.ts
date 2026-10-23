import { describe, expect, it, vi } from 'vitest'
import { clientIp, hashKey, verifyTurnstile } from '../../supabase/functions/public-booking/security'

const h = (o: Record<string, string>) => new Headers(o)
const res = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('public-booking · segurança', () => {
  it('clientIp prefere cf-connecting-ip e rejeita lixo', () => {
    expect(clientIp(h({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.9')
    expect(clientIp(h({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' }))).toBe('198.51.100.7')
    expect(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }))).toBe('198.51.100.7') // item do cliente ignorado
    expect(clientIp(h({ 'cf-connecting-ip': '2001:db8::1' }))).toBe('2001:db8::1')
    expect(clientIp(h({ 'cf-connecting-ip': '999.1.1.1' }))).toBe('unknown')
    expect(clientIp(h({ 'cf-connecting-ip': '<script>' }))).toBe('unknown')
    expect(clientIp(h({}))).toBe('unknown')
  })
  it('hashKey é determinístico, depende do sal e do escopo e não contém o valor', async () => {
    const a = await hashKey('salt', 'bip10', '203.0.113.9')
    expect(a).toBe(await hashKey('salt', 'bip10', '203.0.113.9'))
    expect(a).not.toBe(await hashKey('outro', 'bip10', '203.0.113.9'))
    expect(a).not.toBe(await hashKey('salt', 'bph', '203.0.113.9'))
    expect(a).not.toContain('203')
    expect(a.length).toBeLessThanOrEqual(128)
  })
  it('verifyTurnstile: sucesso, falha, ação errada, hostname errado e indisponível', async () => {
    const base = { secret: 's', token: 'x'.repeat(20), ip: '203.0.113.9' }
    expect(await verifyTurnstile({ ...base, fetchFn: () => res({ success: true, action: 'public_booking', hostname: 'app.exemplo.com' }) })).toBe('ok')
    expect(await verifyTurnstile({ ...base, fetchFn: () => res({ success: false }) })).toBe('failed')
    expect(await verifyTurnstile({ ...base, fetchFn: () => res({ success: true, action: 'login' }) })).toBe('failed')
    expect(await verifyTurnstile({ ...base, fetchFn: () => res({ success: true }) })).toBe('failed') // ação ausente
    expect(await verifyTurnstile({ ...base, fetchFn: () => res({ success: true, action: '' }) })).toBe('failed')
    expect(await verifyTurnstile({ ...base, allowedHostnames: ['app.exemplo.com'], fetchFn: () => res({ success: true, action: 'public_booking', hostname: 'evil.com' }) })).toBe('failed')
    expect(await verifyTurnstile({ ...base, allowedHostnames: ['app.exemplo.com'], fetchFn: () => res({ success: true, action: 'public_booking', hostname: 'APP.exemplo.com' }) })).toBe('ok')
    expect(await verifyTurnstile({ ...base, fetchFn: () => res({}, 500) })).toBe('unavailable')
    expect(await verifyTurnstile({ ...base, fetchFn: () => Promise.reject(new Error('rede')) })).toBe('unavailable')
    expect(await verifyTurnstile({ ...base, token: '' })).toBe('failed')
  })
  it('verifyTurnstile envia segredo e token só no corpo POST', async () => {
    const fn = vi.fn(() => res({ success: true, action: 'public_booking' }))
    await verifyTurnstile({ secret: 'SEGREDO', token: 'tok'.repeat(10), ip: '203.0.113.9', fetchFn: fn as unknown as typeof fetch })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('SEGREDO')
    expect(String(init.body)).toContain('secret=SEGREDO')
  })
})
