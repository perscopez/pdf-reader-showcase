'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { fetchWithTimeout } from '@/lib/request'

export interface SessionUser {
  id?: number
  username: string
  role: string
  is_test?: boolean
  avatar?: string
  email?: string | null
}

interface SessionContextValue {
  user: SessionUser | null
  loading: boolean
  error: string | null
  refresh: () => Promise<SessionUser | null>
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  error: null,
  refresh: async () => null,
})

export function useSession() {
  return useContext(SessionContext)
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/auth/me', {}, 8000)
      if (response.status === 401 || response.status === 403) {
        setUser(null)
        setError(null)
        return null
      }
      if (!response.ok) throw new Error(`Session request failed (${response.status})`)
      const data = await response.json() as SessionUser
      const nextUser = data?.username ? {
        id: data.id,
        username: data.username,
        role: data.role || 'user',
        is_test: Boolean(data.is_test),
        avatar: data.avatar || '',
        email: data.email || null,
      } : null
      setUser(nextUser)
      setError(null)
      return nextUser
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Session request failed'
      setError(message)
      return null
    }
  }, [])

  useEffect(() => {
    let active = true
    const initialLoad = window.setTimeout(() => {
      void refresh().finally(() => { if (active) setLoading(false) })
    }, 0)
    const handleRefresh = () => { void refresh() }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleRefresh()
    }
    window.addEventListener('session-refresh', handleRefresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      active = false
      window.clearTimeout(initialLoad)
      window.removeEventListener('session-refresh', handleRefresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  return <SessionContext.Provider value={{ user, loading, error, refresh }}>{children}</SessionContext.Provider>
}
