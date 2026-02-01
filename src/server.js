// ============================================================================
// OpenClaw Railway Template - Server
// Combines best features from multiple templates:
// - Source build (codetitlan/vignesh07)
// - Web TUI (arjunkomath)
// - Export/Import backup (vignesh07)
// - Express routing (all templates)
// ============================================================================

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";
import pty from "node-pty";
import * as tar from "tar";
import { WebSocketServer } from "ws";

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const STATE_DIR = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR?.trim() || path.join(STATE_DIR, "workspace");
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

const INTERNAL_GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY?.trim() || "/openclaw/dist/entry.js";
const OPENCLAW_NODE = process.env.OPENCLAW_NODE?.trim() || "node";

const ENABLE_WEB_TUI = process.env.ENABLE_WEB_TUI?.toLowerCase() !== "false"; // Enabled by default
const TUI_IDLE_TIMEOUT_MS = Number.parseInt(process.env.TUI_IDLE_TIMEOUT_MS ?? "300000", 10);
const TUI_MAX_SESSION_MS = Number.parseInt(process.env.TUI_MAX_SESSION_MS ?? "1800000", 10);

const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 50;
const GATEWAY_READY_TIMEOUT = 60000;
const GATEWAY_POLL_INTERVAL = 500;

// Debug logging
const DEBUG = process.env.OPENCLAW_TEMPLATE_DEBUG?.toLowerCase() === "true";
function debug(...args) {
  if (DEBUG) console.log("[debug]", ...args);
}

// ============================================================================
// Gateway Token Management
// ============================================================================

function resolveGatewayToken() {
  const envTok = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envTok) {
    debug("Using token from OPENCLAW_GATEWAY_TOKEN env variable");
    return envTok;
  }

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) {
      debug("Using token from persisted file");
      return existing;
    }
  } catch (err) {
    debug(`Could not read persisted file: ${err.message}`);
  }

  const generated = crypto.randomBytes(32).toString("hex");
  debug("Generating new random token");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
    debug(`Persisted new token to ${tokenPath}`);
  } catch (err) {
    console.warn(`[token] Could not persist token: ${err}`);
  }
  return generated;
}

const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;

// ============================================================================
// State
// ============================================================================

let gatewayProc = null;
let gatewayStarting = null;
let cachedOpenclawVersion = null;
let cachedChannelsHelp = null;
const rateLimitMap = new Map();
let tuiSession = null;

// ============================================================================
// Auth Providers Configuration
// ============================================================================

const AUTH_GROUPS = {
  anthropic: {
    name: "Anthropic",
    providers: [
      { id: "claude-cli", name: "Claude Code CLI (OAuth)", type: "oauth", description: "Login via Claude Code CLI" },
      { id: "anthropic-token", name: "Console Token", type: "token", envKey: "ANTHROPIC_AUTH_TOKEN", placeholder: "Paste token from console.anthropic.com" },
      { id: "anthropic-api", name: "API Key", type: "api-key", envKey: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." }
    ]
  },
  openai: {
    name: "OpenAI",
    providers: [
      { id: "openai-codex", name: "Codex CLI (OAuth)", type: "oauth", description: "Login via OpenAI Codex CLI" },
      { id: "chatgpt-oauth", name: "ChatGPT (OAuth)", type: "oauth", description: "Login via ChatGPT" },
      { id: "openai-api", name: "API Key", type: "api-key", envKey: "OPENAI_API_KEY", placeholder: "sk-..." }
    ]
  },
  google: {
    name: "Google",
    providers: [
      { id: "gemini-cli", name: "Gemini CLI (OAuth)", type: "oauth", description: "Login via Gemini CLI" },
      { id: "antigravity-oauth", name: "Antigravity (OAuth)", type: "oauth", description: "Login via Antigravity" },
      { id: "gemini-api", name: "Gemini API Key", type: "api-key", envKey: "GOOGLE_API_KEY", placeholder: "AI..." }
    ]
  },
  openrouter: {
    name: "OpenRouter",
    providers: [
      { id: "openrouter-api", name: "API Key", type: "api-key", envKey: "OPENROUTER_API_KEY", placeholder: "sk-or-..." }
    ]
  },
  vercel: {
    name: "Vercel AI Gateway",
    providers: [
      { id: "vercel-api", name: "API Key", type: "api-key", envKey: "VERCEL_AI_API_KEY", placeholder: "vai_..." }
    ]
  },
  moonshot: {
    name: "Moonshot",
    providers: [
      { id: "moonshot-api", name: "API Key", type: "api-key", envKey: "MOONSHOT_API_KEY", placeholder: "sk-..." }
    ]
  },
  zai: {
    name: "Z.AI",
    providers: [
      { id: "zai-api", name: "API Key", type: "api-key", envKey: "ZAI_API_KEY", placeholder: "..." }
    ]
  },
  minimax: {
    name: "MiniMax",
    providers: [
      { id: "minimax-api", name: "API Key", type: "api-key", envKey: "MINIMAX_API_KEY", placeholder: "..." }
    ]
  },
  qwen: {
    name: "Qwen",
    providers: [
      { id: "qwen-oauth", name: "Qwen (OAuth)", type: "oauth", description: "Login via Qwen" },
      { id: "qwen-api", name: "API Key", type: "api-key", envKey: "QWEN_API_KEY", placeholder: "sk-..." }
    ]
  },
  copilot: {
    name: "GitHub Copilot",
    providers: [
      { id: "copilot-oauth", name: "Copilot (OAuth)", type: "oauth", description: "Login via GitHub Copilot" }
    ]
  },
  synthetic: {
    name: "Synthetic",
    providers: [
      { id: "synthetic-api", name: "API Key", type: "api-key", envKey: "SYNTHETIC_API_KEY", placeholder: "..." }
    ]
  },
  opencodezen: {
    name: "OpenCode Zen",
    providers: [
      { id: "opencodezen-api", name: "API Key", type: "api-key", envKey: "OPENCODEZEN_API_KEY", placeholder: "..." }
    ]
  }
};

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Recommended)", provider: "anthropic" },
  { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", provider: "anthropic" },
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { value: "openai/gpt-4o", label: "GPT-4o", provider: "openai" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
  { value: "openai/o1", label: "o1", provider: "openai" },
  { value: "openai/o1-mini", label: "o1 Mini", provider: "openai" },
  { value: "google/gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google" },
  { value: "google/gemini-1.5-pro", label: "Gemini 1.5 Pro", provider: "google" },
  { value: "openrouter/auto", label: "OpenRouter Auto", provider: "openrouter" }
];

// ============================================================================
// Utility Functions
// ============================================================================

function clawArgs(args) {
  return [OPENCLAW_ENTRY, ...args];
}

function configPath() {
  return process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(STATE_DIR, "openclaw.json");
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCmd(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      timeout,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d.toString()));
    proc.stderr?.on("data", (d) => (output += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? 1, output }));
    proc.on("error", (err) => resolve({ code: 1, output: err.message }));
  });
}

async function getOpenclawInfo() {
  if (!cachedOpenclawVersion) {
    const [version, channelsHelp] = await Promise.all([
      runCmd(OPENCLAW_NODE, clawArgs(["--version"])),
      runCmd(OPENCLAW_NODE, clawArgs(["channels", "add", "--help"])),
    ]);
    cachedOpenclawVersion = version.output.trim();
    cachedChannelsHelp = channelsHelp.output;
  }
  return { version: cachedOpenclawVersion, channelsHelp: cachedChannelsHelp };
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
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
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

// ============================================================================
// Gateway Management
// ============================================================================

async function checkGatewayHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${GATEWAY_TARGET}/health`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
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
    await sleep(GATEWAY_POLL_INTERVAL);
  }

  return false;
}

async function startGateway() {
  if (gatewayProc) {
    console.log("[gateway] Already running");
    return;
  }

  if (gatewayStarting) {
    console.log("[gateway] Already starting, waiting...");
    await gatewayStarting;
    return;
  }

  console.log("[gateway] Starting OpenClaw gateway...");

  gatewayStarting = (async () => {
    const args = clawArgs([
      "gateway",
      "--port", INTERNAL_GATEWAY_PORT.toString(),
      "--verbose",
      "--token", OPENCLAW_GATEWAY_TOKEN,
    ]);

    gatewayProc = childProcess.spawn(OPENCLAW_NODE, args, {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
        OPENCLAW_GATEWAY_TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    gatewayProc.stdout.on("data", (data) => {
      console.log(`[gateway] ${data.toString().trim()}`);
    });

    gatewayProc.stderr.on("data", (data) => {
      console.error(`[gateway] ${data.toString().trim()}`);
    });

    gatewayProc.on("error", (error) => {
      console.error("[gateway] Failed to start:", error);
      gatewayProc = null;
    });

    gatewayProc.on("exit", (code, signal) => {
      console.log(`[gateway] Exited with code ${code}, signal ${signal}`);
      gatewayProc = null;
    });

    const ready = await waitForGatewayReady();
    if (ready) {
      console.log("[gateway] Ready");
    } else {
      console.error("[gateway] Failed to become ready within timeout");
      if (gatewayProc) {
        gatewayProc.kill("SIGTERM");
        gatewayProc = null;
      }
      throw new Error("Gateway startup timeout");
    }
  })();

  try {
    await gatewayStarting;
  } finally {
    gatewayStarting = null;
  }
}

async function stopGateway() {
  if (gatewayProc) {
    console.log("[gateway] Stopping...");
    gatewayProc.kill("SIGTERM");
    await sleep(750);
    gatewayProc = null;
  }
}

async function restartGateway() {
  await stopGateway();
  await startGateway();
}

async function ensureGatewayRunning() {
  if (isConfigured() && !gatewayProc) {
    await startGateway();
  }
}

// ============================================================================
// Authentication Middleware
// ============================================================================

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res.status(500).json({ error: "SETUP_PASSWORD environment variable not set" });
  }

  const ip = getClientIP(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="OpenClaw Setup"');
    return res.status(401).send("Authentication required");
  }

  const credentials = Buffer.from(auth.split(" ")[1], "base64").toString();
  const colonIndex = credentials.indexOf(":");
  const pass = colonIndex > -1 ? credentials.slice(colonIndex + 1) : "";

  if (!timingSafeEqual(pass, SETUP_PASSWORD)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="OpenClaw Setup"');
    return res.status(401).send("Invalid password");
  }

  next();
}

// ============================================================================
// Proxy Setup
// ============================================================================

const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, req, res) => {
  console.error("[proxy] Error:", err.message);
  if (res.writeHead) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Gateway unavailable");
  }
});

proxy.on("proxyReq", (proxyReq) => {
  proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
});

// ============================================================================
// Express App
// ============================================================================

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Static files
app.use("/styles.css", express.static(path.join(import.meta.dirname, "public", "styles.css")));

// ============================================================================
// Health Check Routes
// ============================================================================

app.get(["/setup/healthz", "/health"], async (req, res) => {
  const gatewayHealthy = await checkGatewayHealth();
  const info = await getOpenclawInfo().catch(() => ({ version: "unknown", channelsHelp: "" }));

  res.json({
    status: "ok",
    setupComplete: isConfigured(),
    gatewayRunning: gatewayProc !== null,
    gatewayHealthy,
    openclawVersion: info.version,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// Setup Routes
// ============================================================================

app.get("/setup", requireSetupAuth, (req, res) => {
  const filePath = path.join(import.meta.dirname, "public", "setup.html");
  res.sendFile(filePath);
});

app.get("/setup/api/status", requireSetupAuth, async (req, res) => {
  const info = await getOpenclawInfo().catch(() => ({ version: "unknown", channelsHelp: "" }));

  res.json({
    setupComplete: isConfigured(),
    gatewayRunning: gatewayProc !== null,
    stateDir: STATE_DIR,
    workspaceDir: WORKSPACE_DIR,
    authGroups: AUTH_GROUPS,
    models: MODEL_OPTIONS,
    openclawVersion: info.version,
    channelsHelp: info.channelsHelp,
    enableWebTui: ENABLE_WEB_TUI,
  });
});

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {
  try {
    const { authProvider, authValue, model, telegramToken, discordToken, slackToken } = req.body;

    if (!authProvider || !authValue) {
      return res.status(400).json({ error: "Auth provider and value are required" });
    }

    // Find auth provider config
    let providerConfig = null;
    for (const group of Object.values(AUTH_GROUPS)) {
      const found = group.providers.find((p) => p.id === authProvider);
      if (found) {
        providerConfig = found;
        break;
      }
    }

    if (!providerConfig) {
      return res.status(400).json({ error: "Invalid auth provider" });
    }

    // Create config
    const config = {
      agent: {
        model: model || "anthropic/claude-sonnet-4-5",
      },
      channels: {},
    };

    if (telegramToken) config.channels.telegram = { botToken: telegramToken };
    if (discordToken) config.channels.discord = { token: discordToken };
    if (slackToken) config.channels.slack = { token: slackToken };

    // Ensure directories exist
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    // Write config
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));

    // Set environment variable based on provider type
    if (providerConfig.envKey) {
      process.env[providerConfig.envKey] = authValue;
    }

    // Start gateway
    await startGateway();

    res.json({ success: true, message: "Setup complete! Gateway started." });
  } catch (error) {
    console.error("[setup] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/setup/api/reset", requireSetupAuth, async (req, res) => {
  try {
    await stopGateway();
    fs.rmSync(configPath(), { force: true });
    res.json({ success: true, message: "Configuration reset. Please set up again." });
  } catch (error) {
    console.error("[reset] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/setup/api/doctor", requireSetupAuth, async (req, res) => {
  const result = await runCmd(OPENCLAW_NODE, clawArgs(["doctor", "--repair"]));
  res.json({ success: result.code === 0, output: result.output });
});

app.post("/setup/api/restart", requireSetupAuth, async (req, res) => {
  try {
    await restartGateway();
    res.json({ success: true, message: "Gateway restarted." });
  } catch (error) {
    console.error("[restart] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  const { channel, code } = req.body;
  if (!channel || !code) {
    return res.status(400).json({ ok: false, error: "Missing channel or code" });
  }
  const result = await runCmd(OPENCLAW_NODE, clawArgs(["pairing", "approve", String(channel), String(code)]));
  res.status(result.code === 0 ? 200 : 500).json({ ok: result.code === 0, output: result.output });
});

app.get("/setup/api/debug", requireSetupAuth, async (req, res) => {
  let config = null;
  try {
    if (fs.existsSync(configPath())) {
      config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
      // Mask sensitive values
      if (config.channels?.telegram?.botToken) config.channels.telegram.botToken = "***masked***";
      if (config.channels?.discord?.token) config.channels.discord.token = "***masked***";
      if (config.channels?.slack?.token) config.channels.slack.token = "***masked***";
    }
  } catch (e) {
    config = { error: e.message };
  }

  res.json({
    setupComplete: isConfigured(),
    gatewayRunning: gatewayProc !== null,
    gatewayPid: gatewayProc?.pid,
    stateDir: STATE_DIR,
    workspaceDir: WORKSPACE_DIR,
    config,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "***set***" : null,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "***set***" : null,
    },
  });
});

// ============================================================================
// Config Editor Routes
// ============================================================================

app.get("/setup/api/config", requireSetupAuth, async (req, res) => {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) {
      return res.json({ ok: true, path: p, content: "" });
    }
    const content = fs.readFileSync(p, "utf8");
    res.json({ ok: true, path: p, content });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/setup/api/config", requireSetupAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ ok: false, error: "Missing content" });
    }

    // Validate JSON
    try {
      JSON.parse(content);
    } catch (e) {
      return res.status(400).json({ ok: false, error: `Invalid JSON: ${e.message}` });
    }

    const p = configPath();

    // Create backup
    if (fs.existsSync(p)) {
      const backupPath = `${p}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(p, backupPath);
    }

    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, { encoding: "utf8", mode: 0o600 });

    // Restart gateway if configured
    if (isConfigured()) {
      await restartGateway();
    }

    res.json({ ok: true, path: p });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================================
// Debug Console Routes
// ============================================================================

const ALLOWED_CONSOLE_COMMANDS = {
  "gateway.restart": async () => {
    await restartGateway();
    return "Gateway restarted";
  },
  "gateway.stop": async () => {
    await stopGateway();
    return "Gateway stopped";
  },
  "gateway.start": async () => {
    await startGateway();
    return "Gateway started";
  },
  "openclaw.status": async () => {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["status"]));
    return r.output;
  },
  "openclaw.health": async () => {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["health"]));
    return r.output;
  },
  "openclaw.doctor": async () => {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["doctor"]));
    return r.output;
  },
  "openclaw.logs.tail": async (arg) => {
    const n = Number.parseInt(arg || "50", 10);
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["logs", "--tail", String(n)]));
    return r.output;
  },
  "openclaw.config.get": async (arg) => {
    if (!arg) return "Missing config path argument";
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["config", "get", arg]));
    return r.output;
  },
  "openclaw.version": async () => {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
    return r.output;
  },
};

app.post("/setup/api/console", requireSetupAuth, async (req, res) => {
  const { cmd, arg } = req.body;

  if (!cmd || !ALLOWED_CONSOLE_COMMANDS[cmd]) {
    return res.status(400).json({ ok: false, error: `Unknown command: ${cmd}` });
  }

  try {
    const output = await ALLOWED_CONSOLE_COMMANDS[cmd](arg);
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============================================================================
// Export/Import Routes
// ============================================================================

app.get("/setup/export", requireSetupAuth, async (req, res) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  res.setHeader("content-type", "application/gzip");
  res.setHeader(
    "content-disposition",
    `attachment; filename="openclaw-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz"`
  );

  const stateAbs = path.resolve(STATE_DIR);
  const workspaceAbs = path.resolve(WORKSPACE_DIR);
  const dataRoot = "/data";

  const underData = (p) => p === dataRoot || p.startsWith(dataRoot + path.sep);

  let cwd = "/";
  let paths = [stateAbs, workspaceAbs].map((p) => p.replace(/^\//, ""));

  if (underData(stateAbs) && underData(workspaceAbs)) {
    cwd = dataRoot;
    paths = [
      path.relative(dataRoot, stateAbs) || ".",
      path.relative(dataRoot, workspaceAbs) || ".",
    ];
  }

  const stream = tar.c(
    {
      gzip: true,
      portable: true,
      noMtime: true,
      cwd,
      onwarn: () => {},
    },
    paths
  );

  stream.on("error", (err) => {
    console.error("[export]", err);
    if (!res.headersSent) res.status(500);
    res.end(String(err));
  });

  stream.pipe(res);
});

function isUnderDir(p, root) {
  const abs = path.resolve(p);
  const r = path.resolve(root);
  return abs === r || abs.startsWith(r + path.sep);
}

function looksSafeTarPath(p) {
  if (!p) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  if (p.split("/").includes("..")) return false;
  return true;
}

async function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body too large (max ${maxBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

app.post("/setup/import", requireSetupAuth, async (req, res) => {
  try {
    const dataRoot = "/data";
    if (!isUnderDir(STATE_DIR, dataRoot) || !isUnderDir(WORKSPACE_DIR, dataRoot)) {
      return res
        .status(400)
        .type("text/plain")
        .send("Import is only supported when STATE_DIR and WORKSPACE_DIR are under /data");
    }

    // Stop gateway before restore
    await stopGateway();

    const buf = await readBodyBuffer(req, 250 * 1024 * 1024); // 250MB max
    if (!buf.length) {
      return res.status(400).type("text/plain").send("Empty body");
    }

    const tmpPath = path.join(os.tmpdir(), `openclaw-import-${Date.now()}.tar.gz`);
    fs.writeFileSync(tmpPath, buf);

    await tar.x({
      file: tmpPath,
      cwd: dataRoot,
      gzip: true,
      strict: true,
      onwarn: () => {},
      filter: (p) => looksSafeTarPath(p),
    });

    fs.rmSync(tmpPath, { force: true });

    // Restart gateway after restore
    if (isConfigured()) {
      await restartGateway();
    }

    res.type("text/plain").send("OK - imported backup into /data and restarted gateway.");
  } catch (err) {
    console.error("[import]", err);
    res.status(500).type("text/plain").send(String(err));
  }
});

// ============================================================================
// Web TUI Routes
// ============================================================================

app.get("/tui", requireSetupAuth, (req, res) => {
  if (!ENABLE_WEB_TUI) {
    return res.status(403).send("Web TUI is disabled. Set ENABLE_WEB_TUI=true to enable.");
  }
  const filePath = path.join(import.meta.dirname, "public", "tui.html");
  res.sendFile(filePath);
});

// ============================================================================
// Loading Page
// ============================================================================

app.get("/loading", (req, res) => {
  const filePath = path.join(import.meta.dirname, "public", "loading.html");
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  res.send(`
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
});

// ============================================================================
// Proxy to Gateway (catch-all)
// ============================================================================

app.use(async (req, res) => {
  // If not configured, redirect to setup
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  // Ensure gateway is running
  if (isConfigured()) {
    try {
      await ensureGatewayRunning();
    } catch (err) {
      return res.status(503).type("text/plain").send(`Gateway not ready: ${err}`);
    }

    if (!gatewayProc) {
      return res.redirect("/loading");
    }
  }

  proxy.web(req, res, { target: GATEWAY_TARGET });
});

// ============================================================================
// HTTP Server with WebSocket Support
// ============================================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  // TUI WebSocket
  if (pathname === "/tui/ws") {
    if (!ENABLE_WEB_TUI) {
      socket.destroy();
      return;
    }

    // Check auth for WebSocket
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Basic ")) {
      socket.destroy();
      return;
    }

    const credentials = Buffer.from(auth.split(" ")[1], "base64").toString();
    const colonIndex = credentials.indexOf(":");
    const pass = colonIndex > -1 ? credentials.slice(colonIndex + 1) : "";

    if (!SETUP_PASSWORD || !timingSafeEqual(pass, SETUP_PASSWORD)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTuiConnection(ws, req);
    });
    return;
  }

  // Proxy other WebSocket connections to gateway
  if (isConfigured() && gatewayProc) {
    proxy.ws(req, socket, head, {
      target: GATEWAY_TARGET,
      headers: {
        Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
      },
    });
  } else {
    socket.destroy();
  }
});

// ============================================================================
// Web TUI Implementation
// ============================================================================

function handleTuiConnection(ws, req) {
  // Check if there's already an active session
  if (tuiSession && tuiSession.ws.readyState === 1) {
    ws.close(1000, "Another session is already active");
    return;
  }

  let ptyProcess;
  try {
    ptyProcess = pty.spawn("openclaw", ["chat"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: WORKSPACE_DIR,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
        TERM: "xterm-256color",
      },
    });
  } catch (e) {
    console.error("[tui] Failed to spawn PTY:", e.message);
    ws.close(1011, "Failed to create terminal session");
    return;
  }

  const sessionStart = Date.now();
  let lastActivity = Date.now();

  tuiSession = { ws, pty: ptyProcess, sessionStart, lastActivity };

  // Idle timeout check
  const idleChecker = setInterval(() => {
    const now = Date.now();

    if (now - sessionStart > TUI_MAX_SESSION_MS) {
      ws.close(1000, "Maximum session duration reached");
      return;
    }

    if (now - lastActivity > TUI_IDLE_TIMEOUT_MS) {
      ws.close(1000, "Session timed out due to inactivity");
      return;
    }
  }, 10000);

  ptyProcess.onData((data) => {
    lastActivity = Date.now();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    clearInterval(idleChecker);
    tuiSession = null;
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "exit", code: exitCode }));
      ws.close();
    }
  });

  ws.on("message", (msg) => {
    lastActivity = Date.now();
    try {
      const message = JSON.parse(msg.toString());

      if (message.type === "input") {
        ptyProcess.write(message.data);
      } else if (message.type === "resize") {
        ptyProcess.resize(message.cols || 80, message.rows || 24);
      }
    } catch {
      ptyProcess.write(msg.toString());
    }
  });

  ws.on("close", () => {
    clearInterval(idleChecker);
    ptyProcess.kill();
    tuiSession = null;
  });

  ws.on("error", (err) => {
    console.error("[tui] WebSocket error:", err.message);
    clearInterval(idleChecker);
    ptyProcess.kill();
    tuiSession = null;
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log("HTTP server closed");
  });

  wss.clients.forEach((client) => {
    client.close(1001, "Server shutting down");
  });

  if (tuiSession) {
    tuiSession.pty.kill();
    tuiSession.ws.close(1001, "Server shutting down");
    tuiSession = null;
  }

  stopGateway();

  setTimeout(() => {
    console.log("Forcing exit...");
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ============================================================================
// Startup
// ============================================================================

async function startup() {
  if (isConfigured()) {
    console.log("[startup] Setup already complete, starting gateway...");
    try {
      await startGateway();
    } catch (error) {
      console.error("[startup] Failed to start gateway:", error.message);
    }
  } else {
    console.log("[startup] Setup not complete. Visit /setup to configure.");
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[startup] OpenClaw Railway Template v3.0.0`);
    console.log(`[startup] Running on port ${PORT}`);
    console.log(`[startup] Setup complete: ${isConfigured()}`);
    console.log(`[startup] State dir: ${STATE_DIR}`);
    console.log(`[startup] Workspace dir: ${WORKSPACE_DIR}`);
    console.log(`[startup] Web TUI enabled: ${ENABLE_WEB_TUI}`);
    console.log(`[startup] Endpoints:`);
    console.log(`  - Setup:  http://localhost:${PORT}/setup`);
    console.log(`  - Health: http://localhost:${PORT}/setup/healthz`);
    console.log(`  - Export: http://localhost:${PORT}/setup/export`);
    if (ENABLE_WEB_TUI) {
      console.log(`  - TUI:    http://localhost:${PORT}/tui`);
    }
  });
}

startup();
