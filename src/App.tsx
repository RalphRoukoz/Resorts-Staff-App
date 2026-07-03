import type { ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui/Spinner'
import { useAuth } from './context/AuthContext'
import { PERMISSIONS, type Permission } from './lib/permissions'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AnalyticsPage } from './pages/admin/AnalyticsPage'
import { AnnouncementsPage } from './pages/admin/AnnouncementsPage'
import { StaffPage } from './pages/admin/StaffPage'
import { RentalsPage } from './pages/admin/RentalsPage'
import { ResortConfigPage } from './pages/admin/ResortConfigPage'
import { TodayPage } from './pages/admin/TodayPage'
import { UnitsPage } from './pages/admin/UnitsPage'
import { LoginPage } from './pages/LoginPage'
import { NoAccessPage } from './pages/NoAccessPage'
import { ReceptionScanner } from './pages/reception/ReceptionScanner'
import { GateScanner } from './pages/reception/GateScanner'
import { SuperAdminLayout } from './pages/superadmin/SuperAdminLayout'
import { SuperOverviewPage } from './pages/superadmin/SuperOverviewPage'
import { SuperResortAdminsPage } from './pages/superadmin/SuperResortAdminsPage'
import { SuperResortsPage } from './pages/superadmin/SuperResortsPage'

function RootRedirect() {
  const { isSuperAdmin, hasDashboard, hasReception, view } = useAuth()

  if (isSuperAdmin) {
    return <Navigate to="/superadmin/overview" replace />
  }

  if (hasDashboard && view === 'admin') {
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

/** Resort dashboard: full admin or read-only viewer */
function RequireDashboard() {
  const { hasDashboard } = useAuth()
  if (!hasDashboard) return <Navigate to="/scanner" replace />
  return <Outlet />
}


function RequirePermission({ permission }: { permission: Permission }) {
  const { hasPermission } = useAuth()
  if (!hasPermission(permission)) return <Navigate to="/admin/units" replace />
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
      <div className="min-h-screen bg-[#FAFAFA]">
        <Spinner />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/no-access" element={<NoAccessPage />} />

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

      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireDashboard />
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
          <Route element={<RequirePermission permission={PERMISSIONS.CONFIG_WRITE} />}>
            <Route path="configuration" element={<ResortConfigPage />} />
          </Route>
          <Route element={<RequirePermission permission={PERMISSIONS.STAFF_MANAGE} />}>
            <Route path="staff" element={<StaffPage />} />
          </Route>
          <Route path="reception-staff" element={<Navigate to="/admin/staff" replace />} />
          <Route path="viewers" element={<Navigate to="/admin/staff" replace />} />
          <Route path="roles" element={<Navigate to="/admin/staff" replace />} />
        </Route>
      </Route>

      <Route
        path="/scanner"
        element={
          <RequireAuth>
            <RequireReception />
          </RequireAuth>
        }
      >
        <Route index element={<ReceptionScanner />} />
        <Route path="gate" element={<GateScanner />} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  )
}
