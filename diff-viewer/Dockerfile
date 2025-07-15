# Build stage for client
FROM node:18-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Build stage for server
FROM node:18-alpine AS server-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY server/ ./server/
COPY --from=client-builder /app/client/dist ./client/dist

# Runtime stage
FROM node:18-alpine
RUN apk add --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY --from=server-builder /app ./
COPY .env.example .env

# Create cache directory
RUN mkdir -p cache

EXPOSE 7655
CMD ["node", "server/index.js"]