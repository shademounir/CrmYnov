FROM node:22.21.1-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run prisma:generate && npm run build --workspace=@crm/shared && npm run build --workspace=@crm/api

FROM node:22.21.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN groupadd --system --gid 10001 crmynov && useradd --system --uid 10001 --gid crmynov crmynov
COPY --from=build --chown=crmynov:crmynov /workspace/node_modules ./node_modules
COPY --from=build --chown=crmynov:crmynov /workspace/package.json ./package.json
COPY --from=build --chown=crmynov:crmynov /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=crmynov:crmynov /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=crmynov:crmynov /workspace/packages/shared ./packages/shared
USER 10001:10001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
