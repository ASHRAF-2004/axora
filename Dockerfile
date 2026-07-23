# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.13.0-slim

FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends tar \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 axora \
    && useradd --system --uid 1001 --gid axora --create-home axora
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=builder --chown=axora:axora /app/public ./public
RUN mkdir -p .next data/uploads && chown -R axora:axora .next data
COPY --from=builder --chown=axora:axora /app/.next/standalone ./
COPY --from=builder --chown=axora:axora /app/.next/static ./.next/static
COPY --from=builder --chown=axora:axora /app/server-tools ./server-tools
COPY --from=builder --chown=axora:axora /app/database/migrations ./database/migrations
COPY --from=builder --chown=axora:axora /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=builder --chown=axora:axora /app/licenses ./licenses

USER axora
EXPOSE 3000
CMD ["node", "server.js"]
