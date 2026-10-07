FROM node:22.21.1-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
# Next checks the connected browser test as well as the app. Keep its canonical
# synthetic fixture and contract available only in this build stage; no API app,
# private fixture or test database is copied into the production runtime.
COPY apps/api/test/fixtures/import/historical-workbook.synthetic.ts apps/api/test/fixtures/import/historical-workbook.synthetic.ts
COPY apps/api/src/bootstrap-import/bootstrap-import.contract.ts apps/api/src/bootstrap-import/bootstrap-import.contract.ts
RUN npm run build --workspace=@crm/shared && npm run build --workspace=@crm/web

FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS patched-openssl
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      libssl3t64=3.5.7-1~deb13u3 openssl-provider-legacy=3.5.7-1~deb13u3 \
    && dpkg-query -s libssl3t64 > /libssl3t64.status \
    && dpkg-query -s openssl-provider-legacy > /openssl-provider-legacy.status

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:5ef534d3db0ac0c43bee379af4ae49cfbfc0ef38a46c94c52d87c68f32f34d8a AS runtime
ENV NODE_ENV=production
ENV CRM_API_INTERNAL_URL=http://api:3001
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /workspace
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/ossl-modules/legacy.so /usr/lib/x86_64-linux-gnu/ossl-modules/legacy.so
COPY --from=patched-openssl /libssl3t64.status /var/lib/dpkg/status.d/libssl3t64
COPY --from=patched-openssl /openssl-provider-legacy.status /var/lib/dpkg/status.d/openssl-provider-legacy
COPY --from=build --chown=65532:65532 /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=65532:65532 /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=65532:65532 /workspace/apps/web/public ./apps/web/public
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["apps/web/server.js"]
