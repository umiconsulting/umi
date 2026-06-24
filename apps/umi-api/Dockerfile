# syntax=docker/dockerfile:1

# ── build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Run as the unprivileged built-in node user, not root.
RUN chown -R node:node /app
USER node
# Default command is the web process; docker-compose overrides it for the worker.
CMD ["node", "dist/main.js"]
