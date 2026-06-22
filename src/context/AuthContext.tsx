import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { usernameToEmail } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { Resort, ResortStaff } from '../types/database'

export type AppView = 'admin' | 'reception'

interface AuthContextValue {
  session: Session | null
  staffRows: ResortStaff[]
  resort: Resort | null
  resortId: string | null
  loading: boolean
  hasAdmin: boolean
  hasReception: boolean
  hasAccess: boolean
  view: AppView
  setView: (view: AppView) => void
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshResort: () => Promise<void>
  refreshStaff: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [staffRows, setStaffRows] = useState<ResortStaff[]>([])
  const [resort, setResort] = useState<Resort | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<AppView>('admin')

  const loadResort = useCallback(async (resortId: string) => {
    const { data, error } = await supabase
      .from('resorts')
      .select('*')
      .eq('id', resortId)
      .single()

    if (error) throw error
    setResort(data)
  }, [])

  const loadStaff = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from('resort_staff')
        .select('*')
        .eq('user_id', userId)

      if (error) throw error

      const rows = (data ?? []) as ResortStaff[]
      setStaffRows(rows)

      const hasAdminRole = rows.some((row) => row.role === 'admin')
      const hasReceptionRole = rows.some((row) => row.role === 'reception')

      if (hasAdminRole) setView('admin')
      else if (hasReceptionRole) setView('reception')

      const resortId = rows[0]?.resort_id
      if (resortId) await loadResort(resortId)
      else setResort(null)
    },
    [loadResort],
  )

  const refreshResort = useCallback(async () => {
    const resortId = staffRows[0]?.resort_id
    if (resortId) await loadResort(resortId)
  }, [loadResort, staffRows])

  const refreshStaff = useCallback(async () => {
    if (session?.user.id) await loadStaff(session.user.id)
  }, [loadStaff, session?.user.id])

  useEffect(() => {
    let mounted = true

    async function init() {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      if (!mounted) return

      setSession(currentSession)
      if (currentSession?.user.id) {
        await loadStaff(currentSession.user.id)
      }
      setLoading(false)
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession?.user.id) {
        void loadStaff(nextSession.user.id)
      } else {
        setStaffRows([])
        setResort(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadStaff])

  const signIn = useCallback(async (username: string, password: string) => {
    const email = usernameToEmail(username)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setStaffRows([])
    setResort(null)
  }, [])

  const hasAdmin = staffRows.some((row) => row.role === 'admin')
  const hasReception = staffRows.some((row) => row.role === 'reception')
  const hasAccess = staffRows.length > 0
  const resortId = staffRows[0]?.resort_id ?? null

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      staffRows,
      resort,
      resortId,
      loading,
      hasAdmin,
      hasReception,
      hasAccess,
      view,
      setView,
      signIn,
      signOut,
      refreshResort,
      refreshStaff,
    }),
    [
      session,
      staffRows,
      resort,
      resortId,
      loading,
      hasAdmin,
      hasReception,
      hasAccess,
      view,
      signIn,
      signOut,
      refreshResort,
      refreshStaff,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
