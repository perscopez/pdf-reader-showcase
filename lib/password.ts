import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto'

const ITERATIONS = 120_000
const KEY_LENGTH = 32
const DIGEST = 'sha256'

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('base64url')
  return `pbkdf2:${ITERATIONS}:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, iterationValue, salt, hash] = stored.split(':')
  if (scheme !== 'pbkdf2' || !iterationValue || !salt || !hash) return false

  const iterations = Number(iterationValue)
  if (!Number.isFinite(iterations) || iterations < 10_000) return false

  const actual = Buffer.from(hash, 'base64url')
  const expected = pbkdf2Sync(password, salt, iterations, actual.length, DIGEST)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}