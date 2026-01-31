FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /app

# Install OpenClaw globally
ARG OPENCLAW_VERSION=latest
RUN npm install -g openclaw@${OPENCLAW_VERSION}

# Copy wrapper application
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create data directories
RUN mkdir -p /data/.openclaw /data/workspace

# Environment defaults
ENV PORT=8080
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=/data/workspace
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/server.js"]
