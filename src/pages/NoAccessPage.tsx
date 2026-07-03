import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../context/AuthContext'

export function NoAccessPage() {
  const { t } = useTranslation()
  const { session, loading, hasAccess, signOut } = useAuth()

  // Never decide while the session/role check is still resolving.
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Spinner label={t('noAccess.checking')} />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (hasAccess) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FAFAFA] px-4 text-center">
      <div className="max-w-md rounded-2xl border border-[#ECECEC] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1A1A1A]">{t('noAccess.title')}</h1>
        <p className="mt-3 text-gray-500">{t('noAccess.description')}</p>
        <Button className="mt-6" variant="secondary" onClick={() => void signOut()}>
          {t('common.signOut')}
        </Button>
      </div>
    </div>
  )
}
