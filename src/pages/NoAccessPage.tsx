import { Navigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'

export function NoAccessPage() {
  const { session, loading, hasAccess, signOut } = useAuth()

  if (!loading && !session) {
    return <Navigate to="/login" replace />
  }

  if (!loading && hasAccess) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center">
      <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-2xl font-semibold text-white">No staff access</h1>
        <p className="mt-3 text-slate-400">
          Your account is signed in but is not linked to any resort staff role.
          Contact your resort administrator.
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
