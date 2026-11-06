/* 千城游戏厅 · 消消乐（Match-3）v1
   自包含模块：不依赖任何图片/音频素材，全部 Canvas 程序化绘制。
   - 8×8 棋盘、6 种宝石、限步数过关、连锁加成
   - 四连生条纹、五连生彩虹、L/T 形生炸弹；特殊块被消除时连锁触发
   - 一局从第 1 关开始，通关自动进下一关，分数累计；步数用尽且未达标即结束
   - 战绩经 window.QCM3.report() 上报 /api/platform/solo/result（服务端 clamp + matchId 防重）
   - 平台桥接只在 window.QCM3 上，本模块不直接碰 api/profile */
(() => {
  'use strict';
  if (window.QCM3Game) return;

  /* ---------------- 常量 ---------------- */
  const COLS = 8, ROWS = 8;
  const BASE = 40;                       // 每消一颗基础分
  const LEVEL_MOVES = 24;                // 每关步数
  const TARGET = lv => 1100 + (lv - 1) * 820;
  const KINDS = [
    { a: '#ff9a9e', b: '#e8545f', ring: '#a8283a', shape: 'circle' },
    { a: '#ffe08a', b: '#f2b53c', ring: '#a97514', shape: 'diamond' },
    { a: '#c9a7ff', b: '#8a5fe0', ring: '#5a34a5', shape: 'hex' },
    { a: '#a8f0a0', b: '#4fbf6a', ring: '#24763c', shape: 'square' },
    { a: '#96d8ff', b: '#3f8fe0', ring: '#1d5aa0', shape: 'drop' },
    { a: '#ffc59a', b: '#f07f3c', ring: '#a04a12', shape: 'star' }
  ];
  const SP = { NONE: 0, STRIPE_H: 1, STRIPE_V: 2, BOMB: 3, RAINBOW: 4 };

  /* ---------------- 状态 ---------------- */
  let host = null, canvas = null, g = null, hud = null, overlay = null;
  let board = [], kinds = 6, busy = false, dead = false, started = false;
  let run = null, rafId = 0, last = 0, cell = 40, pad = 0, dpr = 1;
  let dragFrom = -1, dragDx = 0, dragDy = 0, sel = -1;
  let particles = [], floats = [], anim = null, shake = 0;
  let hintTimer = 0, hintCells = null, idleTimer = 0;

  const rnd = n => Math.floor(Math.random() * n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sfx = (n, a) => { try { window.QCSFX?.play(n, a); } catch { } };
  const mid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');

  /* ---------------- DOM ---------------- */
  function build() {
    if (host) return;
    const style = document.createElement('style');
    style.textContent = `
#qcM3{position:fixed;inset:0;z-index:9200;display:none;flex-direction:column;align-items:center;
  background:radial-gradient(ellipse 80% 50% at 50% 0%,#3b2a63,#170f2b 70%),#170f2b;color:#fdf6ff;
  font-family:'Microsoft YaHei','PingFang SC',sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none}
#qcM3.on{display:flex;justify-content:center;padding-bottom:66px}
#qcM3 *{box-sizing:border-box}
.m3hud{width:min(94vw,470px);padding:10px 4px 4px;display:flex;flex-direction:column;gap:6px;flex:none}
.m3top{display:flex;align-items:center;gap:8px}
.m3lv{background:linear-gradient(145deg,#ffd774,#f2a63b);color:#4a2a05;font-weight:800;border-radius:12px;padding:4px 11px;font-size:13px;box-shadow:0 3px 0 #a76c14}
.m3score{font-size:24px;font-weight:800;letter-spacing:.5px;margin-left:auto;color:#fff;text-shadow:0 2px 10px #8a5cff66}
.m3score small{font-size:10px;color:#b7a9d6;font-weight:400;margin-left:4px}
.m3btn{border:0;border-radius:12px;padding:8px 12px;font:13px/1 inherit;background:#ffffff1f;color:#fff;cursor:pointer;backdrop-filter:blur(4px)}
.m3btn:active{transform:scale(.95)}
.m3bar{height:10px;border-radius:20px;background:#ffffff1a;overflow:hidden;position:relative}
.m3bar i{display:block;height:100%;width:0;border-radius:20px;background:linear-gradient(90deg,#7ee7c7,#6cc6ff,#b48cff);transition:width .25s}
.m3meta{display:flex;justify-content:space-between;font-size:11px;color:#b7a9d6}
.m3meta b{color:#fff}
.m3moves{font-variant-numeric:tabular-nums}
.m3moves.low{color:#ff8d8d}
#qcM3Board{display:block;border-radius:18px;background:#ffffff0d;box-shadow:0 12px 40px #00000059,inset 0 0 0 1px #ffffff1a;margin:8px auto 0;touch-action:none}
.m3foot{position:absolute;left:0;right:0;bottom:calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;justify-content:center;flex:none}
.m3foot .m3btn{padding:10px 16px;font-size:13px}
/* 覆盖层：开始 / 结算 / 过关 */
.m3ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#120b22d9;backdrop-filter:blur(6px);padding:20px;z-index:3}
.m3card{width:min(92vw,380px);background:linear-gradient(160deg,#372a55,#241a3d);border:1px solid #ffffff26;border-radius:26px;padding:24px 20px;text-align:center;box-shadow:0 20px 60px #00000073}
.m3card h2{margin:0 0 6px;font-size:22px}
.m3card h2 span{font-size:34px;display:block;margin-bottom:6px}
.m3card p{color:#c4b6de;font-size:12.5px;line-height:1.75;margin:8px 0}
.m3card .bigscore{font-size:44px;font-weight:800;color:#ffd774;line-height:1.1;text-shadow:0 4px 18px #f2a63b59}
.m3card .stars{font-size:30px;letter-spacing:4px;margin:10px 0}
.m3card .m3btn{display:block;width:100%;margin-top:10px;padding:13px;font-size:14px;background:linear-gradient(145deg,#ac8bec,#8a63d8);font-weight:700}
.m3card .m3btn.ghost{background:#ffffff17;font-weight:400}
.m3rules{text-align:left;background:#ffffff0f;border-radius:14px;padding:12px 14px;margin:12px 0;font-size:12px;color:#cfc3e6;line-height:1.8}
.m3rules b{color:#ffd774}
.m3toast{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);font-size:22px;font-weight:800;
  color:#fff;text-shadow:0 3px 16px #000000b3;pointer-events:none;opacity:0;transition:opacity .2s,transform .2s}
.m3toast.on{opacity:1;transform:translate(-50%,-70%)}
`;
    document.head.append(style);

    host = document.createElement('div');
    host.id = 'qcM3';
    host.innerHTML = `
      <div class="m3hud">
        <div class="m3top">
          <span class="m3lv" id="m3Lv">第 1 关</span>
          <button class="m3btn" id="m3Pause" type="button">⏸</button>
          <div class="m3score"><span id="m3Score">0</span><small>分</small></div>
        </div>
        <div class="m3bar"><i id="m3Bar"></i></div>
        <div class="m3meta"><span>目标 <b id="m3Target">900</b></span><span class="m3moves" id="m3Moves">剩余 24 步</span></div>
      </div>
      <canvas id="qcM3Board" aria-label="消消乐棋盘"></canvas>
      <div class="m3foot"><button class="m3btn" id="m3Restart" type="button">↻ 重开</button><button class="m3btn" id="m3Exit" type="button">返回大厅</button></div>
      <div class="m3ov" id="m3Ov"></div>
      <div class="m3toast" id="m3Toast"></div>`;
    document.body.append(host);
    canvas = host.querySelector('#qcM3Board');
    hud = { lv: host.querySelector('#m3Lv'), score: host.querySelector('#m3Score'), bar: host.querySelector('#m3Bar'), target: host.querySelector('#m3Target'), moves: host.querySelector('#m3Moves') };
    overlay = host.querySelector('#m3Ov');

    host.querySelector('#m3Exit').onclick = () => close();
    host.querySelector('#m3Restart').onclick = () => { if (busy) return; startRun(); };
    host.querySelector('#m3Pause').onclick = () => showPause();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', () => { dragFrom = -1; dragDx = dragDy = 0; });
    window.addEventListener('resize', layout);
  }

  function layout() {
    if (!host) return;
    const w = Math.min(window.innerWidth * .94, 470);
    const availH = window.innerHeight - 190;
    const side = Math.max(220, Math.min(w, availH));
    cell = Math.floor(side / COLS);
    const px = cell * COLS;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = px * dpr; canvas.height = px * dpr;
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- 棋盘逻辑 ---------------- */
  const idx = (x, y) => y * COLS + x;
  const at = i => board[i];
  const isSp = (i, t) => at(i) && at(i).s === t;

  function newBoard() {
    board = new Array(COLS * ROWS).fill(null);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      let k, guard = 0;
      do { k = rnd(kinds); guard++; }
      while (guard < 30 && (
        (x >= 2 && at(idx(x - 1, y))?.k === k && at(idx(x - 2, y))?.k === k) ||
        (y >= 2 && at(idx(x, y - 1))?.k === k && at(idx(x, y - 2))?.k === k)
      ));
      board[idx(x, y)] = { k, s: SP.NONE };
    }
    if (!findMove()) newBoard();
  }

  /* 找所有 ≥3 的同色连线 */
  function findRuns() {
    const runs = [];
    for (let y = 0; y < ROWS; y++) {
      let s = 0;
      for (let x = 1; x <= COLS; x++) {
        const same = x < COLS && at(idx(x, y)) && at(idx(s, y)) && at(idx(x, y)).k === at(idx(s, y)).k;
        if (same) continue;
        if (x - s >= 3) runs.push({ dir: 'h', cells: Array.from({ length: x - s }, (_, t) => idx(s + t, y)), k: at(idx(s, y)).k });
        s = x;
      }
    }
    for (let x = 0; x < COLS; x++) {
      let s = 0;
      for (let y = 1; y <= ROWS; y++) {
        const same = y < ROWS && at(idx(x, y)) && at(idx(x, s)) && at(idx(x, y)).k === at(idx(x, s)).k;
        if (same) continue;
        if (y - s >= 3) runs.push({ dir: 'v', cells: Array.from({ length: y - s }, (_, t) => idx(x, s + t)), k: at(idx(x, s)).k });
        s = y;
      }
    }
    return runs;
  }

  function findMove() {
    for (let i = 0; i < board.length; i++) {
      const x = i % COLS, y = (i / COLS) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= COLS || ny >= ROWS) continue;
        const j = idx(nx, ny);
        [board[i], board[j]] = [board[j], board[i]];
        const ok = findRuns().length > 0;
        [board[i], board[j]] = [board[j], board[i]];
        if (ok) return [i, j];
      }
    }
    return null;
  }

  /* 特殊块效果展开：返回需要一起消除的格子集合 */
  function expand(clearSet, triggered) {
    const queue = [...clearSet];
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const i = queue.pop();
      const c = at(i);
      if (!c || !c.s) continue;
      if (triggered.has(i)) continue;
      triggered.add(i);
      const add = j => { if (j >= 0 && j < board.length && at(j) && !clearSet.has(j)) { clearSet.add(j); queue.push(j); } };
      if (c.s === SP.STRIPE_H) { const y = (i / COLS) | 0; for (let x = 0; x < COLS; x++) add(idx(x, y)); sfx('special'); }
      else if (c.s === SP.STRIPE_V) { const x = i % COLS; for (let y = 0; y < ROWS; y++) add(idx(x, y)); sfx('special'); }
      else if (c.s === SP.BOMB) {
        const x = i % COLS, y = (i / COLS) | 0;
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (xx >= 0 && xx < COLS && yy >= 0 && yy < ROWS) add(idx(xx, yy));
        sfx('special');
      } else if (c.s === SP.RAINBOW) {
        const target = c.k >= 0 ? c.k : rnd(kinds);
        for (let j = 0; j < board.length; j++) if (at(j) && at(j).k === target) add(j);
        sfx('levelup');
      }
    }
  }

  /* 消除一轮：返回是否消除了东西 */
  function clearOnce(swapInfo, combo) {
    const runs = findRuns();
    if (!runs.length) return false;
    const clearSet = new Set();
    const runCount = new Map();
    for (const r of runs) for (const i of r.cells) { clearSet.add(i); runCount.set(i, (runCount.get(i) || 0) + 1); }
    const makes = [];   // {i, k, s}
    for (const r of runs) {
      if (r.cells.length >= 5) {
        const i = pickCreateCell(r, swapInfo);
        makes.push({ i, k: r.k, s: SP.RAINBOW });
      } else if (r.cells.length === 4) {
        const i = pickCreateCell(r, swapInfo);
        makes.push({ i, k: r.k, s: r.dir === 'h' ? SP.STRIPE_V : SP.STRIPE_H });
      }
    }
    /* L / T 形：同一格同时在横竖两条线里 → 炸弹 */
    let bombAt = -1;
    for (const [i, n] of runCount) if (n >= 2 && bombAt < 0) bombAt = i;
    if (bombAt >= 0 && !makes.some(m => m.i === bombAt)) makes.push({ i: bombAt, k: at(bombAt)?.k ?? 0, s: SP.BOMB });
    /* 一次只保留一个特殊块，避免重叠打架 */
    const keep = makes.length ? [makes[makes.length - 1]] : [];

    const triggered = new Set();
    expand(clearSet, triggered);
    for (const m of keep) clearSet.delete(m.i);

    const mul = Math.min(5, 1 + combo * .5);
    let gained = 0;
    for (const i of clearSet) {
      const c = at(i);
      if (!c) continue;
      gained += BASE * (c.s ? 3 : 1);
      burst(i, c.k);
      board[i] = null;
    }
    if (keep.length) { const m = keep[0]; board[m.i] = { k: m.k, s: m.s }; gained += 120; sfx('coinBig'); }
    gained = Math.round(gained * mul);
    run.total += gained;
    run.levelScore += gained;
    if (combo > 0) { sfx('cascade', combo); addFloat(gained, combo); run.maxCombo = Math.max(run.maxCombo, combo); }
    else addFloat(gained, 0);
    sfx('match', combo + Math.min(6, clearSet.size / 3));
    dropAll();
    renderHud();
    return true;
  }

  function pickCreateCell(run_, swapInfo) {
    if (swapInfo) for (const i of swapInfo) if (run_.cells.includes(i)) return i;
    return run_.cells[Math.floor(run_.cells.length / 2)];
  }

  function dropAll() {
    for (let x = 0; x < COLS; x++) {
      let write = ROWS - 1;
      for (let y = ROWS - 1; y >= 0; y--) {
        const i = idx(x, y);
        if (board[i]) { if (write !== y) { board[idx(x, write)] = board[i]; board[i] = null; } write--; }
      }
      for (let y = write; y >= 0; y--) {
        const i = idx(x, y);
        board[i] = { k: rnd(kinds), s: SP.NONE };
        board[i].fall = (write - y + 1) * cell;
      }
    }
  }

  /* ---------------- 交互 ---------------- */
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / cell), y: Math.floor((e.clientY - r.top) / cell) };
  }
  function onDown(e) {
    if (busy || dead || !started) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { }
    const p = pos(e);
    if (p.x < 0 || p.x >= COLS || p.y < 0 || p.y >= ROWS) return;
    dragFrom = idx(p.x, p.y); dragDx = dragDy = 0;
    idleTimer = 0; hintCells = null;
  }
  function onMove(e) {
    if (dragFrom < 0) return;
    const p = pos(e);
    dragDx = p.x - (dragFrom % COLS); dragDy = p.y - ((dragFrom / COLS) | 0);
  }
  function onUp(e) {
    if (dragFrom < 0) return;
    const from = dragFrom, dx = dragDx, dy = dragDy;
    dragFrom = -1; dragDx = dragDy = 0;
    if (Math.abs(dx) + Math.abs(dy) >= 1) {
      const x = from % COLS, y = (from / COLS) | 0;
      const useX = Math.abs(dx) >= Math.abs(dy);
      const tx = clamp(x + (useX ? Math.sign(dx) : 0), 0, COLS - 1);
      const ty = clamp(y + (useX ? 0 : Math.sign(dy)), 0, ROWS - 1);
      const to = idx(tx, ty);
      if (to !== from) { sel = -1; trySwap(from, to); }
      return;
    }
    /* 点击模式：第一次点选中，第二次点相邻格交换 */
    if (sel >= 0 && sel !== from && adjacent(sel, from)) { const a = sel; sel = -1; trySwap(a, from); }
    else if (sel === from) sel = -1;
    else { sel = from; sfx('select'); }
  }
  const adjacent = (a, b) => {
    const ax = a % COLS, ay = (a / COLS) | 0, bx = b % COLS, by = (b / COLS) | 0;
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  };

  function trySwap(a, b) {
    if (busy || !adjacent(a, b)) return;
    busy = true;
    sfx('m3Swap');
    anim = { type: 'swap', a, b, t: 0, dur: .16 };
    [board[a], board[b]] = [board[b], board[a]];
    setTimeout(() => {
      const runs = findRuns();
      if (!runs.length && !(at(a)?.s === SP.RAINBOW || at(b)?.s === SP.RAINBOW)) {
        /* 无效交换：换回去 + 抖一下 */
        [board[a], board[b]] = [board[b], board[a]];
        anim = { type: 'swap', a: b, b: a, t: 0, dur: .16 };
        shake = 1; sfx('m3Invalid');
        setTimeout(() => { anim = null; busy = false; }, 170);
        return;
      }
      anim = null;
      run.moves--; renderHud();
      /* 彩虹块与普通块交换：直接把全屏同色清掉 */
      if (at(a)?.s === SP.RAINBOW || at(b)?.s === SP.RAINBOW) {
        const rb = at(a)?.s === SP.RAINBOW ? a : b;
        const other = rb === a ? b : a;
        board[rb] = { k: at(other)?.k ?? 0, s: SP.RAINBOW };
      }
      resolve([a, b], 0);
    }, 165);
  }

  function resolve(swapInfo, combo) {
    if (clearOnce(swapInfo, combo)) {
      setTimeout(() => resolve(null, combo + 1), 230);
    } else {
      /* 一轮结束：检查是否还有可走步 */
      if (!findMove()) { toast('没有可消除的组合，重排棋盘'); reshuffle(); }
      setTimeout(afterTurn, 120);
    }
  }

  function reshuffle() {
    const flat = board.filter(Boolean);
    for (let i = flat.length - 1; i > 0; i--) { const j = rnd(i + 1); [flat[i], flat[j]] = [flat[j], flat[i]]; }
    board = flat.slice(0, COLS * ROWS);
    if (findRuns().length || !findMove()) { newBoard(); }
  }

  function afterTurn() {
    busy = false;
    if (run.levelScore >= run.target) return levelUp();
    if (run.moves <= 0) return gameOver();
  }

  function levelUp() {
    const bonus = Math.max(0, run.moves) * 60;
    run.total += bonus;
    run.level++;
    run.levelScore = 0;
    run.target = TARGET(run.level);
    run.moves = LEVEL_MOVES;
    kinds = run.level >= 3 ? 6 : 5;
    sfx('levelup');
    renderHud();
    overlay.innerHTML = `<div class="m3card"><h2><span>🎉</span>第 ${run.level - 1} 关通过</h2>
      <p>剩余步数奖励 <b style="color:#ffd774">+${bonus}</b> 分</p>
      <div class="bigscore">${run.total}</div>
      <p>下一关目标 <b>${run.target}</b> 分 · ${LEVEL_MOVES} 步</p>
      <button class="m3btn" id="m3Next">进入第 ${run.level} 关</button></div>`;
    overlay.style.display = 'flex';
    overlay.querySelector('#m3Next').onclick = () => {
      overlay.style.display = 'none';
      board = []; newBoard(); busy = false; dead = false;
      hintCells = null;
      renderHud();
    };
  }

  async function gameOver() {
    dead = true; busy = true;
    sfx('lose');
    const best = JSON.parse(localStorage.getItem('qc_m3_best') || '{}');
    const isNew = run.total > (best.score || 0);
    if (isNew) localStorage.setItem('qc_m3_best', JSON.stringify({ score: run.total, level: run.level }));
    const stars = run.total >= run.target * 1.6 ? 3 : run.total >= run.target * .8 ? 2 : 1;
    overlay.innerHTML = `<div class="m3card">
      <h2><span>${run.level > 1 ? '🏁' : '💫'}</span>本局结束</h2>
      <p>到达第 <b style="color:#fff">${run.level}</b> 关 · 最高连击 ${run.maxCombo + 1}</p>
      <div class="bigscore">${run.total}</div>
      <div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
      ${isNew ? '<p style="color:#7ee7c7">🎊 打破你的最高分记录！</p>' : `<p>你的最高分 ${best.score || 0} 分</p>`}
      <p id="m3Coin" style="color:#ffd774">正在结算金币…</p>
      <button class="m3btn" id="m3Again">再玩一局</button>
      <button class="m3btn ghost" id="m3Back">返回大厅</button></div>`;
    overlay.style.display = 'flex';
    if (stars === 3) setTimeout(() => sfx('m3Star'), 420);
    overlay.querySelector('#m3Again').onclick = () => { overlay.style.display = 'none'; startRun(); };
    overlay.querySelector('#m3Back').onclick = () => close();
    try {
      const r = await window.QCM3?.report?.({
        game: 'match3', win: run.level > 1, score: run.total, level: run.level,
        combo: run.maxCombo, time: Math.round(run.seconds), matchId: run.matchId
      });
      const el = overlay.querySelector('#m3Coin');
      if (el) el.textContent = r?.coin ? `金币 +${r.coin}${r.record ? ' · 新纪录已上榜' : ''}` : '战绩已记录';
      if (r?.coin) sfx('coinBig');
    } catch (e) {
      const el = overlay.querySelector('#m3Coin');
      if (el) el.textContent = '战绩上报失败（离线也能继续玩）';
    }
  }

  function startRun() {
    run = { level: 1, total: 0, levelScore: 0, target: TARGET(1), moves: LEVEL_MOVES, maxCombo: 0, seconds: 0, matchId: mid() };
    kinds = 5; busy = false; dead = false; started = true;
    particles = []; floats = []; anim = null; sel = -1; hintCells = null; idleTimer = 0;
    newBoard(); renderHud();
    overlay.style.display = 'none';
    sfx('deal');
    if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(loop); }
  }

  /* ---------------- 渲染 ---------------- */
  function renderHud() {
    if (!run) return;
    hud.lv.textContent = '第 ' + run.level + ' 关';
    hud.score.textContent = run.total;
    hud.target.textContent = run.target;
    const pct = clamp(run.levelScore / run.target, 0, 1) * 100;
    hud.bar.style.width = pct.toFixed(1) + '%';
    hud.moves.textContent = '剩余 ' + Math.max(0, run.moves) + ' 步';
    hud.moves.classList.toggle('low', run.moves <= 5);
  }

  function burst(i, k) {
    const x = (i % COLS) * cell + cell / 2, y = ((i / COLS) | 0) * cell + cell / 2;
    for (let n = 0; n < 5; n++) particles.push({ x, y, vx: (Math.random() - .5) * 5, vy: (Math.random() - .5) * 5 - 1.5, life: 1, k });
  }
  function addFloat(v, combo) {
    floats.push({ x: COLS * cell / 2, y: (ROWS * cell) / 2, v, t: 0, combo });
  }
  function toast(t) {
    const el = host.querySelector('#m3Toast');
    el.textContent = t; el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 1100);
  }

  function drawGem(x, y, size, c, sp, alpha) {
    const cx = x + size / 2, cy = y + size / 2, r = size * .42;
    const cfg = KINDS[c.k] || KINDS[0];
    g.save();
    g.globalAlpha = alpha;
    if (shake > 0) g.translate((Math.random() - .5) * 5 * shake, (Math.random() - .5) * 5 * shake);
    const grad = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, cfg.a); grad.addColorStop(1, cfg.b);
    g.fillStyle = grad;
    g.strokeStyle = cfg.ring;
    g.lineWidth = Math.max(1, size * .035);

    const shape = c.s === SP.RAINBOW ? 'rainbow' : cfg.shape;
    g.beginPath();
    if (shape === 'circle') g.arc(cx, cy, r, 0, 6.2832);
    else if (shape === 'diamond') { g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); }
    else if (shape === 'hex') {
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 6; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath();
    } else if (shape === 'square') {
      const rr = r * .35;
      g.roundRect ? g.roundRect(cx - r * .88, cy - r * .88, r * 1.76, r * 1.76, rr) : g.rect(cx - r * .88, cy - r * .88, r * 1.76, r * 1.76);
    } else if (shape === 'drop') {
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r * .95, cy - r * .1, cx + r * .75, cy + r, cx, cy + r);
      g.bezierCurveTo(cx - r * .75, cy + r, cx - r * .95, cy - r * .1, cx, cy - r);
      g.closePath();
    } else if (shape === 'star') {
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? r * .45 : r; const a = Math.PI / 5 * i - Math.PI / 2;
        const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
    } else { /* rainbow：同心圆 */
      g.arc(cx, cy, r, 0, 6.2832);
      g.fillStyle = '#fff';
      g.fill();
      const cols = ['#ff6b6b', '#ffd166', '#7ee787', '#6cc6ff', '#b48cff'];
      cols.forEach((col, i) => {
        g.beginPath(); g.arc(cx, cy, r * (1 - i * .18), 0, 6.2832);
        g.fillStyle = col; g.fill();
      });
      g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.stroke();
      /* 高光 */
      g.beginPath(); g.arc(cx - r * .3, cy - r * .35, r * .22, 0, 6.2832);
      g.fillStyle = '#ffffffb0'; g.fill();
      g.restore();
      return;
    }
    g.fill(); g.stroke();
    /* 内高光 */
    g.beginPath();
    g.ellipse(cx - r * .28, cy - r * .32, r * .26, r * .18, -.6, 0, 6.2832);
    g.fillStyle = '#ffffff52'; g.fill();
    /* 特殊标记 */
    if (c.s === SP.STRIPE_H || c.s === SP.STRIPE_V) {
      g.strokeStyle = '#ffffffd0'; g.lineWidth = Math.max(1.5, size * .06);
      g.beginPath();
      if (c.s === SP.STRIPE_H) { g.moveTo(cx - r * .7, cy); g.lineTo(cx + r * .7, cy); }
      else { g.moveTo(cx, cy - r * .7); g.lineTo(cx, cy + r * .7); }
      g.stroke();
    } else if (c.s === SP.BOMB) {
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(size * .4)}px sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('✦', cx, cy + 1);
    }
    g.restore();
  }

  function draw(dt) {
    if (!g) return;
    const px = cell * COLS;
    g.clearRect(0, 0, px, px);
    /* 棋盘格背景 */
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      g.fillStyle = (x + y) % 2 ? '#ffffff0a' : '#ffffff05';
      g.fillRect(x * cell, y * cell, cell, cell);
    }
    if (hintCells) {
      g.fillStyle = '#ffd77430';
      for (const i of hintCells) g.fillRect((i % COLS) * cell, ((i / COLS) | 0) * cell, cell, cell);
    }
    if (sel >= 0) {
      g.strokeStyle = '#ffd774cc'; g.lineWidth = 3;
      g.strokeRect((sel % COLS) * cell + 2, ((sel / COLS) | 0) * cell + 2, cell - 4, cell - 4);
    }
    for (let i = 0; i < board.length; i++) {
      const c = board[i];
      if (!c) continue;
      let x = (i % COLS) * cell, y = ((i / COLS) | 0) * cell;
      if (anim && anim.type === 'swap') {
        const p = Math.min(1, anim.t / anim.dur), e = 1 - Math.pow(1 - p, 3);
        if (i === anim.a) { const tx = (anim.b % COLS) * cell, ty = ((anim.b / COLS) | 0) * cell; x += (tx - x) * e; y += (ty - y) * e; }
        else if (i === anim.b) { const tx = (anim.a % COLS) * cell, ty = ((anim.a / COLS) | 0) * cell; x += (tx - x) * e; y += (ty - y) * e; }
      }
      if (c.fall > 0) { y -= c.fall; c.fall = Math.max(0, c.fall - cell * dt * 9); }
      drawGem(x, y, cell, c, c.s, 1);
    }
    /* 粒子 */
    for (let n = particles.length - 1; n >= 0; n--) {
      const p = particles[n];
      p.x += p.vx; p.y += p.vy; p.vy += .35; p.life -= dt * 2.6;
      if (p.life <= 0) { particles.splice(n, 1); continue; }
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = KINDS[p.k]?.b || '#fff';
      g.beginPath(); g.arc(p.x, p.y, cell * .09 * p.life + 1, 0, 6.2832); g.fill();
      g.globalAlpha = 1;
    }
    /* 飘分 */
    for (let n = floats.length - 1; n >= 0; n--) {
      const f = floats[n]; f.t += dt;
      if (f.t > .9) { floats.splice(n, 1); continue; }
      g.globalAlpha = 1 - f.t / .9;
      g.fillStyle = f.combo ? '#ffd774' : '#ffffff';
      g.font = `bold ${Math.round(cell * (f.combo ? .6 : .5))}px sans-serif`;
      g.textAlign = 'center';
      g.fillText((f.combo ? `连击 ×${f.combo + 1}  ` : '') + '+' + f.v, COLS * cell / 2, (ROWS * cell) / 2 - f.t * 46);
      g.globalAlpha = 1;
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 4);
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (!started) return;
    if (anim) { anim.t += dt; if (anim.t >= anim.dur + .02) anim = null; }
    if (!busy && run && !dead) {
      run.seconds += dt;
      idleTimer += dt;
      if (idleTimer > 6 && !hintCells) { const m = findMove(); hintCells = m; idleTimer = 0; }
    }
    draw(dt);
  }

  function showPause() {
    if (!started) return;
    overlay.innerHTML = `<div class="m3card"><h2><span>⏸</span>暂停</h2>
      <p>第 ${run.level} 关 · ${run.total} 分 · 剩余 ${run.moves} 步</p>
      <button class="m3btn" id="m3Resume">继续游戏</button>
      <button class="m3btn ghost" id="m3Re">重开一局</button>
      <button class="m3btn ghost" id="m3Leave">返回大厅</button></div>`;
    overlay.style.display = 'flex';
    overlay.querySelector('#m3Resume').onclick = () => { overlay.style.display = 'none'; };
    overlay.querySelector('#m3Re').onclick = () => { overlay.style.display = 'none'; startRun(); };
    overlay.querySelector('#m3Leave').onclick = () => close();
  }

  function showStart() {
    const best = JSON.parse(localStorage.getItem('qc_m3_best') || '{}');
    overlay.innerHTML = `<div class="m3card"><h2><span>💎</span>宝石消消乐</h2>
      <p>交换相邻宝石，三个同色即消除。</p>
      <div class="m3rules">
        <div><b>四连</b> → 条纹块，清一整行/列</div>
        <div><b>L / T 形</b> → 炸弹，炸掉周围 9 格</div>
        <div><b>五连</b> → 彩虹块，清掉全屏同色</div>
        <div><b>连锁</b> → 每多一轮连消，分数倍率 +50%</div>
        <div>每关 ${LEVEL_MOVES} 步，达到目标分即过关，剩余步数换算奖励分。</div>
      </div>
      ${best.score ? `<p>你的最高分 <b style="color:#ffd774">${best.score}</b> · 最远第 ${best.level || 1} 关</p>` : ''}
      <button class="m3btn" id="m3Go">开始游戏</button>
      <button class="m3btn ghost" id="m3Out">返回大厅</button></div>`;
    overlay.style.display = 'flex';
    overlay.querySelector('#m3Go').onclick = () => startRun();
    overlay.querySelector('#m3Out').onclick = () => close();
  }

  /* ---------------- 开关 ---------------- */
  function open() {
    build();
    layout();
    host.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    started = false;
    board = []; newBoard();
    run = { level: 1, total: 0, levelScore: 0, target: TARGET(1), moves: LEVEL_MOVES, maxCombo: 0, seconds: 0, matchId: mid() };
    renderHud();
    showStart();
    if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(loop); }
    window.QCSFX?.unlock();
    window.scrollTo(0, 0);
  }

  function close() {
    if (!host) return;
    host.classList.remove('on');
    started = false; busy = true;
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    try { window.QCM3?.back?.(); } catch { }
  }

  /* hint/cells 供提示与自动化测试用，不改变游戏逻辑 */
  window.QCM3Game = {
    open, close,
    hint: () => findMove(),
    cells: () => board.map(c => c ? { k: c.k, s: c.s } : null),
    get state() { return run ? { ...run } : null; },
    get busy() { return busy; }
  };
})();
