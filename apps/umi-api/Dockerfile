# syntax=docker/dockerfile:1

# umi-api is a pnpm workspace member, so its image is built from the REPO ROOT
# (see docker-compose.yml + .github/workflows/deploy-backend.yml) — pnpm resolves
# the workspace from the root lockfile. Multi-stage: install + build in a full
# workspace, then `pnpm deploy` emits a pruned, isolated bundle for a lean runtime
# image. The VPS only ever PULLS this prebuilt image; it never builds.

# ── build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /repo

# Manifests first for a cacheable install layer. Every workspace member's
# package.json must be present so `--frozen-lockfile` membership matches the root
# lockfile; `--filter @umi/api...` then installs only umi-api's subtree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/umi-api/package.json ./apps/umi-api/
COPY apps/umi-dashboard/package.json ./apps/umi-dashboard/
COPY apps/umi-landing-page/package.json ./apps/umi-landing-page/
COPY packages/contract/package.json ./packages/contract/
COPY packages/tokens/package.json ./packages/tokens/
RUN pnpm install --frozen-lockfile --filter @umi/api...

# Source, build (nest → dist/main.js + dist/worker.js), then a pruned prod bundle.
COPY apps/umi-api ./apps/umi-api
RUN pnpm --filter @umi/api build \
 && pnpm --filter=@umi/api deploy --prod --legacy /out

# ── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
RUN chown -R node:node /app
USER node
# docker-compose overrides this for the worker process (node dist/worker.js).
CMD ["node", "dist/main.js"]
