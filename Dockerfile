FROM node:22-slim AS base

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ============================================================================
# Build stage - install dependencies with native modules
# ============================================================================
FROM base AS builder

# Install build dependencies for node-pty and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies (including native modules)
RUN pnpm install --frozen-lockfile || pnpm install

# ============================================================================
# Production stage
# ============================================================================
FROM base AS production

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    chromium \
    # Required for node-pty at runtime
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Install OpenClaw globally
ARG OPENCLAW_VERSION=latest
RUN npm install -g openclaw@${OPENCLAW_VERSION}

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package.json ./
COPY src ./src

# Create data directories with proper permissions
RUN mkdir -p /data/.openclaw /data/workspace

# Create non-root user for security
RUN groupadd -r openclaw && useradd -r -g openclaw openclaw
RUN chown -R openclaw:openclaw /app /data

# Environment defaults
ENV PORT=8080
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=/data/workspace
ENV NODE_ENV=production

# Switch to non-root user
USER openclaw

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/setup/healthz || exit 1

CMD ["node", "src/server.js"]
