// 演示用：每 4 秒改一次状态与工位，让小人动起来
// 用法：另开一个终端执行 node demo.js
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'agents.json');

const BASE = [
  { id: 'a1', name: '研究员' },
  { id: 'a2', name: '编码员' },
  { id: 'a3', name: '执行者' },
  { id: 'a4', name: '评审员' }
];

const STATES = ['writing', 'researching', 'executing', 'waiting', 'idle'];
const TASKS = ['写接口', '查资料', '跑测试', '等确认', '整理日志', '改样式'];

function writeAtomic(obj) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

let round = 0;
function tick() {
  round++;
  const agents = BASE.map((a, i) => ({
    ...a,
    state: STATES[(i + round) % STATES.length],
    task: TASKS[(i + round * 2) % TASKS.length],
    seat: 'desk-' + (((i + round) % 4) + 1)
  }));

  // 顺手演示“消失”：每 5 轮少一个 agent
  const list = round % 5 === 0 ? agents.slice(0, 3) : agents;
  writeAtomic({ updated: Date.now(), agents: list });
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 第 ${round} 轮已写入`);
}

tick();
setInterval(tick, 4000);
