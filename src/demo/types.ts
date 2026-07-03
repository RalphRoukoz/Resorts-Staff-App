export interface AnalyticsPayload {
  totals: { visits: number; unique_guests: number }
  daily: { date?: string; day?: number; visits: number }[]
  by_unit: { label: string; visits: number }[]
  guests: { name: string; unit: string; visits: number; last_visit: string }[]
  weekday: number
  weekend: number
  date_from: string
  date_to: string
}
