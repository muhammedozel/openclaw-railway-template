const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const url = require('url');

require('dotenv').config();

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '8080', 10);
const SETUP_PASSWORD = process.env.SETUP_PASSWORD;
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/data/.openclaw';
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';
const GATEWAY_PORT = 18789;
const GATEWAY_READY_TIMEOUT = 60000; // 60 seconds
const GATEWAY_POLL_INTERVAL = 500; // 500ms
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 50; // 50 requests per minute
const TUI_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const TUI_MAX_SESSION = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// State
// ============================================================================

let gatewayProcess = null;
let isSetupComplete = false;
let isGatewayReady = false;
let gatewayToken = null;
const rateLimitMap = new Map();
let tuiSession = null;

// ============================================================================
// Auth Providers Configuration
// ============================================================================

const AUTH_GROUPS = {
  anthropic: {
    name: 'Anthropic',
    providers: [
      { id: 'claude-cli', name: 'Claude Code CLI (OAuth)', type: 'oauth', description: 'Login via Claude Code CLI' },
      { id: 'anthropic-token', name: 'Console Token', type: 'token', envKey: 'ANTHROPIC_AUTH_TOKEN', placeholder: 'Paste token from console.anthropic.com' },
      { id: 'anthropic-api', name: 'API Key', type: 'api-key', envKey: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' }
    ]
  },
  openai: {
    name: 'OpenAI',
    providers: [
      { id: 'openai-codex', name: 'Codex CLI (OAuth)', type: 'oauth', description: 'Login via OpenAI Codex CLI' },
      { id: 'chatgpt-oauth', name: 'ChatGPT (OAuth)', type: 'oauth', description: 'Login via ChatGPT' },
      { id: 'openai-api', name: 'API Key', type: 'api-key', envKey: 'OPENAI_API_KEY', placeholder: 'sk-...' }
    ]
  },
  google: {
    name: 'Google',
    providers: [
      { id: 'gemini-cli', name: 'Gemini CLI (OAuth)', type: 'oauth', description: 'Login via Gemini CLI' },
      { id: 'antigravity-oauth', name: 'Antigravity (OAuth)', type: 'oauth', description: 'Login via Antigravity' },
      { id: 'gemini-api', name: 'Gemini API Key', type: 'api-key', envKey: 'GOOGLE_API_KEY', placeholder: 'AI...' }
    ]
  },
  openrouter: {
    name: 'OpenRouter',
    providers: [
      { id: 'openrouter-api', name: 'API Key', type: 'api-key', envKey: 'OPENROUTER_API_KEY', placeholder: 'sk-or-...' }
    ]
  },
  vercel: {
    name: 'Vercel AI Gateway',
    providers: [
      { id: 'vercel-api', name: 'API Key', type: 'api-key', envKey: 'VERCEL_AI_API_KEY', placeholder: 'vai_...' }
    ]
  },
  moonshot: {
    name: 'Moonshot',
    providers: [
      { id: 'moonshot-api', name: 'API Key', type: 'api-key', envKey: 'MOONSHOT_API_KEY', placeholder: 'sk-...' }
    ]
  },
  zai: {
    name: 'Z.AI',
    providers: [
      { id: 'zai-api', name: 'API Key', type: 'api-key', envKey: 'ZAI_API_KEY', placeholder: '...' }
    ]
  },
  minimax: {
    name: 'MiniMax',
    providers: [
      { id: 'minimax-api', name: 'API Key', type: 'api-key', envKey: 'MINIMAX_API_KEY', placeholder: '...' }
    ]
  },
  qwen: {
    name: 'Qwen',
    providers: [
      { id: 'qwen-oauth', name: 'Qwen (OAuth)', type: 'oauth', description: 'Login via Qwen' },
      { id: 'qwen-api', name: 'API Key', type: 'api-key', envKey: 'QWEN_API_KEY', placeholder: 'sk-...' }
    ]
  },
  copilot: {
    name: 'GitHub Copilot',
    providers: [
      { id: 'copilot-oauth', name: 'Copilot (OAuth)', type: 'oauth', description: 'Login via GitHub Copilot' }
    ]
  },
  synthetic: {
    name: 'Synthetic',
    providers: [
      { id: 'synthetic-api', name: 'API Key', type: 'api-key', envKey: 'SYNTHETIC_API_KEY', placeholder: '...' }
    ]
  },
  opencodezen: {
    name: 'OpenCode Zen',
    providers: [
      { id: 'opencodezen-api', name: 'API Key', type: 'api-key', envKey: 'OPENCODEZEN_API_KEY', placeholder: '...' }
    ]
  }
};

const MODEL_OPTIONS = [
  { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Recommended)', provider: 'anthropic' },
  { value: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5', provider: 'anthropic' },
  { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { value: 'openai/gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  { value: 'openai/o1', label: 'o1', provider: 'openai' },
  { value: 'openai/o1-mini', label: 'o1 Mini', provider: 'openai' },
  { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google' },
  { value: 'google/gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'google' },
  { value: 'openrouter/auto', label: 'OpenRouter Auto', provider: 'openrouter' }
];

// ============================================================================
// Utility Functions
// ============================================================================

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant time comparison even when lengths differ
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  }

  record.count++;
  rateLimitMap.set(ip, record);

  return record.count <= RATE_LIMIT_MAX;
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket?.remoteAddress ||
         'unknown';
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendHTML(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveStaticFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch (e) {
    return false;
  }
}

function checkSetupComplete() {
  const configPath = path.join(STATE_DIR, 'openclaw.json');
  return fs.existsSync(configPath);
}

function loadGatewayToken() {
  const tokenPath = path.join(STATE_DIR, 'gateway-token');
  try {
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, 'utf8').trim();
    }
  } catch (e) {
    console.error('Failed to load gateway token:', e.message);
  }
  return process.env.OPENCLAW_GATEWAY_TOKEN || null;
}

function saveGatewayToken(token) {
  const tokenPath = path.join(STATE_DIR, 'gateway-token');
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  } catch (e) {
    console.error('Failed to save gateway token:', e.message);
  }
}

// ============================================================================
// Authentication Middleware
// ============================================================================

function requireSetupAuth(req, res) {
  if (!SETUP_PASSWORD) {
    sendJSON(res, 500, { error: 'SETUP_PASSWORD environment variable not set' });
    return false;
  }

  const ip = getClientIP(req);
  if (!checkRateLimit(ip)) {
    sendJSON(res, 429, { error: 'Too many requests. Please try again later.' });
    return false;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="OpenClaw Setup"',
      'Content-Type': 'text/plain'
    });
    res.end('Authentication required');
    return false;
  }

  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const colonIndex = credentials.indexOf(':');
  const pass = colonIndex > -1 ? credentials.slice(colonIndex + 1) : '';

  if (!timingSafeEqual(pass, SETUP_PASSWORD)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="OpenClaw Setup"',
      'Content-Type': 'text/plain'
    });
    res.end('Invalid password');
    return false;
  }

  return true;
}

// ============================================================================
// Gateway Management
// ============================================================================

async function checkGatewayHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${GATEWAY_PORT}/health`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForGatewayReady() {
  const startTime = Date.now();

  while (Date.now() - startTime < GATEWAY_READY_TIMEOUT) {
    if (await checkGatewayHealth()) {
      return true;
    }
    await new Promise(r => setTimeout(r, GATEWAY_POLL_INTERVAL));
  }

  return false;
}

async function startGateway() {
  return new Promise(async (resolve, reject) => {
    if (gatewayProcess) {
      console.log('Gateway already running');
      return resolve();
    }

    console.log('Starting OpenClaw gateway...');
    isGatewayReady = false;

    // Generate a gateway token if not already set
    if (!gatewayToken) {
      gatewayToken = loadGatewayToken();
      if (!gatewayToken) {
        gatewayToken = crypto.randomBytes(32).toString('hex');
        saveGatewayToken(gatewayToken);
      }
    }

    const args = [
      'gateway',
      '--port', GATEWAY_PORT.toString(),
      '--verbose'
    ];

    if (gatewayToken) {
      args.push('--token', gatewayToken);
    }

    gatewayProcess = spawn('openclaw', args, {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    gatewayProcess.stdout.on('data', (data) => {
      console.log(`[Gateway] ${data.toString().trim()}`);
    });

    gatewayProcess.stderr.on('data', (data) => {
      console.error(`[Gateway] ${data.toString().trim()}`);
    });

    gatewayProcess.on('error', (error) => {
      console.error('Failed to start gateway:', error);
      gatewayProcess = null;
      isGatewayReady = false;
      reject(error);
    });

    gatewayProcess.on('exit', (code, signal) => {
      console.log(`Gateway exited with code ${code}, signal ${signal}`);
      gatewayProcess = null;
      isGatewayReady = false;
    });

    // Wait for gateway to be ready
    const ready = await waitForGatewayReady();
    if (ready) {
      console.log('Gateway is ready');
      isGatewayReady = true;
      resolve();
    } else {
      console.error('Gateway failed to become ready within timeout');
      if (gatewayProcess) {
        gatewayProcess.kill('SIGTERM');
        gatewayProcess = null;
      }
      reject(new Error('Gateway startup timeout'));
    }
  });
}

function stopGateway() {
  if (gatewayProcess) {
    console.log('Stopping gateway...');
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
    isGatewayReady = false;
  }
}

async function restartGateway() {
  stopGateway();
  await new Promise(r => setTimeout(r, 1000));
  await startGateway();
}

// ============================================================================
// Proxy Setup
// ============================================================================

const proxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${GATEWAY_PORT}`,
  ws: true,
  xfwd: true
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Gateway unavailable');
  }
});

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers for API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ========== Static Files ==========

  if (pathname === '/styles.css') {
    const filePath = path.join(__dirname, 'public', 'styles.css');
    if (serveStaticFile(res, filePath, 'text/css')) return;
  }

  // ========== Health Check ==========

  if (pathname === '/setup/healthz' || pathname === '/health') {
    const gatewayHealthy = await checkGatewayHealth();
    sendJSON(res, 200, {
      status: 'ok',
      setupComplete: isSetupComplete,
      gatewayRunning: gatewayProcess !== null,
      gatewayReady: isGatewayReady,
      gatewayHealthy,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // ========== Setup Routes ==========

  if (pathname === '/setup') {
    if (!requireSetupAuth(req, res)) return;

    const filePath = path.join(__dirname, 'public', 'setup.html');
    if (serveStaticFile(res, filePath, 'text/html; charset=utf-8')) return;

    sendJSON(res, 404, { error: 'Setup page not found' });
    return;
  }

  if (pathname === '/setup/api/status') {
    if (!requireSetupAuth(req, res)) return;

    sendJSON(res, 200, {
      setupComplete: isSetupComplete,
      gatewayRunning: gatewayProcess !== null,
      gatewayReady: isGatewayReady,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      authGroups: AUTH_GROUPS,
      models: MODEL_OPTIONS
    });
    return;
  }

  if (pathname === '/setup/api/run' && req.method === 'POST') {
    if (!requireSetupAuth(req, res)) return;

    try {
      const body = await parseBody(req);
      const {
        authProvider,
        authValue,
        model,
        telegramToken,
        discordToken,
        slackToken
      } = body;

      // Validate required fields
      if (!authProvider || !authValue) {
        sendJSON(res, 400, { error: 'Auth provider and value are required' });
        return;
      }

      // Find auth provider config
      let providerConfig = null;
      for (const group of Object.values(AUTH_GROUPS)) {
        const found = group.providers.find(p => p.id === authProvider);
        if (found) {
          providerConfig = found;
          break;
        }
      }

      if (!providerConfig) {
        sendJSON(res, 400, { error: 'Invalid auth provider' });
        return;
      }

      // Create config
      const config = {
        agent: {
          model: model || 'anthropic/claude-sonnet-4-5'
        },
        channels: {}
      };

      // Add channels
      if (telegramToken) {
        config.channels.telegram = { botToken: telegramToken };
      }
      if (discordToken) {
        config.channels.discord = { token: discordToken };
      }
      if (slackToken) {
        config.channels.slack = { token: slackToken };
      }

      // Ensure directories exist
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

      // Write config
      const configPath = path.join(STATE_DIR, 'openclaw.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Set environment variable based on provider type
      if (providerConfig.envKey) {
        process.env[providerConfig.envKey] = authValue;
      }

      // Start gateway
      await startGateway();

      isSetupComplete = true;
      sendJSON(res, 200, { success: true, message: 'Setup complete! Gateway started.' });
    } catch (error) {
      console.error('Setup error:', error);
      sendJSON(res, 500, { success: false, error: error.message });
    }
    return;
  }

  if (pathname === '/setup/api/reset' && req.method === 'POST') {
    if (!requireSetupAuth(req, res)) return;

    try {
      // Stop gateway
      stopGateway();

      // Remove config file
      const configPath = path.join(STATE_DIR, 'openclaw.json');
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      // Remove gateway token
      const tokenPath = path.join(STATE_DIR, 'gateway-token');
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
      }

      isSetupComplete = false;
      gatewayToken = null;

      sendJSON(res, 200, { success: true, message: 'Configuration reset. Please set up again.' });
    } catch (error) {
      console.error('Reset error:', error);
      sendJSON(res, 500, { success: false, error: error.message });
    }
    return;
  }

  if (pathname === '/setup/api/doctor' && req.method === 'POST') {
    if (!requireSetupAuth(req, res)) return;

    try {
      const result = execSync('openclaw doctor 2>&1', {
        timeout: 30000,
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: STATE_DIR,
          OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR
        }
      });

      sendJSON(res, 200, { success: true, output: result });
    } catch (error) {
      sendJSON(res, 200, {
        success: false,
        output: error.stdout || error.stderr || error.message
      });
    }
    return;
  }

  if (pathname === '/setup/api/restart' && req.method === 'POST') {
    if (!requireSetupAuth(req, res)) return;

    try {
      await restartGateway();
      sendJSON(res, 200, { success: true, message: 'Gateway restarted.' });
    } catch (error) {
      console.error('Restart error:', error);
      sendJSON(res, 500, { success: false, error: error.message });
    }
    return;
  }

  if (pathname === '/setup/api/pairing/approve' && req.method === 'POST') {
    if (!requireSetupAuth(req, res)) return;

    try {
      const body = await parseBody(req);
      const { pairingId, approved } = body;

      if (!pairingId) {
        sendJSON(res, 400, { error: 'Pairing ID is required' });
        return;
      }

      // TODO: Implement actual pairing approval via OpenClaw API
      sendJSON(res, 200, {
        success: true,
        message: approved ? 'Pairing approved' : 'Pairing rejected'
      });
    } catch (error) {
      console.error('Pairing approval error:', error);
      sendJSON(res, 500, { success: false, error: error.message });
    }
    return;
  }

  if (pathname === '/setup/api/debug') {
    if (!requireSetupAuth(req, res)) return;

    const configPath = path.join(STATE_DIR, 'openclaw.json');
    let config = null;
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // Mask sensitive values
        if (config.channels?.telegram?.botToken) {
          config.channels.telegram.botToken = '***masked***';
        }
        if (config.channels?.discord?.token) {
          config.channels.discord.token = '***masked***';
        }
        if (config.channels?.slack?.token) {
          config.channels.slack.token = '***masked***';
        }
      }
    } catch (e) {
      config = { error: e.message };
    }

    sendJSON(res, 200, {
      setupComplete: isSetupComplete,
      gatewayRunning: gatewayProcess !== null,
      gatewayReady: isGatewayReady,
      gatewayPid: gatewayProcess?.pid,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      config,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '***set***' : null,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***set***' : null
      }
    });
    return;
  }

  // ========== Web TUI ==========

  if (pathname === '/tui') {
    if (!requireSetupAuth(req, res)) return;

    const filePath = path.join(__dirname, 'public', 'tui.html');
    if (serveStaticFile(res, filePath, 'text/html; charset=utf-8')) return;

    sendJSON(res, 404, { error: 'TUI page not found' });
    return;
  }

  // ========== Loading Page ==========

  if (pathname === '/loading') {
    const filePath = path.join(__dirname, 'public', 'loading.html');
    if (serveStaticFile(res, filePath, 'text/html; charset=utf-8')) return;

    // Fallback loading page
    sendHTML(res, 200, `
      <!DOCTYPE html>
      <html>
      <head>
        <title>OpenClaw - Loading</title>
        <meta http-equiv="refresh" content="3">
        <style>
          body { font-family: system-ui; background: #1a1a2e; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .loader { text-align: center; }
          .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #ff6b35; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="loader">
          <div class="spinner"></div>
          <p>Starting OpenClaw gateway...</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // ========== API Status (legacy) ==========

  if (pathname === '/api/status') {
    sendJSON(res, 200, {
      setupComplete: isSetupComplete,
      gatewayRunning: gatewayProcess !== null,
      gatewayReady: isGatewayReady,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR
    });
    return;
  }

  // ========== Proxy to Gateway ==========

  // If setup not complete, redirect to setup
  if (!isSetupComplete) {
    res.writeHead(302, { Location: '/setup' });
    res.end();
    return;
  }

  // If gateway not ready, show loading page
  if (!isGatewayReady) {
    res.writeHead(302, { Location: '/loading' });
    res.end();
    return;
  }

  // Proxy to gateway
  const proxyHeaders = { ...req.headers };
  if (gatewayToken) {
    proxyHeaders['Authorization'] = `Bearer ${gatewayToken}`;
  }
  req.headers = proxyHeaders;

  proxy.web(req, res);
});

// ========== WebSocket Handling ==========

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // TUI WebSocket
  if (pathname === '/tui/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTuiConnection(ws, req);
    });
    return;
  }

  // If gateway ready, proxy WebSocket
  if (isSetupComplete && isGatewayReady) {
    proxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

// ========== Web TUI Implementation ==========

function handleTuiConnection(ws, req) {
  // Check if there's already an active session
  if (tuiSession && tuiSession.ws.readyState === 1) {
    ws.close(1000, 'Another session is already active');
    return;
  }

  let pty;
  try {
    const nodePty = require('node-pty');
    pty = nodePty.spawn('openclaw', ['chat'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: WORKSPACE_DIR,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
        TERM: 'xterm-256color'
      }
    });
  } catch (e) {
    console.error('Failed to spawn PTY:', e.message);
    ws.close(1011, 'Failed to create terminal session');
    return;
  }

  const sessionStart = Date.now();
  let lastActivity = Date.now();

  tuiSession = { ws, pty, sessionStart, lastActivity };

  // Idle timeout check
  const idleChecker = setInterval(() => {
    const now = Date.now();

    // Check max session duration
    if (now - sessionStart > TUI_MAX_SESSION) {
      ws.close(1000, 'Maximum session duration reached');
      return;
    }

    // Check idle timeout
    if (now - lastActivity > TUI_IDLE_TIMEOUT) {
      ws.close(1000, 'Session timed out due to inactivity');
      return;
    }
  }, 10000);

  pty.onData((data) => {
    lastActivity = Date.now();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  pty.onExit(({ exitCode }) => {
    clearInterval(idleChecker);
    tuiSession = null;
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close();
    }
  });

  ws.on('message', (msg) => {
    lastActivity = Date.now();
    try {
      const message = JSON.parse(msg.toString());

      if (message.type === 'input') {
        pty.write(message.data);
      } else if (message.type === 'resize') {
        pty.resize(message.cols || 80, message.rows || 24);
      }
    } catch (e) {
      // If it's not JSON, treat as raw input
      pty.write(msg.toString());
    }
  });

  ws.on('close', () => {
    clearInterval(idleChecker);
    pty.kill();
    tuiSession = null;
  });

  ws.on('error', (err) => {
    console.error('TUI WebSocket error:', err.message);
    clearInterval(idleChecker);
    pty.kill();
    tuiSession = null;
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
  });

  // Close WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  // Stop TUI session
  if (tuiSession) {
    tuiSession.pty.kill();
    tuiSession.ws.close(1001, 'Server shutting down');
    tuiSession = null;
  }

  // Stop gateway
  stopGateway();

  // Force exit after timeout
  setTimeout(() => {
    console.log('Forcing exit...');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// Startup
// ============================================================================

async function startup() {
  isSetupComplete = checkSetupComplete();
  gatewayToken = loadGatewayToken();

  if (isSetupComplete) {
    console.log('Setup already complete, starting gateway...');
    try {
      await startGateway();
    } catch (error) {
      console.error('Failed to start gateway on startup:', error.message);
    }
  } else {
    console.log('Setup not complete. Visit /setup to configure.');
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenClaw Railway Template running on port ${PORT}`);
    console.log(`  Setup complete: ${isSetupComplete}`);
    console.log(`  State dir: ${STATE_DIR}`);
    console.log(`  Workspace dir: ${WORKSPACE_DIR}`);
    console.log(`  Endpoints:`);
    console.log(`    - Setup:  http://localhost:${PORT}/setup`);
    console.log(`    - Health: http://localhost:${PORT}/setup/healthz`);
    console.log(`    - TUI:    http://localhost:${PORT}/tui`);
  });
}

startup();
