# OpenClaw Railway Template

Deploy OpenClaw to Railway with a single click. Features a setup wizard, 20+ auth providers, Web Terminal UI, and production-ready security.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/openclaw)

## Features

- **Setup Wizard** - Web-based configuration UI with auth provider selection
- **20+ Auth Providers** - Anthropic, OpenAI, Google, OpenRouter, and more
- **OAuth Support** - Login via Claude CLI, Codex CLI, and other OAuth flows
- **Web Terminal (TUI)** - Browser-based terminal access to OpenClaw
- **Multi-Channel** - Telegram, Discord, and Slack support
- **Security** - Rate limiting, timing-safe auth, non-root container
- **Health Checks** - Detailed health endpoint with gateway status
- **Graceful Shutdown** - Proper signal handling for clean restarts

## Quick Start

### Deploy to Railway

1. Click the "Deploy on Railway" button above
2. Set `SETUP_PASSWORD` environment variable
3. Add a volume mounted at `/data` for persistence
4. Deploy and visit `/setup` to configure

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
# Build the image
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
| `/setup/api/debug` | Debug information |
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
| `ANTHROPIC_API_KEY` | No | Pre-set Anthropic API key |
| `OPENAI_API_KEY` | No | Pre-set OpenAI API key |
| `GOOGLE_API_KEY` | No | Pre-set Google API key |
| `OPENROUTER_API_KEY` | No | Pre-set OpenRouter API key |

## Architecture

```
openclaw-railway-template/
├── src/
│   ├── server.js          # Main Express server (HTTP/WS)
│   └── public/
│       ├── setup.html     # Setup wizard UI
│       ├── loading.html   # Gateway loading page
│       ├── styles.css     # Shared CSS
│       └── tui.html       # Web Terminal UI
├── Dockerfile             # Multi-stage build with pnpm
├── railway.toml           # Railway configuration
├── package.json           # Dependencies
└── .env.example           # Environment template
```

### How It Works

1. User deploys to Railway with a volume at `/data`
2. Express wrapper starts on configured PORT
3. If not configured, redirects to `/setup`
4. Setup wizard collects auth credentials and channel tokens
5. Creates config at `$OPENCLAW_STATE_DIR/openclaw.json`
6. Starts OpenClaw gateway with health polling
7. Wrapper proxies all traffic to gateway with auth headers
8. Web TUI available at `/tui` for terminal access

## Security Features

- **Rate Limiting**: 50 requests/minute per IP
- **Timing-Safe Password Comparison**: Prevents timing attacks
- **Gateway Token Persistence**: Secure file-based token storage
- **Non-Root Container**: Runs as unprivileged user
- **CORS Headers**: Configurable cross-origin access

## Web Terminal (TUI)

Access OpenClaw via browser at `/tui`:

- **Idle Timeout**: 5 minutes of inactivity
- **Max Session**: 30 minutes per session
- **Single Session**: Only one active session at a time
- **Full Terminal**: xterm.js with 256 colors

## Development

```bash
# Install dependencies
pnpm install

# Start with file watching
pnpm dev

# Build Docker image
docker build -t openclaw-railway .

# Run tests
pnpm test
```

## License

MIT
