# ---------- Stage 1: Build Vue UI ----------
FROM node:20-bookworm-slim AS ui

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts

COPY vite.config.js vite-plugin-fedextool-api.mjs ./
COPY src ./src
COPY public ./public
COPY index.html ./

RUN npm run build

# ---------- Stage 2: Runtime (API + static UI) ----------
FROM mcr.microsoft.com/playwright:v1.51.0-noble

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Server dependencies
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --ignore-scripts

# Playwright chromium (browsers already present in base image, but ensure correct version)
RUN cd server && npx playwright install chromium

# Copy server source
COPY server ./server

# Copy built UI from stage 1
COPY --from=ui /app/dist ./dist

# Environment defaults for containers (can override in Dokploy)
ENV FEDEX_TOOL_API_HOST=0.0.0.0
ENV FEDEX_TOOL_API_PORT=3847

EXPOSE 3847

CMD ["node", "server/index.mjs"]
