import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { createStaffAccount, resetStaffPassword } from '../../lib/edgeFunctions'
import { supabase } from '../../lib/supabase'
import type { Resort, ResortStaff } from '../../types/database'

interface NewCredentials {
  username: string
  password: string
}

function generatePassword(length = 12): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

export function SuperResortAdminsPage() {
  const [resorts, setResorts] = useState<Resort[]>([])
  const [selectedResortId, setSelectedResortId] = useState<string>('')
  const [admins, setAdmins] = useState<ResortStaff[]>([])
  const [loadingResorts, setLoadingResorts] = useState(true)
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<NewCredentials | null>(null)

  const [resetTarget, setResetTarget] = useState<ResortStaff | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  // Load resorts on mount
  useEffect(() => {
    async function load() {
      setLoadingResorts(true)
      const { data, error: fetchError } = await supabase
        .from('resorts')
        .select('*')
        .order('name')

      if (fetchError) setError(fetchError.message)
      else {
        const rows = (data ?? []) as Resort[]
        setResorts(rows)
        if (rows.length > 0) setSelectedResortId(rows[0].id)
      }
      setLoadingResorts(false)
    }
    void load()
  }, [])

  const loadAdmins = useCallback(async (resortId: string) => {
    setLoadingAdmins(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('resort_staff')
      .select('*')
      .eq('resort_id', resortId)
      .eq('role', 'admin')
      .order('username')

    if (fetchError) setError(fetchError.message)
    else setAdmins((data ?? []) as ResortStaff[])
    setLoadingAdmins(false)
  }, [])

  useEffect(() => {
    if (selectedResortId) void loadAdmins(selectedResortId)
  }, [selectedResortId, loadAdmins])

  function openCreate() {
    setUsername('')
    setPassword(generatePassword())
    setFormError(null)
    setModalOpen(true)
  }

  async function handleCreate() {
    if (!selectedResortId) return
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
      role: 'admin',
      resort_id: selectedResortId,
    })

    if (!result.ok) {
      setFormError(result.message)
      setSaving(false)
      return
    }

    const created = { username: username.trim(), password }
    setModalOpen(false)
    setCredentials(created)
    await loadAdmins(selectedResortId)
    setSaving(false)
  }

  async function handleRemove(row: ResortStaff) {
    if (!confirm(`Remove admin "${row.username ?? 'this account'}" from this resort?`)) return

    const { error: deleteError } = await supabase.from('resort_staff').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
    else if (selectedResortId) await loadAdmins(selectedResortId)
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
      `Password reset for ${resetTarget.username ?? 'this admin'}. Share it now: ${resetPasswordValue}`,
    )
    setResetTarget(null)
    setResetting(false)
  }

  if (loadingResorts) return <Spinner label="Loading resorts…" />

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Resort admins</h2>
        <p className="mt-1 text-sm text-slate-400">
          Manage admin credentials for each resort.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      {resetSuccess ? (
        <p className="mb-4 rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
          {resetSuccess}
        </p>
      ) : null}

      {/* Resort selector */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-300">Resort</span>
          <select
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100"
            value={selectedResortId}
            onChange={(e) => setSelectedResortId(e.target.value)}
          >
            {resorts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={openCreate} disabled={!selectedResortId}>
          Add admin
        </Button>
      </div>

      {loadingAdmins ? (
        <Spinner label="Loading admins…" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {admins.map((row) => (
                <tr key={row.id} className="bg-slate-950/50">
                  <td className="px-4 py-3 font-medium text-white">{row.username ?? '—'}</td>
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
              {admins.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-slate-500">
                    No admins for this resort yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {modalOpen ? (
        <Modal
          title="Add resort admin"
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
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <div>
              <Input
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => setPassword(generatePassword())}
              >
                Regenerate
              </Button>
            </div>
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {/* Reset password modal */}
      {resetTarget ? (
        <Modal
          title={`Reset password — ${resetTarget.username ?? 'admin'}`}
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
            <p className="text-sm text-slate-400">
              Enter a new password. The old one cannot be viewed.
            </p>
            <div>
              <Input
                label="New password"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
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
            {resetError ? <p className="text-sm text-rose-400">{resetError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {/* Show credentials once */}
      {credentials ? (
        <Modal title="Admin credentials — save now" onClose={() => setCredentials(null)}>
          <p className="mb-4 text-sm text-amber-300">
            These credentials are shown once. Copy them before closing.
          </p>
          <div className="space-y-3 rounded-lg bg-slate-950 p-4 font-mono text-sm">
            <p>
              <span className="text-slate-500">Username: </span>
              <span className="text-white">{credentials.username}</span>
            </p>
            <p>
              <span className="text-slate-500">Password: </span>
              <span className="text-white">{credentials.password}</span>
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
