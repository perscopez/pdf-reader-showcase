/* eslint-disable @typescript-eslint/no-require-imports */
const https = require('https')

const url = process.env.HEALTHCHECK_URL || 'https://library.example.com/api/health'
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 10_000)

const req = https.get(url, { timeout: timeoutMs }, res => {
  let body = ''
  res.on('data', chunk => {
    body += chunk
  })
  res.on('end', () => {
    try {
      const data = JSON.parse(body)
      if (res.statusCode === 200 && data.ok === true) {
        console.log(`Health OK: ${url}`)
        process.exit(0)
      }
      console.error(`Health check failed (${res.statusCode}): ${body}`)
      process.exit(1)
    } catch {
      console.error(`Health check returned invalid JSON (${res.statusCode}): ${body.slice(0, 500)}`)
      process.exit(1)
    }
  })
})

req.on('timeout', () => {
  req.destroy(new Error(`Health check timed out after ${timeoutMs}ms`))
})

req.on('error', err => {
  console.error(`Health check error: ${err.message}`)
  process.exit(1)
})
