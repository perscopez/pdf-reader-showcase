/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const packageLockPath = path.join(root, 'package-lock.json')
const licensesJsonPath = path.join(root, 'public', 'licenses.json')
const noticesMdPath = path.join(root, 'THIRD_PARTY_NOTICES.md')

if (!fs.existsSync(packageLockPath)) {
  console.error('package-lock.json not found!')
  process.exit(1)
}

const lock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'))
const packages = lock.packages || {}

const allowedLicensesRegex = /^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|OFL-1\.1|CC0-1\.0|Unlicense|MPL-2\.0|LGPL-2\.1.*|LGPL-3\.0.*|0BSD|WTFPL|CC-BY-3\.0|CC-BY-4\.0|BlueOak-1\.0\.0|Public Domain|Zlib)$/i
const forbiddenLicensesRegex = /(?<!L)GPL|AGPL|NonCommercial|NC-/i

const prodDeps = []
const violations = []

for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
  // Skip root package
  if (pkgPath === '') continue
  
  // Skip dev dependencies
  if (pkgInfo.dev) continue

  const name = pkgPath.replace(/^node_modules\//, '')
  
  // Only look at actual packages, skip subpaths inside workspace
  if (pkgPath.includes('node_modules/') && pkgPath.split('node_modules/').length > 2) {
    continue
  }

  let license = pkgInfo.license
  let version = pkgInfo.version

  // Fallback to reading the package's package.json if license is missing in package-lock.json
  if (!license) {
    try {
      const pkgJsonPath = path.join(root, pkgPath, 'package-json')
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
        license = pkgJson.license || (pkgJson.licenses && pkgJson.licenses[0]?.type)
      }
    } catch {
      // Ignore reading errors
    }
  }

  // Treat as unknown if still missing
  if (!license) {
    license = 'Unknown'
  }

  // Normalize string if object/array
  if (typeof license === 'object') {
    license = license.type || JSON.stringify(license)
  }

  // Clean license string (e.g. "(MIT OR Apache-2.0)" -> "MIT OR Apache-2.0")
  const cleanLicense = String(license).replace(/[()]/g, '')

  // Split multi-licenses (e.g., OR / AND)
  prodDeps.push({
    name,
    version,
    license: cleanLicense,
  })

  // Check for violations
  let isAllowed = false
  if (cleanLicense.toUpperCase().includes(' OR ')) {
    const options = cleanLicense.split(/\s+OR\s+/i)
    // If at least one option is allowed and not forbidden, it's allowed
    isAllowed = options.some(lic => allowedLicensesRegex.test(lic.trim()) && !forbiddenLicensesRegex.test(lic.trim()))
  } else {
    const individualLicenses = cleanLicense.split(/\s+AND\s+/i)
    // For single or AND licenses, all must be allowed and not forbidden
    isAllowed = individualLicenses.every(lic => allowedLicensesRegex.test(lic.trim()) && !forbiddenLicensesRegex.test(lic.trim()))
  }

  if (!isAllowed) {
    violations.push(`${name}@${version}: Incompatible or forbidden license "${cleanLicense}" detected!`)
  }
}

// Generate public/licenses.json
fs.mkdirSync(path.dirname(licensesJsonPath), { recursive: true })
fs.writeFileSync(licensesJsonPath, JSON.stringify(prodDeps, null, 2))
console.log(`Saved ${prodDeps.length} licenses to public/licenses.json`)

// Generate THIRD_PARTY_NOTICES.md
let noticesContent = `# Third-Party Notices

This application utilizes the following open-source dependencies. We appreciate the work of the developers behind these projects.

| Library | Version | License |
| :--- | :--- | :--- |
`

// Sort production dependencies alphabetically
prodDeps.sort((a, b) => a.name.localeCompare(b.name))

for (const dep of prodDeps) {
  noticesContent += `| **${dep.name}** | ${dep.version} | ${dep.license} |\n`
}

fs.writeFileSync(noticesMdPath, noticesContent)
console.log(`Saved third-party notices to THIRD_PARTY_NOTICES.md`)

if (violations.length > 0) {
  console.error('\nLicense audit failed: Forbidden or incompatible licenses detected:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('\nLicense audit passed successfully. No forbidden licenses found.')
process.exit(0)
