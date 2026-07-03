import type { ResortRole, ResortStaff } from '../types/database'

export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard.read',
  DASHBOARD_WRITE: 'dashboard.write',
  INVITATIONS_BONUS: 'invitations.bonus',
  ANNOUNCEMENTS_WRITE: 'announcements.write',
  STAFF_MANAGE: 'staff.manage',
  CONFIG_WRITE: 'config.write',
  SCANNER: 'scanner',
  UNITS_WRITE: 'units.write',
  RENTALS_WRITE: 'rentals.write',
  ANALYTICS_READ: 'analytics.read',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.read': 'View dashboard',
  'dashboard.write': 'Full dashboard write access',
  'invitations.bonus': 'Grant bonus invitations',
  'announcements.write': 'Manage announcements',
  'staff.manage': 'Manage staff accounts',
  'config.write': 'Edit resort configuration',
  scanner: 'Use scanner (reception & gate)',
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
  'units.write': 'Add, edit, and delete chalets and cabines.',
  'rentals.write': 'Create and remove tenant rentals.',
  'analytics.read': 'View validated visit analytics and guest reports.',
}

export type StaffWithRole = ResortStaff & { resort_roles?: ResortRole | null }

export function permissionsForStaff(row: StaffWithRole): Set<Permission> {
  const role = row.resort_roles
  if (role?.is_owner) return new Set(ALL_PERMISSIONS)
  if (role?.permissions?.length) return new Set(role.permissions as Permission[])

  if (row.role === 'admin') return new Set(ALL_PERMISSIONS)
  if (row.role === 'viewer') return new Set([PERMISSIONS.DASHBOARD_READ, PERMISSIONS.ANALYTICS_READ])
  if (row.role === 'reception') return new Set([PERMISSIONS.SCANNER])
  return new Set()
}

export function staffHasPermission(rows: StaffWithRole[], permission: Permission): boolean {
  return rows.some((row) => permissionsForStaff(row).has(permission))
}
