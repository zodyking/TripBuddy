# ---------- Stage 1: Build Vue UI ----------
FROM node:20-bookworm-slim AS ui

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# Dokploy → Build → Build Args (recommended):
#   GIT_COMMIT = commit SHA from your deploy (or ${{COMMIT_SHA}} if your template supports it)
# Also enable "Disable build cache" / clean build when UI still looks stale.
# UI rebuild trigger: daily-briefing-narrator-fix
ARG GIT_COMMIT=unknown
ARG BUILD_TIMESTAMP=

COPY vite.config.js vite-plugin-fedextool-api.mjs ./
COPY src ./src
COPY public ./public
COPY index.html ./

RUN set -e; \
  TS="${BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"; \
  echo "TripBuddy UI build git=${GIT_COMMIT} at=${TS}"; \
  npm run build; \
  printf '{"gitCommit":"%s","builtAt":"%s"}\n' "${GIT_COMMIT}" "${TS}" > dist/build-meta.json; \
  cat dist/build-meta.json

# ---------- Stage 2: Runtime (API + static UI) ----------
FROM mcr.microsoft.com/playwright:v1.51.0-noble

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Copy server source first (needed for package.json)
COPY server ./server

# Install server dependencies (this runs postinstall which installs Playwright browsers)
WORKDIR /app/server
RUN npm install

# Back to app root
WORKDIR /app

# Copy built UI from stage 1
COPY --from=ui /app/dist ./dist

# Server imports from `../src/*` at runtime (not bundled into dist).
COPY --from=ui /app/src/utils ./src/utils
COPY --from=ui /app/src/constants ./src/constants

# Environment defaults for containers
ENV FEDEX_TOOL_API_HOST=0.0.0.0
ENV FEDEX_TOOL_API_PORT=3847
ENV NODE_ENV=production

# Healthcheck so Docker/Dokploy knows the container is healthy
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3847/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3847

CMD ["node", "server/index.mjs"]
