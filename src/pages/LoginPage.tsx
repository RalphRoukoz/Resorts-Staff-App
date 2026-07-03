import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const { t } = useTranslation()
  const { session, loading, hasAccess, signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // While the session/role check is resolving, keep showing the form (with its
  // submitting state) rather than redirecting prematurely.
  if (!loading && session && hasAccess) {
    return <Navigate to="/" replace />
  }

  if (!loading && session && !hasAccess) {
    return <Navigate to="/no-access" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await signIn(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#ECECEC] bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{t('login.portal')}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('login.title')}</h1>
        <p className="mt-2 text-sm text-gray-500">{t('login.subtitle')}</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input label={t('login.username')} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          <Input label={t('login.password')} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />

          {error ? (
            <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? t('login.signingIn') : t('common.signIn')}
          </Button>
        </form>
      </div>
    </div>
  )
}
