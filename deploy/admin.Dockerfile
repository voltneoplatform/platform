# Volt Neo admin panel image (Next.js standalone server).
#   docker build -f deploy/admin.Dockerfile --build-arg DEPLOYMENT=staging .
FROM node:22-bookworm-slim AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/field/package.json apps/field/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@voltneo/admin..."
COPY packages/shared packages/shared
COPY apps/admin apps/admin
ARG DEPLOYMENT=staging
# On the server Caddy sends /v1 straight to the API; this is the fallback route.
ENV NEXT_PUBLIC_DEPLOYMENT=$DEPLOYMENT API_URL=http://api:4000 NEXT_OUTPUT=standalone
RUN pnpm --filter @voltneo/shared run build && pnpm --filter @voltneo/admin run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
