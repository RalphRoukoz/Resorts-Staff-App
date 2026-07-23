import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  type Permission,
} from '../../lib/permissions'
import { supabase } from '../../lib/supabase'
import type { ResortRole } from '../../types/database'

export function RolesPage() {
  const { resortId } = useAuth()
  const [roles, setRoles] = useState<ResortRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadRoles = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('resort_roles')
      .select('id, resort_id, name, permissions, is_owner, is_system, created_at')
      .eq('resort_id', resortId)
      .order('is_owner', { ascending: false })
      .order('name')
      .limit(100)

    if (fetchError) setError(fetchError.message)
    else setRoles((data ?? []) as ResortRole[])
    setLoading(false)
  }, [resortId])

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  function openCreate() {
    setName('')
    setPermissions([])
    setFormError(null)
    setModalOpen(true)
  }

  function togglePermission(perm: Permission) {
    setPermissions((current) =>
      current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm],
    )
  }

  async function handleCreate() {
    if (!resortId) return
    if (!name.trim()) {
      setFormError('Role name is required')
      return
    }
    if (permissions.length === 0) {
      setFormError('Select at least one permission')
      return
    }

    setSaving(true)
    setFormError(null)

    const { error: insertError } = await supabase.from('resort_roles').insert({
      resort_id: resortId,
      name: name.trim(),
      permissions,
      is_owner: false,
      is_system: false,
    })

    if (insertError) setFormError(insertError.message)
    else {
      setModalOpen(false)
      await loadRoles()
    }
    setSaving(false)
  }

  async function handleDelete(role: ResortRole) {
    if (role.is_system) return
    if (!confirm(`Delete role "${role.name}"? Staff assigned to it will lose their role link.`)) return

    const { error: deleteError } = await supabase.from('resort_roles').delete().eq('id', role.id)
    if (deleteError) setError(deleteError.message)
    else await loadRoles()
  }

  async function handleUpdatePermissions(role: ResortRole, next: Permission[]) {
    if (role.is_owner) return
    const { error: updateError } = await supabase
      .from('resort_roles')
      .update({ permissions: next })
      .eq('id', role.id)

    if (updateError) setError(updateError.message)
    else await loadRoles()
  }

  if (loading) return <Spinner label="Loading roles…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">Roles &amp; permissions</h2>
          <p className="mt-1 text-sm text-gray-500">
            Owners have full access. Create custom roles and assign permissions for your staff.
          </p>
        </div>
        <Button onClick={openCreate}>Add custom role</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <div className="space-y-4">
        {roles.map((role) => (
          <div key={role.id} className="rounded-2xl border border-[#ECECEC] bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-medium text-[#1A1A1A]">{role.name}</h3>
                {role.is_owner ? (
                  <span className="rounded-full bg-[#E1F3FE] px-2 py-0.5 text-xs font-medium text-[#1F6C9F]">
                    Owner
                  </span>
                ) : null}
                {role.is_system ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">System</span>
                ) : null}
              </div>
              {!role.is_system ? (
                <Button variant="danger" onClick={() => void handleDelete(role)}>
                  Delete
                </Button>
              ) : null}
            </div>

            {role.is_owner ? (
              <p className="text-sm text-gray-500">Full access to all resort features.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_PERMISSIONS.map((perm) => {
                  const checked = role.permissions.includes(perm)
                  return (
                    <label key={perm} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={checked}
                        disabled={role.is_system}
                        onChange={() => {
                          const next = checked
                            ? (role.permissions.filter((p) => p !== perm) as Permission[])
                            : ([...role.permissions, perm] as Permission[])
                          void handleUpdatePermissions(role, next)
                        }}
                      />
                      <span className="text-gray-700">{PERMISSION_LABELS[perm]}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {modalOpen ? (
        <Modal
          title="Add custom role"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={saving}>
                {saving ? 'Creating…' : 'Create role'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Role name" value={name} onChange={(e) => setName(e.target.value)} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700">Permissions</legend>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {ALL_PERMISSIONS.map((perm) => (
                  <label key={perm} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={permissions.includes(perm)}
                      onChange={() => togglePermission(perm)}
                    />
                    <span>{PERMISSION_LABELS[perm]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
