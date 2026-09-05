FROM node:22.21.1-bookworm-slim AS dependencies
WORKDIR /workspace
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run prisma:validate && npm run prisma:generate \
    && npm run build --workspace=@crm/shared \
    && npm run build --workspace=@crm/api -- --sourceMap false \
    && ./node_modules/.bin/tsc -p apps/api/tsconfig.seed.json

FROM dependencies AS runtime-dependencies
RUN npm ci --omit=dev --ignore-scripts --workspace=@crm/api --workspace=@crm/shared --include-workspace-root=false \
    && test -f node_modules/prisma/build/index.js

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:9a052c12c6501f1248b682bf6d022276220cb2a65416d215e0973527394d1552 AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=runtime-dependencies --chown=65532:65532 /workspace/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /workspace/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=build --chown=65532:65532 /workspace/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build --chown=65532:65532 /workspace/package.json ./package.json
COPY --from=build --chown=65532:65532 /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=65532:65532 /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=65532:65532 /workspace/apps/api/dist-local ./apps/api/dist-local
COPY --from=build --chown=65532:65532 /workspace/apps/api/prisma/schema.prisma ./apps/api/prisma/schema.prisma
COPY --from=build --chown=65532:65532 /workspace/apps/api/prisma/migrations ./apps/api/prisma/migrations
COPY --from=build --chown=65532:65532 /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=65532:65532 /workspace/packages/shared/dist ./packages/shared/dist
USER 65532:65532
EXPOSE 3001
ENTRYPOINT ["/nodejs/bin/node"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3001/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["apps/api/dist/main.js"]
