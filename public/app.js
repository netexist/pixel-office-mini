// Trae 办公室 · 2.5D 等距插画渲染（Canvas 2D，零依赖）
// 数据约定：/api/agents 返回 { agents: [{ id, name, state, task, seat }] }
// 两个房间：开放办公区 / 会议 & 休息区，点顶部标签切换
(() => {
  'use strict';

  const cvs = document.getElementById('c');
  const ctx = cvs.getContext('2d');
  const stageEl = document.querySelector('.stage');
  const wrapEl = document.querySelector('.wrap');
  const labelsEl = document.getElementById('labels');
  const dot = document.getElementById('dot');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const roomsEl = document.getElementById('rooms');

  window.addEventListener('error', (e) => {
    if (dot) dot.classList.add('err');
    if (statusEl) statusEl.textContent = '脚本错误：' + e.message;
  });

  /* ================= 等距投影 ================= */
  const W = 1340, H = 880;
  const HW = 56, HH = 28;          // 单格菱形的半宽 / 半高（2:1 等距）
  const OX = 558, OY = 200;        // 房间后角在屏幕上的位置
  const RW = 13, RD = 9;           // 房间 13×9 格
  const WALL_H = 170, BASE_T = 20;

  const iso = (gx, gy) => ({ x: OX + (gx - gy) * HW, y: OY + (gx + gy) * HH });
  const up = (p, h) => ({ x: p.x, y: p.y - h });
  const dn = (p, h) => ({ x: p.x, y: p.y + h });

  const P00 = iso(0, 0);      // 后角（两面墙交汇）
  const PA = iso(RW, 0);      // 后右墙另一端
  const PB = iso(0, RD);      // 后左墙另一端
  const PAB = iso(RW, RD);    // 前角

  /* ================= 状态 ================= */
  const STATES = {
    writing:     { c: '#22C55E', label: '写代码' },
    researching: { c: '#3B82F6', label: '查资料' },
    executing:   { c: '#F97316', label: '执行中' },
    waiting:     { c: '#EAB308', label: '等你确认' },
    idle:        { c: '#94A3B8', label: '待命' }
  };

  const SKINS = ['#F3C9A4', '#E3AE83', '#CB9068', '#F8DCBB'];
  const SHIRTS = ['#5B8DEF', '#E07A5F', '#5FBF9B', '#A97BE0', '#EFB44A', '#6E8BF5'];
  const SHIRT2 = ['#4675CB', '#C4644B', '#4AA383', '#8D62C4', '#D29A34', '#5876D6'];
  const HAIRS = ['#2D2A32', '#5A3A22', '#1F2933', '#7A4A2B', '#3B2F4A'];
  const PANTS = ['#334155', '#3D4450', '#2F4858'];

  /* ================= 墙面品牌（可选） =================
     想在墙上挂自己的 LOGO / 公司名，把 branding.example.json 复制成
     branding.json（后者已在 .gitignore 里，不会被提交），填 logo / wallText 即可。
     不配置就什么都不画，方便开源分发。 */
  const BRAND = { logo: '', wallText: '' };
  const logoImg = new Image();
  let logoReady = false;
  logoImg.onload = () => { logoReady = true; };
  fetch('./branding.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg) return;
      if (cfg.wallText) BRAND.wallText = String(cfg.wallText);
      if (cfg.logo) { BRAND.logo = String(cfg.logo); logoImg.src = cfg.logo; }
    })
    .catch(() => { /* 没有配置文件就用空白墙面 */ });

  /* ================= 画布 ================= */
  // stacked = 竖屏/窄窗口：三个房间在同一张画布里上下排开，不用切标签
  let stacked = false;

  function totalH() {
    return stacked ? H * ROOMS.length : H;
  }

  function setupCanvas() {
    const dpr = Math.min(stacked ? 1.5 : 2, window.devicePixelRatio || 1);
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(totalH() * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (stageEl) {
      stageEl.style.aspectRatio = stacked
        ? `1340 / ${880 * ROOMS.length}`
        : '1340 / 880';
    }
  }

  function poly(pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    const k = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
  }

  // 圆头粗线，用来画弯曲的四肢
  function limb(x1, y1, x2, y2, w, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // 等距立方体：hb / ht 都是离地高度，画 top 面 + 左右两个可见侧面
  function slab(gx, gy, w, d, hb, ht, top, left, right) {
    const a = iso(gx, gy), b = iso(gx + w, gy), c = iso(gx + w, gy + d), e = iso(gx, gy + d);
    if (left) poly([up(e, hb), up(c, hb), up(c, ht), up(e, ht)], left);
    if (right) poly([up(b, hb), up(c, hb), up(c, ht), up(b, ht)], right);
    poly([up(a, ht), up(b, ht), up(c, ht), up(e, ht)], top);
  }

  /* ================= 房间：地板 / 墙 ================= */
  function drawFloor() {
    poly([dn(PB, BASE_T), dn(PAB, BASE_T), PAB, PB], '#C7B49F');
    poly([dn(PA, BASE_T), dn(PAB, BASE_T), PAB, PA], '#B49F88');

    for (let i = 0; i < RW; i++) {
      for (let j = 0; j < RD; j++) {
        const p1 = iso(i, j), p2 = iso(i + 1, j), p3 = iso(i + 1, j + 1), p4 = iso(i, j + 1);
        poly([p1, p2, p3, p4], (i + j) % 2 === 0 ? '#F5ECE0' : '#EFE4D5');
      }
    }
  }

  function drawWallPlanes() {
    poly([P00, PA, up(PA, WALL_H), up(P00, WALL_H)], '#CBD9E9');   // 后右墙（受光）
    poly([P00, PB, up(PB, WALL_H), up(P00, WALL_H)], '#B4C5DA');   // 后左墙（背光）

    // 踢脚线（墙面变换里只用 fillRect，见下方“时钟”注释）
    ctx.save();
    ctx.transform(PA.x - P00.x, PA.y - P00.y, 0, -1, P00.x, P00.y);
    ctx.fillStyle = '#9FB2C9';
    ctx.fillRect(0, 0, 1, 14);
    ctx.restore();

    ctx.save();
    ctx.transform(PB.x - P00.x, PB.y - P00.y, 0, -1, P00.x, P00.y);
    ctx.fillStyle = '#93A7BE';
    ctx.fillRect(0, 0, 1, 14);
    ctx.restore();
  }

  // 后右墙上的窗
  function drawWallWindow() {
    ctx.save();
    ctx.transform(PA.x - P00.x, PA.y - P00.y, 0, -1, P00.x, P00.y);
    ctx.fillStyle = '#F4F8FC';
    ctx.fillRect(0.02, 52, 0.32, 88);
    ctx.fillStyle = '#BFE3FA';
    ctx.fillRect(0.032, 56, 0.296, 80);
    ctx.fillStyle = '#8FBBD9';
    const BH = [18, 30, 14, 26, 20, 33, 16, 24];
    for (let i = 0; i < 8; i++) ctx.fillRect(0.048 + i * 0.034, 56, 0.028, BH[i]);
    ctx.fillStyle = '#F4F8FC';
    ctx.fillRect(0.178, 56, 0.008, 80);
    ctx.restore();
  }

  // 后右墙上的投影幕布（会议区）
  function drawWallScreen() {
    ctx.save();
    ctx.transform(PA.x - P00.x, PA.y - P00.y, 0, -1, P00.x, P00.y);
    ctx.fillStyle = '#46536A';
    ctx.fillRect(0.42, 38, 0.42, 100);
    ctx.fillStyle = '#EDF6FC';
    ctx.fillRect(0.435, 44, 0.39, 88);
    ctx.fillStyle = '#4C7FA8';
    ctx.fillRect(0.465, 60, 0.20, 9);
    ctx.fillStyle = '#9BBCD4';
    ctx.fillRect(0.465, 76, 0.31, 6);
    ctx.fillRect(0.465, 87, 0.25, 6);
    ctx.fillRect(0.465, 98, 0.29, 6);
    ctx.fillStyle = '#E8B457';
    ctx.fillRect(0.465, 110, 0.13, 13);
    ctx.restore();
  }

  /* 墙面「实物空间」：x 沿墙方向按像素、y 从墙顶往下按像素。
     和上面 u∈[0,1] 的变换不同，这里横纵 1 单位都是 1px，
     所以图片和文字不会被拉伸变形（只保留透视倾斜）。 */
  function enterWallSpace(ax, ay) {
    const dx = ax - P00.x, dy = ay - P00.y;
    const len = Math.hypot(dx, dy);
    ctx.transform(dx / len, dy / len, 0, 1, P00.x, P00.y - WALL_H);
    return len;
  }

  // 品牌 LOGO：挂在后左墙，所有房间都有（配置了才画）
  function drawWallLogo() {
    if (!BRAND.logo || !logoReady) return;
    const w = 190, h = w * logoImg.height / logoImg.width;
    ctx.save();
    // 左墙从「远端」往「后角」量，保证 x 轴正向不翻转（否则图片会左右镜像）
    const dx = P00.x - PB.x, dy = P00.y - PB.y;
    const len = Math.hypot(dx, dy);
    ctx.transform(dx / len, dy / len, 0, 1, PB.x, PB.y - WALL_H);
    const cx = len * 0.60;            // 距远端 60%，约等于距后角 40%
    const cy = WALL_H - 103;          // 离地约 103px
    ctx.drawImage(logoImg, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  }

  // 公司全称：刷在后右墙上（办公区，配置了才画）
  function drawCompanyName() {
    if (!BRAND.wallText) return;
    ctx.save();
    const len = enterWallSpace(PA.x, PA.y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 30px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.fillStyle = 'rgba(74,105,142,.92)';
    ctx.fillText(BRAND.wallText, len * 0.38, WALL_H - 94);
    ctx.restore();
  }

  /* 时钟：必须在屏幕空间绘制。
     墙面变换是各向异性的（横向 1 单位 = 700px 左右、纵向 1 单位 = 1px），
     在其中 stroke 会把线宽横向放大数百倍，变成横贯画面的灰带。 */
  function drawClock() {
    const ck = {
      x: P00.x + 0.66 * (PB.x - P00.x),
      y: P00.y + 0.66 * (PB.y - P00.y) - 104
    };
    ctx.beginPath(); ctx.ellipse(ck.x, ck.y, 17, 25, 0, 0, 6.283);
    ctx.fillStyle = '#A8BACD'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(ck.x, ck.y, 14, 22, 0, 0, 6.283);
    ctx.fillStyle = '#FBFDFF'; ctx.fill();

    const d = new Date();
    const hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2 - Math.PI / 2;
    const mA = (d.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#33414F';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ck.x, ck.y);
    ctx.lineTo(ck.x + Math.cos(hA) * 6.6, ck.y + Math.sin(hA) * 10);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ck.x, ck.y);
    ctx.lineTo(ck.x + Math.cos(mA) * 9.9, ck.y + Math.sin(mA) * 15);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.strokeStyle = 'rgba(120,140,165,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(P00.x, P00.y);
    ctx.lineTo(P00.x, P00.y - WALL_H);
    ctx.stroke();
  }

  function drawRug(gx, gy, w, d, outer, inner) {
    poly([iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)], outer);
    poly([iso(gx + 0.2, gy + 0.2), iso(gx + w - 0.2, gy + 0.2),
          iso(gx + w - 0.2, gy + d - 0.2), iso(gx + 0.2, gy + d - 0.2)], inner);
  }

  // 墙根落在地板上的投影，让墙体“坐实”
  function drawWallShadow() {
    ctx.save();
    ctx.globalAlpha = 0.14;
    poly([P00, PA, dn(PA, 30), dn(P00, 30)], '#123055');
    poly([P00, PB, dn(PB, 30), dn(P00, 30)], '#123055');
    ctx.restore();
  }

  function drawSoftShadow(gx, gy, rx, ry) {
    const p = iso(gx, gy);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#0A111C';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 5, rx, ry, 0, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  /* ================= 家具 ================= */
  const DW = 2.2, DD = 1.3, DH = 46;   // 工位桌面宽 / 深 / 高

  function drawDesk(gx, gy) {
    const TOP = DH, TH = 9;

    drawSoftShadow(gx + DW / 2, gy + DD / 2 + 0.15, 66, 24);

    // 两侧桌腿板
    slab(gx + 0.07, gy + 0.12, 0.17, DD - 0.24, 0, TOP - TH, null, '#99A5B2', '#8996A4');
    slab(gx + DW - 0.24, gy + 0.12, 0.17, DD - 0.24, 0, TOP - TH, null, '#99A5B2', '#8996A4');
    // 抽屉柜
    slab(gx + DW - 0.86, gy + 0.38, 0.6, 0.6, 0, 30, '#D9E0E8', '#B6C1CC', '#A6B2BF');
    // 桌面
    slab(gx, gy, DW, DD, TOP - TH, TOP, '#E9D2B0', '#C8A87F', '#B4926A');

    const mid = iso(gx + DW / 2, gy + 0.38);
    const surf = mid.y - TOP;

    // 显示器支架
    ctx.fillStyle = '#8B96A3';
    ctx.fillRect(mid.x - 5, surf - 16, 10, 16);
    roundRect(mid.x - 16, surf - 4, 32, 5, 2.5); ctx.fill();

    // 显示器
    const bw = 74, bh = 46;
    roundRect(mid.x - bw / 2, surf - 16 - bh, bw, bh, 7);
    ctx.fillStyle = '#2B3644'; ctx.fill();
    roundRect(mid.x - bw / 2 + 4, surf - 16 - bh + 4, bw - 8, bh - 8, 4);
    ctx.fillStyle = '#9BD8F5'; ctx.fill();

    ctx.fillStyle = 'rgba(38,92,130,.55)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(mid.x - bw / 2 + 10, surf - 16 - bh + 12 + i * 7, 18 + (i % 3) * 13, 3);
    }

    // 键盘
    slab(gx + DW / 2 - 0.52, gy + 0.86, 1.04, 0.34, TOP, TOP + 5, '#DCE3EA', '#B6C0CB', '#A6B1BD');

    // 杯子
    const mug = iso(gx + DW / 2 + 0.72, gy + 0.86);
    ctx.fillStyle = '#FFFFFF';
    roundRect(mug.x - 6, mug.y - TOP - 15, 12, 15, 3); ctx.fill();
    ctx.fillStyle = '#B5653C';
    ctx.fillRect(mug.x - 6, mug.y - TOP - 13, 12, 3);
    ctx.strokeStyle = '#E4E9EF'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mug.x + 7, mug.y - TOP - 8, 4, -1.2, 1.2); ctx.stroke();
  }

  // 圆桌：等距投影下圆变成椭圆（rx = r·HW·√2，ry = r·HH·√2）
  function drawRoundTable(gx, gy, r) {
    const c = iso(gx, gy);
    const rx = r * HW * 1.4142, ry = r * HH * 1.4142;
    const H = 44, T = 9;
    const surfY = c.y - H;

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#0A111C';
    ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, rx * 1.04, ry * 1.04, 0, 0, 6.283); ctx.fill();
    ctx.restore();

    // 底盘 + 立柱
    ctx.fillStyle = '#8E99A7';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx * 0.36, ry * 0.36, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#A7B2BF';
    ctx.fillRect(c.x - rx * 0.13, surfY + T, rx * 0.26, c.y - surfY - T);

    // 桌面侧壁（下层椭圆露出的那一圈）
    ctx.fillStyle = '#B4926A';
    ctx.beginPath(); ctx.ellipse(c.x, surfY + T, rx, ry, 0, 0, 6.283); ctx.fill();

    // 桌面
    ctx.fillStyle = '#E9D2B0';
    ctx.beginPath(); ctx.ellipse(c.x, surfY, rx, ry, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(150,118,86,.30)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 桌上：文件 + 水杯
    ctx.fillStyle = '#F7FAFD';
    roundRect(c.x - 26, surfY - 8, 24, 11, 2); ctx.fill();
    ctx.fillStyle = '#C3CFDB';
    ctx.fillRect(c.x - 24, surfY - 6, 20, 7);
    ctx.fillStyle = '#FFFFFF';
    roundRect(c.x + 18, surfY - 10, 9, 12, 2); ctx.fill();
  }

  function drawStool(gx, gy) {
    drawSoftShadow(gx + 0.35, gy + 0.33, 20, 8);
    slab(gx, gy, 0.7, 0.66, 0, 23, '#E2E8EF', '#BCC6D1', '#ABB6C2');
  }

  // 办公椅：坐垫 + 靠背（靠背在近侧，被人挡住）+ 立柱底座
  function drawOfficeChair(gx, gy) {
    drawSoftShadow(gx + 0.38, gy + 0.42, 24, 9);
    slab(gx + 0.06, gy + 0.06, 0.64, 0.6, 0, 40, '#8C97A5', '#6F7B8A', '#616D7C');
    slab(gx, gy + 0.5, 0.76, 0.16, 40, 68, '#A9B6C4', '#8493A4', '#768696');
  }

  function drawArmchair(gx, gy, w, d) {
    drawSoftShadow(gx + w / 2, gy + d / 2 + 0.15, 34, 14);
    slab(gx, gy, w, d, 0, 22, '#9DB0C5', '#7C90A8', '#6D8399');
    slab(gx + 0.08, gy, w - 0.16, 0.24, 22, 58, '#B4C4D6', '#93A7BD', '#869AAE');
    slab(gx, gy, 0.22, d, 22, 46, '#B4C4D6', '#93A7BD', '#869AAE');
    slab(gx + w - 0.22, gy, 0.22, d, 22, 46, '#B4C4D6', '#93A7BD', '#869AAE');
    slab(gx + 0.22, gy + 0.28, w - 0.44, d - 0.4, 22, 30, '#C6D3E1', '#A6B8CA', '#97A9BC');
  }

  function drawSideTable(gx, gy) {
    slab(gx, gy, 0.9, 0.9, 0, 32, '#F4F1EB', '#D8D2C8', '#C6BFB3');
    const p = iso(gx + 0.45, gy + 0.45);
    ctx.fillStyle = '#8B96A3';
    ctx.fillRect(p.x - 1.5, p.y - 58, 3, 26);
    ctx.fillStyle = '#EDBD62';
    ctx.beginPath();
    ctx.moveTo(p.x - 11, p.y - 58);
    ctx.lineTo(p.x + 11, p.y - 58);
    ctx.lineTo(p.x + 7, p.y - 74);
    ctx.lineTo(p.x - 7, p.y - 74);
    ctx.closePath();
    ctx.fill();
  }

  function drawSofa(gx, gy, w, d) {
    drawSoftShadow(gx + w / 2, gy + d / 2 + 0.2, 78, 26);
    slab(gx, gy, w, d, 0, 24, '#8FA3BC', '#71869F', '#63788F');                 // 底座
    slab(gx + 0.1, gy, w - 0.2, 0.26, 24, 62, '#9DB0C5', '#7C90A8', '#6D8399'); // 靠背
    slab(gx, gy, 0.26, d, 24, 50, '#9DB0C5', '#7C90A8', '#6D8399');             // 左扶手
    slab(gx + w - 0.26, gy, 0.26, d, 24, 50, '#9DB0C5', '#7C90A8', '#6D8399');  // 右扶手

    const n = 3, cw = (w - 0.52) / n;
    for (let i = 0; i < n; i++) {
      slab(gx + 0.26 + i * cw + 0.05, gy + 0.3, cw - 0.12, d - 0.42, 24, 32,
           '#B4C4D6', '#93A7BD', '#869AAE');
    }
  }

  function drawCoffeeTable(gx, gy, w, d) {
    slab(gx + 0.12, gy + 0.1, 0.16, d - 0.2, 0, 20, null, '#C9C2B6', '#B9B2A6');
    slab(gx + w - 0.28, gy + 0.1, 0.16, d - 0.2, 0, 20, null, '#C9C2B6', '#B9B2A6');
    slab(gx, gy, w, d, 20, 27, '#F4F1EB', '#D8D2C8', '#C6BFB3');

    // 桌上：几本书 + 一杯咖啡
    const p = iso(gx + w / 2, gy + d / 2);
    ctx.fillStyle = '#D9736B'; roundRect(p.x - 18, p.y - 27 - 6, 20, 5, 1.5); ctx.fill();
    ctx.fillStyle = '#5E9BC7'; roundRect(p.x - 17, p.y - 27 - 11, 18, 5, 1.5); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; roundRect(p.x + 8, p.y - 27 - 12, 9, 11, 2); ctx.fill();
  }

  // 书架：贴在后右墙（gy=0）上，正面朝房间
  function drawBookshelf(gx, gy, w, d) {
    slab(gx, gy, w, d, 0, 104, '#8E7C63', '#6F5F49', '#5F5140');

    const o = iso(gx, gy + d);
    ctx.save();
    ctx.transform(HW, HH, 0, -1, o.x, o.y);
    ctx.fillStyle = '#4B4033';
    ctx.fillRect(0.1, 10, w - 0.2, 90);

    const LEVELS = [10, 34, 58, 82];
    LEVELS.forEach(h => { ctx.fillStyle = '#8E7C63'; ctx.fillRect(0.08, h - 3, w - 0.16, 4); });

    const BOOKS = ['#D9736B', '#5E9BC7', '#E8B457', '#7FA98E', '#A98ECB', '#E08F5B', '#6FA9C4'];
    for (let li = 0; li < 3; li++) {
      const base = LEVELS[li] + 2;
      let u = 0.18, bi = li;
      while (u < w - 0.6) {
        const bw = 0.11 + (bi % 4) * 0.025;
        const bh = 14 + (bi % 3) * 4;
        ctx.fillStyle = BOOKS[bi % BOOKS.length];
        ctx.fillRect(u, base, bw, bh);
        u += bw + 0.035;
        bi++;
      }
    }
    ctx.restore();
  }

  function drawPlant(gx, gy, scale) {
    const base = iso(gx, gy);
    const s = scale || 1;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#0A111C';
    ctx.beginPath(); ctx.ellipse(base.x, base.y + 3, 26 * s, 10 * s, 0, 0, 6.283); ctx.fill();
    ctx.restore();

    slab(gx - 0.32 * s, gy - 0.32 * s, 0.64 * s, 0.64 * s, 0, 30 * s,
         '#D8A17A', '#B5825E', '#A4734F');

    const cx = base.x, cy = base.y - 30 * s;
    const leaves = [
      [0, -28, 20], [-20, -14, 15], [20, -14, 15],
      [-13, -34, 13], [14, -33, 12], [0, -44, 14]
    ];
    leaves.forEach(([dx, dy, r], i) => {
      ctx.fillStyle = i % 2 ? '#5FA377' : '#4F8F68';
      ctx.beginPath();
      ctx.ellipse(cx + dx * s, cy + dy * s, r * s, r * 0.82 * s, 0, 0, 6.283);
      ctx.fill();
    });
  }

  function drawCoffeeCorner(gx, gy, w, d) {
    slab(gx, gy, w, d, 0, 52, '#E4E9EF', '#BFC8D2', '#AFB9C4');

    const m = iso(gx + w / 2, gy + d * 0.42);
    ctx.fillStyle = '#39465A';
    roundRect(m.x - 15, m.y - 52 - 30, 30, 30, 5); ctx.fill();
    ctx.fillStyle = '#5B6B80';
    roundRect(m.x - 11, m.y - 52 - 26, 22, 10, 3); ctx.fill();
    ctx.fillStyle = '#F2D16B';
    ctx.beginPath(); ctx.arc(m.x + 8, m.y - 52 - 24, 2.2, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    roundRect(m.x - 5, m.y - 52 - 10, 10, 9, 2); ctx.fill();

    const p = iso(gx + w * 0.24, gy + d * 0.8);
    ctx.fillStyle = '#C08A63';
    roundRect(p.x - 6, p.y - 52 - 12, 12, 12, 3); ctx.fill();
    ctx.fillStyle = '#5FA377';
    ctx.beginPath(); ctx.arc(p.x, p.y - 52 - 18, 8, 0, 6.283); ctx.fill();
  }

  /* ================= 小人 ================= */
  function drawAgent(a, t) {
    const st = STATES[a.state] || STATES.idle;
    const moving = a.walking;
    const sit = !moving && a.pose === 'sit';
    const seatH = sit ? (a.seatH || 28) : 0;

    const stride = moving ? Math.sin(t / 90) : 0;
    const bob = moving ? Math.abs(Math.sin(t / 90)) * 2.6
              : sit ? Math.sin(t / 900 + a.phase) * 0.7
              : Math.sin(t / 640 + a.phase) * 1.1;

    const x = a.x;
    const footY = a.y;
    const hipY = footY - (sit ? seatH : 26) - bob;
    const torsoTop = hipY - (sit ? 28 : 32);
    const torsoH = hipY + 2 - torsoTop;
    const headY = torsoTop - 13;
    const armY = torsoTop + 4;

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#0A111C';
    ctx.beginPath(); ctx.ellipse(x, footY + 3, 19, 7.5, 0, 0, 6.283); ctx.fill();
    ctx.restore();

    // 被点选时的光圈
    if (a === selected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(228,199,119,.95)';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.ellipse(x, footY + 3, 27, 11, 0, 0, 6.283); ctx.stroke();
      ctx.restore();
    }

    if (a.state === 'executing' || a.state === 'waiting') {
      const pulse = 1 + Math.sin(t / 260) * 0.12;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = st.c;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, footY + 3, 25 * pulse, 10 * pulse, 0, 0, 6.283);
      ctx.stroke();
      ctx.restore();
    }

    // ---- 腿：坐 / 站 ----
    if (sit) {
      // 膝盖向前岔开，明显区别于站立
      limb(x - 4, hipY - 2, x - 13, hipY + 11, 9, a.pants);
      limb(x - 13, hipY + 11, x - 13, footY - 7, 8, a.pants);
      limb(x + 4, hipY - 2, x + 13, hipY + 11, 9, a.pants);
      limb(x + 13, hipY + 11, x + 13, footY - 7, 8, a.pants);
      ctx.fillStyle = '#334155';
      roundRect(x - 18, footY - 7, 11, 7, 3); ctx.fill();
      roundRect(x + 7, footY - 7, 11, 7, 3); ctx.fill();
    } else {
      ctx.fillStyle = a.pants;
      roundRect(x - 10, hipY + stride * 2, 8, 24, 4); ctx.fill();
      roundRect(x + 2, hipY - stride * 2, 8, 24, 4); ctx.fill();
      ctx.fillStyle = '#334155';
      roundRect(x - 11, footY - 8 + stride * 2, 10, 8, 4); ctx.fill();
      roundRect(x + 1, footY - 8 - stride * 2, 10, 8, 4); ctx.fill();
    }

    // ---- 身体 ----
    ctx.fillStyle = a.shirt;
    roundRect(x - 14, torsoTop, 28, torsoH, 12); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    roundRect(x - 14, torsoTop, 28, 12, 10); ctx.fill();

    // ---- 手臂（默认下垂）----
    if (a.act !== 'stretch') {
      ctx.fillStyle = a.shirt2;
      roundRect(x - 19, armY + stride * 1.5, 8, 22, 4); ctx.fill();
      roundRect(x + 11, armY - stride * 1.5, 8, 22, 4); ctx.fill();
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.arc(x - 15, armY + 22 + stride * 1.5, 4.5, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 15, armY + 22 - stride * 1.5, 4.5, 0, 6.283); ctx.fill();
    }

    // ---- 脖子 / 头 ----
    const back = a.facing === 'back' && sit;
    ctx.fillStyle = a.skin;
    ctx.fillRect(x - 4, torsoTop - 7, 8, 8);

    if (back) {
      // 背对镜头（坐在工位前看屏幕）：整颗头都是头发，不画眼睛
      ctx.beginPath(); ctx.arc(x, headY, 12.5, 0, 6.283);
      ctx.fillStyle = a.hair; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.beginPath(); ctx.arc(x - 3, headY - 4, 6, 0, 6.283); ctx.fill();
      ctx.fillStyle = a.hair;
      ctx.beginPath(); ctx.ellipse(x, headY + 11.2, 5, 2.4, 0, 0, 6.283); ctx.fill();  // 后颈发际
    } else {
      ctx.beginPath(); ctx.arc(x, headY, 12.5, 0, 6.283); ctx.fill();

      // 头发
      ctx.fillStyle = a.hair;
      ctx.beginPath();
      ctx.arc(x, headY - 0.5, 12.6, Math.PI * 1.03, Math.PI * 1.97);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 12.6, headY - 4, 3.6, 10);
      ctx.fillRect(x + 9, headY - 4, 3.6, 10);

      // 眼睛
      ctx.fillStyle = '#1F2937';
      ctx.beginPath(); ctx.arc(x - 4.5, headY + 1.5, 1.7, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 4.5, headY + 1.5, 1.7, 0, 6.283); ctx.fill();
    }

    // ---- 小动作 ----
    if (a.act === 'drink') {
      ctx.fillStyle = a.shirt2;
      roundRect(x + 8, armY - 4, 8, 16, 4); ctx.fill();
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.arc(x + 14, armY + 10, 4.5, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      roundRect(x + 15, armY + 4, 9, 11, 2); ctx.fill();
      ctx.fillStyle = '#B5653C';
      ctx.fillRect(x + 15, armY + 6, 9, 2.5);
      const p = (t / 520) % 1;
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + 19, armY - 2 - p * 7);
      ctx.quadraticCurveTo(x + 23, armY - 8 - p * 7, x + 19, armY - 13 - p * 7);
      ctx.stroke();
    } else if (a.act === 'read') {
      ctx.fillStyle = '#F7FAFD';
      roundRect(x - 12, torsoTop + 14, 24, 14, 2); ctx.fill();
      ctx.fillStyle = '#5E9BC7';
      ctx.fillRect(x - 12, torsoTop + 14, 24, 2.5);
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.arc(x - 13, torsoTop + 23, 4, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 13, torsoTop + 23, 4, 0, 6.283); ctx.fill();
    } else if (a.act === 'paper') {
      // 看报纸：比书本更宽的一张纸，带折缝和几行字
      ctx.fillStyle = '#EEF2F6';
      roundRect(x - 17, torsoTop + 12, 34, 19, 2); ctx.fill();
      ctx.fillStyle = '#C9D3DE';
      ctx.fillRect(x - 0.8, torsoTop + 12, 1.6, 19);
      ctx.fillStyle = '#8FA0B2';
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x - 14, torsoTop + 16 + i * 4, 11, 1.6);
        ctx.fillRect(x + 3, torsoTop + 16 + i * 4, 11, 1.6);
      }
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.arc(x - 17, torsoTop + 24, 4, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 17, torsoTop + 24, 4, 0, 6.283); ctx.fill();
    } else if (a.act === 'stretch') {
      const up = Math.sin(t / 300) * 2;
      ctx.fillStyle = a.shirt2;
      roundRect(x - 21, torsoTop - 13 - up, 8, 20, 4); ctx.fill();
      roundRect(x + 13, torsoTop - 13 - up, 8, 20, 4); ctx.fill();
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.arc(x - 17, torsoTop - 15 - up, 4.5, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 17, torsoTop - 15 - up, 4.5, 0, 6.283); ctx.fill();
    }

    // 胸前状态点
    ctx.beginPath(); ctx.arc(x + 8, hipY - 24, 3.4, 0, 6.283);
    ctx.fillStyle = st.c; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 1.4; ctx.stroke();
  }

  /* ================= 三个房间 ================= */
  // 每个房间：座位锚点（含坐/站姿态）+ 闲逛点 + 静态道具清单
  const MT = { gx: 6.5, gy: 4.6, r: 1.85, R: 2.62 };   // 会议圆桌中心 / 半径 / 凳子环半径
  const MT_RING = [0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
    const a = deg * Math.PI / 180;
    return { x: MT.gx + MT.R * Math.cos(a), y: MT.gy + MT.R * Math.sin(a) };
  });

  const ROOMS = [
    {
      id: 'office',
      label: '开放办公区',
      seats: [
        { key: 'desk-1', gx: 2.2,  gy: 2.62, pose: 'sit', seatH: 40, facing: 'back' },
        { key: 'desk-2', gx: 6.5,  gy: 2.62, pose: 'sit', seatH: 40, facing: 'back' },
        { key: 'desk-3', gx: 10.8, gy: 2.62, pose: 'sit', seatH: 40, facing: 'back' },
        { key: 'desk-4', gx: 2.2,  gy: 6.42, pose: 'sit', seatH: 40, facing: 'back' },
        { key: 'desk-5', gx: 6.5,  gy: 6.42, pose: 'sit', seatH: 40, facing: 'back' },
        { key: 'desk-6', gx: 10.8, gy: 6.42, pose: 'sit', seatH: 40, facing: 'back' }
      ],
      spots: [
        { gx: 1.62, gy: 4.62, act: 'drink' },   // 咖啡角前
        { gx: 7.85, gy: 0.82 },                 // 窗前
        { gx: 12.08, gy: 1.55 },                // 绿植旁
        { gx: 4.2,  gy: 4.0 },
        { gx: 8.8,  gy: 4.1 },
        { gx: 4.2,  gy: 7.7 },
        { gx: 8.8,  gy: 7.6 }
      ],
      props: null
    },
    {
      id: 'meeting',
      label: '会议室',
      seats: MT_RING.map((p, i) => ({
        key: 'desk-' + (i + 1), gx: p.x, gy: p.y + 0.22, pose: 'sit', seatH: 23
      })),
      spots: [
        { gx: 11.6, gy: 1.6 },                  // 幕布前
        { gx: 1.3,  gy: 4.9, act: 'drink' },    // 咖啡角
        { gx: 12.3, gy: 7.6 },                  // 绿植旁
        { gx: 2.3,  gy: 1.4 }                   // 书架侧
      ],
      props: null
    },
    {
      id: 'lounge',
      label: '休息区',
      seats: [
        { key: 'desk-1', gx: 10.05, gy: 6.28, pose: 'sit', seatH: 30 },
        { key: 'desk-2', gx: 11.3,  gy: 6.28, pose: 'sit', seatH: 30 },
        { key: 'desk-3', gx: 1.65,  gy: 6.75, pose: 'sit', seatH: 30 },
        { key: 'desk-4', gx: 4.9,   gy: 4.6 },
        { key: 'desk-5', gx: 6.6,   gy: 6.9 },
        { key: 'desk-6', gx: 12.4,  gy: 2.6 },
        { key: 'desk-7', gx: 3.0,   gy: 2.6 },
        { key: 'desk-8', gx: 7.7,   gy: 8.15 }
      ],
      spots: [
        { gx: 4.6,  gy: 0.95, act: 'read' },
        { gx: 7.8,  gy: 1.0 },
        { gx: 12.4, gy: 7.6 },
        { gx: 0.9,  gy: 8.2 },
        { gx: 7.6,  gy: 3.9, act: 'paper' }
      ],
      props: null
    }
  ];

  function buildOfficeProps() {
    const list = [];
    const DESKS = [
      [1.1, 1.2], [5.4, 1.2], [9.7, 1.2],
      [1.1, 5.0], [5.4, 5.0], [9.7, 5.0]
    ];
    DESKS.forEach(([gx, gy]) => {
      list.push({ k: gx + DW / 2 + gy + DD / 2, fn: () => drawDesk(gx, gy) });
      list.push({ k: gx + DW / 2 + gy + 1.6, fn: () => drawOfficeChair(gx + 0.72, gy + 1.24) });
    });
    list.push({ k: 0.3 + 0.48 + 3.0 + 0.95, fn: () => drawCoffeeCorner(0.3, 3.0, 0.95, 1.9) });
    list.push({ k: 0.8 + 8.3, fn: () => drawPlant(0.8, 8.3, 0.85) });
    list.push({ k: 12.3 + 8.1, fn: () => drawPlant(12.3, 8.1, 0.95) });
    list.push({ k: 12.4 + 0.6, fn: () => drawPlant(12.4, 0.6, 0.7) });
    return list.sort((a, b) => a.k - b.k);
  }

  function buildMeetingProps() {
    const list = [];
    list.push({ k: 0.8 + 2.2, fn: () => drawCoffeeCorner(0.35, 1.35, 1.0, 1.7) });
    MT_RING.forEach(p => list.push({
      k: p.x + p.y,
      fn: () => drawStool(p.x - 0.35, p.y - 0.33)
    }));
    list.push({ k: MT.gx + MT.gy, fn: () => drawRoundTable(MT.gx, MT.gy, MT.r) });
    list.push({ k: 12.4 + 1.2, fn: () => drawPlant(12.4, 1.2, 0.8) });
    list.push({ k: 0.7 + 8.4, fn: () => drawPlant(0.7, 8.4, 0.9) });
    list.push({ k: 12.4 + 8.1, fn: () => drawPlant(12.4, 8.1, 0.85) });
    return list.sort((a, b) => a.k - b.k);
  }

  function buildLoungeProps() {
    return [
      { fn: () => drawBookshelf(1.2, 0.2, 3.2, 0.7) },
      { fn: () => drawPlant(3.9, 0.7, 0.7) },
      { fn: () => drawArmchair(1.1, 5.9, 1.1, 1.0) },
      { fn: () => drawSideTable(2.9, 6.1) },
      { fn: () => drawCoffeeTable(9.6, 4.2, 2.2, 1.0) },
      { fn: () => drawSofa(9.2, 5.6, 3.0, 0.9) },
      { fn: () => drawPlant(0.7, 8.4, 0.85) },
      { fn: () => drawPlant(12.4, 8.1, 0.95) },
      { fn: () => drawPlant(12.5, 2.2, 0.7) }
    ];
  }

  ROOMS.forEach(r => {
    r.props = r.id === 'office' ? buildOfficeProps()
            : r.id === 'meeting' ? buildMeetingProps()
            : buildLoungeProps();
    r.spots = r.spots.map(s => ({ ...s, x: iso(s.gx, s.gy).x, y: iso(s.gx, s.gy).y }));
  });

  let currentRoom = 0;

  function visibleIn(roomId) {
    let n = 0;
    for (const a of agents.values()) {
      if (a.roomId === roomId && !a.hidden) n++;
    }
    return n;
  }

  function drawRoomBody(room, t) {
    drawWallPlanes();
    if (room.id === 'office') {
      drawWallWindow();
      drawCompanyName();
    } else if (room.id === 'meeting') {
      drawWallScreen();
    }
    drawWallLogo();     // 左墙 LOGO，所有房间都挂

    drawFloor();
    if (room.id === 'office') drawRug(0.5, 0.9, 12.3, 7.6, '#BFD0E2', '#CBDAEA');
    else if (room.id === 'lounge') drawRug(8.2, 3.6, 4.6, 4.2, '#C6D5E4', '#D2DFEC');

    drawWallShadow();
    drawClock();

    room.props.forEach(p => p.fn());

    [...agents.values()]
      .filter(a => a.roomId === room.id && !a.hidden)
      .sort((p, q) => p.y - q.y)
      .forEach(a => drawAgent(a, t));
  }

  // 竖屏堆叠时每块面板左上角的标题
  function drawPanelTitle(room) {
    const n = visibleIn(room.id);
    ctx.font = '700 27px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(236,243,250,.92)';
    ctx.fillText(room.label, 36, 54);
    const w = ctx.measureText(room.label).width;
    ctx.font = '500 20px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.fillStyle = '#8FA3B8';
    ctx.fillText(n + ' 人', 36 + w + 14, 54);
  }

  function roomSlots() {
    return stacked
      ? ROOMS.map((room, k) => ({ room, k }))
      : [{ room: ROOMS[currentRoom], k: 0 }];
  }

  function drawScene(t) {
    const total = totalH();
    ctx.clearRect(0, 0, W, total);

    roomSlots().forEach(({ room, k }) => {
      ctx.save();
      ctx.translate(0, k * H);
      drawRoomBody(room, t);
      if (stacked) {
        drawPanelTitle(room);
        if (visibleIn(room.id) === 0) {
          ctx.font = '500 23px "Microsoft YaHei","PingFang SC",sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(62,84,110,.45)';
          ctx.fillText('这个房间暂时没有人', W / 2, H * 0.52);
        }
      }
      ctx.restore();
    });

    if (stacked) {
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.lineWidth = 2;
      for (let i = 1; i < ROOMS.length; i++) {
        ctx.beginPath();
        ctx.moveTo(28, i * H);
        ctx.lineTo(W - 28, i * H);
        ctx.stroke();
      }
    }
  }

  /* ================= 数据 / 连接 ================= */
  const agents = new Map();
  let lastList = [];
  let mode = 'sse', pollTimer = null;

  const DOOR = iso(0.8, 8.2);

  function markOk() {
    if (!dot || !statusEl) return;
    dot.classList.remove('err');
    statusEl.textContent = '同步 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    statusEl.title = mode === 'sse' ? '实时推送（SSE）' : '轮询（SSE 降级）';
    if (countEl) countEl.textContent = agents.size;
  }
  function markErr(msg) {
    if (!dot || !statusEl) return;
    dot.classList.add('err');
    statusEl.textContent = msg;
  }

  async function pollOnce() {
    try {
      const res = await fetch('/api/agents', { cache: 'no-store' });
      const data = await res.json();
      apply(data.agents || []);
      mode = 'poll';
      markOk();
    } catch (e) {
      markErr('连接失败：确认 node server.js 已启动');
    }
  }

  function startPolling() {
    if (pollTimer) return;
    mode = 'poll';
    pollOnce();
    pollTimer = setInterval(pollOnce, 1200);
  }

  function startSSE() {
    // ?poll=1 供无头截图 / 自动化使用，避免长连接让浏览器等不到“网络空闲”
    if (location.search.indexOf('poll=1') >= 0) return startPolling();
    if (!('EventSource' in window)) return startPolling();
    const es = new EventSource('/api/stream');
    es.onopen = () => { mode = 'sse'; markOk(); };
    es.onmessage = (ev) => {
      try {
        apply((JSON.parse(ev.data).agents) || []);
        mode = 'sse';
        markOk();
      } catch (e) { /* 忽略坏消息 */ }
    };
    es.onerror = () => {
      es.close();
      markErr('推送断开，已降级为轮询');
      startPolling();
    };
  }

  // 有“正在进行”状态的项目 → 办公区；其余 → 会议室 / 休息区（均衡分配，会话内固定）
  const ACTIVE = { writing: 1, researching: 1, executing: 1, waiting: 1 };
  const idleRoom = new Map();

  function roomForIdle(id) {
    if (!idleRoom.has(id)) {
      let m = 0, l = 0;
      for (const v of idleRoom.values()) { if (v === 'meeting') m++; else l++; }
      idleRoom.set(id, m <= l ? 'meeting' : 'lounge');
    }
    return idleRoom.get(id);
  }

  function apply(list) {
    lastList = list;
    // 堆叠模式要同时给三个房间的人分座位，标签模式只处理当前房间
    const fillRooms = stacked ? ROOMS : [ROOMS[currentRoom]];
    const buckets = new Map(fillRooms.map(r => [r.id, []]));
    const seen = new Set();

    list.forEach((a, i) => {
      const id = a.id || ('agent-' + i);
      seen.add(id);

      let rt = agents.get(id);
      if (!rt) {
        rt = {
          id,
          name: a.name || id,
          state: 'idle',
          task: '',
          x: DOOR.x + (i % 4) * 14,
          y: DOOR.y + (i % 4) * 8,
          tx: 0, ty: 0,
          walking: false,
          placed: false,
          roomId: '',
          placedRoom: '',
          phase: Math.random() * 6.28,
          skin: SKINS[i % SKINS.length],
          shirt: SHIRTS[i % SHIRTS.length],
          shirt2: SHIRT2[i % SHIRT2.length],
          hair: HAIRS[i % HAIRS.length],
          pants: PANTS[i % PANTS.length],
          labelKey: '',
          // 行为
          mode: 'seat',
          modeRoom: '',
          pose: 'stand',
          facing: 'front',
          act: '',
          seatX: 0, seatY: 0,
          seatKey: '',
          seatPose: 'stand',
          seatFacing: 'front',
          seatH0: 0,
          seatH: 0,
          spot: null,
          until: 0,
          microUntil: 0,
          thinkAt: 0,
          actKey: ''
        };
        agents.set(id, rt);
        mountLabel(rt);
      }

      rt.name = a.name || rt.name;
      rt.state = STATES[a.state] ? a.state : 'idle';
      rt.task = a.task || '';
      rt.hidden = hidden.has(id);

      // 分配房间：正在工作的进办公区，其余在会议室 / 休息区之间均衡分配
      rt.roomId = ACTIVE[rt.state] ? 'office' : roomForIdle(id);
      if (!rt.hidden && buckets.has(rt.roomId)) buckets.get(rt.roomId).push({ rt, pref: a.seat });

      const key = rt.name + '|' + rt.state + '|' + rt.task;
      if (key !== rt.labelKey) {
        rt.labelKey = key;
        paintLabel(rt);
      }
    });

    // 只给“当前房间”的人分座位
    fillRooms.forEach((room) => {
      const used = new Set();
      const occupied = {};
      const here = buckets.get(room.id) || [];

      here.forEach((it, idx) => {
        const rt = it.rt;
        let seat = room.seats.find(s => s.key === it.pref && !used.has(s.key))
                || room.seats.find(s => !used.has(s.key))
                || room.seats[idx % room.seats.length];
        used.add(seat.key);

        const n = occupied[seat.key] || 0;
        occupied[seat.key] = n + 1;
        const p = iso(seat.gx + n * 0.42, seat.gy);

        rt.seatX = p.x;
        rt.seatY = p.y;
        rt.seatKey = seat.key;
        rt.seatPose = seat.pose || 'stand';
        rt.seatFacing = seat.facing || 'front';
        rt.seatH0 = seat.seatH || 0;

        if (!rt.placed || rt.placedRoom !== room.id) {
          rt.x = p.x; rt.y = p.y;
          rt.tx = p.x; rt.ty = p.y;
          rt.placed = true;
          rt.placedRoom = room.id;
          rt.modeRoom = room.id;
          rt.mode = 'seat';
          rt.pose = rt.seatPose;
          rt.facing = rt.seatFacing;
          rt.seatH = rt.seatH0;
          rt.act = '';
          rt.spot = null;
          rt.thinkAt = 0;
          rt.microUntil = 0;
        }
      });
    });

    for (const id of [...agents.keys()]) {
      if (!seen.has(id)) {
        const rt = agents.get(id);
        if (rt && rt.el) rt.el.remove();
        agents.delete(id);
      }
    }
    if (countEl) countEl.textContent = agents.size;
    updateTabCounts();
    if (showPanel && !showPanel.hidden) renderShowList();
    else refreshShowStat();
  }

  function updateTabCounts() {
    if (!roomsEl) return;
    const n = { office: 0, meeting: 0, lounge: 0 };
    for (const a of agents.values()) {
      if (a.hidden) continue;
      if (n[a.roomId] !== undefined) n[a.roomId]++;
    }
    [...roomsEl.children].forEach((btn, i) => {
      const room = ROOMS[i];
      const el = btn.querySelector('.n');
      if (el && room) el.textContent = n[room.id] || 0;
    });
  }

  /* ================= 文字层（DOM，保证清晰可读） ================= */
  function mountLabel(rt) {
    const el = document.createElement('div');
    el.className = 'agent-label';
    el.innerHTML =
      '<div class="bubble"></div>' +
      '<div class="name"><i></i><span class="nm"></span><span class="st"></span><span class="act"></span></div>';
    labelsEl.appendChild(el);
    rt.el = el;
    rt.$bubble = el.querySelector('.bubble');
    rt.$nm = el.querySelector('.nm');
    rt.$st = el.querySelector('.st');
    rt.$dot = el.querySelector('.name i');
    rt.$act = el.querySelector('.act');
  }

  function bubbleText(a) {
    if (a.state === 'waiting') return a.task ? '等你确认：' + a.task : '等你确认一下';
    if (a.task && a.task !== '待命' && a.task !== '已退出') {
      return a.task.length > 20 ? a.task.slice(0, 20) + '…' : a.task;
    }
    if (a.act && ACT_TEXT[a.act]) return '在' + ACT_TEXT[a.act];
    return '';
  }

  function paintLabel(rt) {
    const st = STATES[rt.state] || STATES.idle;
    rt.$nm.textContent = rt.name;
    rt.$st.textContent = st.label;
    rt.$dot.style.background = st.c;
  }

  const ACT_TEXT = { drink: '喝咖啡', read: '看书', paper: '看报纸', stretch: '伸懒腰' };

  function actionText(a) {
    if (a.walking && a.mode === 'go') return '正在走过去';
    if (a.act && ACT_TEXT[a.act]) return '在' + ACT_TEXT[a.act];
    if (a.pose === 'sit' && a.facing === 'back') return '在工位工作';
    if (a.pose === 'sit') return '坐着休息';
    return '待命';
  }

  /* ================= 点击人物 → 详情卡 ================= */
  const detailEl = document.getElementById('detail');
  const detailClose = document.getElementById('detailClose');
  const emptyHint = document.getElementById('emptyHint');
  const dName = document.getElementById('dName');
  const dState = document.getElementById('dState');
  const dDot = document.getElementById('dDot');
  const dAct = document.getElementById('dAct');
  const dTask = document.getElementById('dTask');
  const dSeat = document.getElementById('dSeat');

  let selected = null;
  let detailKey = '';

  function seatLabel(a) {
    const room = ROOMS.find(r => r.id === a.roomId) || ROOMS[currentRoom];
    const i = room.seats.findIndex(s => s.key === a.seatKey);
    return room.label + (i >= 0 ? ' · 工位 ' + (i + 1) : '');
  }

  function fillDetail() {
    const a = selected;
    if (!a) return;
    const st = STATES[a.state] || STATES.idle;
    dName.textContent = a.name;
    dState.textContent = st.label;
    dDot.style.background = st.c;
    dAct.textContent = actionText(a);
    dTask.textContent = a.task || '（暂无任务描述）';
    dSeat.textContent = seatLabel(a);
  }

  function placeDetail() {
    if (!selected || !detailEl || detailEl.hidden) return;
    const a = selected;
    const px = Math.max(13, Math.min(74, a.x / W * 100));
    const headPct = (a.headPct === undefined) ? a.y / H * 100 : a.headPct;
    const localPct = (a.y / H) * 100;          // 面板内的相对高度，决定卡片往上还是往下放
    const below = localPct < 52;
    detailEl.style.left = px + '%';
    detailEl.style.top = (headPct + (below ? 5 : -3)) + '%';
    detailEl.style.transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  }

  function showDetail(a) {
    selected = a;
    if (!detailEl) return;
    detailEl.hidden = false;
    detailKey = '';
    fillDetail();
    placeDetail();
  }

  function hideDetail() {
    selected = null;
    detailKey = '';
    if (detailEl) detailEl.hidden = true;
  }

  function agentAt(cx, cy) {
    let hit = null, best = 1e9;
    for (const a of agents.values()) {
      if (a.slot === undefined || a.slot < 0) continue;
      const midY = a.slot * H + a.y - headOffset(a) * 0.5;
      const d = Math.hypot(a.x - cx, midY - cy);
      if (d < best) { best = d; hit = a; }
    }
    return hit && best < 52 ? hit : null;
  }

  if (detailClose) detailClose.addEventListener('click', (ev) => { ev.stopPropagation(); hideDetail(); });

  cvs.addEventListener('click', (ev) => {
    const r = cvs.getBoundingClientRect();
    const hit = agentAt((ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * totalH());
    if (hit) showDetail(hit); else hideDetail();
  });

  cvs.addEventListener('mousemove', (ev) => {
    const r = cvs.getBoundingClientRect();
    const hit = agentAt((ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * totalH());
    cvs.style.cursor = hit ? 'pointer' : 'default';
  });

  if (labelsEl) {
    labelsEl.addEventListener('click', (ev) => {
      const el = ev.target.closest('.agent-label');
      if (!el) return;
      for (const a of agents.values()) {
        if (a.el === el) { showDetail(a); break; }
      }
    });
  }

  // 人物头顶相对脚底的像素高度（坐姿要随座位高度上移）
  function headOffset(a) {
    const sitting = a.pose === 'sit' && !a.walking;
    return sitting ? (a.seatH || 28) + 53.5 : 83.5;
  }

  function updateEmptyHint(roomId, visCount) {
    if (!emptyHint) return;
    // 停止态由遮罩统一提示，避免两段文字叠在一起
    if (!running || visCount > 0) {
      if (!emptyHint.hidden) emptyHint.hidden = true;
      return;
    }
    let hid = 0;
    for (const a of agents.values()) {
      if (a.hidden && a.roomId === roomId) hid++;
    }
    let html;
    if (hid > 0) html = '<b>这个房间的小人已全部隐藏</b>点右上角「显示」可以重新打开';
    else if (roomId === 'office') html = '<b>当前没有进行中的项目</b>Trae 正在会议室或休息区待命';
    else html = '<b>这里暂时没有人</b>所有项目都在别的房间';

    if (emptyHint.dataset.k !== html) {
      emptyHint.dataset.k = html;
      emptyHint.innerHTML = html;
    }
    emptyHint.hidden = false;
  }

  function syncLabels() {
    const slots = roomSlots();
    const total = totalH();
    const slotOf = {};
    slots.forEach(({ room, k }) => { slotOf[room.id] = k; });

    // 先挑出本房间的人，再按 x 排序做错位，避免人多时标签糊成一团
    const vis = [];
    for (const a of agents.values()) {
      if (!a.el) continue;
      const k = slotOf[a.roomId];
      if (k === undefined || a.hidden) {
        a.slot = -1;
        if (a.el.style.display !== 'none') a.el.style.display = 'none';
        continue;
      }
      a.slot = k;
      if (a.el.style.display === 'none') a.el.style.display = '';
      vis.push(a);
    }
    vis.sort((p, q) => (p.slot - q.slot) || (p.x - q.x));

    let lastX = -1e9, lastSlot = -1, lane = 0;
    // 堆叠模式每块面板更窄，标签错位间距要相应加大
    const LANE_X = stacked ? 132 : 100;
    const LANE_Y = stacked ? 96 : 68;
    for (const a of vis) {
      if (a.slot !== lastSlot) { lastSlot = a.slot; lastX = -1e9; lane = 0; }
      if (a.x - lastX < LANE_X) lane += 1; else lane = 0;
      lastX = a.x;

      const left = Math.max(8, Math.min(92, a.x / W * 100));
      const headPct = (a.slot * H + a.y - headOffset(a)) / total * 100;
      const topPct = (a.slot * H + a.y - headOffset(a) - 3 - lane * LANE_Y) / total * 100;
      a.pctLeft = left;
      a.headPct = headPct;
      a.el.style.left = left + '%';
      a.el.style.top = topPct + '%';

      const k = a.act || '';
      if (a.actKey !== k) {
        a.actKey = k;
        a.$act.textContent = ACT_TEXT[k] || '';
        a.$act.style.display = k ? '' : 'none';
      }

      const bt = bubbleText(a);
      if (a.bubbleKey !== bt) {
        a.bubbleKey = bt;
        a.$bubble.textContent = bt;
        a.$bubble.style.display = bt ? '' : 'none';
        a.$bubble.style.color = a.state === 'waiting' ? '#92400E' : '#1E293B';
      }
    }

    if (emptyHint) {
      if (stacked) {
        if (!emptyHint.hidden) emptyHint.hidden = true;   // 堆叠模式用画布内的占位文字
      } else {
        updateEmptyHint(ROOMS[currentRoom].id, vis.length);
      }
    }

    if (selected && detailEl && !detailEl.hidden) {
      if (selected.slot === undefined || selected.slot < 0) {
        hideDetail();
      } else {
        const a = selected;
        const k = [a.name, a.state, a.task, a.act, a.seatKey, a.walking, a.mode].join('|');
        if (detailKey !== k) { detailKey = k; fillDetail(); }
        placeDetail();
      }
    }
  }

  /* ================= 人物行为：坐下 / 走动 / 小动作 ================= */
  const INPLACE = ['stretch', 'drink', 'read'];

  function tickBehavior(a, now) {
    const room = ROOMS.find(r => r.id === a.roomId) || ROOMS[currentRoom];

    if (a.modeRoom !== room.id) {
      a.modeRoom = room.id;
      a.mode = 'seat';
      a.pose = a.seatPose;
      a.facing = a.seatFacing;
      a.seatH = a.seatH0;
      a.act = '';
      a.spot = null;
      a.thinkAt = now + 2500 + Math.random() * 6000;
      a.microUntil = 0;
    }

    if (a.mode === 'seat') {
      a.tx = a.seatX;
      a.ty = a.seatY;
      a.facing = a.seatFacing;

      if (now < a.microUntil) return;
      if (a.act) a.act = '';
      if (now < a.thinkAt) return;

      a.thinkAt = now + 9000 + Math.random() * 12000;
      // 只有「待命」的人才会离开座位；工作/执行/等你确认的人留在工位
      const canRoam = a.state === 'idle' && room.spots.length > 0;

      if (canRoam && Math.random() < 0.6) {
        const spot = room.spots[(Math.random() * room.spots.length) | 0];
        if (spot === a.spot && room.spots.length > 1) {
          a.thinkAt = now + 2500;
          return;
        }
        a.spot = spot;
        a.tx = spot.x;
        a.ty = spot.y;
        a.mode = 'go';
        a.pose = 'stand';
        a.facing = 'front';
        a.seatH = 0;
        a.act = '';
      } else {
        a.act = INPLACE[(Math.random() * INPLACE.length) | 0];
        a.microUntil = now + 2800 + Math.random() * 2600;
      }
      return;
    }

    if (a.mode === 'go') {
      if (Math.hypot(a.tx - a.x, a.ty - a.y) < 3) {
        a.mode = 'act';
        a.pose = (a.spot && a.spot.pose) || 'stand';
        a.facing = 'front';
        a.seatH = (a.spot && a.spot.seatH) || 0;
        a.act = (a.spot && a.spot.act) || '';
        a.until = now + 5000 + Math.random() * 6000;
      }
      return;
    }

    if (a.mode === 'act' && now > a.until) {
      a.mode = 'seat';
      a.pose = a.seatPose;
      a.facing = a.seatFacing;
      a.seatH = a.seatH0;
      a.act = '';
      a.spot = null;
      a.tx = a.seatX;
      a.ty = a.seatY;
      a.thinkAt = now + 6000 + Math.random() * 8000;
    }
  }

  /* ================= 显示开关 ================= */
  const SHOW_KEY = 'po.hidden.v1';
  let hidden = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(SHOW_KEY) || '[]');
    if (Array.isArray(raw)) hidden = new Set(raw);
  } catch (e) { /* 忽略坏数据 */ }

  const showBtn = document.getElementById('showBtn');
  const showStat = document.getElementById('showStat');
  const showPanel = document.getElementById('showPanel');
  const showList = document.getElementById('showList');
  let showListKey = '';

  function saveHidden() {
    try { localStorage.setItem(SHOW_KEY, JSON.stringify([...hidden])); } catch (e) { /* 忽略 */ }
  }

  function refreshShowStat() {
    const total = agents.size;
    const shown = total - [...agents.keys()].filter(id => hidden.has(id)).length;
    if (showStat) showStat.textContent = shown + '/' + total;
    if (showBtn) showBtn.classList.toggle('on', hidden.size > 0);
  }

  function renderShowList() {
    if (!showList) return;
    const items = [...agents.values()];
    const key = items.map(a => a.id).join(',');
    if (key === showListKey) {
      // 只刷新每行的开合状态，避免整表重建打断点击
      [...showList.children].forEach((row, i) => {
        const a = items[i];
        if (!a) return;
        row.classList.toggle('off', hidden.has(a.id));
        const st = STATES[a.state] || STATES.idle;
        row.querySelector('i').style.background = st.c;
        row.querySelector('.sw-t').textContent = st.label;
      });
      refreshShowStat();
      return;
    }

    showListKey = key;
    showList.innerHTML = '';
    items.forEach(a => {
      const row = document.createElement('div');
      row.className = 'sw-row' + (hidden.has(a.id) ? ' off' : '');
      row.dataset.id = a.id;
      const st = STATES[a.state] || STATES.idle;
      row.innerHTML = '<i></i><span class="sw-n"></span><span class="sw-t"></span>';
      row.querySelector('i').style.background = st.c;
      row.querySelector('.sw-n').textContent = a.name;
      row.querySelector('.sw-t').textContent = st.label;
      row.addEventListener('click', () => toggleAgent(a.id));
      showList.appendChild(row);
    });
    refreshShowStat();
  }

  function toggleAgent(id) {
    if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
    saveHidden();
    if (selected && selected.id === id && hidden.has(id)) hideDetail();
    apply(lastList);
    renderShowList();
  }

  function setAllVisible(on) {
    hidden = on ? new Set() : new Set(agents.keys());
    saveHidden();
    hideDetail();
    apply(lastList);
    renderShowList();
  }

  if (showBtn && showPanel) {
    showBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      showPanel.hidden = !showPanel.hidden;
      if (!showPanel.hidden) renderShowList();
    });
    showPanel.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const btn = ev.target.closest('button[data-act]');
      if (btn) setAllVisible(btn.dataset.act === 'all');
    });
    document.addEventListener('click', () => { showPanel.hidden = true; });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') showPanel.hidden = true;
    });
  }

  /* ================= 停止 / 继续 ================= */
  const ctrlBtn = document.getElementById('ctrlBtn');
  const ctrlState = document.getElementById('ctrlState');
  const stoppedVeil = document.getElementById('stoppedVeil');

  let running = true;

  function setRunning(on) {
    running = !!on;
    if (ctrlBtn) {
      ctrlBtn.textContent = on ? '停止' : '继续';
      ctrlBtn.classList.toggle('is-resume', !on);
    }
    if (ctrlState) {
      ctrlState.textContent = on ? '运行中 · 后台监听已开启' : '已停止 · 后台监听已释放';
    }
    if (stoppedVeil) stoppedVeil.hidden = on;
  }

  async function refreshRuntime() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      const d = await r.json();
      setRunning(!!d.running);
    } catch (e) { /* 服务不可达时保持原状 */ }
  }

  async function control(action) {
    if (ctrlBtn) ctrlBtn.disabled = true;
    try {
      const r = await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const d = await r.json();
      setRunning(!!d.running);
    } catch (e) {
      if (ctrlState) ctrlState.textContent = '控制失败：服务不可达';
    } finally {
      if (ctrlBtn) ctrlBtn.disabled = false;
    }
  }

  if (ctrlBtn) {
    ctrlBtn.addEventListener('click', () => control(running ? 'stop' : 'start'));
  }
  setRunning(true);
  refreshRuntime();
  setInterval(refreshRuntime, 4000);

  /* ================= 房间切换 ================= */
  function setRoomUI() {
    if (!roomsEl) return;
    [...roomsEl.children].forEach((b, i) => b.classList.toggle('is-on', i === currentRoom));
  }

  function switchRoom(idx) {
    if (idx === currentRoom || !ROOMS[idx]) return;
    currentRoom = idx;
    setRoomUI();
    apply(lastList);
  }

  if (roomsEl) {
    roomsEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.room-btn');
      if (!btn) return;
      switchRoom(Number(btn.dataset.room));
    });
  }

  // 支持 ?room=0|1|2 直接打开某个房间（截图 / 深链用）
  const qRoom = Number(new URLSearchParams(location.search).get('room'));
  if (qRoom >= 0 && qRoom < ROOMS.length) {
    currentRoom = qRoom;
    setRoomUI();
  }

  /* ================= 竖屏 / 窄窗口：三间房上下堆叠 ================= */
  const mqStack = window.matchMedia('(orientation: portrait), (max-width: 900px)');
  let layoutReady = false;

  function applyLayout() {
    const next = mqStack.matches;
    if (layoutReady && next === stacked) return;
    layoutReady = true;
    stacked = next;
    if (wrapEl) wrapEl.classList.toggle('stacked', stacked);
    setupCanvas();
    if (lastList.length) apply(lastList);   // 补齐新出现房间的座位
  }
  applyLayout();
  if (mqStack.addEventListener) mqStack.addEventListener('change', applyLayout);

  let rsTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(() => {
      const next = mqStack.matches;
      if (next !== stacked) applyLayout();
    }, 180);
  });

  /* ================= 主循环 ================= */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;

    const liveRooms = stacked ? ROOMS.map(r => r.id) : [ROOMS[currentRoom].id];
    for (const a of agents.values()) {
      if (liveRooms.indexOf(a.roomId) < 0 || a.hidden || !running) { a.walking = false; continue; }
      tickBehavior(a, now);

      const dx = a.tx - a.x, dy = a.ty - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1.5) {
        const step = Math.min(dist, 130 * dt / 1000);
        a.x += dx / dist * step;
        a.y += dy / dist * step;
        a.walking = true;
      } else {
        a.x = a.tx; a.y = a.ty; a.walking = false;
      }
    }

    drawScene(now);
    syncLabels();
    requestAnimationFrame(frame);
  }

  startSSE();
  requestAnimationFrame(frame);
})();
