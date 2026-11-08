# One image runs the API (which also serves the web app), the worker and the migrate step.
# Playwright and its browsers are added in the supplier modules, in their own image.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/audit/package.json packages/audit/
COPY packages/browser-client/package.json packages/browser-client/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/shared/package.json packages/shared/
COPY packages/shopify/package.json packages/shopify/
COPY packages/supplier-session/package.json packages/supplier-session/
COPY services/browser/package.json services/browser/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
