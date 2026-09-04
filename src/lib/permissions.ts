import type { ResortRole, ResortStaff } from '../types/database'

export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard.read',
  DASHBOARD_WRITE: 'dashboard.write',
  INVITATIONS_BONUS: 'invitations.bonus',
  INVITATIONS_QUOTA: 'invitations.quota',
  ANNOUNCEMENTS_WRITE: 'announcements.write',
  STAFF_MANAGE: 'staff.manage',
  /** @deprecated Resort config is super-admin only — not assignable in role editors. */
  CONFIG_WRITE: 'config.write',
  /** @deprecated Prefer SCANNER_RECEPTION / SCANNER_GATE */
  SCANNER: 'scanner',
  SCANNER_RECEPTION: 'scanner.reception',
  SCANNER_GATE: 'scanner.gate',
  UNITS_WRITE: 'units.write',
  RENTALS_WRITE: 'rentals.write',
  ANALYTICS_READ: 'analytics.read',
  LISTINGS_WRITE: 'listings.write',
  EVENTS_WRITE: 'events.write',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** Permissions shown in role editors (deprecated entries omitted). */
export const ALL_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.DASHBOARD_WRITE,
  PERMISSIONS.INVITATIONS_QUOTA,
  PERMISSIONS.ANNOUNCEMENTS_WRITE,
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.SCANNER_RECEPTION,
  PERMISSIONS.SCANNER_GATE,
  PERMISSIONS.UNITS_WRITE,
  PERMISSIONS.RENTALS_WRITE,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.LISTINGS_WRITE,
  PERMISSIONS.EVENTS_WRITE,
]

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.read': 'View dashboard',
  'dashboard.write': 'Full dashboard write access',
  'invitations.bonus': 'Grant or remove bonus invitations',
  'invitations.quota': 'Manage invitation quotas',
  'announcements.write': 'Manage announcements',
  'staff.manage': 'Manage staff accounts',
  'config.write': 'Edit resort configuration (deprecated — super admin only)',
  scanner: 'Use scanner (reception & gate)',
  'scanner.reception': 'Reception scanner',
  'scanner.gate': 'Gate scanner',
  'units.write': 'Manage units',
  'rentals.write': 'Manage rentals',
  'analytics.read': 'View analytics',
  'listings.write': 'Manage marketplace listings',
  'events.write': 'Manage resort events',
}

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'dashboard.read': 'View Today, units, rentals, and read-only dashboard pages.',
  'dashboard.write': 'Create and edit units, rentals, announcements, and other dashboard data.',
  'invitations.bonus': 'Grant or remove extra weekday/weekend invitations for a unit for the current period.',
  'invitations.quota': 'Hand over, add, remove, and manage monthly invitation quotas per unit.',
  'announcements.write': 'Create, edit, and delete resort announcements.',
  'staff.manage': 'Add staff accounts, assign roles, and reset passwords.',
  'config.write': 'Deprecated. Invite limits and season settings are configured by platform super admins.',
  scanner: 'Scan invitation QR codes at reception and gate checkpoints.',
  'scanner.reception': 'Scan invitation QR codes at the reception checkpoint.',
  'scanner.gate': 'Scan invitation QR codes at the gate checkpoint.',
  'units.write': 'Add, edit, and delete chalets and cabines.',
  'rentals.write': 'Create and remove tenant rentals.',
  'analytics.read': 'View validated visit analytics and guest reports.',
  'listings.write': 'Create, edit, and permanently delete sale/rental marketplace listings.',
  'events.write': 'Create, edit, and publish resort events for the guest app.',
}

export type StaffWithRole = ResortStaff & { resort_roles?: ResortRole | null }

function expandPermissions(perms: Iterable<string>): Set<Permission> {
  const set = new Set<Permission>()
  for (const p of perms) {
    set.add(p as Permission)
    if (p === PERMISSIONS.SCANNER) {
      set.add(PERMISSIONS.SCANNER_RECEPTION)
      set.add(PERMISSIONS.SCANNER_GATE)
    }
    if (p === PERMISSIONS.INVITATIONS_BONUS) {
      set.add(PERMISSIONS.INVITATIONS_QUOTA)
    }
  }
  return set
}

export function permissionsForStaff(row: StaffWithRole): Set<Permission> {
  const role = row.resort_roles
  // Owner/admin no longer receive CONFIG_WRITE (super-admin-only settings).
  if (role?.is_owner) return new Set(ALL_PERMISSIONS)
  if (role?.permissions?.length) return expandPermissions(role.permissions)

  if (row.role === 'admin') return new Set(ALL_PERMISSIONS)
  if (row.role === 'viewer') return new Set([PERMISSIONS.DASHBOARD_READ, PERMISSIONS.ANALYTICS_READ])
  if (row.role === 'reception') {
    return new Set([PERMISSIONS.SCANNER_RECEPTION, PERMISSIONS.SCANNER_GATE])
  }
  return new Set()
}

export function staffHasPermission(rows: StaffWithRole[], permission: Permission): boolean {
  return rows.some((row) => permissionsForStaff(row).has(permission))
}

export function staffHasAnyScanner(rows: StaffWithRole[]): boolean {
  return (
    staffHasPermission(rows, PERMISSIONS.SCANNER_RECEPTION) ||
    staffHasPermission(rows, PERMISSIONS.SCANNER_GATE) ||
    staffHasPermission(rows, PERMISSIONS.SCANNER)
  )
}
