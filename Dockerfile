# Stage 1: Build dependencies and compile Next.js application
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install native compilation dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

COPY package*.json .npmrc ./
# Playwright is a local design-review devDependency; never download browsers in Docker
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY scripts/backup-package.json ./backup-deps/package.json
RUN cd backup-deps && npm install --omit=dev --ignore-scripts

COPY . .

ARG NEXT_PUBLIC_BUILD_SHA
ARG NEXT_PUBLIC_BUILD_TIME
ENV NEXT_PUBLIC_BUILD_SHA=$NEXT_PUBLIC_BUILD_SHA
ENV NEXT_PUBLIC_BUILD_TIME=$NEXT_PUBLIC_BUILD_TIME

RUN npm run build

# Stage 2: Light runtime image
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_PATH=/app/backup-deps/node_modules

# Install curl, calibre, ghostscript, poppler-utils, and tar for health check, conversions, and backups
RUN apt-get update && apt-get install -y curl calibre ghostscript poppler-utils tar && rm -rf /var/lib/apt/lists/*

# Copy standalone build assets
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/scripts ./scripts
# Standalone tracing prunes internal Next modules that the router only requires
# at runtime (for example lib/metadata/get-metadata-route), which crashes the
# server on boot. Restore the complete package over the traced subset.
COPY --chown=node:node --from=builder /app/node_modules/next ./node_modules/next
# PDF.js loads this optional native package dynamically when extracting text in
# Node. Next standalone tracing cannot see that runtime require, so copy the
# package and its platform binary explicitly.
COPY --chown=node:node --from=builder /app/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --chown=node:node --from=builder /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
COPY --chown=node:node --from=builder /app/backup-deps/node_modules ./backup-deps/node_modules

# Ensure data and public/uploads directories exist and are owned by non-root node user
RUN mkdir -p /app/data /app/public/uploads && chown -R node:node /app/data /app/public/uploads

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
