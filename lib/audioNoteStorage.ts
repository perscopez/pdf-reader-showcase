import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { audioExtensionForMime } from './audioNotes'

export function audioNoteDirectory(userId: number) {
  return path.join(process.cwd(), 'public', 'uploads', 'audio-notes', String(userId))
}

export function audioNoteRelativePath(userId: number, sessionId: number, mimeType: string) {
  return `audio-notes/${userId}/${sessionId}.${audioExtensionForMime(mimeType)}`
}

export function audioNotePath(relativePath: string) {
  const root = path.join(process.cwd(), 'public', 'uploads', 'audio-notes')
  const resolved = path.resolve(process.cwd(), 'public', 'uploads', relativePath)
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null
}

export async function ensureAudioNoteDirectory(userId: number) {
  const directory = audioNoteDirectory(userId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return directory
}
