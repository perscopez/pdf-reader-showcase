/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')

// ── Mock S3 Storage ──────────────────────────────────────────────────────────
const mockStorage = new Map()

// ── Mock S3 Server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`)
  const pathname = urlObj.pathname
  const bucketName = 'drill-bucket'

  console.log(`[Mock S3] Received request: ${req.method} ${pathname}`)

  // Route: List bucket (GET /drill-bucket/)
  if (req.method === 'GET' && pathname === `/${bucketName}/`) {
    const prefix = urlObj.searchParams.get('prefix') || ''
    
    // Generate S3 XML listing
    let xml = '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>'
    xml += `<Name>${bucketName}</Name>`
    xml += '<Contents>'
    
    for (const [key, val] of mockStorage.entries()) {
      if (key.startsWith(prefix)) {
        xml += '<Contents>'
        xml += `<Key>${key}</Key>`
        xml += `<LastModified>${val.lastModified.toISOString()}</LastModified>`
        xml += `<Size>${val.data.length}</Size>`
        xml += '</Contents>'
      }
    }
    xml += '</Contents></ListBucketResult>'

    res.writeHead(200, { 'Content-Type': 'application/xml' })
    res.end(xml)
    return
  }

  // Route: Get object (GET /drill-bucket/:key)
  if (req.method === 'GET' && pathname.startsWith(`/${bucketName}/`)) {
    const key = pathname.slice(`/${bucketName}/`.length)
    const item = mockStorage.get(key)
    if (item) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(item.data)
    } else {
      res.writeHead(404)
      res.end('Not Found')
    }
    return
  }

  // Route: Put object (PUT /drill-bucket/:key)
  if (req.method === 'PUT' && pathname.startsWith(`/${bucketName}/`)) {
    const key = pathname.slice(`/${bucketName}/`.length)
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', () => {
      const buffer = Buffer.concat(body)
      mockStorage.set(key, {
        data: buffer,
        lastModified: new Date()
      })
      console.log(`[Mock S3] Saved key: ${key} (${buffer.length} bytes)`)
      res.writeHead(200)
      res.end()
    })
    return
  }

  // Route: Delete object (DELETE /drill-bucket/:key)
  if (req.method === 'DELETE' && pathname.startsWith(`/${bucketName}/`)) {
    const key = pathname.slice(`/${bucketName}/`.length)
    const deleted = mockStorage.delete(key)
    console.log(`[Mock S3] Deleted key: ${key} (exists: ${deleted})`)
    res.writeHead(204)
    res.end()
    return
  }

  res.writeHead(400)
  res.end('Unsupported S3 Mock Route')
})

// ── Run backup/restore child process helper ──────────────────────────────────
function runS3Script(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'backup-s3.js')
    const child = fork(scriptPath, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: 'inherit'
    })

    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`backup-s3.js exited with code ${code}`))
    })
  })
}

// ── Main Verification Drill ──────────────────────────────────────────────────
async function main() {
  // Start server on dynamic port
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const mockS3Endpoint = `http://127.0.0.1:${port}`
  console.log(`[Drill] Mock S3 server listening on port ${port}`)

  const tempWorkspace = path.join(process.cwd(), 'data', 's3-drill-temp')
  const tempDbDir = path.join(tempWorkspace, 'data')
  const tempUploadsDir = path.join(tempWorkspace, 'public', 'uploads')

  try {
    // 1. Clean and setup temporary workspace
    console.log('[Drill 1/6] Setting up temporary workspace...')
    fs.rmSync(tempWorkspace, { recursive: true, force: true })
    fs.mkdirSync(tempDbDir, { recursive: true })
    fs.mkdirSync(tempUploadsDir, { recursive: true })

    // Create dummy library.db file
    const dbFilePath = path.join(tempDbDir, 'library.db')
    fs.writeFileSync(dbFilePath, 'mock sqlite database content bytes')

    // Create dummy uploads files
    const file1Path = path.join(tempUploadsDir, 'book1.pdf')
    const file2Path = path.join(tempUploadsDir, 'nested', 'book2.epub')
    fs.mkdirSync(path.dirname(file2Path), { recursive: true })
    fs.writeFileSync(file1Path, 'book 1 encrypted bytes')
    fs.writeFileSync(file2Path, 'book 2 epub zip bytes')

    console.log('[Drill 2/6] Triggering encrypted backup...')
    const testEnv = {
      S3_ENDPOINT: mockS3Endpoint,
      S3_REGION: 'auto',
      S3_BUCKET_NAME: 'drill-bucket',
      S3_ACCESS_KEY_ID: 'drill-key',
      S3_SECRET_ACCESS_KEY: 'drill-secret',
      BACKUP_ENCRYPTION_KEY: 'drill-encryption-key'
    }

    await runS3Script(['backup'], tempWorkspace, testEnv)

    // 2. Verify that mock storage contains the uploaded encrypted backup file
    console.log('[Drill 3/6] Verifying S3 storage status...')
    const keys = Array.from(mockStorage.keys())
    console.log('[Drill] Storage keys in S3:', keys)
    expect(keys.length).toBe(1)
    expect(keys[0]).toMatch(/^pdf-library-backup-.*\.zip\.enc$/)

    const backupKey = keys[0]

    // 3. Clear local workspace to prepare for restore drill
    console.log('[Drill 4/6] Wiping local workspace database and uploads...')
    fs.unlinkSync(dbFilePath)
    fs.rmSync(tempUploadsDir, { recursive: true, force: true })

    expect(fs.existsSync(dbFilePath)).toBe(false)
    expect(fs.existsSync(file1Path)).toBe(false)

    // 4. Run restore
    console.log(`[Drill 5/6] Restoring backup: ${backupKey}...`)
    await runS3Script(['restore', backupKey], tempWorkspace, testEnv)

    // 5. Verify restored files
    console.log('[Drill 6/6] Verifying restored files match original...')
    expect(fs.existsSync(dbFilePath)).toBe(true)
    expect(fs.readFileSync(dbFilePath, 'utf8')).toBe('mock sqlite database content bytes')

    expect(fs.existsSync(file1Path)).toBe(true)
    expect(fs.readFileSync(file1Path, 'utf8')).toBe('book 1 encrypted bytes')

    expect(fs.existsSync(file2Path)).toBe(true)
    expect(fs.readFileSync(file2Path, 'utf8')).toBe('book 2 epub zip bytes')

    console.log('\n[SUCCESS] S3 Backup & Restore encrypted drill passed successfully!')
  } catch (err) {
    console.error('\n[FAILED] S3 Backup & Restore drill failed:', err)
    process.exit(1)
  } finally {
    // Cleanup server
    server.close()
    // Cleanup temporary workspace
    fs.rmSync(tempWorkspace, { recursive: true, force: true })
    console.log('[Drill] Mock S3 server stopped and temp workspace cleaned.')
  }
}

// Simple expect helper for self-contained assertion
function expect(val) {
  return {
    toBe: (expected) => {
      if (val !== expected) throw new Error(`Expected ${expected}, but got ${val}`)
    },
    toMatch: (regex) => {
      if (!regex.test(val)) throw new Error(`Expected ${val} to match ${regex}`)
    }
  }
}

main()
