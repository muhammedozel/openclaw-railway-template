# CLAUDE.md - OpenClaw Railway Template v3.1

## Project Overview

Railway deployment template for OpenClaw with source build, setup wizard, Web TUI, export/import backup, 20+ auth providers, and production security.

## Architecture

- **Express Server** (`src/server.js`): Handles setup, proxying, TUI, and backup
- **Setup Wizard** (`src/public/setup.html`): Web UI for configuration with tabs
- **Web TUI** (`src/public/tui.html`): Browser-based terminal (xterm.js)
- **OpenClaw Gateway**: AI assistant backend (built from source)

## Key Files

```
├── Dockerfile              # Multi-stage source build with Homebrew
├── railway.toml            # Railway deployment config
├── package.json            # Dependencies (express, http-proxy, node-pty, ws, tar)
├── src/
│   ├── server.js           # Main Express server (~1370 lines)
│   └── public/
│       ├── setup.html      # Setup wizard with tabs (Actions, Backup, Console, Config)
│       ├── loading.html    # Gateway loading page
│       ├── styles.css      # Shared styles
│       └── tui.html        # Web terminal (xterm.js)
├── .env.example            # Environment template
└── README.md               # Documentation
```

## How It Works

1. **Build Stage**: Docker clones OpenClaw from GitHub, builds with pnpm/bun
2. **Runtime Stage**: Node.js + Homebrew + Express wrapper
3. User deploys to Railway with volume at `/data`
4. Container starts Express server on PORT (default 8080)
5. If not configured, redirects to `/setup`
6. Setup wizard shows 20+ auth providers grouped by vendor
7. On submit, creates config at `$OPENCLAW_STATE_DIR/openclaw.json`
8. Starts OpenClaw gateway on port 18789 with health polling
9. Wrapper proxies all traffic to gateway with Bearer token
10. Web TUI available at `/tui` for terminal access

## Key Features

### Source Build (New in v3)
- OpenClaw built from GitHub source (not npm)
- Avoids missing dist files in npm package
- Homebrew available for additional tools
- Build arg `OPENCLAW_GIT_REF` to pin version

### Export/Import Backup (New in v3)
- Export: Downloads tar.gz of config + workspace
- Import: Restores from backup, restarts gateway
- Automatic backup before config edits

### Config Editor (New in v3)
- Edit raw JSON config in browser
- Automatic .bak file creation
- Gateway restart on save

### Debug Console (New in v3)
- Run safe commands from browser
- Gateway control (start/stop/restart)
- OpenClaw commands (status, health, doctor, logs)

### OAuth Support (New in v3.1)
- **Device Code Flow**: Browser-based OAuth with URL + code display
- **Token Paste**: Manual token input for providers supporting it
- **Local OAuth + Import**: Run OAuth locally, export, upload backup
- Supported OAuth providers: Claude CLI, OpenAI Codex, ChatGPT, Gemini CLI, Antigravity, Qwen, GitHub Copilot
- 5-minute timeout with automatic cleanup
- Real-time polling for authentication status

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
- Enabled by default (ENABLE_WEB_TUI=false to disable)
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

### Setup (auth required)
- `GET /setup` - Setup wizard
- `GET /setup/api/status` - Status + auth groups + models
- `POST /setup/api/run` - Run onboarding
- `POST /setup/api/reset` - Reset config
- `POST /setup/api/doctor` - Run doctor command
- `POST /setup/api/restart` - Restart gateway
- `POST /setup/api/pairing/approve` - Approve pairing
- `GET /setup/api/debug` - Debug info
- `GET /setup/api/config` - Get raw config
- `POST /setup/api/config` - Save raw config
- `POST /setup/api/console` - Run debug command
- `GET /setup/export` - Download backup
- `POST /setup/import` - Upload backup

### OAuth (auth required)
- `POST /setup/api/oauth/start` - Start Device Code Flow
- `GET /setup/api/oauth/poll/:pollId` - Poll OAuth status
- `POST /setup/api/oauth/cancel/:pollId` - Cancel OAuth session
- `POST /setup/api/oauth/paste` - Paste token directly

### Health (no auth)
- `GET /setup/healthz` - Detailed health check
- `GET /health` - Simple health check

### Web TUI (auth required)
- `GET /tui` - Web terminal
- `WS /tui/ws` - Terminal WebSocket

## Environment Variables

Required:
- `SETUP_PASSWORD` - Password for /setup page

Optional:
- `PORT` - Server port (default: 8080)
- `OPENCLAW_STATE_DIR` - Config storage (default: /data/.openclaw)
- `OPENCLAW_WORKSPACE_DIR` - Workspace (default: /data/workspace)
- `ENABLE_WEB_TUI` - Enable TUI (default: true)
- `TUI_IDLE_TIMEOUT_MS` - TUI idle timeout (default: 300000)
- `TUI_MAX_SESSION_MS` - TUI max session (default: 1800000)
- `OPENCLAW_TEMPLATE_DEBUG` - Debug logging (default: false)
- `ANTHROPIC_API_KEY` - Pre-set API key
- `OPENAI_API_KEY` - Pre-set API key
- `GOOGLE_API_KEY` - Pre-set API key
- `OPENROUTER_API_KEY` - Pre-set API key

## Docker Build Args

- `OPENCLAW_GIT_REF` - Git ref to build (default: main)

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
- Homebrew available at /home/linuxbrew/.linuxbrew/bin
