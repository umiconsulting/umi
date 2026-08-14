# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=300000
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/umi-api/package.json ./apps/umi-api/
COPY apps/umi-dashboard/package.json ./apps/umi-dashboard/
COPY apps/umi-landing-page/package.json ./apps/umi-landing-page/
COPY packages/contract/package.json ./packages/contract/
COPY packages/tokens/package.json ./packages/tokens/
RUN --mount=type=cache,id=umipos-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @umi/api...

COPY packages/contract ./packages/contract
COPY apps/umi-api ./apps/umi-api
RUN --mount=type=cache,id=umipos-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @umi/contract build \
 && pnpm --filter @umi/api build \
 && pnpm --filter=@umi/api --config.inject-workspace-packages=true deploy --prod /out

FROM node:22-alpine AS runtime
ARG RELEASE_VERSION=development
ARG RELEASE_GIT_COMMIT=unavailable
ARG RELEASE_BUILD_TIMESTAMP=unavailable
ENV RELEASE_VERSION=$RELEASE_VERSION \
    RELEASE_GIT_COMMIT=$RELEASE_GIT_COMMIT \
    RELEASE_BUILD_TIMESTAMP=$RELEASE_BUILD_TIMESTAMP
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
RUN find /app/dist -type f -name '*.map' -delete
LABEL org.opencontainers.image.title="UMI API" \
      org.opencontainers.image.version="$RELEASE_VERSION" \
      org.opencontainers.image.revision="$RELEASE_GIT_COMMIT" \
      org.opencontainers.image.created="$RELEASE_BUILD_TIMESTAMP"
USER node
HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/main.js"]
