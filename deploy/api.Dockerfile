# Volt Neo API image. Built by GitHub Actions from the repository root:
#   docker build -f deploy/api.Dockerfile .
# Keeps the Prisma CLI so the same image runs database migrations.
FROM node:22-bookworm-slim
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
# Amazon's certificate bundle, so the database connection is checked (sslmode=verify-full).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/field/package.json apps/field/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@voltneo/api..."

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @voltneo/shared run build && pnpm --filter @voltneo/api run build \
  && chown -R node:node /repo/apps/api

USER node
WORKDIR /repo/apps/api
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD curl -fsS http://localhost:4000/v1/health || exit 1
CMD ["node", "dist/main.js"]
