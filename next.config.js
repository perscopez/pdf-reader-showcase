const path = require('path')
const { execSync } = require('child_process')

function readBuildSha() {
  if (process.env.NEXT_PUBLIC_BUILD_SHA) return process.env.NEXT_PUBLIC_BUILD_SHA
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const buildSha = readBuildSha()
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha,
    NEXT_PUBLIC_BUILD_ID: buildSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    NEXT_PUBLIC_BUILD_LABEL: `build ${buildSha} · ${buildTime}`,
  },
  generateBuildId: async () => buildSha,
  allowedDevOrigins: ['*.local', ...(process.env.DEV_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)],
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    '*': [
      'data/**/*',
      'public/uploads/**/*',
      'backup-deps/**/*',
    ],
  },
  experimental: {
    proxyClientMaxBodySize: '1000mb',
  },
  // Uploaded files live under public/uploads, but must never be served by the static
  // file handler (that would skip the ownership check). beforeFiles rewrites run
  // before public/ lookups, so every /uploads/* request hits the guarded route.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/uploads/:path*', destination: '/api/uploads/:path*' },
      ],
    }
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob:; font-src 'self' data:; frame-src 'self'; worker-src 'self' blob:;",
          },
        ],
      },
    ]
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false

    // Both modern and legacy pdf.mjs ship an inner `var __webpack_exports__`.
    // Webpack's eval wrappers hoist it over their own export object in dev
    // bundles, including server-side indexer imports. Apply the collision fix
    // to both client/server and modern/legacy entrypoints.
    config.module.rules.push({
      test: /pdfjs-dist[\\/](?:legacy[\\/])?build[\\/]pdf\.mjs$/,
      use: [{ loader: path.resolve(__dirname, 'loaders/pdfjs-exports-fix.js') }],
    })

    return config
  },
}

module.exports = nextConfig
