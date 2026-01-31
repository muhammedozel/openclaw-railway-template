const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const SETUP_PASSWORD = process.env.SETUP_PASSWORD;
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/data/.openclaw';
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR || '/data/workspace';
const GATEWAY_PORT = 18789;

let gatewayProcess = null;
let isSetupComplete = false;

// Check if setup is already complete
function checkSetupComplete() {
  const configPath = path.join(STATE_DIR, 'openclaw.json');
  return fs.existsSync(configPath);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Basic auth for setup pages
function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res.status(500).send('SETUP_PASSWORD environment variable not set');
  }
  
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Setup"');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = credentials.split(':');
  
  if (pass !== SETUP_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="OpenClaw Setup"');
    return res.status(401).send('Invalid password');
  }
  
  next();
}

// Setup page
app.get('/setup', requireSetupAuth, (req, res) => {
  if (isSetupComplete) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'views', 'setup.html'));
});

// Setup API
app.post('/api/setup', requireSetupAuth, async (req, res) => {
  try {
    const { 
      anthropicKey, 
      openaiKey,
      telegramToken, 
      discordToken,
      model 
    } = req.body;

    // Create config
    const config = {
      agent: {
        model: model || 'anthropic/claude-sonnet-4-5'
      },
      channels: {}
    };

    // Add Telegram if token provided
    if (telegramToken) {
      config.channels.telegram = {
        botToken: telegramToken
      };
    }

    // Add Discord if token provided
    if (discordToken) {
      config.channels.discord = {
        token: discordToken
      };
    }

    // Ensure directories exist
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    // Write config
    const configPath = path.join(STATE_DIR, 'openclaw.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Set API keys as environment variables for the gateway
    if (anthropicKey) {
      process.env.ANTHROPIC_API_KEY = anthropicKey;
    }
    if (openaiKey) {
      process.env.OPENAI_API_KEY = openaiKey;
    }

    // Start gateway
    await startGateway();
    
    isSetupComplete = true;
    res.json({ success: true, message: 'Setup complete! Gateway started.' });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    setupComplete: isSetupComplete,
    gatewayRunning: gatewayProcess !== null
  });
});

// Status API
app.get('/api/status', (req, res) => {
  res.json({
    setupComplete: isSetupComplete,
    gatewayRunning: gatewayProcess !== null,
    stateDir: STATE_DIR,
    workspaceDir: WORKSPACE_DIR
  });
});

// Start OpenClaw gateway
async function startGateway() {
  return new Promise((resolve, reject) => {
    if (gatewayProcess) {
      console.log('Gateway already running');
      return resolve();
    }

    console.log('Starting OpenClaw gateway...');
    
    gatewayProcess = spawn('openclaw', [
      'gateway',
      '--port', GATEWAY_PORT.toString(),
      '--verbose'
    ], {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    gatewayProcess.stdout.on('data', (data) => {
      console.log(`[Gateway] ${data}`);
    });

    gatewayProcess.stderr.on('data', (data) => {
      console.error(`[Gateway Error] ${data}`);
    });

    gatewayProcess.on('error', (error) => {
      console.error('Failed to start gateway:', error);
      gatewayProcess = null;
      reject(error);
    });

    gatewayProcess.on('exit', (code) => {
      console.log(`Gateway exited with code ${code}`);
      gatewayProcess = null;
    });

    // Wait a bit for gateway to start
    setTimeout(() => {
      console.log('Gateway started successfully');
      resolve();
    }, 3000);
  });
}

// Proxy to gateway when setup is complete
app.use('/', (req, res, next) => {
  // Allow setup routes
  if (req.path.startsWith('/setup') || req.path.startsWith('/api/')) {
    return next();
  }

  // If setup not complete, redirect to setup
  if (!isSetupComplete) {
    return res.redirect('/setup');
  }

  // Proxy to gateway
  createProxyMiddleware({
    target: `http://127.0.0.1:${GATEWAY_PORT}`,
    changeOrigin: true,
    ws: true,
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      if (res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Gateway unavailable');
      }
    }
  })(req, res, next);
});

// Startup
async function startup() {
  isSetupComplete = checkSetupComplete();
  
  if (isSetupComplete) {
    console.log('Setup already complete, starting gateway...');
    try {
      await startGateway();
    } catch (error) {
      console.error('Failed to start gateway on startup:', error);
    }
  } else {
    console.log('Setup not complete. Visit /setup to configure.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🦞 OpenClaw Railway Template running on port ${PORT}`);
    console.log(`   Setup complete: ${isSetupComplete}`);
    console.log(`   State dir: ${STATE_DIR}`);
    console.log(`   Workspace dir: ${WORKSPACE_DIR}`);
  });
}

startup();
