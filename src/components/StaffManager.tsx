import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Modal } from './ui/Modal'
import { Spinner } from './ui/Spinner'
import { createStaffAccount, deleteStaffAccount, resetStaffPassword } from '../lib/edgeFunctions'
import { supabase } from '../lib/supabase'
import type { ResortStaff } from '../types/database'

type Role = 'admin' | 'reception' | 'viewer'

interface Copy {
  heading: string
  subheading: string
  addLabel: string
  createModalTitle: string
  credentialsTitle: string
  emptyLabel: string
  loadingLabel: string
  removeNoun: string
}

const COPY: Record<Role, Copy> = {
  reception: {
    heading: 'Reception staff',
    subheading: 'Gate scanners with username + password access.',
    addLabel: 'Add reception staff',
    createModalTitle: 'Add reception staff',
    credentialsTitle: 'Staff credentials — save now',
    emptyLabel: 'No reception staff yet.',
    loadingLabel: 'Loading reception staff…',
    removeNoun: 'reception staff',
  },
  admin: {
    heading: 'Resort admins',
    subheading: 'Manage admin credentials for each resort.',
    addLabel: 'Add admin',
    createModalTitle: 'Add resort admin',
    credentialsTitle: 'Admin credentials — save now',
    emptyLabel: 'No admins for this resort yet.',
    loadingLabel: 'Loading admins…',
    removeNoun: 'admin',
  },
  viewer: {
    heading: 'Dashboard viewers',
    subheading: 'Read-only resort accounts — managed here by resort admins only.',
    addLabel: 'Add viewer',
    createModalTitle: 'Add dashboard viewer',
    credentialsTitle: 'Viewer credentials — save now',
    emptyLabel: 'No dashboard viewers yet.',
    loadingLabel: 'Loading viewers…',
    removeNoun: 'viewer',
  },
}

function generatePassword(length = 12): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

interface StaffManagerProps {
  /** Resort the staff belong to. Null disables creation. */
  resortId: string | null
  role: Role
  /** Optional control rendered to the left of the Add button (e.g. a resort picker). */
  headerControl?: ReactNode
}

/**
 * Shared CRUD surface for username/password staff accounts (reception + admin).
 * Lists accounts for a resort and handles create, reset-password, and remove.
 */
export function StaffManager({ resortId, role, headerControl }: StaffManagerProps) {
  const copy = COPY[role]

  const [staff, setStaff] = useState<ResortStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null)

  const [resetTarget, setResetTarget] = useState<ResortStaff | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  const loadStaff = useCallback(async () => {
    if (!resortId) {
      setStaff([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('resort_staff')
      .select('id, resort_id, user_id, role, resort_role_id, username')
      .eq('resort_id', resortId)
      .eq('role', role)
      .order('username')
      .limit(200)

    if (fetchError) setError(fetchError.message)
    else setStaff((data ?? []) as ResortStaff[])
    setLoading(false)
  }, [resortId, role])

  useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  function openCreate() {
    setUsername('')
    setPassword(generatePassword())
    setFormError(null)
    setModalOpen(true)
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

    const result = await createStaffAccount({
      username: username.trim(),
      password,
      role,
      resort_id: resortId,
    })

    if (!result.ok) {
      setFormError(result.message)
      setSaving(false)
      return
    }

    setModalOpen(false)
    setCredentials({ username: username.trim(), password })
    await loadStaff()
    setSaving(false)
  }

  function openReset(row: ResortStaff) {
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

    setResetSuccess(
      `Password reset for ${resetTarget.username ?? 'this account'}. Share it now: ${resetPasswordValue}`,
    )
    setResetTarget(null)
    setResetting(false)
  }

  async function handleRemove(row: ResortStaff) {
    if (!confirm(`Remove ${copy.removeNoun} "${row.username ?? 'this account'}"?`)) return

    const result = await deleteStaffAccount(row.id)
    if (!result.ok) setError(result.message)
    else await loadStaff()
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{copy.heading}</h2>
          <p className="mt-1 text-sm text-gray-500">{copy.subheading}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {headerControl}
          <Button onClick={openCreate} disabled={!resortId}>
            {copy.addLabel}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {resetSuccess ? (
        <p className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {resetSuccess}
        </p>
      ) : null}

      {loading ? (
        <Spinner label={copy.loadingLabel} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#FAFAFA] text-[11px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staff.map((row) => (
                <tr key={row.id} className="transition hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-[#1A1A1A]">{row.username ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openReset(row)}>
                        Reset password
                      </Button>
                      <Button variant="danger" onClick={() => void handleRemove(row)}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-gray-400">
                    {copy.emptyLabel}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <Modal
          title={copy.createModalTitle}
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={saving}>
                {saving ? 'Creating…' : 'Create account'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
            />
            <div>
              <Input
                label="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
              <Button variant="ghost" className="mt-2" onClick={() => setPassword(generatePassword())}>
                Regenerate password
              </Button>
            </div>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {resetTarget ? (
        <Modal
          title={`Reset password — ${resetTarget.username ?? 'account'}`}
          onClose={() => setResetTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleReset()} disabled={resetting}>
                {resetting ? 'Resetting…' : 'Reset password'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Enter a new password. The old one cannot be viewed.</p>
            <div>
              <Input
                label="New password"
                value={resetPasswordValue}
                onChange={(event) => setResetPasswordValue(event.target.value)}
                autoComplete="new-password"
              />
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => setResetPasswordValue(generatePassword())}
              >
                Regenerate
              </Button>
            </div>
            {resetError ? <p className="text-sm text-red-600">{resetError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {credentials ? (
        <Modal title={copy.credentialsTitle} onClose={() => setCredentials(null)}>
          <p className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            These credentials are shown once. Copy them before closing.
          </p>
          <div className="space-y-3 rounded-xl border border-[#ECECEC] bg-[#FAFAFA] p-4 font-mono text-sm">
            <p>
              <span className="text-gray-400">Username: </span>
              <span className="text-[#1A1A1A]">{credentials.username}</span>
            </p>
            <p>
              <span className="text-gray-400">Password: </span>
              <span className="text-[#1A1A1A]">{credentials.password}</span>
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
