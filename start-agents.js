// 多项目监听（单进程）：同时监视 projects.json 里所有项目的目录活动
// 文件一改 → 该项目标为 writing；停顿 25 秒 → 回到 idle
// 用法：node start-agents.js
const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, 'projects.json');
const CFG_EXAMPLE = path.join(__dirname, 'projects.example.json');
const OUT = path.join(__dirname, 'agents.json');
const IDLE_MS = 25000;
const IGNORE = /(^|[\\/])(node_modules|\.git|dist|build|\.next|__pycache__|vendor|\.trae|\.idea)([\\/]|$)/i;

let cfgPath = CFG;
if (!fs.existsSync(cfgPath)) {
  cfgPath = CFG_EXAMPLE;
  console.warn('[提示] 没找到 projects.json，先用示例 projects.example.json 跑。');
  console.warn('       复制一份改成自己的项目路径：copy projects.example.json projects.json');
}

let list;
try {
  list = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  console.error(cfgPath + ' 读取失败：', e.message);
  process.exit(1);
}

/* ---------- 原子写 agents.json（读-改-写，保留手动打点的人的字段） ---------- */
function upsert(p, state, task) {
  let raw = { agents: [] };
  try { raw = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 首次运行 */ }
  const agents = (raw.agents || []).filter(a => a.id !== p.id);
  agents.push({
    id: p.id,
    name: p.name,
    state,
    task: (task || '').slice(0, 24),
    seat: p.seat
  });
  const tmp = OUT + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ updated: Date.now(), agents }, null, 2), 'utf8');
  fs.renameSync(tmp, OUT);
}

/* ---------- 启动 ---------- */
let watching = 0;
list.forEach(p => {
  if (!p.watch || !fs.existsSync(p.watch)) {
    console.warn(`[跳过] ${p.name}：目录不存在 ${p.watch}`);
    return;
  }

  let timer = null;
  const lastSeen = new Map();

  try {
    fs.watch(p.watch, { recursive: true }, (event, file) => {
      if (!file || IGNORE.test(file)) return;

      const now = Date.now();
      const prev = lastSeen.get(file) || 0;
      if (now - prev < 250) return;      // 去抖
      lastSeen.set(file, now);
      if (lastSeen.size > 400) lastSeen.clear();

      upsert(p, 'writing', '改 ' + (file.length > 18 ? '…' + file.slice(-17) : file));

      clearTimeout(timer);
      timer = setTimeout(() => upsert(p, 'idle', '待命'), IDLE_MS);
    });
    watching++;
    console.log(`[监听] ${p.name}  ←  ${p.watch}`);
  } catch (e) {
    console.warn(`[失败] ${p.name}：${e.message}`);
  }
});

if (!watching) {
  console.error('没有可监听的目录，请检查 projects.json 里的 watch 路径。');
  process.exit(1);
}

// 启动时把所有项目刷成 idle（这样页面一开始就能看到全部小人）
list.forEach(p => {
  if (p.watch && fs.existsSync(p.watch)) upsert(p, 'idle', '待命');
});
console.log(`\n共监听 ${watching} 个项目，状态写入 ${OUT}\n`);

function shutdown() {
  console.log('\n退出中…');
  list.forEach(p => {
    if (p.watch && fs.existsSync(p.watch)) upsert(p, 'idle', '已退出');
  });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
