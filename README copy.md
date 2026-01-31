# 🦞 OpenClaw Railway Template

One-click deploy [OpenClaw](https://github.com/openclaw/openclaw) to Railway with a web-based setup wizard.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/openclaw?referralCode=muhammedozel)

## What is OpenClaw?

OpenClaw is a personal AI assistant that connects to your favorite messaging platforms:
- 💬 **Telegram** - Chat with your AI via Telegram bot
- 🎮 **Discord** - AI bot for your Discord server
- 📱 **WhatsApp** - Personal AI on WhatsApp
- 💼 **Slack** - AI assistant for your workspace
- And more: Signal, iMessage, Microsoft Teams, Matrix...

## Features of this Template

- ✅ **1-Click Deploy** - No command line needed
- 🔧 **Web Setup Wizard** - Configure everything from your browser
- 💾 **Persistent Storage** - Config survives redeploys (Railway Volume)
- 🔐 **Password Protected** - Setup page secured with password
- 🔄 **Auto-restart** - Gateway restarts on failure

## Quick Start

### 1. Deploy to Railway

Click the button above or:
1. Fork this repo
2. Go to [Railway](https://railway.com)
3. New Project → Deploy from GitHub repo
4. Select your forked repo

### 2. Configure Environment Variables

In Railway dashboard, add these variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SETUP_PASSWORD` | ✅ Yes | Password to access `/setup` page |
| `OPENCLAW_STATE_DIR` | No | Default: `/data/.openclaw` |
| `OPENCLAW_WORKSPACE_DIR` | No | Default: `/data/workspace` |

### 3. Add a Volume

1. In Railway, click "Add Volume"
2. Mount path: `/data`
3. This stores your config and credentials

### 4. Complete Setup

1. Visit `https://your-app.up.railway.app/setup`
2. Enter the `SETUP_PASSWORD` when prompted
3. Configure your AI provider (Anthropic/OpenAI)
4. Add channel tokens (Telegram, Discord, etc.)
5. Click "Start OpenClaw"

### 5. Done! 🎉

Your OpenClaw instance is now running. The main gateway UI will be at `https://your-app.up.railway.app/`

## Getting Bot Tokens

### Telegram Bot Token

1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Copy the token (looks like `123456789:AAH...`)

### Discord Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application
3. Go to "Bot" tab → Add Bot
4. Copy the Token
5. Enable "Message Content Intent" in Bot settings
6. Invite bot to your server using OAuth2 URL Generator

## Local Development

```bash
# Clone
git clone https://github.com/muhammedozel/openclaw-railway-template.git
cd openclaw-railway-template

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your values

# Run
npm start

# Visit http://localhost:8080/setup
```

## Docker (Local)

```bash
docker build -t openclaw-railway .

docker run -p 8080:8080 \
  -e SETUP_PASSWORD=test123 \
  -v $(pwd)/data:/data \
  openclaw-railway
```

## Architecture

```
┌─────────────────────────────────────────┐
│           Railway Container             │
│                                         │
│  ┌─────────────┐    ┌────────────────┐ │
│  │   Express   │───▶│    OpenClaw    │ │
│  │   Wrapper   │    │    Gateway     │ │
│  │  (port 80)  │    │  (port 18789)  │ │
│  └─────────────┘    └────────────────┘ │
│         │                              │
│         ▼                              │
│  ┌─────────────┐                       │
│  │   /setup    │                       │
│  │   wizard    │                       │
│  └─────────────┘                       │
│                                         │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Railway Volume  │
│    /data        │
│  ├── .openclaw  │
│  └── workspace  │
└─────────────────┘
```

## Troubleshooting

### "Gateway unavailable" error
- Check Railway logs for startup errors
- Ensure SETUP_PASSWORD is set
- Try redeploying

### Bot not responding
- Verify bot token is correct
- Check if bot was added to server (Discord) or started (Telegram)
- Review gateway logs in Railway

### Setup page shows 401
- You're entering wrong password
- Make sure `SETUP_PASSWORD` env var is set in Railway

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SETUP_PASSWORD` | - | Required. Password for /setup |
| `PORT` | `8080` | Server port (set by Railway) |
| `OPENCLAW_STATE_DIR` | `/data/.openclaw` | Config storage path |
| `OPENCLAW_WORKSPACE_DIR` | `/data/workspace` | Workspace path |
| `ANTHROPIC_API_KEY` | - | Pre-set Anthropic key |
| `OPENAI_API_KEY` | - | Pre-set OpenAI key |
| `TELEGRAM_BOT_TOKEN` | - | Pre-set Telegram token |
| `DISCORD_BOT_TOKEN` | - | Pre-set Discord token |

## Links

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Railway Documentation](https://docs.railway.com)

## License

MIT - See [LICENSE](LICENSE)

---

Made with 🦞 by [Muhammed Özel](https://github.com/muhammedozel)
