# Build context is the repository root (see render.yaml: dockerContext: .)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY samples/package.json samples/
COPY eval/package.json eval/
RUN npm ci --workspace apps/server --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w apps/server

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY samples/package.json samples/
COPY eval/package.json eval/
RUN npm ci --workspace apps/server --include-workspace-root --omit=dev && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations
COPY samples/index.json samples/index.json
COPY samples/pdf samples/pdf
ENV PORT=8080 SAMPLES_DIR=/app/samples
EXPOSE 8080
USER node
# migrations run on every boot; they are idempotent and the free tier has no pre-deploy hook
CMD ["sh", "-c", "npx node-pg-migrate up -m apps/server/migrations --migration-file-language sql && node apps/server/dist/index.js"]
