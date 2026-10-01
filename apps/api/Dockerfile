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

FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS patched-openssl
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      libssl3t64=3.5.7-1~deb13u3 openssl-provider-legacy=3.5.7-1~deb13u3 \
    && dpkg-query -s libssl3t64 > /libssl3t64.status \
    && dpkg-query -s openssl-provider-legacy > /openssl-provider-legacy.status

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:5ef534d3db0ac0c43bee379af4ae49cfbfc0ef38a46c94c52d87c68f32f34d8a AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/ossl-modules/legacy.so /usr/lib/x86_64-linux-gnu/ossl-modules/legacy.so
COPY --from=patched-openssl /libssl3t64.status /var/lib/dpkg/status.d/libssl3t64
COPY --from=patched-openssl /openssl-provider-legacy.status /var/lib/dpkg/status.d/openssl-provider-legacy
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
