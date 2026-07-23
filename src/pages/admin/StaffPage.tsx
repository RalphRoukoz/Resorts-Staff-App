import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { createStaffAccount, deleteStaffAccount, resetStaffPassword } from '../../lib/edgeFunctions'
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
  type Permission,
} from '../../lib/permissions'
import { supabase } from '../../lib/supabase'
import type { ResortRole, ResortStaff, StaffRole } from '../../types/database'

type StaffWithRole = ResortStaff & { resort_roles?: ResortRole | null }

type RoleChoice =
  | { kind: 'preset'; role: 'admin' | 'viewer' | 'reception' }
  | { kind: 'system'; roleId: string }
  | { kind: 'custom'; roleId: string }

const PRESET_LABELS: Record<'admin' | 'viewer' | 'reception', string> = {
  admin: 'Full admin',
  viewer: 'Viewer (read-only)',
  reception: 'Scanner (reception & gate) — legacy',
}

const SYSTEM_SCANNER_NAMES = ['Reception scanner', 'Gate scanner'] as const

function generatePassword(length = 12): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function roleLabel(row: StaffWithRole): string {
  if (row.resort_roles?.name) return row.resort_roles.name
  if (row.role === 'admin') return PRESET_LABELS.admin
  if (row.role === 'viewer') return PRESET_LABELS.viewer
  if (row.role === 'reception') return 'Scanner (reception & gate)'
  return row.role
}

function choiceKey(choice: RoleChoice): string {
  if (choice.kind === 'preset') return `preset:${choice.role}`
  if (choice.kind === 'system') return `system:${choice.roleId}`
  return `custom:${choice.roleId}`
}

function choiceFromStaff(row: StaffWithRole): RoleChoice {
  if (row.resort_role_id && row.resort_roles?.is_system) {
    return { kind: 'system', roleId: row.resort_role_id }
  }
  if (row.resort_role_id) return { kind: 'custom', roleId: row.resort_role_id }
  if (row.role === 'admin' || row.role === 'viewer' || row.role === 'reception') {
    return { kind: 'preset', role: row.role }
  }
  return { kind: 'preset', role: 'viewer' }
}

export function StaffPage() {
  const { t } = useTranslation()
  const { resortId } = useAuth()

  const [staff, setStaff] = useState<StaffWithRole[]>([])
  const [roles, setRoles] = useState<ResortRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [roleChoice, setRoleChoice] = useState<RoleChoice>({ kind: 'preset', role: 'viewer' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null)

  const [resetTarget, setResetTarget] = useState<StaffWithRole | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [roleName, setRoleName] = useState('')
  const [rolePermissions, setRolePermissions] = useState<Permission[]>([])
  const [roleFormError, setRoleFormError] = useState<string | null>(null)
  const [roleSaving, setRoleSaving] = useState(false)

  const customRoles = roles.filter((r) => !r.is_owner && !r.is_system)
  const systemScannerRoles = SYSTEM_SCANNER_NAMES.map(
    (name) => roles.find((r) => r.is_system && r.name === name) ?? null,
  ).filter((r): r is ResortRole => r != null)

  const loadData = useCallback(async () => {
    if (!resortId) {
      setStaff([])
      setRoles([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const [staffRes, rolesRes] = await Promise.all([
      supabase
        .from('resort_staff')
        .select(
          'id, resort_id, user_id, role, resort_role_id, username, resort_roles(id, resort_id, name, permissions, is_owner, is_system, created_at)',
        )
        .eq('resort_id', resortId)
        .order('username')
        .limit(200),
      supabase
        .from('resort_roles')
        .select('id, resort_id, name, permissions, is_owner, is_system, created_at')
        .eq('resort_id', resortId)
        .order('is_owner', { ascending: false })
        .order('name')
        .limit(100),
    ])

    if (staffRes.error) setError(staffRes.error.message)
    else setStaff((staffRes.data ?? []) as unknown as StaffWithRole[])

    if (rolesRes.error) setError(rolesRes.error.message)
    else setRoles((rolesRes.data ?? []) as ResortRole[])

    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openCreate() {
    setUsername('')
    setPassword(generatePassword())
    setRoleChoice(
      systemScannerRoles[0]
        ? { kind: 'system', roleId: systemScannerRoles[0].id }
        : { kind: 'preset', role: 'reception' },
    )
    setFormError(null)
    setCreateOpen(true)
  }

  async function applyRoleChoice(staffId: string, choice: RoleChoice) {
    const patch: { role: StaffRole; resort_role_id: string | null } =
      choice.kind === 'preset'
        ? { role: choice.role, resort_role_id: null }
        : { role: 'staff', resort_role_id: choice.roleId }

    const { error: updateError } = await supabase.from('resort_staff').update(patch).eq('id', staffId)
    if (updateError) throw new Error(updateError.message)
  }

  async function handleCreate() {
    if (!resortId) return
    if (!username.trim()) {
      setFormError('Username is required')
      return
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters')
      return
    }

    setSaving(true)
    setFormError(null)

    const legacyRole: 'admin' | 'reception' | 'viewer' =
      roleChoice.kind === 'preset'
        ? roleChoice.role
        : roleChoice.kind === 'system'
          ? 'reception'
          : 'viewer'

    const result = await createStaffAccount({
      username: username.trim(),
      password,
      role: legacyRole,
      resort_id: resortId,
    })

    if (!result.ok) {
      setFormError(result.message)
      setSaving(false)
      return
    }

    const { data: created, error: fetchError } = await supabase
      .from('resort_staff')
      .select('id')
      .eq('resort_id', resortId)
      .eq('username', username.trim())
      .maybeSingle()

    if (fetchError || !created) {
      setFormError(fetchError?.message ?? 'Account created but role assignment failed. Refresh and try again.')
      setSaving(false)
      return
    }

    try {
      await applyRoleChoice(created.id, roleChoice)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Role assignment failed')
      setSaving(false)
      return
    }

    setCreateOpen(false)
    setCredentials({ username: username.trim(), password })
    await loadData()
    setSaving(false)
  }

  async function handleRoleChange(row: StaffWithRole, choice: RoleChoice) {
    if (row.resort_roles?.is_owner) return
    setError(null)
    try {
      await applyRoleChoice(row.id, choice)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  function openReset(row: StaffWithRole) {
    setResetTarget(row)
    setResetPasswordValue(generatePassword())
    setResetError(null)
    setResetSuccess(null)
  }

  async function handleReset() {
    if (!resetTarget) return
    if (resetPasswordValue.length < 6) {
      setResetError('Password must be at least 6 characters')
      return
    }

    setResetting(true)
    setResetError(null)

    const result = await resetStaffPassword(resetTarget.user_id, resetPasswordValue)

    if (!result.ok) {
      setResetError(result.message)
      setResetting(false)
      return
    }

    setResetSuccess(`Password reset for ${resetTarget.username ?? 'account'}. Share it now: ${resetPasswordValue}`)
    setResetTarget(null)
    setResetting(false)
  }

  async function handleRemove(row: StaffWithRole) {
    if (row.resort_roles?.is_owner) return
    if (!confirm(`Remove staff "${row.username ?? 'this account'}"?`)) return

    const result = await deleteStaffAccount(row.id)
    if (!result.ok) setError(result.message)
    else await loadData()
  }

  function openRoleCreate() {
    setRoleName('')
    setRolePermissions([])
    setRoleFormError(null)
    setRoleModalOpen(true)
  }

  function toggleRolePermission(perm: Permission) {
    setRolePermissions((current) =>
      current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm],
    )
  }

  async function handleRoleCreate() {
    if (!resortId) return
    if (!roleName.trim()) {
      setRoleFormError('Role name is required')
      return
    }
    if (rolePermissions.length === 0) {
      setRoleFormError('Select at least one permission')
      return
    }

    setRoleSaving(true)
    setRoleFormError(null)

    const { error: insertError } = await supabase.from('resort_roles').insert({
      resort_id: resortId,
      name: roleName.trim(),
      permissions: rolePermissions,
      is_owner: false,
      is_system: false,
    })

    if (insertError) setRoleFormError(insertError.message)
    else {
      setRoleModalOpen(false)
      await loadData()
    }
    setRoleSaving(false)
  }

  async function handleDeleteRole(role: ResortRole) {
    if (role.is_system || role.is_owner) return
    if (!confirm(`Delete role "${role.name}"? Staff assigned to it will lose their role link.`)) return

    const { error: deleteError } = await supabase.from('resort_roles').delete().eq('id', role.id)
    if (deleteError) setError(deleteError.message)
    else await loadData()
  }

  async function handleUpdateRolePermissions(role: ResortRole, next: Permission[]) {
    if (role.is_owner) return
    const { error: updateError } = await supabase.from('resort_roles').update({ permissions: next }).eq('id', role.id)
    if (updateError) setError(updateError.message)
    else await loadData()
  }

  if (loading) return <Spinner label={t('staff.loading')} />

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('staff.title')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('staff.subtitle')}</p>
        </div>
        <Button onClick={openCreate} disabled={!resortId}>
          {t('staff.addStaff')}
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {resetSuccess ? (
        <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {resetSuccess}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">{t('staff.usernameCol')}</th>
              <th className="px-4 py-3 font-medium">{t('staff.roleCol')}</th>
              <th className="px-4 py-3 font-medium">{t('staff.actionsCol')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((row) => {
              const isOwner = row.resort_roles?.is_owner
              return (
                <tr key={row.id} className="transition hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-[#1A1A1A]">{row.username ?? '—'}</td>
                  <td className="px-4 py-3">
                    {isOwner ? (
                      <span className="rounded-full bg-[#E1F3FE] px-2.5 py-1 text-xs font-medium text-[#1F6C9F]">
                        {roleLabel(row)}
                      </span>
                    ) : (
                      <select
                        className="w-full max-w-xs rounded-xl border border-[#ECECEC] bg-white px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                        value={choiceKey(choiceFromStaff(row))}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value.startsWith('preset:')) {
                            const role = value.replace('preset:', '') as 'admin' | 'viewer' | 'reception'
                            void handleRoleChange(row, { kind: 'preset', role })
                          } else if (value.startsWith('system:')) {
                            void handleRoleChange(row, {
                              kind: 'system',
                              roleId: value.replace('system:', ''),
                            })
                          } else if (value.startsWith('custom:')) {
                            void handleRoleChange(row, { kind: 'custom', roleId: value.replace('custom:', '') })
                          }
                        }}
                      >
                        <optgroup label={t('staff.presetRoles')}>
                          <option value="preset:admin">{PRESET_LABELS.admin}</option>
                          {systemScannerRoles.map((role) => (
                            <option key={role.id} value={`system:${role.id}`}>
                              {role.name}
                            </option>
                          ))}
                          <option value="preset:viewer">{PRESET_LABELS.viewer}</option>
                          {(() => {
                            const current = choiceFromStaff(row)
                            return current.kind === 'preset' && current.role === 'reception' ? (
                              <option value="preset:reception">{PRESET_LABELS.reception}</option>
                            ) : null
                          })()}
                        </optgroup>
                        {customRoles.length > 0 ? (
                          <optgroup label={t('staff.customRoles')}>
                            {customRoles.map((role) => (
                              <option key={role.id} value={`custom:${role.id}`}>
                                {role.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => openReset(row)}>
                        {t('staff.resetPassword')}
                      </Button>
                      {!isOwner ? (
                        <Button variant="danger" onClick={() => void handleRemove(row)}>
                          {t('staff.remove')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
            {staff.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-gray-400">
                  {t('staff.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium text-[#1A1A1A]">{t('staff.customRolesTitle')}</h3>
            <p className="mt-1 text-sm text-gray-500">{t('staff.customRolesHint')}</p>
          </div>
          <Button variant="secondary" onClick={openRoleCreate}>
            {t('staff.addRole')}
          </Button>
        </div>

        <div className="space-y-3">
          {customRoles.map((role) => (
            <div key={role.id} className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium text-[#1A1A1A]">{role.name}</h4>
                <Button variant="danger" onClick={() => void handleDeleteRole(role)}>
                  {t('staff.deleteRole')}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_PERMISSIONS.map((perm) => {
                  const checked = role.permissions.includes(perm)
                  return (
                    <label key={perm} className="group relative flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? (role.permissions.filter((p) => p !== perm) as Permission[])
                            : ([...role.permissions, perm] as Permission[])
                          void handleUpdateRolePermissions(role, next)
                        }}
                      />
                      <span className="text-gray-700 underline decoration-dotted decoration-gray-300 underline-offset-2">
                        {PERMISSION_LABELS[perm]}
                      </span>
                      <span className="pointer-events-none absolute start-0 bottom-full z-20 mb-1 hidden w-64 rounded-lg border border-[#ECECEC] bg-white p-2 text-xs font-normal text-gray-600 shadow-md group-hover:block">
                        {PERMISSION_DESCRIPTIONS[perm]}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
          {customRoles.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#ECECEC] bg-white px-4 py-8 text-center text-sm text-gray-400">
              {t('staff.noCustomRoles')}
            </p>
          ) : null}
        </div>
      </section>

      {createOpen ? (
        <Modal
          title={t('staff.createTitle')}
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleCreate()} disabled={saving}>
                {saving ? t('staff.creating') : t('staff.createAccount')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label={t('staff.usernameCol')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <div>
              <Input
                label={t('login.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <Button variant="ghost" className="mt-2" onClick={() => setPassword(generatePassword())}>
                {t('staff.regeneratePassword')}
              </Button>
            </div>
            <div>
              <label htmlFor="staff-role" className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('staff.roleCol')}
              </label>
              <select
                id="staff-role"
                className="w-full rounded-xl border border-[#ECECEC] bg-white px-3.5 py-2.5 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                value={choiceKey(roleChoice)}
                onChange={(e) => {
                  const value = e.target.value
                  if (value.startsWith('preset:')) {
                    setRoleChoice({
                      kind: 'preset',
                      role: value.replace('preset:', '') as 'admin' | 'viewer' | 'reception',
                    })
                  } else if (value.startsWith('system:')) {
                    setRoleChoice({ kind: 'system', roleId: value.replace('system:', '') })
                  } else if (value.startsWith('custom:')) {
                    setRoleChoice({ kind: 'custom', roleId: value.replace('custom:', '') })
                  }
                }}
              >
                <optgroup label={t('staff.presetRoles')}>
                  <option value="preset:admin">{PRESET_LABELS.admin}</option>
                  {systemScannerRoles.map((role) => (
                    <option key={role.id} value={`system:${role.id}`}>
                      {role.name}
                    </option>
                  ))}
                  <option value="preset:viewer">{PRESET_LABELS.viewer}</option>
                </optgroup>
                {customRoles.length > 0 ? (
                  <optgroup label={t('staff.customRoles')}>
                    {customRoles.map((role) => (
                      <option key={role.id} value={`custom:${role.id}`}>
                        {role.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {resetTarget ? (
        <Modal
          title={t('staff.resetTitle', { username: resetTarget.username ?? 'account' })}
          onClose={() => setResetTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleReset()} disabled={resetting}>
                {resetting ? t('staff.resetting') : t('staff.resetPassword')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{t('staff.resetHint')}</p>
            <div>
              <Input
                label={t('staff.newPassword')}
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
                autoComplete="new-password"
              />
              <Button variant="ghost" className="mt-2" onClick={() => setResetPasswordValue(generatePassword())}>
                {t('staff.regeneratePassword')}
              </Button>
            </div>
            {resetError ? <p className="text-sm text-red-600">{resetError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {credentials ? (
        <Modal title={t('staff.credentialsTitle')} onClose={() => setCredentials(null)}>
          <p className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {t('staff.credentialsHint')}
          </p>
          <div className="space-y-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] p-4 font-mono text-sm">
            <p>
              <span className="text-gray-400">{t('staff.usernameCol')}: </span>
              <span className="text-[#1A1A1A]">{credentials.username}</span>
            </p>
            <p>
              <span className="text-gray-400">{t('login.password')}: </span>
              <span className="text-[#1A1A1A]">{credentials.password}</span>
            </p>
          </div>
        </Modal>
      ) : null}

      {roleModalOpen ? (
        <Modal
          title={t('staff.addRole')}
          onClose={() => setRoleModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRoleModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleRoleCreate()} disabled={roleSaving}>
                {roleSaving ? t('staff.creating') : t('staff.createRole')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label={t('staff.roleName')} value={roleName} onChange={(e) => setRoleName(e.target.value)} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700">{t('staff.permissions')}</legend>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {ALL_PERMISSIONS.map((perm) => (
                  <label key={perm} className="group relative flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={rolePermissions.includes(perm)}
                      onChange={() => toggleRolePermission(perm)}
                    />
                    <span className="underline decoration-dotted decoration-gray-300 underline-offset-2">
                      {PERMISSION_LABELS[perm]}
                    </span>
                    <span className="pointer-events-none absolute start-0 bottom-full z-20 mb-1 hidden w-64 rounded-lg border border-[#ECECEC] bg-white p-2 text-xs font-normal text-gray-600 shadow-md group-hover:block">
                      {PERMISSION_DESCRIPTIONS[perm]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {roleFormError ? <p className="text-sm text-red-600">{roleFormError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
