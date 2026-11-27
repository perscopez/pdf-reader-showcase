'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import type { SyncDevice, SyncChange, SyncEntity } from '@/lib/sync'
import { getOrCreateDeviceId, getDeviceName } from '@/lib/sync'
import {
  initDb,
  getFromStore,
  getByServerId,
  getDirtyRecords,
  putToStore,
  deleteFromStore,
  getSyncMeta,
  saveSyncMeta,
} from '@/lib/indexedDb'
import { fetchWithTimeout } from '@/lib/request'

interface SyncState {
  lastSyncAt: string | null
  lastAttemptAt: string | null
  isSyncing: boolean
  isOffline: boolean
  syncPhase: 'idle' | 'preparing' | 'uploading' | 'downloading' | 'applying'
  error: string | null
  devices: SyncDevice[]
  conflicts: SyncConflict[]
}

export interface SyncConflict {
  id: string
  storeName: string
  entity: SyncEntity
  localId: number
  serverId: number
  localRecord: Record<string, unknown>
  serverRecord: Record<string, unknown>
  detectedAt: string
}

interface SyncContextValue extends SyncState {
  triggerSync: () => Promise<void>
  resolveConflict: (id: string, resolution: 'local' | 'server') => Promise<void>
}

const SyncContext = createContext<SyncContextValue>({
  lastSyncAt: null,
  lastAttemptAt: null,
  isSyncing: false,
  isOffline: false,
  syncPhase: 'idle',
  error: null,
  devices: [],
  conflicts: [],
  triggerSync: async () => {},
  resolveConflict: async () => {},
})

export function useSync() {
  return useContext(SyncContext)
}

const SYNC_INTERVAL = 5 * 60 * 1000
const LAST_SYNC_KEY = 'pdf_last_sync_at'

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SyncState>({
    lastSyncAt: null,
    lastAttemptAt: null,
    isSyncing: false,
    isOffline: typeof window !== 'undefined' ? !navigator.onLine : false,
    syncPhase: 'idle',
    error: null,
    devices: [],
    conflicts: [],
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const registeredRef = useRef(false)
  const lastSyncAtRef = useRef<string | null>(null)
  const syncInFlightRef = useRef(false)

  // Initialize checkpoint on mount from IndexedDB or localStorage
  useEffect(() => {
    async function loadCheckpoint() {
      try {
        await initDb()
        let checkpoint = await getSyncMeta(LAST_SYNC_KEY)
        if (!checkpoint && typeof window !== 'undefined') {
          checkpoint = localStorage.getItem(LAST_SYNC_KEY)
        }
        if (checkpoint) {
          lastSyncAtRef.current = checkpoint
          setState(prev => ({ ...prev, lastSyncAt: checkpoint }))
        }
        const storedConflicts = await getSyncMeta('sync_conflicts')
        if (storedConflicts) {
          try {
            const parsed = JSON.parse(storedConflicts)
            if (Array.isArray(parsed)) setState(prev => ({ ...prev, conflicts: parsed as SyncConflict[] }))
          } catch {
            await saveSyncMeta('sync_conflicts', '[]')
          }
        }
      } catch (err) {
        console.error('Failed to load sync checkpoint:', err)
      }
    }
    loadCheckpoint()
  }, [])

  const registerDevice = useCallback(async () => {
    if (registeredRef.current) return
    const deviceId = getOrCreateDeviceId()
    if (!deviceId) return
    registeredRef.current = true
    try {
      await fetchWithTimeout('/api/sync/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, device_name: getDeviceName() }),
      })
    } catch {
      // silently fail — registration is best-effort
    }
  }, [])

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/sync/devices', {}, 10000)
      if (res.ok) {
        const devices = await res.json() as SyncDevice[]
        setState(prev => ({ ...prev, devices }))
      }
    } catch {
      // silently fail
    }
  }, [])

  const triggerSync = useCallback(async () => {
    if (syncInFlightRef.current) return
    if (typeof window !== 'undefined' && !navigator.onLine) {
      setState(prev => ({ ...prev, isOffline: true, error: 'Çevrimdışı', syncPhase: 'idle' }))
      return
    }
    syncInFlightRef.current = true
    setState(prev => ({ ...prev, isSyncing: true, error: null, isOffline: false, syncPhase: 'preparing', lastAttemptAt: new Date().toISOString() }))
    try {
      const deviceId = getOrCreateDeviceId()
      if (!deviceId) throw new Error('Device ID not found')

      await initDb()

      let persistedConflicts: SyncConflict[] = []
      const conflictJson = await getSyncMeta('sync_conflicts')
      if (conflictJson) {
        try {
          const parsed = JSON.parse(conflictJson)
          if (Array.isArray(parsed)) persistedConflicts = parsed as SyncConflict[]
        } catch {
          persistedConflicts = []
        }
      }

      const syncStores: SyncEntity[] = ['book', 'annotation', 'bookmark', 'word', 'session']
      const storeMap: Record<SyncEntity, string> = {
        book: 'books',
        annotation: 'annotations',
        bookmark: 'bookmarks',
        word: 'word_library',
        session: 'reading_sessions',
      }

      // 1. PUSH PHASE: Get all dirty records from local IndexedDB
      const pushChanges: SyncChange[] = []
      const localSnapshots: { storeName: string; local_id: number; updated_at: string; action: 'upsert' | 'delete' }[] = []

      for (const entity of syncStores) {
        const storeName = storeMap[entity]
        const dirty = await getDirtyRecords(storeName)
        for (const record of dirty) {
          if (persistedConflicts.some(conflict => conflict.storeName === storeName && conflict.localId === record.local_id)) {
            continue
          }
          if (record.local_status === 'deleted' && !record.server_id) {
            await deleteFromStore(storeName, record.local_id!)
            continue
          }

          const { local_id, server_id, local_status, updated_at, ...data } = record
          
          pushChanges.push({
            local_id,
            server_id: server_id || undefined,
            entity,
            action: local_status === 'deleted' ? 'delete' : 'upsert',
            data,
            updated_at,
          })

          localSnapshots.push({
            storeName,
            local_id: local_id!,
            updated_at,
            action: local_status === 'deleted' ? 'delete' : 'upsert',
          })
        }
      }

      if (pushChanges.length > 0) {
        setState(prev => ({ ...prev, syncPhase: 'uploading' }))
        const pushRes = await fetchWithTimeout('/api/sync/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, changes: pushChanges }),
        })

        if (!pushRes.ok) {
          throw new Error(`Sync push failed: ${pushRes.statusText}`)
        }

        const pushPayload = await pushRes.json() as { results: { server_id: number; entity: SyncEntity; local_id?: number }[] }

        for (const res of pushPayload.results) {
          if (!res.local_id) continue
          const entityStore = storeMap[res.entity]
          const snapshot = localSnapshots.find(s => s.storeName === entityStore && s.local_id === res.local_id)
          if (!snapshot) continue

          if (snapshot.action === 'delete') {
            await deleteFromStore(entityStore, res.local_id)
          } else {
            const current = await getFromStore(entityStore, res.local_id)
            if (current && current.updated_at === snapshot.updated_at) {
              await putToStore(entityStore, {
                ...current,
                server_id: res.server_id,
                local_status: 'synced',
              })
            } else if (current) {
              await putToStore(entityStore, {
                ...current,
                server_id: res.server_id,
              })
            }
          }
        }
      }

      // 2. PULL PHASE
      let since = await getSyncMeta(LAST_SYNC_KEY)
      if (!since && typeof window !== 'undefined') {
        since = localStorage.getItem(LAST_SYNC_KEY) || ''
      }

      const params = new URLSearchParams()
      if (since) params.set('since', since)
      if (deviceId) params.set('device_id', deviceId)

      setState(prev => ({ ...prev, syncPhase: 'downloading' }))
      const pullRes = await fetchWithTimeout(`/api/sync/pull?${params.toString()}`)
      if (!pullRes.ok) throw new Error('Sync pull failed')

      const pullPayload = await pullRes.json() as {
        changes: SyncChange[]
        deleted: { entity: SyncEntity; id: number }[]
        server_time?: string
      }

      // Apply server deletions
      setState(prev => ({ ...prev, syncPhase: 'applying' }))
      for (const del of pullPayload.deleted) {
        const storeName = storeMap[del.entity]
        if (!storeName) continue
        const local = await getByServerId(storeName, del.id)
        if (local) {
          await deleteFromStore(storeName, local.local_id!)
        }
      }

      // Apply server upserts (Conflict Reconciliation)
      for (const change of pullPayload.changes) {
        const storeName = storeMap[change.entity]
        if (!storeName) continue
        const local = await getByServerId(storeName, change.server_id!)

        if (!local) {
          await putToStore(storeName, {
            ...change.data,
            server_id: change.server_id,
            local_status: 'synced',
            updated_at: change.updated_at,
          })
        } else {
          if (local.local_status === 'synced') {
            await putToStore(storeName, {
              ...local,
              ...change.data,
              server_id: change.server_id,
              local_status: 'synced',
              updated_at: change.updated_at,
            })
          } else {
            const localTime = new Date(local.updated_at).getTime()
            const serverTime = new Date(change.updated_at).getTime()

            if (serverTime > localTime) {
              const conflict: SyncConflict = {
                id: `${storeName}:${local.local_id}:${change.updated_at}`,
                storeName,
                entity: change.entity,
                localId: local.local_id!,
                serverId: change.server_id!,
                localRecord: local as Record<string, unknown>,
                serverRecord: {
                  ...change.data,
                  local_id: local.local_id,
                  server_id: change.server_id,
                  local_status: 'synced',
                  updated_at: change.updated_at,
                },
                detectedAt: new Date().toISOString(),
              }
              if (!persistedConflicts.some(item => item.id === conflict.id)) persistedConflicts.push(conflict)
            }
          }
        }
      }

      await saveSyncMeta('sync_conflicts', JSON.stringify(persistedConflicts))

      const checkpoint = pullPayload.server_time || new Date().toISOString()
      lastSyncAtRef.current = checkpoint
      await saveSyncMeta(LAST_SYNC_KEY, checkpoint)
      if (typeof window !== 'undefined') {
        localStorage.setItem(LAST_SYNC_KEY, checkpoint)
      }
      
      setState(prev => ({ ...prev, lastSyncAt: checkpoint, isSyncing: false, syncPhase: 'idle', error: null, conflicts: persistedConflicts }))
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sync-completed'))
      }
    } catch (err) {
      console.error('[SyncProvider] sync error:', err)
      setState(prev => ({
        ...prev,
        isSyncing: false,
        syncPhase: 'idle',
        isOffline: typeof window !== 'undefined' && !navigator.onLine,
        error: err instanceof Error ? err.message : 'Sync failed',
      }))
    } finally {
      syncInFlightRef.current = false
    }
  }, [])

  const resolveConflict = useCallback(async (id: string, resolution: 'local' | 'server') => {
    const raw = await getSyncMeta('sync_conflicts')
    let conflicts: SyncConflict[] = []
    try {
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) conflicts = parsed as SyncConflict[]
    } catch {
      conflicts = []
    }
    const conflict = conflicts.find(item => item.id === id)
    if (!conflict) return
    const store = conflict.storeName
    if (resolution === 'server') {
      await putToStore(store, conflict.serverRecord)
    } else {
      const current = await getFromStore(store, conflict.localId)
      if (current) {
        await putToStore(store, {
          ...current,
          server_id: conflict.serverId,
          local_status: 'updated',
          updated_at: new Date().toISOString(),
        })
      }
    }
    const next = conflicts.filter(item => item.id !== id)
    await saveSyncMeta('sync_conflicts', JSON.stringify(next))
    setState(prev => ({ ...prev, conflicts: next }))
    void triggerSync()
  }, [triggerSync])

  useEffect(() => {
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOffline: false, error: null }))
      void triggerSync()
    }
    const handleOffline = () => {
      setState(prev => ({ ...prev, isOffline: true, error: 'Çevrimdışı', syncPhase: 'idle' }))
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    registerDevice()
    fetchDevices()
    triggerSync()
    intervalRef.current = setInterval(triggerSync, SYNC_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [registerDevice, fetchDevices, triggerSync])

  return (
      <SyncContext.Provider value={{ ...state, triggerSync, resolveConflict }}>
      {children}
    </SyncContext.Provider>
  )
}
