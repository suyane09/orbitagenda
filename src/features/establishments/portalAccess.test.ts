import { describe, expect, it } from 'vitest'
import { isPlatformRoute, mayUseMerchantPortal, portalHome } from './portalAccess'

describe('separate platform and barbershop portal', () => {
  it('defaults superadmin to platform while standard users enter own establishment', () => {
    expect(portalHome(true)).toBe('/plataforma')
    expect(portalHome(false)).toBe('/app')
  })

  it('requires real owner membership for superadmin merchant access', () => {
    expect(mayUseMerchantPortal(true, undefined)).toBe(false)
    expect(mayUseMerchantPortal(true, 'staff')).toBe(false)
    expect(mayUseMerchantPortal(true, 'owner')).toBe(true)
    expect(mayUseMerchantPortal(false, 'staff')).toBe(true)
  })

  it('keeps admin navigation independent from merchant routes', () => {
    expect(isPlatformRoute(true, '/plataforma')).toBe(true)
    expect(isPlatformRoute(true, '/plataforma/whatsapp-teste')).toBe(true)
    expect(isPlatformRoute(true, '/app')).toBe(false)
    expect(isPlatformRoute(true, '/app/agenda')).toBe(false)
    expect(isPlatformRoute(false, '/plataforma')).toBe(false)
    expect(isPlatformRoute(true, '/plataforma-fake')).toBe(false)
  })
})
