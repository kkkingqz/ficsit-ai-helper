export function getLauncherJsCode(): string {
  return getLauncherCjsCode();
}

export function getLauncherCjsCode(): string {
  return `#!/usr/bin/env node
/**
 * FICSIT AI Sidecar Launcher (S5-lite)
 * Manages the 3 sidecar processes strictly on loopback (127.0.0.1).
 * CommonJS format (.cjs) guarantees compatibility across ES module and CommonJS parent packages.
 * Cross-platform: runs on Linux and Windows (and Wine) via bundled portable Node 22.
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname);
const RUN_DIR = path.join(ROOT_DIR, 'run');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const TOKEN_FILE = path.join(DATA_DIR, 'adapter.token');
const KEY_FILE = path.join(DATA_DIR, 'llm.key');
const DB_FILE = path.join(DATA_DIR, 'foreman.db');

const HOST = '127.0.0.1';
const SF_MCP_PORT = 8723;
const FF_SERVER_PORT = 8724;
const ADAPTER_PORT = 8730;
const NORMALIZER_PORT = 8731;

function ensureDirs() {
  for (const dir of [RUN_DIR, LOG_DIR, DATA_DIR, SAVES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureToken() {
  ensureDirs();
  if (!fs.existsSync(TOKEN_FILE) || fs.statSync(TOKEN_FILE).size === 0) {
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  }
  return fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
}

function checkPort(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isListening = false;
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      isListening = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, HOST);
  });
}

async function waitForPort(port, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkPort(port, 300)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function getPid(name) {
  const pidFile = path.join(RUN_DIR, \`\${name}.pid\`);
  if (!fs.existsSync(pidFile)) return null;
  const content = fs.readFileSync(pidFile, 'utf-8').trim();
  const pid = parseInt(content, 10);
  return isNaN(pid) ? null : pid;
}

function savePid(name, pid) {
  fs.writeFileSync(path.join(RUN_DIR, \`\${name}.pid\`), String(pid));
}

function clearPid(name) {
  const pidFile = path.join(RUN_DIR, \`\${name}.pid\`);
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cmdStatus() {
  ensureDirs();
  const sfListening = await checkPort(SF_MCP_PORT);
  const ffListening = await checkPort(FF_SERVER_PORT);
  const adListening = await checkPort(ADAPTER_PORT);
  const normListening = await checkPort(NORMALIZER_PORT);

  console.log('=== FICSIT AI Sidecar Status ===');
  console.log(\`  sf-mcp      (port \${SF_MCP_PORT}): \${sfListening ? 'ONLINE' : 'STOPPED'} (pid: \${getPid('sf-mcp') || '-'})\`);
  console.log(\`  ff-server   (port \${FF_SERVER_PORT}): \${ffListening ? 'ONLINE' : 'STOPPED'} (pid: \${getPid('ff-server') || '-'})\`);
  console.log(\`  adapter     (port \${ADAPTER_PORT}): \${adListening ? 'ONLINE' : 'STOPPED'} (pid: \${getPid('adapter') || '-'})\`);
  console.log(\`  normalizer  (port \${NORMALIZER_PORT}): \${normListening ? 'ONLINE' : 'STOPPED'}\`);

  const allRunning = sfListening && ffListening && adListening && normListening;
  console.log(\`Overall: \${allRunning ? 'RUNNING' : 'INCOMPLETE/STOPPED'}\`);
  process.exit(allRunning ? 0 : 1);
}

async function cmdStop() {
  ensureDirs();
  console.log('Stopping FICSIT AI Sidecar processes...');
  for (const name of ['adapter', 'ff-server', 'sf-mcp']) {
    const pid = getPid(name);
    if (pid && isPidAlive(pid)) {
      try {
        if (process.platform === 'win32') {
          execSync(\`taskkill /pid \${pid} /t /f\`, { stdio: 'ignore' });
        } else {
          process.kill(-pid, 'SIGTERM');
        }
      } catch {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
      console.log(\`  Stopped \${name} (pid \${pid})\`);
    }
    clearPid(name);
  }
  // Short pause to ensure ports are released
  await new Promise((r) => setTimeout(r, 1000));
  console.log('Sidecar stopped.');
}

async function cmdStart() {
  ensureDirs();
  const token = ensureToken();

  // 1. Check if already running
  if (await checkPort(ADAPTER_PORT) || await checkPort(FF_SERVER_PORT) || await checkPort(SF_MCP_PORT)) {
    console.error('Error: Sidecar or another process is already listening on ports 8723/8724/8730. Run "stop" first.');
    process.exit(1);
  }

  // 2. Resolve LLM key
  let apiKey = process.env.LLM_API_KEY || '';
  if (!apiKey && fs.existsSync(KEY_FILE)) {
    apiKey = fs.readFileSync(KEY_FILE, 'utf-8').trim();
  }
  if (!apiKey) {
    console.warn('WARNING: No LLM API key found in data/llm.key or LLM_API_KEY environment variable.');
    console.warn('The sidecar will start and provide game data and saves, but chat with LLM requires a key.');
    console.warn('To set your key, run: start.sh set-key (or write key to data/llm.key)');
  }

  // 3. Resolve Node binary
  const nodeBinary = process.execPath;

  // 4. Common env
  const env = {
    ...process.env,
    HOST: HOST,
    PORT: String(FF_SERVER_PORT),
    MCP_TRANSPORT: 'http',
    MCP_HTTP_HOST: HOST,
    MCP_HTTP_PORT: String(SF_MCP_PORT),
    ADAPTER_HOST: HOST,
    ADAPTER_PORT: String(ADAPTER_PORT),
    ADAPTER_TOKEN: token,
    NORMALIZER_PORT: String(NORMALIZER_PORT),
    FICSITAI_NORMALIZER: 'on',
    LLM_PROVIDER: 'openai',
    LLM_UPSTREAM_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    LLM_BASE_URL: \`http://\${HOST}:\${NORMALIZER_PORT}\`,
    LLM_MODEL: process.env.LLM_MODEL || 'gemini-3.5-flash-lite',
    LLM_SUMMARY_MODEL: process.env.LLM_SUMMARY_MODEL || 'gemini-3.5-flash-lite',
    LLM_API_KEY: apiKey,
    DATABASE_URL: \`file:\${DB_FILE}\`,
    SAVE_DATA_DIR: SAVES_DIR,
    SYSTEM_PROMPT_PATH: path.join(ROOT_DIR, 'app/foreman/SYSTEM_PROMPT.md'),
    FOREMAN_ACCOUNT_PATH: path.join(DATA_DIR, 'adapter-account.json'),
    MCP_URL: \`http://\${HOST}:\${ADAPTER_PORT}/mcp?token=\${token}\`,
    SF_MCP_URL: \`http://\${HOST}:\${SF_MCP_PORT}/mcp\`,
    FOREMAN_BASE_URL: \`http://\${HOST}:\${FF_SERVER_PORT}\`,
  };

  console.log('Starting FICSIT AI Sidecar processes on 127.0.0.1...');

  // 5. Start sf-mcp
  const sfMcpScript = path.join(ROOT_DIR, 'app/node_modules/@foreman/sf-mcp/dist/index.js');
  const sfLogFd = fs.openSync(path.join(LOG_DIR, 'sf-mcp.log'), 'a');
  const sfProc = spawn(nodeBinary, [sfMcpScript], {
    cwd: path.join(ROOT_DIR, 'app'),
    env,
    detached: true,
    stdio: ['ignore', sfLogFd, sfLogFd],
  });
  savePid('sf-mcp', sfProc.pid);
  sfProc.unref();

  // 6. Start ff-server
  const ffServerScript = path.join(ROOT_DIR, 'app/node_modules/@foreman/ff-server/dist/index.js');
  const ffLogFd = fs.openSync(path.join(LOG_DIR, 'ff-server.log'), 'a');
  const ffProc = spawn(nodeBinary, [ffServerScript], {
    cwd: path.join(ROOT_DIR, 'app'),
    env,
    detached: true,
    stdio: ['ignore', ffLogFd, ffLogFd],
  });
  savePid('ff-server', ffProc.pid);
  ffProc.unref();

  // 7. Start adapter
  const adapterScript = path.join(ROOT_DIR, 'app/adapter/dist/index.js');
  const adLogFd = fs.openSync(path.join(LOG_DIR, 'adapter.log'), 'a');
  const adProc = spawn(nodeBinary, [adapterScript], {
    cwd: path.join(ROOT_DIR, 'app/adapter'),
    env,
    detached: true,
    stdio: ['ignore', adLogFd, adLogFd],
  });
  savePid('adapter', adProc.pid);
  adProc.unref();

  // 8. Wait for ports
  console.log('Waiting for sidecar services to be ready...');
  const sfReady = await waitForPort(SF_MCP_PORT);
  const ffReady = await waitForPort(FF_SERVER_PORT);
  const adReady = await waitForPort(ADAPTER_PORT);

  if (sfReady && ffReady && adReady) {
    console.log('All FICSIT AI Sidecar services are UP and listening on 127.0.0.1:');
    console.log(\`  - sf-mcp:     http://\${HOST}:\${SF_MCP_PORT}/mcp\`);
    console.log(\`  - ff-server:  http://\${HOST}:\${FF_SERVER_PORT}\`);
    console.log(\`  - adapter:    http://\${HOST}:\${ADAPTER_PORT}\`);
    console.log(\`  - normalizer: http://\${HOST}:\${NORMALIZER_PORT}\`);
    console.log(\`Logs directory: \${LOG_DIR}\`);
  } else {
    console.error('Error: Some services failed to start within timeout. Check logs:');
    console.error(\`  sf-mcp:    \${sfReady ? 'OK' : 'FAILED (check logs/sf-mcp.log)'}\`);
    console.error(\`  ff-server: \${ffReady ? 'OK' : 'FAILED (check logs/ff-server.log)'}\`);
    console.error(\`  adapter:   \${adReady ? 'OK' : 'FAILED (check logs/adapter.log)'}\`);
    process.exit(1);
  }
}

function cmdSetKey() {
  ensureDirs();
  const readline = require('node:readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  readline.question('Enter your LLM API Key (e.g. Gemini key): ', (key) => {
    readline.close();
    const trimmed = key.trim();
    if (!trimmed) {
      console.log('No key entered. File unchanged.');
      return;
    }
    fs.writeFileSync(KEY_FILE, trimmed, { mode: 0o600 });
    console.log(\`Saved API key to \${KEY_FILE} (permissions 600).\`);
  });
}

const action = process.argv[2] || 'start';

switch (action) {
  case 'start':
    cmdStart().catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'stop':
    cmdStop().catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'status':
    cmdStatus().catch((err) => { console.error(err); process.exit(1); });
    break;
  case 'set-key':
    cmdSetKey();
    break;
  default:
    console.log(\`Usage: \${path.basename(process.argv[1])} {start|stop|status|set-key}\`);
    process.exit(1);
}
`;
}

export function getStartSh(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
if [ $# -eq 0 ]; then
  exec "$DIR/runtime/node" "$DIR/launcher.cjs" start
else
  exec "$DIR/runtime/node" "$DIR/launcher.cjs" "$@"
fi
`;
}

export function getStopSh(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/runtime/node" "$DIR/launcher.cjs" stop "$@"
`;
}

export function getStatusSh(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/runtime/node" "$DIR/launcher.cjs" status "$@"
`;
}

export function getStartBat(): string {
  return `@echo off
setlocal
set "DIR=%~dp0"
if "%~1"=="" (
  "%DIR%runtime\\node.exe" "%DIR%launcher.cjs" start
) else (
  "%DIR%runtime\\node.exe" "%DIR%launcher.cjs" %*
)
`;
}

export function getStopBat(): string {
  return `@echo off
setlocal
set "DIR=%~dp0"
"%DIR%runtime\\node.exe" "%DIR%launcher.cjs" stop %*
`;
}

export function getStatusBat(): string {
  return `@echo off
setlocal
set "DIR=%~dp0"
"%DIR%runtime\\node.exe" "%DIR%launcher.cjs" status %*
`;
}

export function getReadmeTxt(): string {
  return `===========================================================
FICSIT AI Sidecar (Alpha Release, S5-lite)
===========================================================

Self-contained local AI assistant sidecar for Satisfactory.
Includes portable Node.js 22, Foreman (ff-server + sf-mcp), and FICSIT AI adapter.

Quick Start:
1. Windows:
   - Run: start.bat
   - To configure LLM key: run "start.bat set-key"
     (or place your key into data\\llm.key)
   - To stop: run stop.bat
   - To check status: run status.bat

2. Linux:
   - Run: ./start.sh
   - To configure LLM key: run ./start.sh set-key
     (or place your key into data/llm.key)
   - To stop: ./stop.sh
   - To check status: ./status.sh

Network & Security Note:
All services listen strictly on 127.0.0.1 (loopback).
No network ports are exposed to the public internet or local LAN.
Windows Firewall will NOT prompt for network access.
`;
}
