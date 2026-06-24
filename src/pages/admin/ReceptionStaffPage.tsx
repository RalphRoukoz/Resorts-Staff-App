import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { createStaffAccount, resetStaffPassword } from '../../lib/edgeFunctions'
import { supabase } from '../../lib/supabase'
import type { ResortStaff } from '../../types/database'

interface CredentialsModal {
  username: string
  password: string
}

function generatePassword(length = 12): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

export function ReceptionStaffPage() {
  const { resortId } = useAuth()
  const [staff, setStaff] = useState<ResortStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<CredentialsModal | null>(null)

  const [resetTarget, setResetTarget] = useState<ResortStaff | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  const loadStaff = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('resort_staff')
      .select('*')
      .eq('resort_id', resortId)
      .eq('role', 'reception')
      .order('username')

    if (fetchError) setError(fetchError.message)
    else setStaff((data ?? []) as ResortStaff[])
    setLoading(false)
  }, [resortId])

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
      role: 'reception',
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
    if (!confirm(`Remove reception staff "${row.username ?? 'this account'}"?`)) return

    const { error: deleteError } = await supabase.from('resort_staff').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
    else await loadStaff()
  }

  if (loading) return <Spinner label="Loading reception staff…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-[#1A1A1A]">Reception staff</h2>
          <p className="mt-1 text-sm text-gray-500">
            Gate scanners with username + password access.
          </p>
        </div>
        <Button onClick={openCreate}>Add reception staff</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      {resetSuccess ? (
        <p className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {resetSuccess}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-[#ECECEC] bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] text-gray-500">
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
                  No reception staff yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {modalOpen ? (
        <Modal
          title="Add reception staff"
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
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => setPassword(generatePassword())}
              >
                Regenerate password
              </Button>
            </div>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {/* Reset password modal */}
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
            <p className="text-sm text-gray-500">
              Enter a new password. The old one cannot be viewed.
            </p>
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

      {/* New-account credentials shown once */}
      {credentials ? (
        <Modal title="Staff credentials — save now" onClose={() => setCredentials(null)}>
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
