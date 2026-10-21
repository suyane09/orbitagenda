export type MembershipRole = 'owner' | 'staff'
export type BusinessType = 'barbershop' | 'salon' | 'other'

export interface Establishment {
  id: string
  name: string
  slug: string
  business_type: BusinessType
  phone: string | null
  timezone: string
  created_at: string
}

export interface Membership {
  id: string
  role: MembershipRole
  establishment: Establishment
}

export interface Profile { id: string; full_name: string }

export interface TeamMember { membershipId: string; userId: string; name: string; role: MembershipRole; isActive: boolean }

export interface TodayAppointment { id: string; starts_at: string; ends_at: string; status: string }

export interface Service {
  id: string
  name: string
  description: string | null
  category: string | null
  duration_minutes: number
  price_cents: number
  is_active: boolean
}

export interface Professional {
  id: string
  name: string
  bio: string | null
  color: string
  is_active: boolean
  /** Serviços vinculados (professional_services). */
  serviceIds: string[]
}
