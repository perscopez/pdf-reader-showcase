import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/password'

describe('hashPassword / verifyPassword', () => {
  it('should hash and verify a password', () => {
    const hash = hashPassword('correct-password')
    expect(hash).toBeTruthy()
    expect(hash.startsWith('pbkdf2:')).toBe(true)
    expect(verifyPassword('correct-password', hash)).toBe(true)
  })

  it('should reject wrong password', () => {
    const hash = hashPassword('correct-password')
    expect(verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('should reject empty password against hash', () => {
    const hash = hashPassword('some-password')
    expect(verifyPassword('', hash)).toBe(false)
  })

  it('should produce different hashes for same password', () => {
    const h1 = hashPassword('same-password')
    const h2 = hashPassword('same-password')
    expect(h1).not.toBe(h2)
    expect(verifyPassword('same-password', h1)).toBe(true)
    expect(verifyPassword('same-password', h2)).toBe(true)
  })

  it('should reject malformed hash strings', () => {
    expect(verifyPassword('password', '')).toBe(false)
    expect(verifyPassword('password', 'invalid')).toBe(false)
    expect(verifyPassword('password', 'pbkdf2:abc')).toBe(false)
    expect(verifyPassword('password', 'pbkdf2:abc:salt')).toBe(false)
  })

  it('should reject hash with too few iterations', () => {
    const hash = hashPassword('test')
    const parts = hash.split(':')
    const weakHash = `pbkdf2:1000:${parts[2]}:${parts[3]}`
    expect(verifyPassword('test', weakHash)).toBe(false)
  })

  it('should produce hash in correct format', () => {
    const hash = hashPassword('test')
    const parts = hash.split(':')
    expect(parts[0]).toBe('pbkdf2')
    expect(Number(parts[1])).toBeGreaterThan(10000)
    expect(parts[2]).toBeTruthy()
    expect(parts[3]).toBeTruthy()
  })
})
