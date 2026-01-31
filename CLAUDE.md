# CLAUDE.md - OpenClaw Railway Template

## Project Overview

This is a Railway deployment template for OpenClaw - a personal AI assistant platform.

## Architecture

- **Express wrapper** (`src/server.js`): Handles setup wizard and proxies to OpenClaw gateway
- **Setup wizard** (`src/views/setup.html`): Web UI for initial configuration
- **OpenClaw gateway**: The actual AI assistant backend (installed globally via npm)

## Key Files

```
├── Dockerfile          # Builds container with Node.js + OpenClaw
├── railway.toml        # Railway deployment config
├── package.json        # Dependencies (express, http-proxy-middleware)
├── src/
│   ├── server.js       # Main wrapper server
│   └── views/
│       └── setup.html  # Setup wizard UI
├── .env.example        # Environment variable template
└── README.md           # Documentation
```

## How It Works

1. User deploys to Railway
2. Container starts Express wrapper on PORT (default 8080)
3. If not configured, redirects to `/setup`
4. Setup wizard collects API keys and channel tokens
5. Creates config at `$OPENCLAW_STATE_DIR/openclaw.json`
6. Starts OpenClaw gateway on port 18789
7. Wrapper proxies all traffic to gateway

## Development Commands

```bash
npm install        # Install dependencies
npm start          # Start wrapper server
npm run dev        # Start with file watching
```

## Environment Variables

Required:
- `SETUP_PASSWORD` - Password for /setup page

Optional:
- `PORT` - Server port (default: 8080)
- `OPENCLAW_STATE_DIR` - Config storage (default: /data/.openclaw)
- `OPENCLAW_WORKSPACE_DIR` - Workspace (default: /data/workspace)
- `ANTHROPIC_API_KEY` - Pre-set API key
- `OPENAI_API_KEY` - Pre-set API key

## Testing

```bash
# Local with Docker
docker build -t test .
docker run -p 8080:8080 -e SETUP_PASSWORD=test -v ./data:/data test

# Visit http://localhost:8080/setup
```

## Notes

- Railway Volume should be mounted at `/data` for persistence
- Gateway process is spawned as child process of wrapper
- WebSocket connections are proxied to gateway
