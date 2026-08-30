# --- build stage ---
# Context: REPO ROOT (bukan packages/proxy) — lockfile & workspace ada di root.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/proxy/package.json packages/proxy/
RUN npm ci --workspace @sonora-music/proxy --include-workspace-root
COPY packages/proxy/tsconfig.json packages/proxy/
COPY packages/proxy/src packages/proxy/src
COPY packages/proxy/server packages/proxy/server
RUN npm run build -w @sonora-music/proxy

# --- runtime stage ---
FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/proxy/package.json packages/proxy/
RUN npm ci --workspace @sonora-music/proxy --include-workspace-root --omit=dev
COPY --from=build /repo/packages/proxy/dist packages/proxy/dist
EXPOSE 3000
USER node
CMD ["node", "packages/proxy/dist/server/node.js"]
