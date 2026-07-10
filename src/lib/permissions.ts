import type { ResortRole, ResortStaff } from '../types/database'

export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard.read',
  DASHBOARD_WRITE: 'dashboard.write',
  INVITATIONS_BONUS: 'invitations.bonus',
  ANNOUNCEMENTS_WRITE: 'announcements.write',
  STAFF_MANAGE: 'staff.manage',
  CONFIG_WRITE: 'config.write',
  /** @deprecated Prefer SCANNER_RECEPTION / SCANNER_GATE */
  SCANNER: 'scanner',
  SCANNER_RECEPTION: 'scanner.reception',
  SCANNER_GATE: 'scanner.gate',
  UNITS_WRITE: 'units.write',
  RENTALS_WRITE: 'rentals.write',
  ANALYTICS_READ: 'analytics.read',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** Permissions shown in role editors (legacy combined scanner omitted). */
export const ALL_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.DASHBOARD_WRITE,
  PERMISSIONS.INVITATIONS_BONUS,
  PERMISSIONS.ANNOUNCEMENTS_WRITE,
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.CONFIG_WRITE,
  PERMISSIONS.SCANNER_RECEPTION,
  PERMISSIONS.SCANNER_GATE,
  PERMISSIONS.UNITS_WRITE,
  PERMISSIONS.RENTALS_WRITE,
  PERMISSIONS.ANALYTICS_READ,
]

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.read': 'View dashboard',
  'dashboard.write': 'Full dashboard write access',
  'invitations.bonus': 'Grant bonus invitations',
  'announcements.write': 'Manage announcements',
  'staff.manage': 'Manage staff accounts',
  'config.write': 'Edit resort configuration',
  scanner: 'Use scanner (reception & gate)',
  'scanner.reception': 'Reception scanner',
  'scanner.gate': 'Gate scanner',
  'units.write': 'Manage units',
  'rentals.write': 'Manage rentals',
  'analytics.read': 'View analytics',
}

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'dashboard.read': 'View Today, units, rentals, and read-only dashboard pages.',
  'dashboard.write': 'Create and edit units, rentals, announcements, and other dashboard data.',
  'invitations.bonus': 'Grant extra weekday/weekend invitations to a chalet for the current period.',
  'announcements.write': 'Create, edit, and delete resort announcements.',
  'staff.manage': 'Add staff accounts, assign roles, and reset passwords.',
  'config.write': 'Change resort invite limits, season dates, and scanner settings.',
  scanner: 'Scan invitation QR codes at reception and gate checkpoints.',
  'scanner.reception': 'Scan invitation QR codes at the reception checkpoint.',
  'scanner.gate': 'Scan invitation QR codes at the gate checkpoint.',
  'units.write': 'Add, edit, and delete chalets and cabines.',
  'rentals.write': 'Create and remove tenant rentals.',
  'analytics.read': 'View validated visit analytics and guest reports.',
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
  }
  return set
}

export function permissionsForStaff(row: StaffWithRole): Set<Permission> {
  const role = row.resort_roles
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
