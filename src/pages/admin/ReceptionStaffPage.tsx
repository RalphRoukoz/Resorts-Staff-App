import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { emailToUsername } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import type { ResortStaff } from '../../types/database'

interface StaffRow extends ResortStaff {
  username: string
}

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
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [credentials, setCredentials] = useState<CredentialsModal | null>(null)

  const loadStaff = useCallback(async () => {
    if (!resortId) return
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('resort_staff')
      .select('*')
      .eq('resort_id', resortId)
      .eq('role', 'reception')

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as ResortStaff[]
    const withUsernames: StaffRow[] = []

    for (const row of rows) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', row.user_id)
        .maybeSingle()

      withUsernames.push({
        ...row,
        username: emailToUsername(profile?.email),
      })
    }

    setStaff(withUsernames)
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

    const { error: invokeError } = await supabase.functions.invoke('create-staff-account', {
      body: {
        username: username.trim(),
        password,
        role: 'reception',
        resort_id: resortId,
      },
    })

    if (invokeError) {
      setFormError(invokeError.message)
      setSaving(false)
      return
    }

    setModalOpen(false)
    setCredentials({ username: username.trim(), password })
    await loadStaff()
    setSaving(false)
  }

  async function handleRemove(row: StaffRow) {
    if (!confirm(`Remove reception staff "${row.username}"?`)) return

    const { error: deleteError } = await supabase.from('resort_staff').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
    else await loadStaff()
  }

  if (loading) return <Spinner label="Loading reception staff…" />

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">Reception staff</h2>
          <p className="mt-1 text-sm text-slate-400">
            Gate scanners with username + password access.
          </p>
        </div>
        <Button onClick={openCreate}>Add reception staff</Button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {staff.map((row) => (
              <tr key={row.id} className="bg-slate-950/50">
                <td className="px-4 py-3 font-medium text-white">{row.username}</td>
                <td className="px-4 py-3">
                  <Button variant="danger" onClick={() => void handleRemove(row)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
            {staff.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-slate-500">
                  No reception staff yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

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
            {formError ? <p className="text-sm text-rose-400">{formError}</p> : null}
          </div>
        </Modal>
      ) : null}

      {credentials ? (
        <Modal title="Staff credentials — save now" onClose={() => setCredentials(null)}>
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
