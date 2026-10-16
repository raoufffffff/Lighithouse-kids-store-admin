import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type AuthState = {
  session: Session | null
  /** null while the admin check is still running */
  isAdmin: boolean | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Session tracking only — no Supabase calls inside this callback.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setIsAdmin(null)
        setLoading(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Verify the signed-in user is an admin.
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    supabase.rpc('lh_is_admin').then(async ({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError || data !== true) {
        setError('هذا الحساب لا يملك صلاحية الدخول إلى لوحة الإدارة.')
        setIsAdmin(false)
        await supabase.auth.signOut()
      } else {
        setIsAdmin(true)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const signIn = async (email: string, password: string) => {
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError('البريد الإلكتروني أو كلمة السر غير صحيحة.')
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setIsAdmin(null)
  }

  return (
    <AuthContext.Provider value={{ session, isAdmin, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
