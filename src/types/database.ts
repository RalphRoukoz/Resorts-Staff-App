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

export type InvitationQuotaMode = 'automatic' | 'manual'

export type InviteQuotaUnitRow = {
  asset_id: string
  label: string
  asset_type: AssetType
  weekday_quota: number | null
  weekend_quota: number | null
  weekday_used: number
  weekend_used: number
  handed_over_at: string | null
  status: 'not_handed' | 'handed' | 'automatic'
  default_weekday: number
  default_weekend: number
  occupancy?: 'rented' | 'owner' | 'n/a'
  is_rented?: boolean
}

export interface Resort {
  id: string
  name: string
  weekend_days: number[]
  chalet_weekday_limit: number
  chalet_weekend_limit: number
  cabine_weekday_limit: number
  cabine_weekend_limit: number
  /** When true, hand-over uses owner vs tenant chalet limit pairs. */
  chalet_owner_tenant_limits_enabled?: boolean
  chalet_owner_weekday_limit?: number
  chalet_owner_weekend_limit?: number
  chalet_tenant_weekday_limit?: number
  chalet_tenant_weekend_limit?: number
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
  /** When false, marketplace listings tab/nav is hidden in owner app and staff dashboard. */
  marketplace_listings_enabled?: boolean
  map_enabled?: boolean
  map_image_url?: string | null
  events_enabled?: boolean
  gallery_enabled?: boolean
  info_enabled?: boolean
  public_phone?: string | null
  public_whatsapp?: string | null
  arrival_notes?: string | null
  gate_notes?: string | null
  /** Max guest invitations per visit_date resort-wide. null = unlimited. */
  daily_invitation_cap?: number | null
  /** Max days ahead invitations may be issued. null = unlimited. */
  max_advance_days?: number | null
  invitation_quota_mode?: InvitationQuotaMode
  distinct_guests_flag_chalet?: number
  distinct_guests_flag_cabine?: number
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
  /** @deprecated Single-device lock is global per phone; column ignored. */
  allow_multiple_logins: boolean
  /** When set and on/after today, unit cannot issue invitations. */
  invites_suspended_until?: string | null
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
  is_public?: boolean
  created_at: string
}

export type PoiType =
  | 'restaurant'
  | 'sports'
  | 'playground'
  | 'pool'
  | 'beach'
  | 'other'

export interface ResortMapPoi {
  id: string
  resort_id: string
  poi_type: PoiType
  title: string
  description: string | null
  image_url: string | null
  x_pct: number
  y_pct: number
  hours_json: Record<string, unknown> | null
  hours_note: string | null
  menu_urls: string[]
  sort_order: number
  is_published: boolean
  is_featured: boolean
  created_at: string
  updated_at: string
}

export interface ResortEvent {
  id: string
  resort_id: string
  title: string
  description: string | null
  cover_url: string | null
  starts_at: string
  ends_at: string | null
  location_label: string | null
  poi_id: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}

export interface ResortGalleryImage {
  id: string
  resort_id: string
  image_url: string
  caption: string | null
  sort_order: number
  is_published: boolean
  created_at: string
}

export interface ResortFaq {
  id: string
  resort_id: string
  question: string
  answer: string
  sort_order: number
  is_published: boolean
  created_at: string
}

export type ListingType = 'sale' | 'rental'

export interface MarketplaceListing {
  id: string
  resort_id: string
  listing_type: ListingType
  title: string
  description: string | null
  price_usd: number
  size_sqm: number | null
  beds: number | null
  baths: number | null
  block: string | null
  floor_number: string | null
  chalet_number: string | null
  images: string[]
  cover_url: string | null
  call_phone: string | null
  whatsapp_phone: string | null
  is_featured: boolean
  is_published: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
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
  /** Checkpoint that consumed the code (reception or gate), when known. */
  checkpoint?: ScanCheckpoint
  invitee?: string
  chalet?: string
  valid_for?: string
}

export type ValidateResult = ValidateSuccess | ValidateFailure

export interface StatusCount {
  status: InvitationStatus
  count: number
}
