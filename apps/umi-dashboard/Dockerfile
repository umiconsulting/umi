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
    pnpm install --frozen-lockfile --filter @umi/dashboard...

COPY packages/contract ./packages/contract
COPY packages/tokens ./packages/tokens
COPY apps/umi-dashboard ./apps/umi-dashboard

ARG UMI_ENVIRONMENT
ARG PUBLIC_URL
ARG API_BASE
ARG RELEASE_VERSION
ARG RELEASE_GIT_COMMIT
ARG RELEASE_BUILD_TIMESTAMP
ARG CONTRACT_VERSION
ARG CONFIG_SCHEMA_VERSION=1
ENV VITE_UMI_ENVIRONMENT=$UMI_ENVIRONMENT \
    VITE_PUBLIC_URL=$PUBLIC_URL \
    VITE_API_BASE=$API_BASE \
    VITE_RELEASE_VERSION=$RELEASE_VERSION \
    VITE_RELEASE_GIT_COMMIT=$RELEASE_GIT_COMMIT \
    VITE_RELEASE_BUILD_TIMESTAMP=$RELEASE_BUILD_TIMESTAMP \
    VITE_CONTRACT_VERSION=$CONTRACT_VERSION \
    VITE_CONFIG_SCHEMA_VERSION=$CONFIG_SCHEMA_VERSION
RUN pnpm --filter @umi/tokens build \
 && VITE_AUTH_MODE=cookie pnpm --filter @umi/dashboard build \
 && node -e "require('node:fs').writeFileSync('apps/umi-dashboard/dist/release.json', JSON.stringify({application:'umi-dashboard',version:process.env.VITE_RELEASE_VERSION,gitCommit:process.env.VITE_RELEASE_GIT_COMMIT,buildTimestamp:process.env.VITE_RELEASE_BUILD_TIMESTAMP,environment:process.env.VITE_UMI_ENVIRONMENT,contractVersion:process.env.VITE_CONTRACT_VERSION,configurationSchemaVersion:process.env.VITE_CONFIG_SCHEMA_VERSION},null,2)+'\\n')"

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG RELEASE_VERSION=development
ARG RELEASE_GIT_COMMIT=unavailable
ARG RELEASE_BUILD_TIMESTAMP=unavailable
COPY --from=build /repo/apps/umi-dashboard/dist /usr/share/nginx/html
COPY apps/umi-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
LABEL org.opencontainers.image.title="UMI Dashboard" \
      org.opencontainers.image.version="$RELEASE_VERSION" \
      org.opencontainers.image.revision="$RELEASE_GIT_COMMIT" \
      org.opencontainers.image.created="$RELEASE_BUILD_TIMESTAMP"
HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
