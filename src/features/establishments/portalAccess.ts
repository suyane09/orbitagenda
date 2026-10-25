import type { Membership } from '@/types/models'

/**
 * Superadmins never gain operational access to an unrelated establishment.
 * Their merchant view is allowed only through a genuine owner membership,
 * and the database still enforces its own tenant RLS and billing policies.
 */
export function mayUseMerchantPortal(isSuperadmin: boolean, role: Membership['role'] | undefined): boolean {
  return !isSuperadmin || role === 'owner'
}

export function isPlatformRoute(isSuperadmin: boolean, pathname: string): boolean {
  return isSuperadmin && (pathname === '/plataforma' || pathname.startsWith('/plataforma/'))
}

export function portalHome(isSuperadmin: boolean): '/plataforma' | '/app' {
  return isSuperadmin ? '/plataforma' : '/app'
}
