import type { ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui/Spinner'
import { useAuth } from './context/AuthContext'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AnalyticsPage } from './pages/admin/AnalyticsPage'
import { AnnouncementsPage } from './pages/admin/AnnouncementsPage'
import { ReceptionStaffPage } from './pages/admin/ReceptionStaffPage'
import { RentalsPage } from './pages/admin/RentalsPage'
import { ResortConfigPage } from './pages/admin/ResortConfigPage'
import { TodayPage } from './pages/admin/TodayPage'
import { UnitsPage } from './pages/admin/UnitsPage'
import { LoginPage } from './pages/LoginPage'
import { NoAccessPage } from './pages/NoAccessPage'
import { ReceptionScanner } from './pages/reception/ReceptionScanner'
import { SuperAdminLayout } from './pages/superadmin/SuperAdminLayout'
import { SuperOverviewPage } from './pages/superadmin/SuperOverviewPage'
import { SuperResortAdminsPage } from './pages/superadmin/SuperResortAdminsPage'
import { SuperResortsPage } from './pages/superadmin/SuperResortsPage'

function RootRedirect() {
  const { isSuperAdmin, hasAdmin, hasReception, view } = useAuth()

  if (isSuperAdmin) {
    return <Navigate to="/superadmin/overview" replace />
  }

  if (hasAdmin && view === 'admin') {
    return <Navigate to="/admin/units" replace />
  }

  if (hasReception) {
    return <Navigate to="/scanner" replace />
  }

  return <Navigate to="/no-access" replace />
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, hasAccess } = useAuth()

  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!hasAccess) return <Navigate to="/no-access" replace />

  return children
}

function RequireSuperAdmin() {
  const { isSuperAdmin } = useAuth()
  if (!isSuperAdmin) return <Navigate to="/" replace />
  return <Outlet />
}

function RequireAdmin() {
  const { hasAdmin } = useAuth()
  if (!hasAdmin) return <Navigate to="/scanner" replace />
  return <Outlet />
}

function RequireReception() {
  const { hasReception } = useAuth()
  if (!hasReception) return <Navigate to="/admin/units" replace />
  return <Outlet />
}

export default function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950">
        <Spinner />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/no-access" element={<NoAccessPage />} />

      {/* Super-admin console */}
      <Route
        path="/superadmin"
        element={
          <RequireAuth>
            <RequireSuperAdmin />
          </RequireAuth>
        }
      >
        <Route element={<SuperAdminLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<SuperOverviewPage />} />
          <Route path="resorts" element={<SuperResortsPage />} />
          <Route path="admins" element={<SuperResortAdminsPage />} />
        </Route>
      </Route>

      {/* Resort admin dashboard */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireAdmin />
          </RequireAuth>
        }
      >
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="units" replace />} />
          <Route path="units" element={<UnitsPage />} />
          <Route path="rentals" element={<RentalsPage />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="reception-staff" element={<ReceptionStaffPage />} />
          <Route path="configuration" element={<ResortConfigPage />} />
        </Route>
      </Route>

      {/* Reception scanner */}
      <Route
        path="/scanner"
        element={
          <RequireAuth>
            <RequireReception />
          </RequireAuth>
        }
      >
        <Route index element={<ReceptionScanner />} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}
