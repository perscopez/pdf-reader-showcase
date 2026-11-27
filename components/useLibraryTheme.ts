'use client'

import { useSyncExternalStore } from 'react'
import { getLibraryTheme, type LibraryTheme } from '@/lib/libraryTheme'

function subscribe(callback: () => void) {
  window.addEventListener('library-theme-changed', callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener('library-theme-changed', callback)
    window.removeEventListener('storage', callback)
  }
}

function getSnapshot(): LibraryTheme {
  return getLibraryTheme()
}

function getServerSnapshot(): LibraryTheme {
  return 'dark'
}

export function useLibraryTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
