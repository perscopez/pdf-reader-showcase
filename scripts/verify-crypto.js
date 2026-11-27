/**
 * verify-crypto.js
 *
 * Automated smoke-test for the E2EE cryptography engine.
 * Runs entirely in Node.js using the built-in WebCrypto API (Node 19+).
 *
 * Usage:
 *   node scripts/verify-crypto.js
 */

const { webcrypto } = require('crypto')
const subtle = webcrypto.subtle

// ── Helpers (mirrors lib/crypto.ts) ────────────────────────────────────────────

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes.buffer
}

function stringToUint8(str) {
  return new TextEncoder().encode(str)
}

function uint8ToString(arr) {
  return new TextDecoder().decode(arr)
}

function generateSaltHex(bytesCount = 32) {
  const bytes = new Uint8Array(bytesCount)
  webcrypto.getRandomValues(bytes)
  return bufferToHex(bytes.buffer)
}

async function deriveKeyFromPassphrase(passphrase, saltHex) {
  const passphraseBuffer = stringToUint8(passphrase)
  const saltBuffer = hexToBuffer(saltHex)
  const baseKey = await subtle.importKey('raw', passphraseBuffer, { name: 'PBKDF2' }, false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuffer, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  )
}

async function generateVaultKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'])
}

async function wrapKey(keyToWrap, wrappingKey) {
  const wrapped = await subtle.wrapKey('raw', keyToWrap, wrappingKey, { name: 'AES-GCM', iv: new Uint8Array(12) })
  return bufferToHex(wrapped)
}

async function unwrapKey(wrappedKeyHex, unwrappingKey) {
  const wrappedBuffer = hexToBuffer(wrappedKeyHex)
  return subtle.unwrapKey(
    'raw', wrappedBuffer, unwrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(12) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  )
}

async function encryptText(text, key) {
  const iv = new Uint8Array(12)
  webcrypto.getRandomValues(iv)
  const data = stringToUint8(text)
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return JSON.stringify({ ciphertextHex: bufferToHex(ciphertext), ivHex: bufferToHex(iv.buffer) })
}

async function decryptText(jsonStr, key) {
  const { ciphertextHex, ivHex } = JSON.parse(jsonStr)
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(hexToBuffer(ivHex)) },
    key,
    new Uint8Array(hexToBuffer(ciphertextHex))
  )
  return uint8ToString(new Uint8Array(decrypted))
}

// ── BIP-39 Recovery Code (simplified wordlist test) ────────────────────────────

const WORDLIST_SAMPLE = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual']

async function sha256(data) {
  const hash = await subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

// ── Test Runner ────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`)
    failed++
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(message || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔐 E2EE Crypto Verification Suite\n')

  // 1. Salt generation
  await test('generateSaltHex produces 64-char hex string', async () => {
    const salt = generateSaltHex(32)
    assertEqual(salt.length, 64, `Expected 64 chars, got ${salt.length}`)
    assert(/^[0-9a-f]+$/.test(salt), 'Not valid hex')
  })

  await test('generateSaltHex produces unique values', async () => {
    const a = generateSaltHex()
    const b = generateSaltHex()
    assert(a !== b, 'Two salts should not be equal')
  })

  // 2. Key derivation
  await test('PBKDF2 derives a key from password + salt', async () => {
    const salt = generateSaltHex()
    const key = await deriveKeyFromPassphrase('şifre123', salt)
    assert(key.type === 'secret', 'Expected secret key')
    assert(key.algorithm.name === 'AES-GCM', 'Expected AES-GCM')
  })

  await test('Same password + salt produces equivalent key (can decrypt each other)', async () => {
    const salt = generateSaltHex()
    const key1 = await deriveKeyFromPassphrase('testpass', salt)
    const key2 = await deriveKeyFromPassphrase('testpass', salt)
    const plaintext = 'merhaba dünya'
    const encrypted = await encryptText(plaintext, key1)
    const decrypted = await decryptText(encrypted, key2)
    assertEqual(decrypted, plaintext, 'Decrypted text mismatch')
  })

  await test('Different password produces wrong key (decryption fails)', async () => {
    const salt = generateSaltHex()
    const key1 = await deriveKeyFromPassphrase('correctpass', salt)
    const key2 = await deriveKeyFromPassphrase('wrongpass', salt)
    const encrypted = await encryptText('secret', key1)
    let threw = false
    try { await decryptText(encrypted, key2) } catch { threw = true }
    assert(threw, 'Expected decryption to fail with wrong key')
  })

  // 3. Vault key generation
  await test('generateVaultKey creates a fresh AES-GCM-256 key', async () => {
    const key = await generateVaultKey()
    assertEqual(key.algorithm.name, 'AES-GCM')
    assertEqual(key.algorithm.length, 256)
  })

  // 4. Key wrapping / unwrapping
  await test('wrapKey + unwrapKey roundtrip preserves vault key', async () => {
    const salt = generateSaltHex()
    const passwordKey = await deriveKeyFromPassphrase('mypassword', salt)
    const vaultKey = await generateVaultKey()

    const wrappedHex = await wrapKey(vaultKey, passwordKey)
    assert(wrappedHex.length > 0, 'wrappedHex should not be empty')

    const unwrapped = await unwrapKey(wrappedHex, passwordKey)

    // Verify they are equivalent: encrypt with original, decrypt with unwrapped
    const plaintext = 'vault key roundtrip test'
    const cipher = await encryptText(plaintext, vaultKey)
    const recovered = await decryptText(cipher, unwrapped)
    assertEqual(recovered, plaintext, 'Key roundtrip failed')
  })

  await test('Wrong wrapping key fails to unwrap', async () => {
    const salt = generateSaltHex()
    const key1 = await deriveKeyFromPassphrase('correct', salt)
    const key2 = await deriveKeyFromPassphrase('wrong', salt)
    const vaultKey = await generateVaultKey()
    const wrapped = await wrapKey(vaultKey, key1)
    let threw = false
    try { await unwrapKey(wrapped, key2) } catch { threw = true }
    assert(threw, 'Expected unwrap to fail with wrong key')
  })

  // 5. Recovery code path
  await test('Recovery code re-derive can also unwrap vault key', async () => {
    const salt = generateSaltHex()
    const recoveryPhrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual'
    const recoveryKey = await deriveKeyFromPassphrase(recoveryPhrase, salt)
    const vaultKey = await generateVaultKey()

    const recoveryWrapped = await wrapKey(vaultKey, recoveryKey)
    const recoveryKeyAgain = await deriveKeyFromPassphrase(recoveryPhrase, salt)
    const unwrapped = await unwrapKey(recoveryWrapped, recoveryKeyAgain)

    const plaintext = 'recovery path test'
    const cipher = await encryptText(plaintext, vaultKey)
    const recovered = await decryptText(cipher, unwrapped)
    assertEqual(recovered, plaintext, 'Recovery path failed')
  })

  // 6. File encryption (binary)
  await test('Binary file encrypt/decrypt roundtrip', async () => {
    const fek = await generateVaultKey()
    // Simulate PDF bytes
    const originalBytes = new Uint8Array(1024)
    webcrypto.getRandomValues(originalBytes)

    // Encrypt
    const iv = new Uint8Array(12)
    webcrypto.getRandomValues(iv)
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, fek, originalBytes)

    // Pack IV + ciphertext (as done in page.tsx)
    const cipherBytes = new Uint8Array(ciphertext)
    const combined = new Uint8Array(iv.length + cipherBytes.length)
    combined.set(iv)
    combined.set(cipherBytes, iv.length)

    // Decrypt (as done in ReaderPageContent.tsx)
    const unpacked_iv = combined.slice(0, 12)
    const unpacked_cipher = combined.slice(12)
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv: unpacked_iv }, fek, unpacked_cipher)
    const decryptedBytes = new Uint8Array(decrypted)

    assertEqual(decryptedBytes.length, originalBytes.length, 'Length mismatch')
    let same = true
    for (let i = 0; i < originalBytes.length; i++) {
      if (decryptedBytes[i] !== originalBytes[i]) { same = false; break }
    }
    assert(same, 'Decrypted bytes do not match original')
  })

  // 7. Metadata encryption
  await test('Encrypted metadata roundtrip (title + author)', async () => {
    const vaultKey = await generateVaultKey()
    const fek = await generateVaultKey()
    const wrappedFek = await wrapKey(fek, vaultKey)

    const meta = { title: 'Suç ve Ceza', author: 'Fyodor Dostoyevski' }
    const encMeta = await encryptText(JSON.stringify(meta), fek)

    // Simulate reader side
    const unwrappedFek = await unwrapKey(wrappedFek, vaultKey)
    const decryptedMetaJson = await decryptText(encMeta, unwrappedFek)
    const decryptedMeta = JSON.parse(decryptedMetaJson)

    assertEqual(decryptedMeta.title, meta.title)
    assertEqual(decryptedMeta.author, meta.author)
  })

  // ── Results ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  Total: ${passed + failed}  ✅ Passed: ${passed}  ❌ Failed: ${failed}`)
  console.log(`${'─'.repeat(50)}\n`)

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\n💥 Unexpected error:', err)
  process.exit(1)
})
