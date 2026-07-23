import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { usernameToEmail } from '../lib/auth'
import {
  PERMISSIONS,
  type Permission,
  type StaffWithRole,
  permissionsForStaff,
  staffHasAnyScanner,
  staffHasPermission,
} from '../lib/permissions'
import { supabase } from '../lib/supabase'
import type { Resort } from '../types/database'

export type AppView = 'admin' | 'reception'

interface AuthContextValue {
  session: Session | null
  isSuperAdmin: boolean
  staffRows: StaffWithRole[]
  staffUsername: string | null
  resort: Resort | null
  resortId: string | null
  loading: boolean
  hasAdmin: boolean
  hasViewer: boolean
  canWrite: boolean
  hasDashboard: boolean
  hasReception: boolean
  hasScannerReception: boolean
  hasScannerGate: boolean
  hasAccess: boolean
  hasPermission: (permission: Permission) => boolean
  view: AppView
  setView: (view: AppView) => void
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshResort: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [staffRows, setStaffRows] = useState<StaffWithRole[]>([])
  const [resort, setResort] = useState<Resort | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<AppView>('admin')
  const loadedUserIdRef = useRef<string | null>(null)
  const rolesRequestIdRef = useRef(0)

  const loadResort = useCallback(async (resortId: string) => {
    const { data, error } = await supabase.from('resorts').select('*').eq('id', resortId).single()
    if (error) {
      console.error('Failed to load resort', error)
      setResort(null)
      return
    }
    setResort(data as Resort)
  }, [])

  const clearRoles = useCallback(() => {
    setIsSuperAdmin(false)
    setStaffRows([])
    setResort(null)
    loadedUserIdRef.current = null
  }, [])

  const loadUserRoles = useCallback(
    async (userId: string) => {
      const requestId = ++rolesRequestIdRef.current
      try {
        const { data: superAdminRow } = await supabase
          .from('super_admins')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle()

        if (requestId !== rolesRequestIdRef.current) return

        if (superAdminRow) {
          setIsSuperAdmin(true)
          setStaffRows([])
          setResort(null)
          loadedUserIdRef.current = userId
          return
        }

        setIsSuperAdmin(false)

        const { data, error } = await supabase
          .from('resort_staff')
          .select('*, resort_roles(*)')
          .eq('user_id', userId)

        if (error) throw error
        if (requestId !== rolesRequestIdRef.current) return

        const rows = (data ?? []) as StaffWithRole[]
        setStaffRows(rows)

        const canDashboard = staffHasPermission(rows, PERMISSIONS.DASHBOARD_READ)
        const canScanner = staffHasAnyScanner(rows)

        if (canDashboard) setView('admin')
        else if (canScanner) setView('reception')

        const resortId = rows[0]?.resort_id
        if (resortId) await loadResort(resortId)
        else setResort(null)

        if (requestId === rolesRequestIdRef.current) {
          loadedUserIdRef.current = userId
        }
      } catch (error) {
        console.error('Failed to load staff roles', error)
      }
    },
    [loadResort],
  )

  const refreshResort = useCallback(async () => {
    const resortId = staffRows[0]?.resort_id
    if (resortId) await loadResort(resortId)
  }, [loadResort, staffRows])

  useEffect(() => {
    let mounted = true

    async function init() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      if (!mounted) return

      setSession(currentSession)
      if (currentSession?.user.id) {
        await loadUserRoles(currentSession.user.id)
      }
      if (mounted) setLoading(false)
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return

      setSession(nextSession)

      // Tab focus / background refresh must not remount the app or wipe open forms.
      if (event === 'TOKEN_REFRESHED') return

      if (!nextSession?.user.id) {
        clearRoles()
        return
      }

      const sameUser = loadedUserIdRef.current === nextSession.user.id
      if (sameUser && event !== 'USER_UPDATED') return

      void loadUserRoles(nextSession.user.id)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [clearRoles, loadUserRoles])

  const signIn = useCallback(async (username: string, password: string) => {
    const email = usernameToEmail(username)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    clearRoles()
  }, [clearRoles])

  const hasPermission = useCallback(
    (permission: Permission) => staffHasPermission(staffRows, permission),
    [staffRows],
  )

  const hasAdmin =
    staffRows.some((row) => row.role === 'admin' || row.resort_roles?.is_owner) ||
    staffHasPermission(staffRows, PERMISSIONS.DASHBOARD_WRITE)
  const hasViewer =
    staffRows.some((row) => row.role === 'viewer') ||
    (staffHasPermission(staffRows, PERMISSIONS.DASHBOARD_READ) &&
      !staffHasPermission(staffRows, PERMISSIONS.DASHBOARD_WRITE))
  const canWrite = staffHasPermission(staffRows, PERMISSIONS.DASHBOARD_WRITE)
  const hasDashboard = staffHasPermission(staffRows, PERMISSIONS.DASHBOARD_READ)
  const hasScannerReception = staffHasPermission(staffRows, PERMISSIONS.SCANNER_RECEPTION)
  const hasScannerGate = staffHasPermission(staffRows, PERMISSIONS.SCANNER_GATE)
  const hasReception = staffHasAnyScanner(staffRows)
  const hasAccess = isSuperAdmin || staffRows.length > 0
  const resortId = staffRows[0]?.resort_id ?? null
  const staffUsername = staffRows[0]?.username?.trim() || null

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isSuperAdmin,
      staffRows,
      staffUsername,
      resort,
      resortId,
      loading,
      hasAdmin,
      hasViewer,
      canWrite,
      hasDashboard,
      hasReception,
      hasScannerReception,
      hasScannerGate,
      hasAccess,
      hasPermission,
      view,
      setView,
      signIn,
      signOut,
      refreshResort,
    }),
    [
      session,
      isSuperAdmin,
      staffRows,
      staffUsername,
      resort,
      resortId,
      loading,
      hasAdmin,
      hasViewer,
      canWrite,
      hasDashboard,
      hasReception,
      hasScannerReception,
      hasScannerGate,
      hasAccess,
      hasPermission,
      view,
      signIn,
      signOut,
      refreshResort,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export { permissionsForStaff }
