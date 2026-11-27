import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  protection: 'plain' as 'plain' | 'encrypted' | 'missing',
  getOwnedBookProtection: vi.fn(),
  prepare: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => ({ id: 7, username: 'fixture-user', role: 'user', is_test: 0 }),
}))

vi.mock('@/lib/encryptedBookPolicy', () => ({
  getOwnedBookProtection: (...args: unknown[]) => mocks.getOwnedBookProtection(...args),
  encryptedBookLocalOnlyResponse: () => new Response(JSON.stringify({
    error: 'Encrypted book derived data is local-only',
    code: 'ENCRYPTED_BOOK_LOCAL_ONLY',
  }), { status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }),
}))

vi.mock('@/lib/db', () => ({
  default: { prepare: (...args: unknown[]) => mocks.prepare(...args) },
}))

vi.mock('@/lib/audioNoteStorage', () => ({
  audioNotePath: () => '/tmp/audio-note.webm',
  audioNoteRelativePath: () => 'audio-notes/7/42.webm',
  ensureAudioNoteDirectory: vi.fn(async () => '/tmp'),
}))

import { GET as getAudioNotes, POST as postAudioNote } from '@/app/api/audio-notes/route'
import { GET as getAudioSession } from '@/app/api/audio-notes/[sessionId]/route'
import { POST as postAudioMarker } from '@/app/api/audio-notes/[sessionId]/markers/route'

describe('audio note API boundaries', () => {
  beforeEach(() => {
    mocks.protection = 'plain'
    mocks.getOwnedBookProtection.mockReset()
    mocks.getOwnedBookProtection.mockImplementation(() => mocks.protection)
    mocks.prepare.mockReset()
  })

  it('fails closed for encrypted books before creating an audio session', async () => {
    mocks.protection = 'encrypted'
    const request = new NextRequest('http://localhost/api/audio-notes', {
      method: 'POST',
      body: JSON.stringify({ book_id: 12, title: 'Private' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await postAudioNote(request)

    expect(response.status).toBe(409)
    expect(mocks.prepare).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ code: 'ENCRYPTED_BOOK_LOCAL_ONLY' })
  })

  it('creates an owned plain-book session with bounded title input', async () => {
    mocks.prepare.mockImplementation((sql: unknown) => ({
      run: () => ({ lastInsertRowid: 42 }),
      get: () => ({ id: 42, book_id: 12, title: 'x'.repeat(120), duration_ms: 0, file_path: null, mime_type: '', status: 'draft' }),
      all: () => [],
    }))
    const response = await postAudioNote(new NextRequest('http://localhost/api/audio-notes', {
      method: 'POST',
      body: JSON.stringify({ book_id: 12, title: 'x'.repeat(300) }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ id: 42, book_id: 12, status: 'draft', markers: [] })
    expect(mocks.prepare.mock.calls[0][0]).toContain('INSERT INTO audio_note_sessions')
  })

  it('rejects encrypted session replay and marker creation without writing', async () => {
    mocks.prepare.mockImplementation((sql: unknown) => ({
      get: () => String(sql).includes('audio_note_sessions') ? { id: 42, book_id: 12, book_is_encrypted: 1 } : undefined,
      all: () => [],
      run: () => ({ lastInsertRowid: 1 }),
    }))
    const sessionResponse = await getAudioSession(new NextRequest('http://localhost/api/audio-notes/42'), { params: Promise.resolve({ sessionId: '42' }) })
    expect(sessionResponse.status).toBe(409)

    const markerResponse = await postAudioMarker(new NextRequest('http://localhost/api/audio-notes/42/markers', {
      method: 'POST',
      body: JSON.stringify({ timestamp_ms: 1000, page: 2 }),
      headers: { 'content-type': 'application/json' },
    }), { params: Promise.resolve({ sessionId: '42' }) })
    expect(markerResponse.status).toBe(409)
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
  })

  it('does not list another book through the all-sessions query', async () => {
    mocks.prepare.mockImplementation(() => ({ all: () => [] }))
    const response = await getAudioNotes(new NextRequest('http://localhost/api/audio-notes?book_id=12'))
    expect(response.status).toBe(200)
    expect(mocks.getOwnedBookProtection).toHaveBeenCalledWith(7, 12)
    expect(mocks.prepare.mock.calls[0][0]).toContain('WHERE user_id = ? AND book_id = ?')
  })
})
