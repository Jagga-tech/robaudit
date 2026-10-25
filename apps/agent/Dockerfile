# Build from repo root: docker build -f apps/agent/Dockerfile -t keel-agent .
FROM node:20-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/agent ./apps/agent
COPY convex ./convex
COPY demo/seed.json ./demo/seed.json
# spacetimedb/ is a workspace glob entry; only its package.json matters for the lockfile
COPY spacetimedb/package.json ./spacetimedb/package.json
# root (tsx) + agent and its workspace deps; apps/harness is dockerignored
RUN pnpm install --frozen-lockfile --filter @keel/agent... --filter keel \
 && chown -R node:node /app
USER node
# exits non-zero on ledger disconnect; the platform restarts it
CMD ["pnpm", "--filter", "@keel/agent", "start"]
