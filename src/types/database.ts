export type StaffRole = 'admin' | 'reception' | 'viewer' | 'staff'

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

export type PaymentStatus = 'not_required' | 'pending' | 'paid'

export type InvitationPeriodMode = 'monthly' | 'whole_period'

export type PeriodAllowanceMode = 'monthly_within_period' | 'entire_period'

export type ScanCheckpoint = 'reception' | 'gate'

export type DayType = 'weekday' | 'weekend'

export interface Resort {
  id: string
  name: string
  weekend_days: number[]
  chalet_weekday_limit: number
  chalet_weekend_limit: number
  cabine_weekday_limit: number
  cabine_weekend_limit: number
  cabine_invites_enabled: boolean
  cabine_limit_invites: boolean
  cabine_paid_invites: boolean
  chalet_double_scan: boolean
  invitation_period_mode: InvitationPeriodMode
  invitation_period_start: string | null
  invitation_period_end: string | null
  period_allowance_mode: PeriodAllowanceMode
  logo_url: string | null
  primary_color: string | null
  created_at: string
}

export interface Asset {
  id: string
  resort_id: string
  label: string
  owner_phones: string[]
  owner_first_name: string | null
  owner_last_name: string | null
  asset_type: AssetType
  weekday_limit: number | null
  weekend_limit: number | null
  created_at: string
}

export interface Tenancy {
  id: string
  asset_id: string
  tenant_phone: string
  tenant_first_name: string | null
  tenant_last_name: string | null
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
  payment_status: PaymentStatus
  reception_scanned_at: string | null
  reception_scanned_by: string | null
  gate_scanned_at: string | null
  gate_scanned_by: string | null
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
  resort_role_id: string | null
  username: string | null
}

export interface ResortRole {
  id: string
  resort_id: string
  name: string
  permissions: string[]
  is_owner: boolean
  is_system: boolean
  created_at: string
}

export interface InviteAllowanceBucket {
  base: number
  bonus: number
  total: number | null
  used: number
  remaining: number | null
}

export interface AssetInviteAllowance {
  month: string
  unlimited?: boolean
  period_label?: string
  period_start?: string
  period_end?: string
  period_mode?: InvitationPeriodMode
  weekday: InviteAllowanceBucket
  weekend: InviteAllowanceBucket
}

export interface Announcement {
  id: string
  resort_id: string
  title: string
  body: string | null
  pdf_url: string | null
  audience: Audience
  expires_at: string | null
  created_at: string
}

export interface ValidateSuccess {
  ok: true
  invitee: string
  chalet: string
  resort: string
  visit_date: string
  checkpoint?: ScanCheckpoint
  next_checkpoint?: ScanCheckpoint
  final?: boolean
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
