'use client'

/**
 * VaultContext — in-memory E2EE vault key store.
 *
 * The vaultKey (CryptoKey) lives only in RAM for the duration of the session.
 * It is NEVER serialised, stored in localStorage, or sent to the server.
 *
 * Usage:
 *   const { vaultKey, setVaultKey, clearVaultKey } = useVault()
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface VaultContextValue {
  vaultKey: CryptoKey | null
  setVaultKey: (key: CryptoKey) => void
  clearVaultKey: () => void
}

const VaultContext = createContext<VaultContextValue>({
  vaultKey: null,
  setVaultKey: () => {},
  clearVaultKey: () => {},
})

export function VaultProvider({ children }: { children: ReactNode }) {
  const [vaultKey, setVaultKeyState] = useState<CryptoKey | null>(null)

  const setVaultKey = useCallback((key: CryptoKey) => {
    setVaultKeyState(key)
  }, [])

  const clearVaultKey = useCallback(() => {
    setVaultKeyState(null)
  }, [])

  return (
    <VaultContext.Provider value={{ vaultKey, setVaultKey, clearVaultKey }}>
      {children}
    </VaultContext.Provider>
  )
}

export function useVault() {
  return useContext(VaultContext)
}
