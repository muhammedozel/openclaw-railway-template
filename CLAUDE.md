# CLAUDE.md - OpenClaw Railway Template

## Project Overview

Railway deployment template for OpenClaw with setup wizard, 20+ auth providers, Web Terminal UI, and production security.

## Architecture

- **HTTP/WS Server** (`src/server.js`): Handles setup, proxying, and TUI
- **Setup Wizard** (`src/public/setup.html`): Web UI for configuration
- **Web TUI** (`src/public/tui.html`): Browser-based terminal
- **OpenClaw Gateway**: AI assistant backend (installed globally via npm)

## Key Files

```
├── Dockerfile              # Multi-stage build with pnpm
├── railway.toml            # Railway deployment config
├── package.json            # Dependencies (http-proxy, node-pty, ws)
├── src/
│   ├── server.js           # Main server (~970 lines)
│   └── public/
│       ├── setup.html      # Setup wizard UI
│       ├── loading.html    # Gateway loading page
│       ├── styles.css      # Shared styles
│       └── tui.html        # Web terminal (xterm.js)
├── .env.example            # Environment template
└── README.md               # Documentation
```

## How It Works

1. User deploys to Railway with volume at `/data`
2. Container starts HTTP server on PORT (default 8080)
3. If not configured, redirects to `/setup`
4. Setup wizard shows 20+ auth providers grouped by vendor
5. On submit, creates config at `$OPENCLAW_STATE_DIR/openclaw.json`
6. Starts OpenClaw gateway on port 18789 with health polling
7. Wrapper proxies all traffic to gateway with Bearer token
8. Web TUI available at `/tui` for terminal access

## Key Features

### Security
- Rate limiting (50 req/min per IP)
- Timing-safe password comparison
- Gateway token file persistence
- Non-root container user

### Auth Providers (20+)
- Anthropic: Claude CLI OAuth, Console Token, API Key
- OpenAI: Codex OAuth, ChatGPT OAuth, API Key
- Google: Gemini CLI OAuth, Antigravity OAuth, API Key
- Others: OpenRouter, Vercel, Moonshot, Z.AI, MiniMax, Qwen, Copilot, Synthetic, OpenCode Zen

### Gateway Management
- Health polling (60s timeout) instead of sleep
- Graceful shutdown (SIGTERM/SIGINT)
- Restart endpoint
- Loading page while starting

### Web TUI
- node-pty + xterm.js
- Idle timeout (5 min)
- Max session (30 min)
- Single session limit

## Development Commands

```bash
pnpm install       # Install dependencies
pnpm start         # Start server
pnpm dev           # Start with file watching
```

## API Endpoints

- `GET /setup` - Setup wizard (auth required)
- `GET /setup/healthz` - Detailed health check
- `GET /setup/api/status` - Status + auth groups + models
- `POST /setup/api/run` - Run onboarding
- `POST /setup/api/reset` - Reset config
- `POST /setup/api/doctor` - Run doctor command
- `POST /setup/api/restart` - Restart gateway
- `POST /setup/api/pairing/approve` - Approve pairing
- `GET /setup/api/debug` - Debug info
- `GET /tui` - Web terminal (auth required)
- `WS /tui/ws` - Terminal WebSocket

## Environment Variables

Required:
- `SETUP_PASSWORD` - Password for /setup page

Optional:
- `PORT` - Server port (default: 8080)
- `OPENCLAW_STATE_DIR` - Config storage (default: /data/.openclaw)
- `OPENCLAW_WORKSPACE_DIR` - Workspace (default: /data/workspace)
- `ANTHROPIC_API_KEY` - Pre-set API key
- `OPENAI_API_KEY` - Pre-set API key
- `GOOGLE_API_KEY` - Pre-set API key
- `OPENROUTER_API_KEY` - Pre-set API key

## Testing

```bash
# Local with Docker
docker build -t openclaw-test .
docker run -p 8080:8080 -e SETUP_PASSWORD=test -v ./data:/data openclaw-test

# Endpoints
curl http://localhost:8080/setup/healthz
# Visit http://localhost:8080/setup (user: any, pass: test)
# Visit http://localhost:8080/tui for terminal
```

## Notes

- Railway Volume should be mounted at `/data` for persistence
- Gateway process spawned as child process with health monitoring
- WebSocket connections proxied to gateway or handled for TUI
- pnpm used as package manager (corepack enabled in Dockerfile)
