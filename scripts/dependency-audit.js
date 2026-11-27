/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('child_process')

function runNpm(args) {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return {
    status: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

const audit = runNpm(['audit', '--audit-level=moderate', '--json'])
let auditJson = null
try {
  auditJson = JSON.parse(audit.stdout || '{}')
} catch {
  // Keep raw output in the report below.
}

const outdated = runNpm(['outdated', '--json'])
let outdatedJson = null
try {
  outdatedJson = JSON.parse(outdated.stdout || '{}')
} catch {
  outdatedJson = {}
}

const vulnerabilities = auditJson?.metadata?.vulnerabilities || {}
const totalVulnerabilities = Object.values(vulnerabilities).reduce((sum, value) => sum + Number(value || 0), 0)
const outdatedCount = outdatedJson ? Object.keys(outdatedJson).length : 0

console.log('Dependency audit summary')
console.log(JSON.stringify({
  vulnerabilities,
  totalVulnerabilities,
  outdatedPackages: outdatedCount,
}, null, 2))

if (outdatedCount > 0) {
  console.log('\nOutdated packages:')
  for (const [name, info] of Object.entries(outdatedJson)) {
    console.log(`- ${name}: current=${info.current} wanted=${info.wanted} latest=${info.latest}`)
  }
}

if (audit.stderr.trim()) {
  console.error(audit.stderr.trim())
}

if (audit.status !== 0) {
  process.exit(audit.status)
}
