// Trae 办公室 · 服务端（零依赖，Node 18+）
// 职责：① 静态托管 public/ ② 把 agents.json 暴露为 /api/agents ③ SSE 推送
//      ④ 托管「多项目监听」子进程，页面上的停止/继续即控制它
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8899;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const AGENTS = path.join(ROOT, 'agents.json');
const SEED = path.join(ROOT, 'agents.example.json');
const AGENT_SCRIPT = path.join(ROOT, 'start-agents.js');

// agents.json 是运行态文件（监听器会不停改写），不进 git；
// 首次运行时用示例文件初始化一份，保证页面一打开就有内容。
if (!fs.existsSync(AGENTS) && fs.existsSync(SEED)) {
  try { fs.copyFileSync(SEED, AGENTS); } catch (e) { /* 忽略只读目录 */ }
}

/* ---------------- 监听子进程的启停 ---------------- */
let watcher = null;
let startedAt = 0;

function startWatcher() {
  if (watcher) return true;
  try {
    watcher = spawn(process.execPath, [AGENT_SCRIPT], {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true
    });
    startedAt = Date.now();
    watcher.on('exit', () => { watcher = null; });
    watcher.on('error', () => { watcher = null; });
    console.log(`[控制] 后台监听已启动 pid=${watcher.pid}`);
    return true;
  } catch (e) {
    watcher = null;
    console.log('[控制] 后台监听启动失败：' + e.message);
    return false;
  }
}

function stopWatcher() {
  if (!watcher) return false;
  const child = watcher;
  watcher = null;                       // 先摘掉引用，避免 exit 回调再置空
  try { child.kill(); } catch (e) { /* 已退出 */ }
  console.log('[控制] 后台监听已停止，目录监听已释放');
  return true;
}

function runtime() {
  return { running: !!watcher, pid: watcher ? watcher.pid : 0, since: startedAt };
}

/* ---------------- HTTP ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, cb) {
  let buf = '';
  req.on('data', (c) => {
    buf += c;
    if (buf.length > 4096) { req.destroy(); }
  });
  req.on('end', () => {
    try { cb(JSON.parse(buf || '{}')); } catch (e) { cb({}); }
  });
}

// ---- SSE：agents.json 一变就推给所有打开的页面 ----
const clients = new Set();

function sseSend(res, raw) {
  try {
    const obj = JSON.parse(raw);                       // 压缩成一行，避免 SSE 多行 data
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  } catch (e) { /* 忽略半截 JSON */ }
}

function broadcast() {
  if (!clients.size) return;
  fs.readFile(AGENTS, 'utf8', (err, data) => {
    if (err) return;
    for (const res of clients) sseSend(res, data);
  });
}

// watchFile 能扛住 rename 原子替换，比 fs.watch 稳
fs.watchFile(AGENTS, { interval: 200 }, (cur, prev) => {
  if (cur.mtimeMs !== prev.mtimeMs) broadcast();
});

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  // 运行状态
  if (url === '/api/status') return json(res, 200, runtime());

  // 开始 / 停止后台监听
  if (url === '/api/control' && req.method === 'POST') {
    return readBody(req, (body) => {
      let ok = false;
      if (body.action === 'stop') ok = stopWatcher();
      else if (body.action === 'start') ok = startWatcher();
      json(res, 200, { ok, ...runtime() });
    });
  }

  // 实时推送
  if (url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1500\n\n');
    clients.add(res);

    fs.readFile(AGENTS, 'utf8', (err, data) => { if (!err) sseSend(res, data); });

    const hb = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
    return;
  }

  // 状态接口：不做缓存，保证画面 1 秒内跟上
  if (url === '/api/agents') {
    fs.readFile(AGENTS, 'utf8', (err, data) => {
      if (err) return json(res, 500, { agents: [], error: 'agents.json 读取失败' });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
    return;
  }

  // 静态文件（只允许 public 目录，防目录穿越）
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(PUB, rel);
  if (!file.startsWith(PUB)) {
    res.writeHead(403);
    return res.end('forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Trae 办公室已启动：http://127.0.0.1:${PORT}`);
  console.log(`状态文件：${AGENTS}`);
  if (process.env.OFFICE_AUTOSTART !== '0') startWatcher();
});

/* 退出时把子进程一起带走，避免留下孤儿监听 */
function shutdown() {
  stopWatcher();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { if (watcher) { try { watcher.kill(); } catch (e) { /* ignore */ } } });
