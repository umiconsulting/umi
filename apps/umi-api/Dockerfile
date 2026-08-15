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

# Source (umi-api + its workspace dep @umi/contract), build the contract then
# umi-api (nest → dist/main.js + dist/worker.js), then a pruned prod bundle.
# `pnpm deploy --legacy` injects the built @umi/contract into /out/node_modules as
# a real copy (no workspace symlink survives in the runtime image).
COPY packages/contract ./packages/contract
COPY apps/umi-api ./apps/umi-api
RUN pnpm --filter @umi/contract build \
 && pnpm --filter @umi/api build \
 && pnpm --filter=@umi/api deploy --prod --legacy /out

# ── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
# The Apple pass template. PKPass.from() reads it at render time, and
# apple-pass.builder.ts resolves TEMPLATE_ROOT from process.cwd(), which is /app
# here. Without this line /app/passes/apple/template.pass does not exist and
# EVERY Apple pass render throws — at issue time and at every refresh, on a path
# no test covers because no test signs a real pass.
#
# `passes` is in the "files" list of package.json, so `pnpm deploy` puts it in
# /out. Both lines are load-bearing: the list gets it into /out, this line gets
# it into the image.
COPY --from=build /out/passes ./passes
RUN chown -R node:node /app
USER node
# docker-compose overrides this for the worker process (node dist/worker.js).
CMD ["node", "dist/main.js"]
