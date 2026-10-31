FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production DEMO_MODE=false DEV_LICENSES=false LISTEN_HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tools ./tools
USER node
EXPOSE 3001
CMD ["node","server/index.js"]
