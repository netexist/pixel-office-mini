// Trae 桥接器（半自动）
// 用法一：手动打点（Trae 在关键节点执行）
//   node adapters/trae.js --id trae1 --name "Trae·天矢送" --seat desk-1 --state writing --task "改标题"
// 用法二：监听目录活动，自动近似“在工作”
//   node adapters/trae.js --watch "e:\path\to\project" --id trae1 --name "Trae·天矢送" --seat desk-1
// 说明：Trae 没有公开的 agent 事件接口，这里用「文件活动」做近似，不是逐工具调用的真实埋点。
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const OUT = arg('out', path.join(__dirname, '..', 'agents.json'));
const ID = arg('id', 'trae');
const NAME = arg('name', 'Trae');
const SEAT = arg('seat', 'desk-1');
const WATCH = arg('watch', '');
const STATES = ['writing', 'researching', 'executing', 'waiting', 'idle'];

function upsert(state, task) {
  if (!STATES.includes(state)) state = 'idle';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const raw = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { agents: [] };
      const list = (raw.agents || []).filter(a => a.id !== ID);
      list.push({ id: ID, name: NAME, state, task: (task || '').slice(0, 24), seat: SEAT });
      const tmp = OUT + '.tmp' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ updated: Date.now(), agents: list }, null, 2), 'utf8');
      fs.renameSync(tmp, OUT);
      return;
    } catch (e) {
      if (attempt === 4) console.error('写入失败：', e.message);
    }
  }
}

const onceState = arg('state', '');
if (!WATCH) {
  // 手动模式
  upsert(onceState || 'idle', arg('task', ''));
  console.log(`[${NAME}] ${onceState || 'idle'} ${arg('task', '')}`);
  process.exit(0);
}

// 监听模式
const IGNORE = /(^|[\\/])(node_modules|\.git|dist|build|\.next|__pycache__|vendor)([\\/]|$)/i;
let idleTimer = null;
const last = new Map();

upsert('idle', '待命');
console.log(`监听中：${WATCH}`);
console.log(`已有状态写入 ${OUT}`);

fs.watch(WATCH, { recursive: true }, (event, file) => {
  if (!file || IGNORE.test(file)) return;
  const now = Date.now();
  const prev = last.get(file) || 0;
  if (now - prev < 250) return;      // 去抖
  last.set(file, now);

  // 手动打点写了 waiting 时，不让文件监听把它冲掉
  try {
    const cur = JSON.parse(fs.readFileSync(OUT, 'utf8')).agents.find(a => a.id === ID);
    if (cur && cur.state === 'waiting') return;
  } catch (e) { /* 读不到就照常写 */ }

  const short = file.length > 18 ? '…' + file.slice(-17) : file;
  upsert('writing', '改 ' + short);

  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => upsert('idle', '待命'), 25000);
});

process.on('SIGINT', () => {
  upsert('idle', '已退出');
  process.exit(0);
});
