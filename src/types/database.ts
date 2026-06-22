export type StaffRole = 'admin' | 'reception'

export type InvitationStatus = 'issued' | 'validated' | 'cancelled' | 'expired'

export type DayType = 'weekday' | 'weekend'

export interface Resort {
  id: string
  name: string
  weekend_days: number[]
  default_weekday_limit: number
  default_weekend_limit: number
  max_invites_per_invitee_month: number | null
  created_at: string
}

export interface Asset {
  id: string
  resort_id: string
  label: string
  owner_phone: string
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

export interface BlockedInvitee {
  id: string
  resort_id: string
  invitee_phone: string
  reason: string | null
  created_at: string
}

export interface InviteeActivity {
  resort_id: string
  invitee_phone: string
  invites_this_month: number
  distinct_chalets_this_month: number
  invites_all_time: number
  last_invited_at: string | null
}

export interface ResortStaff {
  id: string
  resort_id: string
  user_id: string
  role: StaffRole
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
