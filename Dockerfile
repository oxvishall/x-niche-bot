# syntax=docker/dockerfile:1

# ---- build: install all deps, generate the Prisma client, compile ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

# ---- runtime: production deps + compiled output only ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config ./config
USER node
CMD ["node", "dist/index.js"]
