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
  scanner: 'Use reception scanner',
  'units.write': 'Manage units',
  'rentals.write': 'Manage rentals',
  'analytics.read': 'View analytics',
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
