import { WORDLIST } from './wordlist'

const getSubtle = (): SubtleCrypto => {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle
  throw new Error('Web Crypto API is unavailable')
}

// Convert ArrayBuffer to Hex String
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Convert Hex String to ArrayBuffer
export function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes.buffer
}

// Convert string to Uint8Array
function stringToUint8(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

// Convert Uint8Array to string
function uint8ToString(arr: Uint8Array): string {
  return new TextDecoder().decode(arr)
}

// Generate random salt in Hex
export function generateSaltHex(bytesCount = 16): string {
  const bytes = new Uint8Array(bytesCount)
  globalThis.crypto.getRandomValues(bytes)
  return bufferToHex(bytes.buffer)
}

// Derive AES-GCM 256 key from a passphrase (password or recovery code) using PBKDF2
async function deriveKeyFromPassphrase(passphrase: string, saltHex: string): Promise<CryptoKey> {
  const subtle = getSubtle()
  const passphraseBuffer = stringToUint8(passphrase) as unknown as Uint8Array<ArrayBuffer>
  const saltBuffer = hexToBuffer(saltHex) as ArrayBuffer

  // Import the raw passphrase as a key
  const baseKey = await subtle.importKey(
    'raw',
    passphraseBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  // Derive the AES-GCM 256 key
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  )
}

export async function deriveKeyFromPassword(password: string, saltHex: string): Promise<CryptoKey> {
  return deriveKeyFromPassphrase(password, saltHex)
}

export async function deriveKeyFromRecoveryCode(code: string, saltHex: string): Promise<CryptoKey> {
  // Normalize code: lowercase, single space separators
  const normalized = code.trim().toLowerCase().replace(/\s+/g, ' ')
  return deriveKeyFromPassphrase(normalized, saltHex)
}

export async function createRecoveryVerifier(code: string): Promise<string> {
  const normalized = code.trim().toLowerCase().replace(/\s+/g, ' ')
  const digest = await sha256(stringToUint8(`pdf-library-recovery-v1:${normalized}`))
  return bufferToHex(digest.buffer as ArrayBuffer)
}

// Generate a new cryptographically secure 256-bit AES-GCM key
export async function generateVaultKey(): Promise<CryptoKey> {
  const subtle = getSubtle()
  return subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  )
}

// Encrypt plaintext data using AES-GCM
export async function encryptData(
  data: string | Uint8Array,
  key: CryptoKey
): Promise<{ ciphertextHex: string; ivHex: string }> {
  const subtle = getSubtle()
  const dataBuffer = (typeof data === 'string' ? stringToUint8(data) : data) as unknown as Uint8Array<ArrayBuffer>

  // Generate 12-byte IV
  const iv = new Uint8Array(12) as unknown as Uint8Array<ArrayBuffer>
  globalThis.crypto.getRandomValues(iv)

  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    dataBuffer
  )

  return {
    ciphertextHex: bufferToHex(ciphertext),
    ivHex: bufferToHex(iv.buffer)
  }
}

// Decrypt ciphertext data using AES-GCM
export async function decryptData(
  ciphertextHex: string,
  ivHex: string,
  key: CryptoKey
): Promise<Uint8Array> {
  const subtle = getSubtle()
  const ciphertextBuffer = hexToBuffer(ciphertextHex)
  const ivBuffer = hexToBuffer(ivHex)

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(ivBuffer) },
    key,
    ciphertextBuffer
  )

  return new Uint8Array(decrypted)
}

// Encrypt a string using AES-GCM and return JSON format
export async function encryptText(text: string, key: CryptoKey): Promise<string> {
  const enc = await encryptData(text, key)
  return JSON.stringify(enc)
}

// Decrypt a JSON format ciphertext string back to plain text
export async function decryptText(jsonStr: string, key: CryptoKey): Promise<string> {
  const { ciphertextHex, ivHex } = JSON.parse(jsonStr)
  const bytes = await decryptData(ciphertextHex, ivHex, key)
  return uint8ToString(bytes)
}

// Wrap (encrypt) a CryptoKey using another CryptoKey
export async function wrapKey(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const subtle = getSubtle()
  const wrapped = await subtle.wrapKey(
    'raw',
    keyToWrap,
    wrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(12) } // Wrap key can use 0 IV or standard wrapping algorithm
  )
  return bufferToHex(wrapped)
}

// Unwrap (decrypt) a CryptoKey using another CryptoKey
export async function unwrapKey(wrappedKeyHex: string, unwrappingKey: CryptoKey): Promise<CryptoKey> {
  const subtle = getSubtle()
  const wrappedBuffer = hexToBuffer(wrappedKeyHex)
  return subtle.unwrapKey(
    'raw',
    wrappedBuffer,
    unwrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(12) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  )
}

// Helper to export raw key to Hex (useful for sharing keys securely or saving locally)
export async function exportKeyToHex(key: CryptoKey): Promise<string> {
  const subtle = getSubtle()
  const raw = await subtle.exportKey('raw', key)
  return bufferToHex(raw)
}

// Helper to import raw key from Hex
export async function importKeyFromHex(hex: string): Promise<CryptoKey> {
  const subtle = getSubtle()
  const buffer = hexToBuffer(hex)
  return subtle.importKey(
    'raw',
    buffer,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  )
}

// --- 24-Word Recovery Code Generation (BIP-39 style) ---

// Helper to calculate SHA-256 hash in Node / Browser
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle()
  const hash = await subtle.digest('SHA-256', data as unknown as Uint8Array<ArrayBuffer>)
  return new Uint8Array(hash)
}

// Generate 24-word recovery phrase from 256 bits of entropy
export async function generateRecoveryCode(): Promise<string> {
  const entropy = new Uint8Array(32) // 256 bits
  globalThis.crypto.getRandomValues(entropy)

  // Calculate checksum: first 8 bits of SHA-256 hash of entropy
  const hash = await sha256(entropy)
  const checksum = hash[0] // 8 bits

  // Convert entropy + checksum to binary string of 264 bits
  let binary = ''
  for (let i = 0; i < entropy.length; i++) {
    binary += entropy[i].toString(2).padStart(8, '0')
  }
  binary += checksum.toString(2).padStart(8, '0')

  // Split into 24 chunks of 11 bits
  const words: string[] = []
  for (let i = 0; i < 24; i++) {
    const bitChunk = binary.substring(i * 11, (i + 1) * 11)
    const index = parseInt(bitChunk, 2)
    words.push(WORDLIST[index])
  }

  return words.join(' ')
}

// Validate the 24-word recovery phrase checksum
export async function isValidRecoveryCode(code: string): Promise<boolean> {
  const words = code.trim().toLowerCase().split(/\s+/)
  if (words.length !== 24) return false

  try {
    // Convert words back to 11-bit chunks
    let binary = ''
    for (const word of words) {
      const index = WORDLIST.indexOf(word)
      if (index === -1) return false
      binary += index.toString(2).padStart(11, '0')
    }

    const entropyBits = binary.substring(0, 256)
    const checksumBits = binary.substring(256, 264)

    // Convert binary entropy back to bytes
    const entropy = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      entropy[i] = parseInt(entropyBits.substring(i * 8, (i + 1) * 8), 2)
    }

    // Verify checksum
    const hash = await sha256(entropy)
    const expectedChecksum = hash[0]
    const actualChecksum = parseInt(checksumBits, 2)

    return expectedChecksum === actualChecksum
  } catch {
    return false
  }
}
