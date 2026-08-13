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

FROM node:22.21.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN groupadd --system --gid 10001 crmynov && useradd --system --uid 10001 --gid crmynov crmynov
COPY --from=build --chown=crmynov:crmynov /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=crmynov:crmynov /workspace/apps/web/.next/static ./apps/web/.next/static
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
