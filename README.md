# OpenClaw Railway Template v3.1

Deploy OpenClaw to Railway with a single click. Built from source with setup wizard, Web TUI, export/import backup, OAuth support, and 20+ auth providers.

## Features

- **Source Build** - OpenClaw built from GitHub source (more reliable than npm)
- **Homebrew Support** - Install additional tools via brew
- **Setup Wizard** - Web-based configuration UI with auth provider selection
- **20+ Auth Providers** - Anthropic, OpenAI, Google, OpenRouter, and more
- **Web Terminal (TUI)** - Browser-based terminal access with xterm.js
- **Export/Import Backup** - Download and restore your config/workspace
- **Config Editor** - Edit raw JSON config with automatic backups
- **Debug Console** - Run safe commands for debugging
- **Multi-Channel** - Telegram, Discord, and Slack support
- **Security** - Rate limiting, timing-safe auth, non-root container
- **Health Checks** - Detailed health endpoint with gateway status

## Quick Start

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-username/openclaw-railway-template
cd openclaw-railway-template

# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env with your SETUP_PASSWORD

# Run locally (requires openclaw installed globally)
pnpm start
```

### Docker

```bash
# Build the image (includes source build of OpenClaw)
docker build -t openclaw-railway .

# Run with a volume for persistence
docker run -p 8080:8080 \
  -e SETUP_PASSWORD=your-password \
  -v openclaw-data:/data \
  openclaw-railway

# Visit http://localhost:8080/setup
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/setup` | Setup wizard (password protected) |
| `/setup/healthz` | Detailed health check |
| `/setup/api/status` | API status and auth providers |
| `/setup/api/run` | Run onboarding configuration |
| `/setup/api/reset` | Reset all configuration |
| `/setup/api/doctor` | Run openclaw doctor command |
| `/setup/api/restart` | Restart the gateway |
| `/setup/api/config` | Get/Set raw config (JSON) |
| `/setup/api/console` | Run debug commands |
| `/setup/api/debug` | Debug information |
| `/setup/export` | Download backup (tar.gz) |
| `/setup/import` | Upload and restore backup |
| `/tui` | Web Terminal UI |
| `/health` | Simple health check |

## Auth Providers

### Anthropic
- Claude Code CLI (OAuth)
- Console Token
- API Key

### OpenAI
- Codex CLI (OAuth)
- ChatGPT (OAuth)
- API Key

### Google
- Gemini CLI (OAuth)
- Antigravity (OAuth)
- Gemini API Key

### Others
- OpenRouter
- Vercel AI Gateway
- Moonshot
- Z.AI
- MiniMax
- Qwen
- GitHub Copilot
- Synthetic
- OpenCode Zen

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SETUP_PASSWORD` | Yes | Password for /setup page |
| `PORT` | No | Server port (default: 8080) |
| `OPENCLAW_STATE_DIR` | No | Config directory (default: /data/.openclaw) |
| `OPENCLAW_WORKSPACE_DIR` | No | Workspace directory (default: /data/workspace) |
| `ENABLE_WEB_TUI` | No | Enable Web Terminal (default: true) |
| `TUI_IDLE_TIMEOUT_MS` | No | TUI idle timeout (default: 300000) |
| `TUI_MAX_SESSION_MS` | No | TUI max session (default: 1800000) |
| `OPENCLAW_TEMPLATE_DEBUG` | No | Enable debug logging (default: false) |
| `ANTHROPIC_API_KEY` | No | Pre-set Anthropic API key |
| `OPENAI_API_KEY` | No | Pre-set OpenAI API key |
| `GOOGLE_API_KEY` | No | Pre-set Google API key |
| `OPENROUTER_API_KEY` | No | Pre-set OpenRouter API key |

## Architecture

```
openclaw-railway-template/
├── src/
│   ├── server.js          # Express server (HTTP/WS)
│   └── public/
│       ├── setup.html     # Setup wizard UI
│       ├── loading.html   # Gateway loading page
│       ├── styles.css     # Shared CSS
│       └── tui.html       # Web Terminal UI
├── Dockerfile             # Multi-stage source build
├── railway.toml           # Railway configuration
├── package.json           # Dependencies
└── .env.example           # Environment template
```

### How It Works

1. **Build Stage**: Clones OpenClaw from GitHub and builds from source
2. **Runtime**: Node.js + Homebrew + Express wrapper
3. User deploys to Railway with a volume at `/data`
4. Express wrapper starts on configured PORT
5. If not configured, redirects to `/setup`
6. Setup wizard collects auth credentials and channel tokens
7. Creates config at `$OPENCLAW_STATE_DIR/openclaw.json`
8. Starts OpenClaw gateway with health polling
9. Wrapper proxies all traffic to gateway with auth headers
10. Web TUI available at `/tui` for terminal access

## Security Features

- **Rate Limiting**: 50 requests/minute per IP
- **Timing-Safe Password Comparison**: Prevents timing attacks
- **Gateway Token Persistence**: Secure file-based token storage
- **Non-Root Container**: Runs as unprivileged user
- **Source Build**: No npm supply chain concerns

## Web Terminal (TUI)

Access OpenClaw via browser at `/tui`:

- **Enabled by Default**: Set `ENABLE_WEB_TUI=false` to disable
- **Idle Timeout**: 5 minutes of inactivity (configurable)
- **Max Session**: 30 minutes per session (configurable)
- **Single Session**: Only one active session at a time
- **Full Terminal**: xterm.js with 256 colors

## Backup & Restore

### Export
1. Go to `/setup`
2. Click "Backup" tab
3. Click "Download Backup"
4. Save the `.tar.gz` file

### Import
1. Go to `/setup`
2. Click "Backup" tab
3. Click "Import Backup"
4. Select your backup file
5. Gateway will restart automatically

## Development

```bash
# Install dependencies
pnpm install

# Start with file watching
pnpm dev

# Build Docker image
docker build -t openclaw-railway .

# Build with specific OpenClaw version
docker build --build-arg OPENCLAW_GIT_REF=v1.0.0 -t openclaw-railway .
```

## License

MIT
