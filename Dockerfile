# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89
ARG NODE_VERSION=24.13.0-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f
ARG TAILSCALE_VERSION=v1.98.8@sha256:d54b2e6a9c09f0e5ec52e82b9ad4af3d446b54a7c08075e92f11c39dd410105f

FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM tailscale/tailscale:${TAILSCALE_VERSION} AS tailscale

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:${NODE_VERSION} AS runner
ARG AXORA_REVISION
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
LABEL org.opencontainers.image.revision="${AXORA_REVISION}" \
      org.opencontainers.image.source="https://github.com/ASHRAF-2004/axora"

RUN apt-get update && apt-get install -y --no-install-recommends tar \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 axora \
    && useradd --system --uid 1001 --gid axora --create-home axora
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
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
CMD ["sh", "-c", "if [ -n \"${DATABASE_URL:-}\" ]; then exec sh server-tools/render-start.sh; else exec node server.js; fi"]
