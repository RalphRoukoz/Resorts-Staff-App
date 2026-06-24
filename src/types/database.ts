export type StaffRole = 'admin' | 'reception'

export type AssetType = 'chalet' | 'cabine'

export type Audience = 'chalet' | 'cabine' | 'both'

export interface SuperAdmin {
  user_id: string
}

export interface ResortWithStats extends Resort {
  chalet_count: number
  invitation_count: number
}

export type InvitationStatus = 'issued' | 'validated' | 'cancelled' | 'expired'

export type DayType = 'weekday' | 'weekend'

export interface Resort {
  id: string
  name: string
  weekend_days: number[]
  chalet_weekday_limit: number
  chalet_weekend_limit: number
  cabine_weekday_limit: number
  cabine_weekend_limit: number
  logo_url: string | null
  primary_color: string | null
  created_at: string
}

export interface Asset {
  id: string
  resort_id: string
  label: string
  owner_phone: string
  asset_type: AssetType
  weekday_limit: number | null
  weekend_limit: number | null
  created_at: string
}

export interface Tenancy {
  id: string
  asset_id: string
  tenant_phone: string
  starts_on: string
  ends_on: string
  created_at: string
}

export interface TenancyWithAsset extends Tenancy {
  assets: Pick<Asset, 'label' | 'resort_id'>
}

export interface Invitation {
  id: string
  asset_id: string
  issued_by_phone: string
  invitee_name: string
  invitee_phone: string | null
  visit_date: string
  day_type: DayType
  token: string
  status: InvitationStatus
  validated_at: string | null
  validated_by: string | null
  created_at: string
}

export interface InvitationWithChalet extends Invitation {
  assets: Pick<Asset, 'label'>
}

export interface ResortStaff {
  id: string
  resort_id: string
  user_id: string
  role: StaffRole
  username: string | null
}

export interface Announcement {
  id: string
  resort_id: string
  title: string
  body: string | null
  pdf_url: string | null
  audience: Audience
  created_at: string
}

export interface ValidateSuccess {
  ok: true
  invitee: string
  chalet: string
  resort: string
  visit_date: string
}

export interface ValidateFailure {
  ok: false
  reason: string
  validated_at?: string
  invitee?: string
  chalet?: string
  valid_for?: string
}

export type ValidateResult = ValidateSuccess | ValidateFailure

export interface StatusCount {
  status: InvitationStatus
  count: number
}
