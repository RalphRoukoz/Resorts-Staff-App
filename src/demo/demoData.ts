import type { AnalyticsPayload } from './types'

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true' || window.location.pathname.startsWith('/demo')
}

export const demoResort = {
  id: 'demo-resort',
  name: 'Azure Bay Resort',
  weekend_days: [5, 6],
  chalet_weekday_limit: 8,
  chalet_weekend_limit: 4,
  cabine_weekday_limit: 3,
  cabine_weekend_limit: 2,
  cabine_invites_enabled: true,
  cabine_limit_invites: true,
  cabine_paid_invites: true,
  chalet_double_scan: false,
  invitation_period_mode: 'whole_period' as const,
  invitation_period_start: '2026-06-01',
  invitation_period_end: '2026-09-30',
  period_allowance_mode: 'monthly_within_period' as const,
  logo_url: null,
  primary_color: '#0E7C7B',
  created_at: new Date().toISOString(),
}

export const demoAnalytics: AnalyticsPayload = {
  totals: { visits: 47, unique_guests: 31 },
  daily: [
    { date: '2026-06-01', visits: 2 },
    { date: '2026-06-05', visits: 5 },
    { date: '2026-06-12', visits: 8 },
    { date: '2026-06-18', visits: 11 },
    { date: '2026-06-24', visits: 9 },
  ],
  by_unit: [
    { label: 'Chalet 14', visits: 14 },
    { label: 'Chalet 22', visits: 11 },
    { label: 'Cabine 7', visits: 9 },
    { label: 'Chalet 3', visits: 8 },
  ],
  guests: [
    { name: 'Nadia Khoury', unit: 'Chalet 14', visits: 6, last_visit: '2026-06-28' },
    { name: 'Karim Mansour', unit: 'Cabine 7', visits: 4, last_visit: '2026-06-25' },
    { name: 'Layla Haddad', unit: 'Chalet 22', visits: 3, last_visit: '2026-06-20' },
  ],
  weekday: 29,
  weekend: 18,
  date_from: '2026-06-01',
  date_to: '2026-06-30',
}
