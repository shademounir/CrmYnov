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
RUN npm run build --workspace=@crm/shared && npm run build --workspace=@crm/web

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:9a052c12c6501f1248b682bf6d022276220cb2a65416d215e0973527394d1552 AS runtime
ENV NODE_ENV=production
ENV CRM_API_INTERNAL_URL=http://api:3001
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /workspace
COPY --from=build --chown=65532:65532 /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=65532:65532 /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=65532:65532 /workspace/apps/web/public ./apps/web/public
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["apps/web/server.js"]
