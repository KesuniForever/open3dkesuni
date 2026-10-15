# Open3DKesuni on Railway: one long-running Node server (`next start`) with the SQLite database and the uploaded
# files on a Railway volume (mount it at /data). Railway builds this file automatically when it sits at the repo root.
# Guide: docs/DEPLOY-RAILWAY.md. Secrets are Railway variables at run time; none are needed or baked in at build time.

# Node 24 (same as the studio PC): node:sqlite without a flag, and type stripping for scripts/railway-start.mjs.
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && rm -rf .next/cache

FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/scripts/railway-start.mjs ./scripts/railway-start.mjs
COPY --from=build /app/src/lib/deploy.ts ./src/lib/deploy.ts
# Runs as root on purpose: Railway mounts volumes owned by root, and a non-root user could not write the database.
# Railway sets PORT; Next.js listens on it (default 3000).
EXPOSE 3000
CMD ["node", "scripts/railway-start.mjs"]
