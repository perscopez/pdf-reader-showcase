import { describe, it, expect } from 'vitest'
import {
  generateSaltHex,
  deriveKeyFromPassword,
  generateVaultKey,
  wrapKey,
  unwrapKey,
  encryptData,
  decryptData,
  encryptText,
  decryptText,
  generateRecoveryCode,
  isValidRecoveryCode,
  createRecoveryVerifier,
  exportKeyToHex,
  importKeyFromHex,
  bufferToHex,
  hexToBuffer,
} from '@/lib/crypto'

describe('crypto utilities', () => {
  describe('bufferToHex / hexToBuffer', () => {
    it('should convert buffer to hex and back', () => {
      const original = new Uint8Array([0, 255, 128, 64, 32, 16, 8, 4, 2, 1])
      const hex = bufferToHex(original.buffer)
      expect(hex).toBe('00ff8040201008040201')
      const restored = new Uint8Array(hexToBuffer(hex))
      expect(Array.from(restored)).toEqual(Array.from(original))
    })

    it('should handle empty buffer', () => {
      expect(bufferToHex(new ArrayBuffer(0))).toBe('')
      expect(new Uint8Array(hexToBuffer(''))).toHaveLength(0)
    })
  })

  describe('generateSaltHex', () => {
    it('should produce correct length hex string', () => {
      const salt = generateSaltHex(16)
      expect(salt).toHaveLength(32)
    })

    it('should produce unique values', () => {
      const s1 = generateSaltHex(16)
      const s2 = generateSaltHex(16)
      expect(s1).not.toBe(s2)
    })

    it('should accept custom byte count', () => {
      expect(generateSaltHex(32)).toHaveLength(64)
      expect(generateSaltHex(8)).toHaveLength(16)
    })
  })

  describe('deriveKeyFromPassword', () => {
    it('should derive a CryptoKey from password + salt', async () => {
      const salt = generateSaltHex()
      const key = await deriveKeyFromPassword('test-password', salt)
      expect(key).toBeDefined()
      expect(key.algorithm.name).toBe('AES-GCM')
      expect(key.type).toBe('secret')
      expect(key.usages).toContain('encrypt')
      expect(key.usages).toContain('decrypt')
    })

    it('should derive equivalent keys from same password and salt', async () => {
      const salt = generateSaltHex()
      const key1 = await deriveKeyFromPassword('test-password', salt)
      const key2 = await deriveKeyFromPassword('test-password', salt)
      const exported1 = await exportKeyToHex(key1)
      const exported2 = await exportKeyToHex(key2)
      expect(exported1).toBe(exported2)
    })

    it('should derive different keys from different passwords', async () => {
      const salt = generateSaltHex()
      const key1 = await deriveKeyFromPassword('password-a', salt)
      const key2 = await deriveKeyFromPassword('password-b', salt)
      const exported1 = await exportKeyToHex(key1)
      const exported2 = await exportKeyToHex(key2)
      expect(exported1).not.toBe(exported2)
    })
  })

  describe('generateVaultKey', () => {
    it('should generate a fresh AES-GCM-256 key', async () => {
      const key = await generateVaultKey()
      expect(key).toBeDefined()
      expect(key.algorithm.name).toBe('AES-GCM')
      const alg = key.algorithm as AesKeyAlgorithm
      expect(alg.length).toBe(256)
      expect(key.usages).toContain('wrapKey')
      expect(key.usages).toContain('unwrapKey')
    })

    it('should generate unique keys each time', async () => {
      const [k1, k2] = await Promise.all([generateVaultKey(), generateVaultKey()])
      const e1 = await exportKeyToHex(k1)
      const e2 = await exportKeyToHex(k2)
      expect(e1).not.toBe(e2)
    })
  })

  describe('wrapKey / unwrapKey', () => {
    it('should roundtrip a vault key', async () => {
      const vaultKey = await generateVaultKey()
      const targetKey = await generateVaultKey()
      const wrapped = await wrapKey(targetKey, vaultKey)
      expect(wrapped).toBeTruthy()
      expect(wrapped.length).toBeGreaterThan(0)
      const unwrapped = await unwrapKey(wrapped, vaultKey)
      const [originalHex, unwrappedHex] = await Promise.all([
        exportKeyToHex(targetKey),
        exportKeyToHex(unwrapped),
      ])
      expect(unwrappedHex).toBe(originalHex)
    })

    it('should fail to unwrap with wrong key', async () => {
      const vaultKey = await generateVaultKey()
      const wrongKey = await generateVaultKey()
      const targetKey = await generateVaultKey()
      const wrapped = await wrapKey(targetKey, vaultKey)
      await expect(unwrapKey(wrapped, wrongKey)).rejects.toThrow()
    })
  })

  describe('encryptData / decryptData', () => {
    it('should encrypt and decrypt string data', async () => {
      const key = await generateVaultKey()
      const original = 'Hello, World! Test string with Unicode: üğışöç'
      const { ciphertextHex, ivHex } = await encryptData(original, key)
      expect(ciphertextHex).toBeTruthy()
      expect(ivHex).toBeTruthy()
      const decrypted = await decryptData(ciphertextHex, ivHex, key)
      const decoded = new TextDecoder().decode(decrypted)
      expect(decoded).toBe(original)
    })

    it('should encrypt and decrypt binary data', async () => {
      const key = await generateVaultKey()
      const original = new Uint8Array([0, 1, 2, 255, 254, 128, 64, 32, 16, 8, 4, 2, 1, 0])
      const { ciphertextHex, ivHex } = await encryptData(original, key)
      const decrypted = await decryptData(ciphertextHex, ivHex, key)
      expect(Array.from(decrypted)).toEqual(Array.from(original))
    })

    it('should produce different ciphertexts for same plaintext', async () => {
      const key = await generateVaultKey()
      const plaintext = 'constant message'
      const r1 = await encryptData(plaintext, key)
      const r2 = await encryptData(plaintext, key)
      expect(r1.ciphertextHex).not.toBe(r2.ciphertextHex)
      expect(r1.ivHex).not.toBe(r2.ivHex)
    })

    it('should fail decryption with wrong key', async () => {
      const key1 = await generateVaultKey()
      const key2 = await generateVaultKey()
      const { ciphertextHex, ivHex } = await encryptData('secret', key1)
      await expect(decryptData(ciphertextHex, ivHex, key2)).rejects.toThrow()
    })

    it('should fail decryption with tampered ciphertext', async () => {
      const key = await generateVaultKey()
      const { ciphertextHex, ivHex } = await encryptData('secret', key)
      const tampered = '00' + ciphertextHex.slice(2)
      await expect(decryptData(tampered, ivHex, key)).rejects.toThrow()
    })
  })

  describe('encryptText / decryptText', () => {
    it('should roundtrip text through JSON format', async () => {
      const key = await generateVaultKey()
      const original = JSON.stringify({ title: 'Test Book', author: 'Test Author' })
      const encrypted = await encryptText(original, key)
      expect(() => JSON.parse(encrypted)).not.toThrow()
      const decrypted = await decryptText(encrypted, key)
      expect(decrypted).toBe(original)
    })
  })

  describe('importKeyFromHex / exportKeyToHex', () => {
    it('should roundtrip key export and import', async () => {
      const original = await generateVaultKey()
      const hex = await exportKeyToHex(original)
      expect(hex).toBeTruthy()
      const imported = await importKeyFromHex(hex)
      const reExported = await exportKeyToHex(imported)
      expect(reExported).toBe(hex)
    })

    it('imported key should be usable for encryption', async () => {
      const original = await generateVaultKey()
      const hex = await exportKeyToHex(original)
      const imported = await importKeyFromHex(hex)
      const { ciphertextHex, ivHex } = await encryptData('test', imported)
      const decrypted = await decryptData(ciphertextHex, ivHex, original)
      expect(new TextDecoder().decode(decrypted)).toBe('test')
    })
  })

  describe('generateRecoveryCode / isValidRecoveryCode', () => {
    it('should generate a 24-word recovery code', async () => {
      const code = await generateRecoveryCode()
      const words = code.trim().split(/\s+/)
      expect(words).toHaveLength(24)
    })

    it('should validate a generated recovery code', async () => {
      const code = await generateRecoveryCode()
      const valid = await isValidRecoveryCode(code)
      expect(valid).toBe(true)
    })

    it('should reject invalid recovery codes', async () => {
      expect(await isValidRecoveryCode('')).toBe(false)
      expect(await isValidRecoveryCode('a b c')).toBe(false)
      expect(await isValidRecoveryCode('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour')).toBe(false)
    })

    it('should reject codes with wrong word count', async () => {
      const code = await generateRecoveryCode()
      const words = code.split(' ')
      expect(await isValidRecoveryCode(words.slice(0, 23).join(' '))).toBe(false)
    })

    it('should accept case-insensitive and normalized input', async () => {
      const code = await generateRecoveryCode()
      const upper = code.toUpperCase()
      expect(await isValidRecoveryCode(upper)).toBe(true)
      const extraSpace = code.replace(/\s+/g, '  ')
      expect(await isValidRecoveryCode(extraSpace)).toBe(true)
    })

    it('should create a stable normalized recovery verifier', async () => {
      const code = await generateRecoveryCode()
      const verifier = await createRecoveryVerifier(code)
      expect(verifier).toMatch(/^[a-f0-9]{64}$/)
      expect(await createRecoveryVerifier(`  ${code.toUpperCase().replace(/ /g, '   ')}  `)).toBe(verifier)
    })

    it('should create different verifiers for different recovery codes', async () => {
      const first = await createRecoveryVerifier(await generateRecoveryCode())
      const second = await createRecoveryVerifier(await generateRecoveryCode())
      expect(first).not.toBe(second)
    })
  })
})
