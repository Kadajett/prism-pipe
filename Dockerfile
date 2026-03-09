# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json biome.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Production
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY --from=builder /app/dist/ dist/
COPY prism-pipe.example.yaml ./

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
