// All dates/times are displayed in the resort's local timezone (Beirut),
// never raw UTC. Date-only values are pinned to UTC noon so the calendar day
// is preserved when formatted into Asia/Beirut.

const TIME_ZONE = 'Asia/Beirut'

/** Today's calendar date (YYYY-MM-DD) in Asia/Beirut. */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}

/** Format a date-only (YYYY-MM-DD) or timestamp as a Beirut calendar date. */
export function formatDate(iso: string): string {
  const date = iso.length <= 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: TIME_ZONE,
  }).format(date)
}

/** Format a timestamp as a Beirut date + time. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(new Date(iso))
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
