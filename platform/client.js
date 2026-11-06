/* 千城游戏大厅 · 平台层 v3
   2026-10-23 重构：大厅六入口 / 独立分区页 / 斗地主牌桌 / 好友 / 联机房间目录 / 排行榜 / 装扮小铺 */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
/* 是否运行在安卓 APP 壳里（安卓端注入 window.QCAppBridge）；用浏览器打开时为 false */
const QC_IS_APP = (typeof window.QCAppBridge !== 'undefined') && window.QCAppBridge !== null;
/* APP 安装包版本号与下载地址（改版本时同步 android/build.sh 里的 VERSION） */
const QC_APP_VERSION = '1.0.0';
const QC_APP_URL = '/app/qcgame.apk';
/* 轻量统计：只记事件和访客 id，不采集个人信息 */
const QC_VID = (() => {
  try {
    let v = localStorage.getItem('qc_vid');
    if (!v) { v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('qc_vid', v); }
    return v;
  } catch { return 'anon'; }
})();
function track(event, extra = {}) {
  try {
    const body = JSON.stringify({ event, vid: QC_VID, ...extra });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch { }
}


const ART = {
  cat:      { name: '生气猫',     meta: '卡牌策略', desc: '算准每一张牌，别让猫咪炸毛', tags: ['单机', '好友联机'], cls: 'g-cat',      img: '/platform/assets/cat.webp' },
  qq:       { name: '球球大作战', meta: '休闲竞技', desc: '8 分钟，和队友一起吃遍全场', tags: ['单机', '组队'],     cls: 'g-qq',       img: '/platform/assets/qq.webp' },
  fish:     { name: '大鱼吃小鱼', meta: '休闲成长', desc: '吃小鱼长大，一路吃成大白鲨',   tags: ['单机'],           cls: 'g-fish',     img: '/platform/assets/fish.webp' },
  match3:   { name: '宝石消消乐', meta: '休闲益智', desc: '三连消除，连锁点亮整片宝石',   tags: ['单机', '闯关'],   cls: 'g-match3',   img: '' },
  landlord: { name: '斗地主',     meta: '棋牌对战', desc: '叫地主、配牌型、巧配合',     tags: ['单机', '三人'],     cls: 'g-landlord', img: '/platform/assets/landlord.webp' },
  gomoku:   { name: '五子棋',     meta: '棋牌对战', desc: '落子成五，抢先一步',         tags: ['单机', '双人'],     cls: 'g-gomoku',   img: '/platform/assets/gomoku.webp' },
  xiangqi:  { name: '中国象棋',   meta: '棋牌对战', desc: '楚河汉界，将帅对弈',         tags: ['单机', '双人'],     cls: 'g-xiangqi',  img: '/platform/assets/xiangqi.webp' },
  party:    { name: '聚会工具箱', meta: '线下聚会', desc: '骰子、转盘、飞行棋、真心话', tags: ['多人共享'],         cls: 'g-party',    img: '/platform/assets/party.webp' },
  ledger:   { name: '组队账本',   meta: '多人记账', desc: '共同记账，净额结算',         tags: ['多人共享'],         cls: 'g-ledger',   img: '/platform/assets/ledger.webp' }
};
const CASUAL = ['cat', 'qq', 'fish', 'match3', 'landlord', 'gomoku', 'xiangqi'];
const PARTY = ['party', 'ledger'];
const LEGACY = ['cat', 'qq'];
const RULES = {
  cat: '5 人卡牌对局，愤怒值满 100 爆炸出局。数字牌、转向、换牌、+10 轮流出，算准每一张牌，别让猫咪炸毛。',
  qq: '8 分钟贪吃球对战。小球快、大球慢，吃食物长大；单人混战或 5 队双人组队，队友的母球永远吃不到。',
  fish: '经典大鱼吃小鱼：吃掉比你小的鱼长大加分，躲开比你大的鱼；每类鱼有固定体型。进化模式共 18 级（小鱼苗Ⅰ→小丑鱼Ⅲ→黄鳍鱼Ⅲ→河豚Ⅲ→石斑鱼Ⅲ→大白鲨Ⅲ）逐级进化，通关计时上速通榜；无尽模式进化不会停（巨鲨Ⅰ/Ⅱ/Ⅲ…），海域越来越凶，3 条命耗尽按分数上分数榜。',
  landlord: '三人叫分，地主拿三张底牌；先出完手牌的一方获胜。支持单机 AI，也可以开房和好友三人同桌。',
  match3: '交换相邻宝石，三个同色即消除。四连生成条纹块（清一整行/列），L/T 形生成炸弹（炸周围 9 格），五连生成彩虹块（清掉全屏同色）。每关 24 步，达到目标分过关，剩余步数换算奖励分；连锁消除每多一轮倍率 +50%，一局从第 1 关一路打到你步数用尽。',
  gomoku: '15×15 棋盘，黑先，任意方向连成五子即获胜，无禁手。',
  xiangqi: '红先。马走日、象走田，士帅不出九宫；将帅不可照面，被将军时必须应将。',
  party: '同一桌人一起玩：骰子、转盘、飞行棋、真心话大冒险，房主操作公共局面。',
  ledger: '记录谁应付谁，自动计算净额和结算路径；只做记账，不接入任何支付渠道。'
};
const MAX = { match3: 1, fish: 4, gomoku: 2, xiangqi: 2, landlord: 3, party: 12, ledger: 20 };
/* 首页「休闲娱乐」卡片上的数量文案跟着 CASUAL 走，免得每次加游戏都忘记改 */
try {
  const t = document.querySelector('.tCasual .tileText small');
  if (t) t.innerHTML = CASUAL.length + ' 款小游戏<br>点开就能玩';
} catch (e) { }

const root = document.createElement('section');
root.id = 'qcApp';
root.setAttribute('aria-label', '千城游戏厅');
document.body.append(root);

let profile = null, room = null, page = '', socket = null, selected = null;
let cardsSelected = new Set(), ledger = null;
let backAction = null, roomFilter = 'all', shopTab = 'items', rankTab = 'rating';
let rankData = null, coinData = null;

let guestId = localStorage.getItem('qc_guest_id');
if (!guestId) {
  guestId = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('qc_guest_id', guestId);
}
const legacySnapshot = {
  coins, frames: userProfile.frames || [], frame: userProfile.frame || '',
  stats: userProfile.stats || {}, lastSign: userProfile.lastSign || localStorage.getItem('sqm_lastSign') || '',
  favorites: JSON.parse(localStorage.getItem('qc_library_favorites') || '[]')
};

/* ---------------- 网络与账号 ---------------- */
async function api(name, data = {}) {
  const res = await fetch('/api/platform/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: userProfile.token || '', ...data })
  });
  if (!res.ok) throw Error('网络请求失败，请稍后再试');
  const j = await res.json();
  if (!j.ok) throw Error(j.msg || '操作失败');
  return j;
}
function apply(p, token) {
  if (!p) return;
  profile = p;
  window.QCcosmetics = p.items || [];
  if (token) userProfile.token = token;
  Object.assign(userProfile, {
    id: p.id, nickname: p.nickname, avatar: p.avatar, stats: p.stats,
    frames: p.frames || [], frame: p.frame || '', lastSign: p.lastSign || '', guest: !!p.guest
  });
  coins = p.coins || 0;
  saveCoins(); saveProfileLocal(); renderCoins(); renderHome();
  $('homeNick')?.classList.toggle('qc-gold', (p.items || []).includes('name-gold'));
  const sc = document.getElementById('qcShieldCount'), sn = document.getElementById('qcShieldNum');
  if (sc) sc.textContent = p.shields ?? 0;
  if (sn) sn.textContent = p.shields ?? 0;
  if (p.favorites) {
    localStorage.setItem('qc_library_favorites', JSON.stringify(p.favorites));
    window.dispatchEvent(new CustomEvent('qc-favorites', { detail: p.favorites }));
  }
  refreshLobby();
}
function toast(msg) {
  window.QCSFX?.play('notif');
  document.querySelector('.qc-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'qc-toast'; el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}
async function safe(fn) { try { await fn(); } catch (e) { toast(e.message); } }
async function ensure() {
  if (profile && userProfile.token) return profile;
  if (userProfile.token) {
    try { const j = await api('me'); apply(j.profile); connect(); return profile; }
    catch { userProfile.token = ''; }
  }
  const j = await api('guest', { guestId, nickname: userProfile.nickname || '游客', avatar: userProfile.avatar, legacy: legacySnapshot });
  apply(j.profile, j.token); connect();
  return profile;
}
function connect() {
  if (socket && socket.readyState < 2) return;
  socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  socket.onopen = () => socket.send(JSON.stringify({ t: 'platformAuth', token: userProfile.token }));
  socket.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t !== 'platform') return;
    if (m.event === 'profile') apply({ ...m.profile, guest: profile?.guest });
    if (m.event === 'room' && room?.id === m.room.id) {
      window.__fishSnaps = (window.__fishSnaps || 0) + 1;
      room = m.room;
      if (page === 'room') renderRoom();
    }
    if (['friends', 'invite'].includes(m.event)) {
      toast('收到新的好友消息');
      if (page === 'friends') showFriends();
      refreshLobby();
    }
  };
  socket.onclose = () => { socket = null; };
}
setInterval(() => {
  if (profile && userProfile.token) { connect(); api('heartbeat').catch(() => {}); }
}, 15000);

/* ---------------- 页面框架 ---------------- */
function shell(title, body, actions = '', sub = '') {
  const prevPage = root.dataset.page || '';
  root.style.display = 'block';
  root.dataset.game = (page === 'room' && room) ? room.game : '';
  root.innerHTML = `<div class="qc-wrap">
    <header class="qc-top">
      <button class="qc-back" id="qcBack" type="button" aria-label="返回">‹</button>
      <div class="qc-head"><h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <div class="qc-actions">${actions}</div>
    </header>
    <div class="qc-page">${body}</div>
  </div>`;
  root.dataset.page = page;
  if (prevPage !== page) {
    root.scrollTop = 0;
    requestAnimationFrame(() => { if (root.dataset.page === page) root.scrollTop = 0; });
  }
  $('qcBack').onclick = () => safe(back);
  window.QQGame?.setActive(false);
}
function back() {
  if (page === 'room' && room) return leaveRoom();
  if (typeof backAction === 'function') return backAction();
  return hide();
}
function hide() {
  root.style.display = 'none';
  root.dataset.game = '';
  root.dataset.page = '';
  page = ''; backAction = null;
  selected = null;
  showPage('home');
  refreshLobby();
}
/* 安卓 APP 的系统返回键：先回大厅，返回 false 表示已在大厅（交给原生"双击退出"） */
window.qcAppBack = function () {
  try {
    if (page) { back(); return true; }
    const hp = document.getElementById('homePage');
    if (hp && hp.style.display === 'none') { if (window.showPage) window.showPage('home'); return true; }
    return false;
  } catch (e) { return false; }
};
function refreshLobby() {
  api('rooms').then(j => {
    const n = (j.rooms || []).filter(r => !r.ai).length + (j.legacy || []).length;
    const el = $('lobbyRoomCount');
    if (el) el.textContent = n ? `${n} 个房间在线` : '现在还没有房间，去开一间';
    const hr = $('heroRooms');
    if (hr) hr.textContent = n ? `${n} 个房间在线` : '还没有房间，等你开一间';
  }).catch(() => {});
  if (profile && userProfile.token) {
    api('friends').then(j => {
      const el = $('lobbyFriendCount');
      if (el) { el.hidden = false; el.textContent = `${j.friends.length} 位好友`; }
      const hf = $('heroFriends');
      if (hf) { hf.hidden = false; hf.textContent = `${j.friends.length} 位好友`; }
    }).catch(() => {});
  }
}
async function openSection(name) {
  try {
    if (['friends', 'rooms', 'me', 'feedback', 'shop', 'rank', 'tasks', 'history'].includes(name)) await ensure();
    switch (name) {
      case 'casual': return showCasual();
      case 'party': return showParty();
      case 'friends': return showFriends();
      case 'rooms': return showRooms();
      case 'feedback': return showFeedback();
      case 'announcements': return showAnnouncements();
      case 'me': return showMe();
      case 'rank': return showRank();
      case 'shop': return showShop();
      case 'tasks': return showTasks();
      case 'history': return showHistory();
      default: return hide();
    }
  } catch (e) { toast(e.message); }
}

/* ---------------- 游戏卡片 ---------------- */
function gameArt(id, big = false) {
  const a = ART[id];
  if (a.img) return `<img class="gc-img${big ? ' big' : ''}" src="${a.img}" alt="">`;
  if (id === 'qq') return `<span class="gc-orb o1"></span><span class="gc-orb o2"></span><span class="gc-orb o3"></span><span class="gc-ring"></span>`;
  if (id === 'gomoku') return `<span class="gc-grid">${'<i></i>'.repeat(12)}</span><span class="gc-stone b"></span><span class="gc-stone w"></span><span class="gc-stone b2"></span>`;
  if (id === 'xiangqi') return `<span class="gc-token">帅</span><span class="gc-token small">将</span><span class="gc-grid xq"></span>`;
  if (id === 'landlord') return `<span class="gc-pcard">A</span><span class="gc-pcard red">2</span><span class="gc-pcard back"></span>`;
  if (id === 'match3') return `<span class="gc-gem g1"></span><span class="gc-gem g2"></span><span class="gc-gem g3"></span>`;
  return `<span class="gc-emoji">${id === 'ledger' ? '📒' : '🎲'}</span>`;
}
function gameCard(id) {
  const a = ART[id];
  return `<button class="qc-gcard ${a.cls}" data-open-game="${id}" type="button">
    <span class="gc-scrim"></span>
    <span class="gc-art">${gameArt(id)}</span>
    <span class="gc-body">
      <span class="gc-meta">${a.meta}</span>
      <b class="gc-name">${a.name}</b>
      <small class="gc-desc">${a.desc}</small>
      <span class="gc-tags">${a.tags.map(t => `<i>${t}</i>`).join('')}</span>
    </span>
  </button>`;
}
function bindGameCards() {
  for (const b of root.querySelectorAll('[data-open-game]')) {
    b.onclick = () => safe(() => showGame(b.dataset.openGame));
  }
}

/* ---------------- 休闲娱乐 / 聚会账本 ---------------- */
function showCasual() {
  page = 'casual'; backAction = hide;
  shell('休闲娱乐', `
    <div class="qc-lead"><b>${CASUAL.length} 款小游戏</b><span>点开就有完整的游戏页，单机直接玩，联机开房约朋友。</span></div>
    <div class="qc-ggrid">${CASUAL.map(gameCard).join('')}
      <div class="qc-gcard g-soon"><span class="soonIcon">🚧</span><span class="soonText"><b>开发中...</b><small>下一款游戏正在路上</small></span><span class="soonHint">想玩什么？去「意见反馈」告诉我们</span></div>
    </div>`, '', '挑一款，现在开玩');
  bindGameCards();
}
function showParty() {
  page = 'party'; backAction = hide;
  shell('聚会 / 账本', `
    <div class="qc-lead"><b>一群人，一桌事</b><span>线下聚会的小工具，和朋友一起记账的账本。</span></div>
    <div class="qc-ggrid">${PARTY.map(gameCard).join('')}
      <div class="qc-gcard g-soon"><span class="soonIcon">🚧</span><span class="soonText"><b>开发中...</b><small>更多聚会玩法正在路上</small></span><span class="soonHint">想玩什么？去「意见反馈」告诉我们</span></div>
    </div>`, '', '一起玩，也算得清');
  bindGameCards();
}

/* ---------------- 热门小游戏（链接到原作者页面） ---------------- */
const ARCADE = [
  ['合成大奶蛙','十二月的狼头',699000,'https://yhsome.github.io/BigNaiWa/v1/','🐸','益智','bignaiwa-6842bd8f'],
  ['奶蛙神跑','网友作品',449000,'https://naiwa.me','🏃','跑酷','shenpao-b6f09eb4'],
  ['奶蛙羽毛球','网友作品',273000,'https://www.bilibili.com/toy/naiwa-badminton/index.html','🏸','体育','badminton-670db478'],
  ['奶蛙快跑','网友作品',252000,'https://e.233ly.com/1ABrH3','🏁','跑酷','kuaipao-81820335'],
  ['奶蛙放屁','二奶',163000,'https://naiwa-fart.pages.dev/','💨','休闲','fart-3c0de11a'],
  ['奶蛙jump','网友作品',148000,'https://naiwai-jump.github.io/','⬆️','跑酷','njump-fc87c08a'],
  ['奶蛙跳一跳','光影集',137000,'https://naiba-jump.pages.dev/','🦘','跑酷','tyt-72cb528b'],
  ['奶蛙的小窝','网友作品',127000,'https://naiwaxiaowu.pages.dev/','🏠','经营','xiaowu-1ee8e93c'],
  ['召唤神龙','鱼戏荷',120000,'https://naiwa.games/','🐉','休闲','shenlong-452d32f1'],
  ['奶斗罗','网友作品',119000,'https://nai-dou-luo.pages.dev/','🌀','动作','douluo-52a09bb9'],
  ['奶蛙五子棋','网友作品',118000,'https://wudibaolongzhanshi1234.github.io/1335689.giyhub.io/','⚫','棋牌','wuziqi-4448549f'],
  ['奶蛙消消乐','网友作品',118000,'https://chenckx0614.github.io/naiwaxxl/','💎','益智','xxl-5d3adaa0'],
  ['奶蛙街舞','念因',97000,'https://nailong-dance.pages.dev','🕺','音乐','dance-7812a8b8'],
  ['奶蛙一跳','Sn',86000,'https://naiwa-jump.pages.dev/','🪂','跑酷','jump-cff9b51d'],
  ['奶了个蛙','网友作品',86000,'https://junjunya2020.github.io/nailegewa','🧩','益智','nailegewa-2d7c51f8'],
  ['奶蛙2048超级版','网友作品',81000,'https://game.0z.hk/game/2048/','🔟','益智','n2048-c0aec0b7'],
  ['奶蛙工厂','网友作品',80000,'https://66970010-boop.github.io/frog-miner','🏭','经营','factory-506f7bb8'],
  ['奶蛙贪吃蛙','网友作品',78000,'https://milkyfrogs.toolsbox.vip/','🍽️','休闲','snake-5af57c95'],
  ['旅行奶蛙','网友作品',76000,'https://www.bilibili.com/toy/TravelMilkyFrog/index.html','✈️','休闲','travel-f03a164c'],
  ['奶蛙奶茶铺','网友作品',73000,'https://naiwanaichadian.pages.dev/','🧋','经营','naicha-00939e7c'],
  ['奶蛙爱洗澡','kingtrain',55000,'https://milkfrog-bath.pages.dev/','🛁','经营','bath-f8951ee5'],
  ['奶蛙鼓鼓碰','网友作品',50000,'https://naiwa-gugupeng.pages.dev/','🥁','音乐','drum-00298d84'],
  ['合成小奶蛙','十二月的狼头',45000,'https://yhsome.github.io/SmallNaiWa/','🐣','益智','smallnaiwa-6784681f'],
  ['抓奶蛙','龙井茉莉',45000,'https://machinelearningexpertqihang.github.io/zhua-nai-wa-/','🫳','休闲','zhua-8e6124f2'],
  ['奶蛙2048','十二月的狼头',41000,'https://yhsome.github.io/Nai2048/','🔢','益智','nai2048-425bbec5'],
  ['奶蛙颜色大挑战','网友作品',39000,'https://milkyfrog.toolsbox.vip/','🎨','休闲','colors-1954f53c'],
  ['奶蛙踢馆','胆子肥嘟嘟',34000,'https://night-market-rumble-54328.app.workbuddy.host/','🥋','动作','tiguan-10ddd09b'],
  ['奶蛙挠痒','Elio',32000,'https://naiwa.bocchi.website/','🪶','休闲','naoyang-b5a4603b'],
  ['俄罗斯奶块','EIAAN',30000,'https://milkcubebycyanchan1eiann.netlify.app/','🟦','益智','naikuai-e172b2fa'],
  ['奶蛙的奶块雨','光影集',25000,'https://naiwa-milk-rain.pages.dev/','🌧️','动作','milkrain-39b11ae5'],
  ['奶蛙打砖块','nnn',24000,'https://niuniu513-ask.github.io/milky-breakout/?v=1deb2eb','🎯','动作','breakout-0cc61239'],
  ['奶蛙推奶块','EIAAN',17000,'https://sparkly-macaron-5c86c7.netlify.app/','🧱','益智','naidan-f85cfae5'],
  ['勇者奶蛙传','雀石不诗人',7703,'https://e.233ly.com/yDkGpm','⚔️','动作','yongzhe-eb5776b8'],
  ['奶国物语','雀石不诗人',7725,'https://e.233ly.com/bn1yRe','🏰','经营','naiguo-27c1bcf9'],
  ['奶蛙雷霆小队','雀石不诗人',6662,'https://e.233ly.com/v65Ihd','⚡','动作','leiting-9ccdb00e']
].map(([n, a, p, u, e, c, img]) => ({ n, a, p, u, e, c, img: 'https://milkyfrog.com/assets/games/' + img + '.webp' }));
const ARCADE_CATS = ['全部', '热门', '益智', '跑酷', '经营', '动作', '棋牌', '音乐', '体育', '休闲'];
const ARCADE_COLOR = {
  益智: ['#ffe1b8', '#ffb265'], 跑酷: ['#cfe7ff', '#78b7ee'], 经营: ['#cdf4e3', '#63cfa8'],
  棋牌: ['#e2d8ff', '#a98bf5'], 动作: ['#ffd4d1', '#ff8f88'], 音乐: ['#ffd9ec', '#f28ab8'],
  体育: ['#dff0c9', '#94c96f'], 休闲: ['#dbe6ff', '#8fa8e8'],
  策略: ['#ffd9b8', '#e8905a']
};
let arcadeCat = '全部', arcadeQuery = '';
function fmtPlays(n) {
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n);
}
function tabbar(active) {
  return `<nav class="qc-tabbar" aria-label="主导航">
    <button type="button" data-tab-go="home" class="${active === 'home' ? 'on' : ''}">首页</button>
    <button type="button" class="tabMid ${active === 'arcade' ? 'on' : ''}" data-tab-go="arcade" aria-label="热门小游戏"><img class="tabMascot" src="/platform/assets/mascot-pad.webp" alt="" width="30" height="41"></button>
    <button type="button" data-tab-go="me" class="${active === 'me' ? 'on' : ''}">我的</button>
  </nav>`;
}
function bindTabbar() {
  for (const b of root.querySelectorAll('[data-tab-go]')) {
    b.onclick = () => safe(() => {
      const k = b.dataset.tabGo;
      if (k === 'home') return hide();
      if (k === 'me') return page === 'me' ? root.scrollTo({ top: 0, behavior: 'smooth' }) : showMe();
      return page === 'arcade' ? root.scrollTo({ top: 0, behavior: 'smooth' }) : showArcade();
    });
  }
}
function showArcade() {
  page = 'arcade'; backAction = hide;
  shell('热门小游戏', `
    <div class="qc-lead qc-arcadeLead"><div><b>奶蛙同人小游戏合集</b><span>35 款奶家人做的网页小游戏，点开就能玩。</span></div><img class="padArt" src="/platform/assets/pad.webp" alt=""></div>
    <div class="qc-arcadeSearch"><input id="qcArcadeQ" class="qc-input" placeholder="搜索游戏名或作者"></div>
    <div class="qc-chips qc-arcadeCats" id="qcArcadeCats">${ARCADE_CATS.map(c => `<button class="qc-chip ${arcadeCat === c ? 'on' : ''}" data-cat="${c}" type="button">${c}</button>`).join('')}</div>
    <div class="qc-arcadeMeta"><span id="qcArcadeCount"></span><span>全部作品跳转原作者页面</span></div>
    <div class="qc-arcadeGrid" id="qcArcadeGrid"></div>
    <section class="qc-panel qc-credit">
      <h2>免责声明 · 鸣谢</h2>
      <p>以上小游戏均由「奶家人」自发制作，版权归各原作者所有；封面图取自各游戏/收录页，仅用于展示。本页只做<strong>收录与跳转</strong>，不存储、不修改、也不代理任何游戏内容；点击后会打开作者自己的页面。</p>
      <p>鸣谢奶蛙 Milky Frog 与 <a href="https://milkyfrog.com/games" target="_blank" rel="noopener noreferrer">milkyfrog.com</a> 的整理，也谢谢十二月的狼头、光影集、EIAAN、雀石不诗人、念因、Sn、kingtrain、胆子肥嘟嘟、Elio、二奶、鱼戏荷、龙井茉莉、nnn 以及所有署名为「网友作品」的作者。</p>
      <p>如果你是作者，希望调整署名或下架，请通过「意见反馈」联系我们，会尽快处理。</p>
    </section>
    ${tabbar('arcade')}`, '', '收录与跳转 · 版权归原作者');
  root.querySelector('.qc-wrap').classList.add('has-tabbar');
  bindTabbar();
  const grid = $('qcArcadeGrid'), count = $('qcArcadeCount');
  const render = () => {
    const q = arcadeQuery.trim().toLowerCase();
    const list = ARCADE.filter(g => {
      const okCat = arcadeCat === '全部' || (arcadeCat === '热门' ? g.p >= 100000 : g.c === arcadeCat);
      const okQ = !q || g.n.toLowerCase().includes(q) || g.a.toLowerCase().includes(q);
      return okCat && okQ;
    }).sort((a, b) => b.p - a.p);
    count.textContent = `${list.length} 款`;
    grid.innerHTML = list.length ? list.map(g => {
      const [c1, c2] = ARCADE_COLOR[g.c] || ARCADE_COLOR['休闲'];
      return `<a class="qc-acard" href="${g.u}" target="_blank" rel="noopener noreferrer nofollow">
        <span class="qaCover" style="background:linear-gradient(145deg,${c1},${c2})"><span class="qaFallback">${g.e}</span><img src="${g.img}" alt="${g.n} 封面" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><span class="qaPlays">${fmtPlays(g.p)}</span></span>
        <span class="qaBody"><b>${g.n}</b><small>${g.a}</small></span>
      </a>`;
    }).join('') : `<div class="qc-empty small"><span>🔍</span><b>没有找到</b><p>换个关键词，或点「全部」看看。</p></div>`;
  };
  $('qcArcadeQ').addEventListener('input', e => { arcadeQuery = e.target.value; render(); });
  for (const b of root.querySelectorAll('[data-cat]')) {
    b.onclick = () => { arcadeCat = b.dataset.cat; for (const x of root.querySelectorAll('[data-cat]')) x.classList.toggle('on', x === b); render(); };
  }
  render();
}

/* ---------------- 游戏详情 ---------------- */
const MODES = {
  cat: [
    { key: 'solo', icon: '😺', name: '单机模式', desc: '打 4 个 AI 猫猫，节奏轻快', tags: ['5 人局', '普通难度'], cls: 'm-warm' },
    { key: 'challenge', icon: '🔥', name: '挑战模式', desc: '4 个宗师算牌 AI，一步算错就炸', tags: ['高难度', '高额奖惩'], cls: 'm-red' },
    { key: 'net', icon: '🌐', name: '联机好友房', desc: '建房邀请好友，缺人可补 AI', tags: ['房间码邀请', '可补 AI'], cls: 'm-purple' }
  ],
  qq: [
    { key: 'solo', icon: '🏃', name: '经典单机', desc: '独自开局，吃遍全场', tags: ['8 分钟', '15 AI 混战'], cls: 'm-blue' },
    { key: 'team', icon: '🤝', name: '组队赛 · 单机', desc: '和 AI 队友并肩作战', tags: ['5 队 × 2 人', '队伍总分'], cls: 'm-green' },
    { key: 'net', icon: '🏠', name: '联机组队房', desc: '开房间邀请好友一起混战', tags: ['房间码邀请', '可补 AI'], cls: 'm-purple' }
  ]
};
function modePanel(id) {
  const list = MODES[id] || [];
  return `<section class="qc-panel qc-full">
    <h2>选择玩法</h2>
    <div class="qc-modelist">${list.map(m => `<button class="qc-mode ${m.cls}" data-mode="${m.key}" type="button">
      <span class="qc-modeIcon">${m.icon}</span>
      <span class="qc-modeBody"><b>${m.name}</b><small>${m.desc}</small><span class="qc-modeTags">${m.tags.map(t => `<i>${t}</i>`).join('')}</span></span>
      <span class="qc-modeGo">›</span>
    </button>`).join('')}</div>
    <p class="qc-modeHint">${id === 'qq' ? '单机与组队赛由 AI 陪练、战绩照常记录；联机房间会出现在联机大厅。' : '单机与挑战由 AI 陪练、战绩照常记录；联机房间会出现在联机大厅。'}</p>
  </section>`;
}
async function loadM3Rank() {
  const host = $('qcM3Rank');
  if (!host) return;
  try {
    await ensure();
    const j = await api('solo/rank', { game: 'match3' });
    const top = (j.score || []).slice(0, 5);
    const me = j.me || {};
    host.innerHTML = `<div class="m3rankHead"><b>🏆 最高分榜</b><small>我的最高 ${me.score || 0} 分</small></div>` +
      (top.length
        ? top.map((r, i) => `<div class="m3rankRow"><i>${i + 1}</i><span>${esc(r.avatar || '🙂')}</span><b>${esc(r.nickname || '玩家')}</b><em>${r.score}</em></div>`).join('')
        : '<p class="qc-muted">还没有人上榜，来当第一个。</p>');
  } catch (e) {
    host.innerHTML = '<p class="qc-muted">排行榜暂时读不到，先玩一局吧。</p>';
  }
}
function showGame(id) {
  const a = ART[id];
  if (!a) return;
  track('game_open', { game: id });
  page = 'game'; backAction = PARTY.includes(id) ? showParty : showCasual;
  const fishSolo = id === 'fish';
  const m3Solo = id === 'match3';
  const solo = PARTY.includes(id) || fishSolo || m3Solo ? '' : (id === 'landlord'
    ? `<button class="qc-btn primary wide" id="qcPlayDizhu" type="button">🎴 单人牌桌 <small>完整牌桌页面 · 叫分 / 提示 / 托管</small></button>
       <p class="qc-muted">独立牌桌页面，有发牌、出牌、炸弹音效与叫分倍率。战绩和金币会自动记到你的账号上。</p>`
    : `<button class="qc-btn primary wide" id="qcSolo">单机挑战 <small>和 AI 玩</small></button>`);
  const online = `<div class="qc-field"><label>房间可见性</label><select id="qcVisibility" class="qc-input"><option value="public">公开 · 出现在联机大厅</option><option value="private">私密 · 凭房间码加入</option></select></div>
       <button class="qc-btn wide" id="qcCreateOnline">创建好友房间</button>
       <div class="qc-codeRow"><input id="qcJoinCode" class="qc-input" inputmode="numeric" maxlength="6" placeholder="输入 6 位房间码"><button class="qc-btn" id="qcJoinCodeBtn">加入</button></div>`;
  const fishPanel = `<div class="fishEntries">
      <button class="qc-entryCard" id="qcFishItems" type="button"><span class="ecIcon">🎒</span><b>道具</b><small>🛡️ 护盾 × <span id="qcShieldCount">${profile?.shields ?? 0}</span></small></button>
      <button class="qc-entryCard" id="qcFishRankEntry" type="button"><span class="ecIcon">🏆</span><b>排行榜</b><small>⚡ 速通 · 分数</small></button>
    </div>
    <section class="qc-panel"><h2>选择模式</h2>
      <button class="qc-btn primary wide" id="qcPlayFish">🧬 进化模式 <small>18 级进化：小鱼苗Ⅰ → 大白鲨Ⅲ · 通关计时上速通榜</small></button>
      <button class="qc-btn wide" id="qcPlayEndless" style="margin-top:9px">♾️ 无尽模式 <small>巨鲨军备竞赛 · 3 命耗尽结算冲分数榜</small></button>
      <button class="qc-btn wide" id="qcPlayFishMP" style="margin-top:9px">🌐 联机竞速 <small>2~4 人同海抢鱼 · 先到大白鲨Ⅲ 者胜</small></button>
      <div class="qc-field" style="margin-top:10px"><label>联机房间可见性</label><select id="qcVisibility" class="qc-input"><option value="public">公开 · 出现在联机大厅</option><option value="private">私密 · 凭房间码加入</option></select></div>
      <div class="qc-codeRow"><input id="qcJoinCode" class="qc-input" inputmode="numeric" maxlength="6" placeholder="输入 6 位房间码加入联机"><button class="qc-btn" id="qcJoinCodeBtn">加入</button></div>
      <p class="qc-muted">手机按住屏幕出现轮盘拖动转向（暂停菜单可换成跟随手指），电脑鼠标跟随，也支持 WASD / 方向键；右上角可暂停。局内会随机掉落金币，碰到就赚！联机竞速中护盾/复活/金币掉落不生效。</p></section>
    <div id="qcFishSub" hidden>
      <section class="qc-panel" id="qcFishItemsPanel" hidden><h2>🎒 道具</h2>
        <div class="qc-itemRow"><span class="qc-itemIcon">🛡️</span>
          <div class="qc-itemInfo"><b>护盾</b><small>进化模式专属：局内点击左上角护盾按钮激活，8 秒内撞到大鱼不扣命。每局限用 1 次。</small></div>
          <div class="qc-itemOps"><span class="qc-itemCount">× <b id="qcShieldNum">${profile?.shields ?? 0}</b></span><button class="qc-btn primary" id="qcBuyShield" type="button">50 金币兑换</button></div>
        </div>
        <p class="qc-muted">🪙 局内每 12 秒左右随机掉落一枚金币，碰到即得（不限鱼的大小），结算时每枚 +5 金币自动入账；一局最多掉落 20 枚。3 条命耗尽时还有一次花 50 金币原地复活的机会（5 秒无敌，进度保留）。</p>
        <button class="qc-btn" id="qcFishBack1" type="button">‹ 返回</button>
      </section>
      <section class="qc-panel" id="qcFishRankPanel" hidden><h2>🏆 排行榜</h2>
        <div class="qc-menu"><button id="qcRankSpeed" type="button">⚡ 速通榜</button><button id="qcRankScore" type="button">🏆 分数榜</button></div>
        <div id="qcFishRank">加载中…</div>
        <button class="qc-btn" id="qcFishBack2" type="button">‹ 返回</button>
      </section>
    </div>`;
  const m3Panel = `<section class="qc-panel">
      <h2>开始游戏</h2>
      <button class="qc-btn primary wide" id="qcPlayM3" type="button">💎 开始挑战 <small>每关 24 步 · 通关自动进下一关</small></button>
      <p class="qc-muted">纯单机，随时开局不用等对手。分数实时同步到排行榜，破纪录还有额外金币。</p>
      <div id="qcM3Rank" class="qc-m3rank">正在读取排行榜…</div>
    </section>`;
  shell(a.name, `
    <section class="qc-hero ${a.cls}">
      <div class="hero-art">${gameArt(id, true)}</div>
      <div class="hero-copy"><span class="qc-chip">${a.meta}</span><h2>${a.name}</h2><p>${a.desc}</p><div class="gc-tags">${a.tags.map(t => `<i>${t}</i>`).join('')}</div></div>
    </section>
    ${LEGACY.includes(id) ? modePanel(id) : fishSolo ? fishPanel : m3Solo ? m3Panel : `<div class="qc-cols">
      ${PARTY.includes(id) ? '' : `<section class="qc-panel"><h2>开始游戏</h2>${solo}<p class="qc-muted">单机模式由 AI 陪练，战绩照常记录。</p></section>`}
      <section class="qc-panel ${PARTY.includes(id) ? 'qc-full' : ''}"><h2>${PARTY.includes(id) ? '开一桌' : '和朋友一起'}</h2>${online}</section>
    </div>`}
    <section class="qc-panel"><h2>玩法说明</h2><p class="qc-rules">${RULES[id]}</p></section>`,
    `<span class="qc-chip">${a.meta}</span>`, a.desc);
  if (LEGACY.includes(id)) {
    const L = window.LegacyEntry || {};
    for (const b of root.querySelectorAll('[data-mode]')) {
      b.onclick = () => safe(async () => {
        const k = b.dataset.mode;
        await ensure();
        hide();
        if (id === 'cat') {
          if (k === 'solo') L.catSolo?.();
          else if (k === 'challenge') L.catChallenge?.();
          else L.catNet?.();
        } else {
          if (k === 'solo') L.qqSolo?.();
          else if (k === 'team') L.qqTeam?.();
          else L.qqNet?.();
        }
      });
    }
    return;
  }
  $('qcSolo') && ($('qcSolo').onclick = () => safe(() => createRoom(id, true)));
  $('qcPlayDizhu') && ($('qcPlayDizhu').onclick = () => safe(async () => { await ensure(); openDizhu(); }));
  $('qcPlayM3') && ($('qcPlayM3').onclick = () => safe(async () => { await ensure(); window.QCSFX?.unlock(); window.QCM3Game?.open(); }));
  if (m3Solo) safe(loadM3Rank);
  $('qcPlayFish') && ($('qcPlayFish').onclick = () => safe(async () => {
    await ensure();
    window.QCFishGame?.open('evolution');
  }));
  $('qcPlayEndless') && ($('qcPlayEndless').onclick = () => safe(async () => {
    await ensure();
    window.QCFishGame?.open('endless');
  }));
  $('qcPlayFishMP') && ($('qcPlayFishMP').onclick = () => safe(() => createRoom('fish', false, $('qcVisibility').value)));
  const fishRankTab = { tab: 'speed' };
  const loadFishRank = async tab => {
    fishRankTab.tab = tab;
    $('qcRankSpeed')?.classList.toggle('on', tab === 'speed');
    $('qcRankScore')?.classList.toggle('on', tab === 'score');
    const host = $('qcFishRank');
    if (!host) return;
    try {
      const j = await api('solo/rank', { game: 'fish' });
      const fmtT = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      const myId = profile?.id;
      const rows = tab === 'speed' ? j.speed : j.score;
      let html = rows.length ? rows.map((r, i) => `<div class="qc-frow${r.id === myId ? ' qc-meRow' : ''}">
        <b class="qc-rankNo${i < 3 ? ' top' + (i + 1) : ''}">${i + 1}</b>
        <span class="qc-av">${esc(r.avatar || '🙂')}</span>
        <div class="qc-fmeta"><b>${esc(r.nickname)}</b><small>${esc(r.id)}</small></div>
        <span class="qc-rankVal">${tab === 'speed' ? fmtT(r.time) : esc(r.score) + ' 分'}</span></div>`).join('')
        : '<p class="qc-muted">还没有人上榜，快来当第一条鲨鱼！</p>';
      const me = tab === 'speed' ? j.me?.speed : j.me?.score;
      if (me) html += `<p class="qc-muted" style="margin-top:8px">我的最佳：${tab === 'speed' ? fmtT(me) : me + ' 分'}</p>`;
      host.innerHTML = html;
    } catch (e) { host.innerHTML = '<p class="qc-muted">排行榜加载失败，请稍后再试</p>'; }
  };
  if (fishSolo) {
    const fishSub = () => $('qcFishSub');
    const showFishSub = which => {
      const sub = fishSub();
      if (!sub) return;
      sub.hidden = false;
      $('qcFishItemsPanel').hidden = which !== 'items';
      $('qcFishRankPanel').hidden = which !== 'rank';
      if (which === 'rank') safe(async () => { await ensure(); await loadFishRank(fishRankTab.tab || 'speed'); });
      sub.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const hideFishSub = () => { const sub = fishSub(); if (sub) sub.hidden = true; };
    $('qcFishItems') && ($('qcFishItems').onclick = () => showFishSub('items'));
    $('qcFishRankEntry') && ($('qcFishRankEntry').onclick = () => showFishSub('rank'));
    $('qcFishBack1') && ($('qcFishBack1').onclick = hideFishSub);
    $('qcFishBack2') && ($('qcFishBack2').onclick = hideFishSub);
    $('qcBuyShield') && ($('qcBuyShield').onclick = () => safe(async () => {
      await ensure();
      const j = await window.QCFish.buyShield(1);
      toast('兑换成功！护盾 × ' + j.shields);
    }));
    $('qcRankSpeed') && ($('qcRankSpeed').onclick = () => safe(async () => { await ensure(); await loadFishRank('speed'); }));
    $('qcRankScore') && ($('qcRankScore').onclick = () => safe(async () => { await ensure(); await loadFishRank('score'); }));
    $('qcJoinCodeBtn') && ($('qcJoinCodeBtn').onclick = () => safe(() => join('', null, $('qcJoinCode').value.trim())));
  }
  /* 聚会工具箱原本被排除在外，导致「创建好友房间」按钮点了没反应（2026-10-25 修） */
  if (!LEGACY.includes(id)) {
    $('qcCreateOnline') && ($('qcCreateOnline').onclick = () => safe(() => createRoom(id, false, $('qcVisibility')?.value || 'public')));
    $('qcJoinCodeBtn') && ($('qcJoinCodeBtn').onclick = () => safe(() => join('', null, $('qcJoinCode')?.value.trim() || '')));
  }
}

/* ---------------- 好友 ---------------- */
async function showFriends() {
  page = 'friends';
  backAction = room ? () => renderRoom() : hide;
  const j = await api('friends');
  const myId = profile?.id || '';
  shell('好友系统', `
    <section class="qc-meId"><div><small>我的 ID</small><b>${esc(myId)}</b></div><button class="qc-btn" id="qcCopyId">复制 ID</button></section>
    <section class="qc-panel">
      <h2>加个好友</h2>
      <div class="qc-inline"><input id="qcFriendId" class="qc-input" placeholder="输入好友 ID，例如 QC8F2A1C3D"><button id="qcSearchFriend" class="qc-btn primary">查找</button></div>
      <div id="qcFriendFound"></div>
      <p class="qc-muted">把上面的 ID 发给朋友，对方搜索后就能发申请。互相成为好友后可邀请进房。</p>
    </section>
    <section class="qc-panel">
      <h2>好友申请 ${j.requests.length ? `<span class="qc-count">${j.requests.length}</span>` : ''}</h2>
      ${j.requests.length ? j.requests.map(f => `<div class="qc-frow"><span class="qc-av">${esc(f.avatar)}</span><div class="qc-fmeta"><b>${esc(f.nickname)}</b><small>${esc(f.id)}</small></div><button class="qc-btn primary" data-accept="${esc(f.id)}">接受</button><button class="qc-btn" data-reject="${esc(f.id)}">忽略</button></div>`).join('') : '<p class="qc-muted">暂时没有新的申请。</p>'}
    </section>
    ${j.invites.length ? `<section class="qc-panel"><h2>房间邀请</h2>${j.invites.map(i => `<div class="qc-frow"><span class="qc-av">✉️</span><div class="qc-fmeta"><b>${esc(i.from)} 邀请你玩 ${esc(ART[i.game]?.name || i.game)}</b><small>5 分钟内有效</small></div><button class="qc-btn primary" data-inv-room="${esc(i.room)}" data-key="${esc(i.invite)}" data-legacy="${esc(i.legacy || '')}" data-code="${esc(i.code || '')}">加入房间</button></div>`).join('')}</section>` : ''}
    <section class="qc-panel">
      <h2>我的好友 <span class="qc-count">${j.friends.length}</span></h2>
      ${j.friends.length ? `<div class="qc-fgrid">${j.friends.map(f => `<div class="qc-fcard"><span class="qc-av big">${esc(f.avatar)}</span><b>${esc(f.nickname)}</b><small class="${/在线|游戏中/.test(f.status) ? 'on' : ''}">${esc(f.status)}${f.game ? ' · ' + esc(f.game) : ''}</small><div class="qc-fbtns"><button class="qc-btn" data-invite-friend="${esc(f.id)}">邀请</button>${f.room ? `<button class="qc-btn primary" data-join="${esc(f.room)}">加入房间</button>` : ''}</div></div>`).join('')}</div>` : '<p class="qc-muted">还没有好友。把 ID 发给常一起玩的人，建立第一份游戏搭子关系。</p>'}
    </section>`, '', `${j.friends.length} 位好友`);

  $('qcCopyId').onclick = () => safe(async () => {
    try { await navigator.clipboard.writeText(myId); toast('ID 已复制'); }
    catch { toast('我的 ID：' + myId); }
  });
  $('qcSearchFriend').onclick = () => safe(async () => {
    const r = await api('search', { id: $('qcFriendId').value.trim().toUpperCase() });
    $('qcFriendFound').innerHTML = r.user
      ? `<div class="qc-frow"><span class="qc-av">${esc(r.user.avatar)}</span><div class="qc-fmeta"><b>${esc(r.user.nickname)}</b><small>${esc(r.user.id)}</small></div><button class="qc-btn primary" id="qcAddFriend">发送申请</button></div>`
      : '<p class="qc-muted">没有找到这个 ID，确认一下大小写和位数。</p>';
    const add = $('qcAddFriend');
    if (add) add.onclick = () => safe(async () => { await api('friend/request', { id: r.user.id }); toast('好友申请已发送'); });
  });
  for (const b of root.querySelectorAll('[data-accept],[data-reject]')) {
    b.onclick = () => safe(async () => {
      await api('friend/accept', { id: b.dataset.accept || b.dataset.reject, accept: !!b.dataset.accept });
      showFriends();
    });
  }
  for (const b of root.querySelectorAll('[data-invite-friend]')) {
    b.onclick = () => safe(async () => { await api('friend/invite', { id: b.dataset.inviteFriend }); toast('房间邀请已发送'); });
  }
  for (const b of root.querySelectorAll('[data-join]')) b.onclick = () => safe(() => join(b.dataset.join));
  for (const b of root.querySelectorAll('[data-inv-room]')) {
    b.onclick = () => safe(async () => {
      if (b.dataset.legacy) legacyJoin(b.dataset.legacy, b.dataset.code);
      else await join(b.dataset.invRoom, b.dataset.key);
    });
  }
}

/* ---------------- 联机大厅 ---------------- */
async function showRooms() {
  page = 'rooms'; backAction = hide;
  const j = await api('rooms');
  const all = [...(j.rooms || []).filter(r => !r.ai), ...(j.legacy || [])];
  const present = [...new Set(all.map(r => r.game))];
  const gameName = g => ART[g]?.name || g;
  shell('联机大厅', `
    <div class="qc-lead"><b>${all.length ? all.length + ' 个房间在线' : '现在还没有房间'}</b><span>这里汇总所有游戏的公开房间，点进去就能一起玩。</span></div>
    <section class="qc-panel">
      <div class="qc-roombar">
        <div class="qc-chips" id="qcRoomFilter">${['all', ...present].map(g => `<button class="qc-chip ${roomFilter === g ? 'on' : ''}" data-filter="${esc(g)}">${g === 'all' ? '全部游戏' : esc(gameName(g))}</button>`).join('')}</div>
        <div class="qc-codeRow"><input id="qcRoomCode" class="qc-input" inputmode="numeric" maxlength="6" placeholder="房间码"><button class="qc-btn" id="qcCodeJoin">加入</button><button class="qc-btn" id="qcRefreshRooms">刷新</button></div>
      </div>
      <div id="qcRoomsList"></div>
    </section>`, '', `${all.length} 个房间`);
  const rows = () => {
    const list = all.filter(r => roomFilter === 'all' || r.game === roomFilter);
    const box = $('qcRoomsList');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = `<div class="qc-empty"><span>🛋️</span><b>这里还很安静</b><p>去「休闲娱乐」开一间房，房间会自动出现在这里。</p><button class="qc-btn primary" id="qcGoCasual">去开一间</button></div>`;
      $('qcGoCasual').onclick = showCasual;
      return;
    }
    box.innerHTML = list.map(r => {
      const full = r.count >= r.max;
      const blocked = r.locked || r.state === 'playing' || full;
      const label = r.state === 'playing' ? '对局中' : full ? '已满员' : r.locked ? '私密房' : '加入';
      return `<div class="qc-roomcard">
        <span class="qc-gameico ${ART[r.game]?.cls || ''}">${r.game === 'cat' ? '😾' : r.game === 'qq' ? '🟣' : r.game === 'ledger' ? '📒' : r.game === 'party' ? '🎲' : r.game === 'landlord' ? '🃏' : r.game === 'gomoku' ? '⚫' : r.game === 'xiangqi' ? '帅' : '🐟'}</span>
        <div class="qc-roominfo"><b>${esc(gameName(r.game))} <span class="qc-chip small">${r.locked ? '私密' : '公开'}</span></b><small>${esc(r.host || '房主')} 的房间 · ${r.count}/${r.max} 人 · ${r.state === 'playing' ? '对局中' : '等待加入'}</small></div>
        <button class="qc-btn ${blocked ? '' : 'primary'}" data-room-id="${esc(r.id)}" data-legacy="${r.id.startsWith('cat-') ? 'cat' : r.id.startsWith('qq-') ? 'qq' : ''}" data-code="${esc(r.code || '')}" ${blocked ? 'disabled' : ''}>${label}</button>
      </div>`;
    }).join('');
    for (const b of box.querySelectorAll('[data-room-id]')) {
      b.onclick = () => safe(async () => {
        if (b.dataset.legacy) legacyJoin(b.dataset.legacy, b.dataset.code);
        else await join(b.dataset.roomId);
      });
    }
  };
  rows();
  for (const b of root.querySelectorAll('[data-filter]')) {
    b.onclick = () => { roomFilter = b.dataset.filter; for (const x of root.querySelectorAll('[data-filter]')) x.classList.toggle('on', x === b); rows(); };
  }
  $('qcRefreshRooms').onclick = () => safe(showRooms);
  $('qcCodeJoin').onclick = () => safe(() => join('', null, $('qcRoomCode').value.trim()));
}

/* ---------------- 意见反馈 ---------------- */
let feedbackBack = hide;
async function showFeedback() {
  if (page !== 'feedback') feedbackBack = page === 'me' ? showMe : hide;
  page = 'feedback'; backAction = feedbackBack;
  const j = await api('feedback');
  shell('意见反馈', `
    <div class="qc-cols">
      <section class="qc-panel">
        <h2>想玩什么，直接说</h2>
        <p class="qc-muted">是 Bug、想要的新玩法、还是哪里用着别扭，都可以写在这里。会认真看。</p>
        <div class="qc-chips" id="qcFeedbackType"><button class="qc-chip on" data-type="suggestion">功能建议</button><button class="qc-chip" data-type="bug">问题 Bug</button></div>
        <textarea id="qcFeedbackText" class="qc-input" maxlength="3000" placeholder="尽量说清楚：在哪个页面、做了什么、希望变成什么样（5–3000 字）"></textarea>
        <input id="qcFeedbackContact" class="qc-input" maxlength="200" placeholder="联系方式（选填，方便回复你）">
        <button id="qcSubmitFeedback" class="qc-btn primary wide">提交反馈</button>
      </section>
      <section class="qc-panel">
        <h2>我的反馈 <span class="qc-count">${j.feedback.length}</span></h2>
        ${j.feedback.slice().reverse().map(f => `<div class="qc-fb"><div class="qc-fbTop"><b>${esc(f.type)}</b><span class="qc-chip small ${f.status === '已回复' ? 'good' : ''}">${esc(f.status)}</span></div><p>${esc(f.text)}</p>${f.reply ? `<div class="qc-reply"><b>回复</b>${esc(f.reply)}</div>` : '<small class="qc-muted">等待处理，通常会在一天内回复。</small>'}<small class="qc-muted">${new Date(f.time).toLocaleString()}</small></div>`).join('') || '<div class="qc-empty small"><span>💬</span><b>还没有提交过反馈</b><p>你的每一条建议都会影响下一版。</p></div>'}
      </section>
    </div>`, '', '每一条都会看');
  let type = 'suggestion';
  for (const b of root.querySelectorAll('[data-type]')) {
    b.onclick = () => { type = b.dataset.type; for (const x of root.querySelectorAll('[data-type]')) x.classList.toggle('on', x === b); };
  }
  $('qcSubmitFeedback').onclick = () => safe(async () => {
    const btn = $('qcSubmitFeedback');
    btn.disabled = true;
    try {
      await api('feedback', { type, text: $('qcFeedbackText').value, contact: $('qcFeedbackContact').value });
      toast('反馈已提交，谢谢'); showFeedback();
    } finally { btn.disabled = false; }
  });
}

/* ---------------- 我的 ---------------- */
async function showMe() {
  page = 'me'; backAction = hide;
  let p = profile;
  try { const j = await api('me'); p = j.profile; apply(p); } catch (e) {}
  let friendCount = 0;
  try { friendCount = (await api('friends')).friends.length; } catch (e) {}
  const gamesN = p?.stats?.games || 0, wins = p?.stats?.wins || 0;
  const rate = gamesN ? Math.round(wins / gamesN * 100) : 0;
  const signed = window.signedToday ? signedToday() : false;
  shell('我的', `
    <section class="qc-mehero">
      <span class="qc-av xl" id="qcMeAvatar">${esc(p?.avatar || '🙂')}</span>
      <div class="qc-meinfo"><h2>${esc(p?.nickname || '匿名用户')}</h2><small>ID ${esc(p?.id || '—')}</small><div class="qc-chips"><span class="qc-chip">${p && !p.guest ? '正式账号' : '游客'}</span><span class="qc-chip">${esc(p?.rank || 'C')} 段</span><span class="qc-chip">${p?.rating ?? 1000} 分</span><span class="qc-chip gold">🪙 ${p?.coins ?? coins}</span></div></div>
      <button class="qc-btn" id="qcEditProfile">${p && !p.guest ? '编辑资料' : '升级账号'}</button>
    </section>
    <div class="qc-statgrid">
      <div><b>${gamesN}</b><span>总对局</span></div><div><b>${rate}%</b><span>胜率</span></div><div><b>${friendCount}</b><span>好友</span></div><div><b>${p?.coins ?? coins}</b><span>金币</span></div>
    </div>
    <section class="qc-signcard ${signed ? 'done' : ''}">
      <div><b>${signed ? '今天已经签到' : '每日签到'}</b><small>${signed ? '明天再来，连续签到有惊喜' : '签到领 50 金币，攒着换装扮'}</small></div>
      <button class="qc-btn ${signed ? '' : 'primary'}" id="qcSign" ${signed ? 'disabled' : ''}>${signed ? '已签到' : '签到 +50'}</button>
    </section>
    <section class="qc-menu-list">
      ${menuRow('🏆', '排行榜', '段位榜 / 金币榜', 'rank')}
      ${menuRow('🛍️', '装扮小铺', '头像框与游戏皮肤', 'shop')}
      ${menuRow('📊', '我的战绩', '每一局的输赢与排名', 'history')}
      ${menuRow('🎯', '每日任务', '完成任务领金币', 'tasks')}
      ${menuRow('👤', '账号与安全', '资料、密码、登录', 'account')}
      ${menuRow('📢', '公告', '活动与版本更新', 'announcements')}
      ${menuRow('💬', '意见反馈', '告诉我们你的想法', 'feedback')}
      ${QC_IS_APP ? '' : menuRow('📲', '下载 APP', '安卓独立客户端 · 全屏更流畅', 'download')}
      <button class="qc-menurow" data-theme><i>🌓</i><span><b>主题</b><small id="qcThemeName">跟随系统</small></span><em>切换</em></button>
      <button class="qc-menurow" data-sfx-toggle><i id="qcSfxIcon">${window.QCSFX?.enabled === false ? '🔇' : '🔊'}</i><span><b>音效</b><small id="qcSfxName">${window.QCSFX?.enabled === false ? '已关闭' : '已开启'}</small></span><em>切换</em></button>
    </section>
    <p class="qc-footnote">千城游戏厅 · 小小游戏厅，大大快乐</p>
    ${tabbar('me')}`, '', '账号、金币与记录');
  root.querySelector('.qc-wrap').classList.add('has-tabbar');
  bindTabbar();
  const av = $('qcMeAvatar');
  if (av && window.applyFrameClass) applyFrameClass(av, p?.frame);
  $('qcEditProfile').onclick = () => showAccount();
  $('qcSign').onclick = () => safe(signIn);
  for (const b of root.querySelectorAll('[data-menu]')) {
    b.onclick = () => safe(() => b.dataset.menu === 'account' ? showAccount()
      : b.dataset.menu === 'download' ? showDownload()
      : openSection(b.dataset.menu));
  }
  for (const b of root.querySelectorAll('[data-theme]')) b.onclick = () => { cycleTheme(); const n = $('qcThemeName'); if (n) n.textContent = themeName(); };
  $('qcThemeName').textContent = themeName();
  root.querySelectorAll('[data-sfx-toggle]').forEach(b => b.onclick = () => {
    const on = window.QCSFX ? window.QCSFX.toggle() : false;
    const n = $('qcSfxName'), ic = $('qcSfxIcon');
    if (n) n.textContent = on ? '已开启' : '已关闭';
    if (ic) ic.textContent = on ? '🔊' : '🔇';
    if (on) { window.QCSFX?.unlock(); window.QCSFX?.play('toggle'); }
    else toast('音效已关闭');
  });
}
function menuRow(icon, title, sub, key) {
  return `<button class="qc-menurow" data-menu="${key}"><i>${icon}</i><span><b>${title}</b><small>${sub}</small></span><em>›</em></button>`;
}
/* ---------------- 下载 APP（安卓独立客户端） ---------------- */
function showDownload() {
  const from = page;
  page = 'download'; backAction = from === 'me' ? showMe : hide;
  shell('下载 APP', `
    <div class="qc-cols">
      <section class="qc-panel">
        <h2>千城游戏厅 · 安卓版 <span class="qc-chip gold">v${QC_APP_VERSION}</span></h2>
        <p class="qc-muted">这是装在手机里的独立客户端，不是浏览器书签。整个大厅和三款游戏都打包进安装包：点开图标直接进大厅，没有地址栏和工具栏，横屏开黑不会被浏览器界面挡住。</p>
        <ul style="margin:12px 0 14px 18px;line-height:1.95;font-size:13px;color:var(--ink,#33265e)">
          <li>资源在本地，启动快，断网也能玩单机</li>
          <li>全屏沉浸 + 自动保持亮屏，操作不被系统手势条打断</li>
          <li>联机、账号、金币与网页版完全互通</li>
        </ul>
        <button class="qc-btn primary wide" id="qcDlBtn" type="button">⬇ 下载安装包（约 2 MB）</button>
        <p class="qc-muted" style="margin-top:10px">仅安卓。安装时若提示「未知来源应用」，允许一次即可。</p>
      </section>
      <section class="qc-panel" id="qcDlQr" style="text-align:center">
        <h2>扫码装到手机</h2>
        <img src="/app/qr" alt="下载二维码" style="width:188px;height:188px;display:block;margin:8px auto;border-radius:12px;background:#fff;padding:8px" onerror="this.parentNode.style.display='none'">
        <p class="qc-muted">电脑上打开的话，用手机扫这个码直接下载</p>
      </section>
    </div>`, '', `安卓 v${QC_APP_VERSION}`);
  const btn = $('qcDlBtn');
  if (btn) btn.onclick = () => { location.href = QC_APP_URL; };
}
async function signIn() {
  if (window.signedToday && signedToday()) { toast('今天已经签到过了'); return; }
  if (!userProfile.token) { await ensure(); }
  const r = await fetch('/api/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: userProfile.token })
  }).then(x => x.json());
  if (!r.ok) throw Error(r.msg || '签到失败');
  userProfile.lastSign = r.lastSign; saveProfileLocal();
  const me = await api('me'); apply(me.profile);
  window.signBtnState?.();
  if (!r.already) track('sign');
  toast(r.already ? '今天已经签到过了' : '签到成功，金币 +50');
  if (!r.already) window.QCSFX?.play('coinBig');
  showMe();
}

/* ---------------- 排行榜 ---------------- */
async function showRank() {
  page = 'rank'; backAction = showMe;
  const rating = await api('leaderboard').catch(() => ({ top: [] }));
  const coin = await fetch('/api/leaderboard?token=' + encodeURIComponent(userProfile.token || '')).then(r => r.json()).catch(() => ({ top: [] }));
  rankData = rating.top || []; coinData = coin.top || [];
  shell('排行榜', `
    <div class="qc-chips qc-tabs" id="qcRankTabs">
      <button class="qc-chip ${rankTab === 'rating' ? 'on' : ''}" data-rank="rating">段位榜</button>
      <button class="qc-chip ${rankTab === 'coins' ? 'on' : ''}" data-rank="coins">金币榜</button>
    </div>
    <div id="qcRankBody"></div>`, '', '谁是这周最靓的仔');
  const paint = () => {
    const list = rankTab === 'rating'
      ? rankData.map((u, i) => ({ ...u, pos: i + 1, value: u.rating + ' 分', badge: u.rank || 'C' }))
      : coinData.map(u => ({ ...u, pos: u.rank, value: '🪙 ' + u.coins, badge: '' }));
    const body = $('qcRankBody');
    if (!list.length) {
      body.innerHTML = `<div class="qc-empty"><span>🏆</span><b>榜单还是空的</b><p>完成一局正式对局，就能出现在这里。</p></div>`;
      return;
    }
    const top = list.slice(0, 3);
    const rest = list.slice(3);
    body.innerHTML = `
      <section class="qc-podium">
        ${[1, 0, 2].map(n => {
          const u = top[n];
          if (!u) return '';
          return `<div class="qc-podiumSeat p${n + 1}"><span class="qc-medal">${['🥇', '🥈', '🥉'][n]}</span><span class="qc-av big">${esc(u.avatar || '🙂')}</span><b>${esc(u.nickname || '玩家')}</b><small>${esc(u.value)}</small></div>`;
        }).join('')}
      </section>
      <section class="qc-panel qc-ranklist">
        ${rest.map(u => `<div class="qc-rankrow ${u.id === profile?.id ? 'me' : ''}"><span class="qc-pos">${u.pos}</span><span class="qc-av">${esc(u.avatar || '🙂')}</span><b>${esc(u.nickname || '玩家')}</b>${u.badge ? `<span class="qc-chip small">${esc(u.badge)}</span>` : ''}<em>${esc(u.value)}</em></div>`).join('') || '<p class="qc-muted">前三名之外还没有人，冲一冲就能上榜。</p>'}
      </section>
      <section class="qc-mypanel"><div><small>我的${rankTab === 'rating' ? '段位' : '金币'}</small><b>${rankTab === 'rating' ? `${esc(profile?.rank || 'C')} 段 · ${profile?.rating ?? 1000} 分` : `🪙 ${profile?.coins ?? coins}`}</b></div><span>${rankTab === 'rating' ? '赢下正式对局提升段位' : '打对局、做任务攒金币'}</span></section>`;
  };
  paint();
  for (const b of root.querySelectorAll('[data-rank]')) {
    b.onclick = () => { rankTab = b.dataset.rank; for (const x of root.querySelectorAll('[data-rank]')) x.classList.toggle('on', x === b); paint(); };
  }
}

/* ---------------- 装扮小铺 ---------------- */
const FRAMES = [
  { id: 'S', name: 'S 段位框', desc: '金色 S 标 · 五颗星', price: 2000 },
  { id: 'A', name: 'A 段位框', desc: '紫色 A 标 · 五颗星', price: 1000 },
  { id: 'B', name: 'B 段位框', desc: '蓝色 B 标 · 五颗星', price: 500 },
  { id: 'C', name: 'C 段位框', desc: '绿色 C 标 · 五颗星', price: 50 }
];
async function showShop() {
  page = 'shop'; backAction = showMe;
  const j = await api('shop');
  shell('装扮小铺', `
    <div class="qc-chips qc-tabs" id="qcShopTabs">
      <button class="qc-chip ${shopTab === 'items' ? 'on' : ''}" data-shop="items">游戏装扮</button>
      <button class="qc-chip ${shopTab === 'frames' ? 'on' : ''}" data-shop="frames">头像框</button>
    </div>
    <div id="qcShopBody"></div>`, `<span class="qc-chip gold">🪙 ${profile?.coins ?? coins}</span>`, '金币只玩游戏赚，不影响公平');
  const paint = () => {
    const owned = new Set(j.owned || []);
    $('qcShopBody').innerHTML = shopTab === 'items'
      ? `<div class="qc-shopgrid">${j.items.map(i => `<div class="qc-shopcard ${owned.has(i.id) ? 'owned' : ''}">
          <span class="shopArt">${i.id.includes('fish') ? '🐠' : i.id.includes('qq') ? '🟣' : '✨'}</span>
          <b>${esc(i.name)}</b><small>${esc(ART[i.game]?.name || '通用')}</small>
          <div class="qc-shopfoot"><span>🪙 ${i.price}</span><button class="qc-btn ${owned.has(i.id) ? '' : 'primary'}" data-buy="${esc(i.id)}" ${owned.has(i.id) ? 'disabled' : ''}>${owned.has(i.id) ? '已拥有' : '兑换'}</button></div>
        </div>`).join('')}</div>`
      : `<div class="qc-shopgrid">${FRAMES.map(f => {
          const has = (profile?.frames || []).includes(f.id);
          const on = profile?.frame === f.id;
          return `<div class="qc-shopcard frame ${on ? 'owned' : ''}"><span class="frameBox">${f.id}<img src="/frames/frame_${f.id}.png" alt="" onerror="this.remove()"></span><b>${f.name}</b><small>${f.desc}</small><div class="qc-shopfoot"><span>🪙 ${f.price}</span>${on ? '<button class="qc-btn" disabled>佩戴中</button>' : has ? `<button class="qc-btn primary" data-equip="${f.id}">佩戴</button>` : `<button class="qc-btn primary" data-buyframe="${f.id}">兑换</button>`}</div></div>`;
        }).join('')}</div>`;
    for (const b of root.querySelectorAll('[data-buy]')) {
      b.onclick = () => safe(async () => {
        const r = await api('shop', { buy: b.dataset.buy });
        apply(r.profile); toast('装扮已兑换'); showShop();
      });
    }
    for (const b of root.querySelectorAll('[data-buyframe]')) {
      b.onclick = () => safe(async () => {
        const r = await fetch('/api/buyFrame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userProfile.token, id: b.dataset.buyframe }) }).then(x => x.json());
        if (!r.ok) throw Error(r.msg || '兑换失败');
        const me = await api('me'); apply(me.profile);
        toast('头像框已到账并佩戴'); showShop();
      });
    }
    for (const b of root.querySelectorAll('[data-equip]')) {
      b.onclick = () => safe(async () => {
        const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: userProfile.token, frame: b.dataset.equip }) }).then(x => x.json());
        if (!r.ok) throw Error(r.msg || '佩戴失败');
        userProfile.frame = r.frame; saveProfileLocal(); renderHome();
        const me = await api('me'); apply(me.profile);
        toast('已佩戴'); showShop();
      });
    }
  };
  paint();
  for (const b of root.querySelectorAll('[data-shop]')) {
    b.onclick = () => { shopTab = b.dataset.shop; for (const x of root.querySelectorAll('[data-shop]')) x.classList.toggle('on', x === b); paint(); };
  }
}

/* ---------------- 战绩 / 任务 ---------------- */
async function showHistory() {
  page = 'history'; backAction = showMe;
  const j = await api('me'); apply(j.profile);
  const p = profile;
  const grouped = JSON.parse(JSON.stringify(p.gameStats || {}));
  for (const h of (Object.keys(grouped).length ? [] : p.history || [])) {
    const g = grouped[h.game] ??= { games: 0, wins: 0, best: 100 };
    g.games++; if (h.win) g.wins++; g.best = Math.min(g.best, h.rank || 100);
  }
  shell('我的战绩', `
    <section class="qc-mehero small">
      <span class="qc-av xl">${esc(p.avatar)}</span>
      <div class="qc-meinfo"><h2>${esc(p.nickname)}</h2><small>${esc(p.rank)} 段 · ${p.rating} 分 · ${p.stats.games} 局 · 胜率 ${p.stats.games ? Math.round(p.stats.wins / p.stats.games * 100) : 0}%</small></div>
    </section>
    <div class="qc-gstat">${Object.entries(grouped).map(([id, g]) => `<div class="qc-gstatCard"><span class="qc-av big">${id === 'cat' ? '😾' : id === 'qq' ? '🟣' : ART[id] ? '🎮' : '🎲'}</span><b>${esc(ART[id]?.name || id)}</b><small>${g.games} 局 · 胜率 ${Math.round(g.wins / g.games * 100)}%</small><em>最高第 ${g.best} 名</em></div>`).join('') || '<p class="qc-muted">还没有正式对局记录。</p>'}</div>
    <section class="qc-panel"><h2>最近对局</h2>${(p.history || []).map((h, i) => `<div class="qc-frow"><span class="qc-av">${h.win ? '🏅' : '🎮'}</span><div class="qc-fmeta"><b>${esc(ART[h.game]?.name || h.game)} · ${h.win ? '胜利' : '完成'}</b><small>${new Date(h.time).toLocaleString()} · 金币 ${h.coin >= 0 ? '+' : ''}${h.coin}</small></div><button class="qc-btn" data-share-result="${i}">战绩卡</button></div>`).join('') || '<p class="qc-muted">开始一局游戏，积累第一份战绩吧。</p>'}</section>`, '', '一局一局攒出来的');
  for (const b of root.querySelectorAll('[data-share-result]')) {
    b.onclick = () => shareResult(p, p.history[Number(b.dataset.shareResult)]);
  }
}
function shareResult(p, h) {
  if (!h) return;
  const c = document.createElement('canvas'); c.width = 800; c.height = 450;
  const x = c.getContext('2d');
  x.fillStyle = '#f6f8fd'; x.fillRect(0, 0, 800, 450);
  x.strokeStyle = '#d9d3ea'; x.lineWidth = 6; x.strokeRect(18, 18, 764, 414);
  x.fillStyle = '#343047'; x.font = '24px sans-serif'; x.fillText('千城游戏厅 · 我的对局', 55, 80);
  x.font = 'bold 42px sans-serif'; x.fillText(p.nickname.slice(0, 12), 55, 155);
  x.font = '28px sans-serif'; x.fillText((ART[h.game]?.name || h.game) + ' · ' + (h.win ? '胜利！' : '挑战完成'), 55, 225);
  x.fillText('金币 ' + h.coin + '　' + p.rank + ' 段位', 55, 285);
  x.font = '18px sans-serif'; x.fillStyle = '#85849b'; x.fillText(new Date(h.time).toLocaleString(), 55, 365);
  const a = document.createElement('a'); a.download = '千城战绩.png'; a.href = c.toDataURL(); a.click();
}
async function showTasks() {
  page = 'tasks'; backAction = showMe;
  const j = await api('tasks');
  shell('每日任务', `
    <div class="qc-lead"><b>今天还能领 ${j.tasks.filter(t => t.done && !t.claimed).reduce((a, t) => a + t.reward, 0)} 金币</b><span>每日任务按北京时间刷新，完成条件由服务器记录。</span></div>
    <section class="qc-tasklist">${j.tasks.map(t => `<div class="qc-task ${t.done ? 'done' : ''}"><span class="taskDot">${t.claimed ? '✓' : t.done ? '!' : '·'}</span><div><b>${esc(t.name)}</b><small>奖励 ${t.reward} 金币</small></div><button class="qc-btn ${t.done && !t.claimed ? 'primary' : ''}" data-claim="${esc(t.id)}" ${!t.done || t.claimed ? 'disabled' : ''}>${t.claimed ? '已领取' : t.done ? '领取' : '进行中'}</button></div>`).join('')}</section>`, '', '完成就能领');
  for (const b of root.querySelectorAll('[data-claim]')) {
    b.onclick = () => safe(async () => {
      const r = await api('tasks', { claim: b.dataset.claim });
      apply(r.profile); toast('奖励已领取'); showTasks();
    });
  }
}

/* ---------------- 账号 ---------------- */
async function showAccount() {
  page = 'account'; backAction = showMe;
  await ensure().catch(e => toast(e.message));
  const p = profile;
  const guest = !p || p.guest;
  shell(guest ? '账号升级' : '账号与安全', `
    <div class="qc-cols">
      <section class="qc-panel">
        <h2>${guest ? '游客升级 · 保留已有进度' : '账号资料'}</h2>
        ${p ? `<p class="qc-muted">我的 ID：<b class="qc-strong">${esc(p.id)}</b> · ${guest ? '游客' : '正式账号'}</p>` : ''}
        <label class="qc-label">昵称</label><input class="qc-input" id="qcNick" maxlength="16" value="${esc(p?.nickname || userProfile.nickname)}">
        <label class="qc-label">头像</label><div class="qc-avatars" id="qcAvatar">${['🙂', '😀', '😊', '😎', '🐱', '🐶', '🦊', '🐼'].map(a => `<button type="button" class="qc-avatarbtn ${a === (p?.avatar || userProfile.avatar) ? 'on' : ''}" data-avatar="${a}" aria-label="选择头像 ${a}">${a}</button>`).join('')}</div>
        ${guest ? `<label class="qc-label">设置密码（8–100 位，请妥善保存 ID 和密码）</label><input id="qcNewPassword" class="qc-input" type="password" minlength="8" autocomplete="new-password"><p class="qc-muted">升级后金币、头像框、战绩、好友和收藏都会跟着账号走。</p><button id="qcRegister" class="qc-btn primary wide">升级为正式账号</button>` : `<button id="qcSaveProfile" class="qc-btn primary">保存资料</button> <button id="qcLogout" class="qc-btn">退出登录</button><details class="qc-details"><summary>修改密码</summary><label class="qc-label">当前密码</label><input id="qcOldPassword" class="qc-input" type="password" autocomplete="current-password"><label class="qc-label">新密码</label><input id="qcNewPassword" class="qc-input" type="password" minlength="8" autocomplete="new-password"><button id="qcChangePassword" class="qc-btn">更新密码</button></details>`}
      </section>
      <section class="qc-panel">
        <h2>登录已有账号</h2>
        <p class="qc-muted">支持新版用户 ID，也支持原来的手机号账号。</p>
        <label class="qc-label">ID / 原手机号</label><input id="qcLoginId" class="qc-input" autocomplete="username">
        <label class="qc-label">密码</label><input id="qcLoginPassword" class="qc-input" type="password" autocomplete="current-password">
        <button id="qcLogin" class="qc-btn primary wide">登录并同步</button>
        <p class="qc-muted">登录已有账号会读取它的云端数据，不会把两个账号的资产叠加。</p>
      </section>
    </div>`, '', guest ? '把游客进度保存下来' : '资料与密码');
  let avatarPicked = p?.avatar || userProfile.avatar || '🙂';
  for (const b of root.querySelectorAll('[data-avatar]')) {
    b.onclick = () => {
      avatarPicked = b.dataset.avatar;
      for (const x of root.querySelectorAll('[data-avatar]')) x.classList.toggle('on', x === b);
    };
  }
  const fields = () => ({ nickname: $('qcNick')?.value.trim(), avatar: avatarPicked });
  $('qcRegister') && ($('qcRegister').onclick = () => safe(async () => {
    const j2 = await api('register', { ...fields(), password: $('qcNewPassword').value, guestId, legacy: legacySnapshot });
    apply(j2.profile, j2.token); connect(); toast('升级成功，请保存你的 ID：' + j2.profile.id); showAccount();
  }));
  $('qcSaveProfile') && ($('qcSaveProfile').onclick = () => safe(async () => {
    const j2 = await api('profile', fields()); apply({ ...j2.profile, guest: profile.guest }); toast('资料已保存');
  }));
  $('qcLogin') && ($('qcLogin').onclick = () => safe(async () => {
    const j2 = await api('login', { account: $('qcLoginId').value, password: $('qcLoginPassword').value });
    socket?.close(); apply(j2.profile, j2.token); socket = null; connect(); toast('登录成功'); showMe();
  }));
  $('qcLogout') && ($('qcLogout').onclick = () => safe(async () => {
    await api('logout'); socket?.close(); profile = null;
    userProfile = { nickname: '', avatar: '🙂', phone: '', token: '', stats: null, frames: [], frame: '' };
    saveProfileLocal(); localStorage.removeItem('qc_guest_id');
    guestId = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('qc_guest_id', guestId);
    toast('已退出登录'); hide();
  }));
  $('qcChangePassword') && ($('qcChangePassword').onclick = () => safe(async () => {
    const j2 = await api('password', { oldPassword: $('qcOldPassword').value, password: $('qcNewPassword').value });
    userProfile.token = j2.token; saveProfileLocal(); toast('密码已更新，其他设备已失效');
  }));
}

/* ---------------- 房间 ---------------- */
async function createRoom(game, ai, visibility = 'public') {
  await ensure();
  const current = await api('room/current');
  if (current.room) { room = current.room; page = 'room'; renderRoom(); return; }
  const j = await api('room/create', { game, visibility, ai, ratio: clamp((window.innerWidth || 390) / Math.max(1, window.innerHeight || 844), 1.25, 2.2) });
  room = j.room;
  track('room_create', { game });
  if (ai || game === 'party') { const s = await api('room/start'); room = s.room; }
  page = 'room'; renderRoom();
  if (game === 'party') maybeAutoQ();
}
async function join(id, invite, code) {
  await ensure();
  if (/^(cat|qq)-/.test(id)) {
    const list = await api('rooms');
    const old = (list.legacy || []).find(r => r.id === id);
    if (!old || !old.code) throw Error('房间已结束，或这是私密房');
    legacyJoin(old.game, old.code); return;
  }
  if (code && /^\d{4,6}$/.test(code)) {
    if (code.length === 6) {
      try {   // 6 位码优先按平台房间加入（fish/五子棋等）
        const j = await api('room/join', { code });
        room = j.room; page = 'room'; renderRoom(); return;
      } catch (e) { /* 不是平台房间，继续走旧游戏解析 */ }
    }
    const old = await api('room/resolve', { code });
    legacyJoin(old.game, old.code); return;
  }
  const j = await api('room/join', { id, invite, code });
  room = j.room; page = 'room'; renderRoom();
  maybeAutoQ();
}
async function leaveRoom() {
  try { await api('room/leave'); } catch (e) {}
  closeQPage();
  qAutoFor = '';
  room = null; hide();
}
function roomHeader() {
  const idx = room.members.findIndex(m => m.id === profile?.id);
  const host = idx === 0;
  const playing = !!room.engine && !room.engine.over;
  const max = (MAX[room.game] || room.members.length);
  const canStart = room.ai || room.game === 'party' || room.game === 'ledger' || (room.game === 'fish' ? room.members.length >= 2 : room.members.length >= max);
  const seats = [];
  const seatHTML = (m, i) => `<span class="qc-seat ${i === 0 ? 'host' : ''}"><span class="qc-av">${esc(m.avatar || '🙂')}</span><b>${i === idx ? '你' : esc(m.nickname)}</b>${i === 0 ? '<i>房主</i>' : ''}</span>`;
  if (max > 4) {
    room.members.forEach((m, i) => seats.push(seatHTML(m, i)));
    if (room.members.length < max) seats.push(`<span class="qc-seat empty"><span class="qc-av">+</span><b>邀请朋友加入</b></span>`);
  } else {
    for (let i = 0; i < Math.max(Math.min(max, 4), room.members.length); i++) {
      const m = room.members[i];
      if (m) seats.push(seatHTML(m, i));
      else if (room.ai) seats.push(`<span class="qc-seat ai"><span class="qc-av">🤖</span><b>AI</b></span>`);
      else seats.push(`<span class="qc-seat empty"><span class="qc-av">+</span><b>等待加入</b></span>`);
    }
  }
  return `<section class="qc-roomhead">
    <div class="rhTop">
      <div>
        <p class="rhKicker">${room.ai ? '单机 AI 练习' : room.visibility === 'public' ? '公开房间' : '私密房间'}</p>
        <h2>${esc(ART[room.game]?.name || room.game)}</h2>
        <p class="rhCode">房间码 <b>${esc(room.code)}</b> <button class="qc-mini" id="qcCopyCode" type="button">复制</button></p>
      </div>
      <div class="rhActions">
        ${room.ai ? '' : `<button class="qc-btn" id="qcInvite">二维码邀请</button><button class="qc-btn" id="qcRoomFriends">邀请好友</button>`}
        ${(host || room.visibility === 'private') && (!room.engine || room.engine.over) && room.game !== 'ledger' ? `<button class="qc-btn primary" id="qcStart" ${canStart ? '' : 'disabled'}>${room.engine?.over ? '再来一局' : canStart ? '开始游戏' : `等待玩家 ${room.members.length}/${max}`}</button>` : ''}
        <button class="qc-btn" id="qcLeave">退出房间</button>
      </div>
    </div>
    <div class="rhSeats">${seats.join('')}</div>
    <div id="qcInviteBox" hidden></div>
  </section>`;
}
let roomShellKey = '';
function renderRoom(force = false) {
  if (!room) return;
  const e = room.engine;
  const focused = document.activeElement?.id;
  if (e?.kind === 'party' && focused && ['qcWheelOptions', 'qcTruthOptions'].includes(focused)) return;
  page = 'room'; backAction = leaveRoom;
  let body = roomHeader();
  const waiting = !room.ai && room.members.length < (room.game === 'fish' ? 2 : MAX[room.game] || 2) && room.game !== 'party' && room.game !== 'ledger';
  if (!e && room.game !== 'ledger') {
    body += `<section class="qc-panel"><h2>${room.ai ? '准备开局' : '等待朋友加入'}</h2><p>${room.ai ? '点击右上角开始游戏，AI 会补满牌桌。' : '把房间码发给朋友，或点“二维码邀请”扫码进房。'}</p></section>`;
  }
  if (room.game === 'ledger') body += '<section class="qc-panel" id="qcLedgerBody">正在读取账本…</section>';
  if (e && ['gomoku', 'xiangqi'].includes(e.kind)) body += boardHTML(e);
  if (e?.kind === 'landlord') body += landlordHTML(e);
  if (e?.kind === 'party') body += partyHTML(e);
  /* 同一间房、人数没变时只更新游戏区，不再整页重建（避免点一下闪一下） */
  const shellKey = room.id + '|' + room.members.length + '|' + (e ? e.kind + (e.over ? ':over' : '') : 'wait');
  const shellHTML = () => shell(ART[room.game]?.name || room.game, `<div id="qcRoomBody">${body}</div>`, `<span class="qc-chip">${room.ai ? 'AI 练习' : room.visibility === 'public' ? '公开房' : '私密房'}</span>`, room.ai ? '单机练习局' : `房间 ${room.code}`);
  if (force || roomShellKey !== shellKey) {
    roomShellKey = shellKey;
    boardSig = ''; llSig = '';
    shellHTML();
  } else {
    const host = $('qcRoomBody');
    if (host) host.innerHTML = body;
    else { roomShellKey = shellKey; boardSig = ''; llSig = ''; shellHTML(); }
  }
  root.dataset.game = room.game;
  $('qcStart') && ($('qcStart').onclick = () => safe(async () => { room = (await api('room/start')).room; selected = null; cardsSelected.clear(); boardSnap = null; lastMark = []; renderRoom(); }));
  $('qcLeave') && ($('qcLeave').onclick = () => safe(leaveRoom));
  $('qcCopyCode') && ($('qcCopyCode').onclick = () => safe(async () => { try { await navigator.clipboard.writeText(room.code); toast('房间码已复制'); } catch { toast('房间码：' + room.code); } }));
  $('qcInvite') && ($('qcInvite').onclick = () => safe(showInvite));
  $('qcRoomFriends') && ($('qcRoomFriends').onclick = () => safe(showFriends));
  if (room.game === 'ledger') loadLedger();
  if (e && ['gomoku', 'xiangqi'].includes(e.kind)) bindBoard();
  if (e?.kind === 'landlord') bindLandlord();
  if (e?.kind === 'party') bindParty();
  if (e?.kind === 'fishmp') {
    if (!e.over) safe(() => window.QCFishGame?.openMP());
    else if (e.kind === 'fishmp' && e.over && !document.getElementById('qcFishMpResultNote')) {
      const host = $('qcRoomBody');
      if (host) host.insertAdjacentHTML('afterbegin', `<section class="qc-panel" id="qcFishMpResultNote"><h2>🏁 本局结束</h2><p>${esc(e.reason || '')}</p><p class="qc-muted">点击「再来一局」或退出房间。</p></section>`);
    }
  }
  roomSoundCheck(e);
  if (waiting && !e) {
    // 房主等待时给一个明确的提示
    setTimeout(() => { if (page === 'room' && room && !room.engine) {} }, 0);
  }
}
async function showInvite() {
  const el = $('qcInviteBox');
  if (!el) return;
  el.hidden = !el.hidden;
  if (el.hidden) return;
  const link = location.origin + '/?join=' + room.id + '&invite=' + room.invite;
  const response = await fetch('/invite-qr?room=' + encodeURIComponent(room.id) + '&token=' + encodeURIComponent(userProfile.token), { referrerPolicy: 'no-referrer' });
  if (!response.ok) throw Error('二维码生成失败');
  const blob = await response.blob(), src = URL.createObjectURL(blob);
  el.innerHTML = `<div class="qc-qrbox"><img class="qc-qr" src="${src}" alt="扫码加入房间"><div><b>扫码一起玩</b><p class="qc-muted">游客也能直接加入。</p><input class="qc-input" readonly value="${esc(link)}"><button class="qc-btn" id="qcCopyInvite">复制邀请链接</button></div></div>`;
  $('qcCopyInvite').onclick = () => safe(async () => {
    try { await navigator.clipboard.writeText(link); toast('邀请链接已复制'); }
    catch { el.querySelector('input').select(); document.execCommand('copy'); toast('邀请链接已复制'); }
  });
}

/* ---------------- 音效（统一走 /platform/sfx.js 的合成器） ---------------- */
const qcSfx = {
  move: () => window.QCSFX?.play('place'),
  card: () => window.QCSFX?.play('flip'),
  gulp: () => window.QCSFX?.play('eat'),
  hurt: () => window.QCSFX?.play('hurt'),
  tap: () => window.QCSFX?.play('tap'),
  coin: () => window.QCSFX?.play('coin'),
  win: () => window.QCSFX?.play('win'),
  lose: () => window.QCSFX?.play('lose'),
  dice: () => window.QCSFX?.play('dice'),
  reveal: () => window.QCSFX?.play('reveal')
};
let boardSig = '', llSig = '', overSig = '';
function roomSoundCheck(e) {
  if (!e) { overSig = ''; return; }
  if (e.kind === 'gomoku' || e.kind === 'xiangqi') {
    const sig = e.moves + '|' + (e.log && e.log[0] || '');
    if (boardSig && sig !== boardSig) qcSfx.move();
    boardSig = sig;
  } else boardSig = '';
  if (e.kind === 'landlord') {
    const sig = e.phase + '|' + (e.last ? e.last.seat + ':' + e.last.cards.join(',') : 'bid' + e.bidHigh) + '|' + (e.counts || []).join(',');
    if (llSig && sig !== llSig) qcSfx.card();
    llSig = sig;
  } else llSig = '';
  if (e.kind === 'party') {
    const sig = JSON.stringify([e.dice, e.choice, e.question, e.flight && e.flight.last, e.flight && e.flight.winner]);
    if (partySig && sig !== partySig) {
      if (e.flight && e.flight.last && partySig !== sig) qcSfx.dice();
      else if (e.choice || e.question) qcSfx.reveal();
    }
    partySig = sig;
  }
  /* 胜负：同一局只响一次（快照会重复推送，靠 key 去重） */
  if (e.over) {
    const key = room?.id + '|' + (e.moves ?? 0) + '|' + (e.reason || '');
    if (roomOverKey !== key) {
      roomOverKey = key;
      const me = room ? room.members.findIndex(m => m.id === profile?.id) : -1;
      const win = e.winner === me || e.winner === 'all' || (Array.isArray(e.winningTeam) && e.winningTeam.includes(me));
      const draw = e.winner === 'draw';
      setTimeout(() => window.QCSFX?.play(draw ? 'draw' : win ? 'win' : 'lose'), 120);
      setTimeout(() => { if (win && !draw) window.QCSFX?.play('reward'); }, 780);
    }
  } else {
    roomOverKey = '';
  }
}
let partySig = '', roomOverKey = '';

/* ---------------- 棋类 ---------------- */
/* 最后一手：对比上一帧棋盘求差集，避免服务端额外传字段 */
let boardSnap = null, lastMark = [];
function diffBoard(e) {
  const sig = e.board.map(p => e.kind === 'gomoku' ? String(p) : (p ? p.s + p.t : ''));
  if (!boardSnap || boardSnap.kind !== e.kind || boardSnap.sig.length !== sig.length) { boardSnap = { kind: e.kind, sig }; lastMark = []; return; }
  const changed = [];
  /* 只标记「落点」：起手格现在变空了，标它反而让人以为下到那儿 */
  for (let n = 0; n < sig.length; n++) if (sig[n] !== boardSnap.sig[n] && sig[n]) changed.push(n);
  boardSnap = { kind: e.kind, sig };
  if (changed.length && changed.length <= 3) lastMark = changed;
  if (!changed.length && !e.over) return;
}
/* ---- 客户端象棋规则：与服务端 engines.js 完全一致（用于本地预判和可走位提示）。
   改动这里必须同步 platform/engines.js，否则会出现"本地能走、服务器拒绝"。 ---- */
const inRangeC = (x, y, w, h) => x >= 0 && x < w && y >= 0 && y < h;
function betweenC(board, from, to, w) {
  const x = from % w, y = Math.floor(from / w), xx = to % w, yy = Math.floor(to / w);
  if (x !== xx && y !== yy) return -1;
  const step = x === xx ? (yy > y ? w : -w) : (xx > x ? 1 : -1);
  let n = 0;
  for (let i = from + step; i !== to; i += step) if (board[i]) n++;
  return n;
}
function xqPseudoC(board, from, to) {
  const p = board[from], q = board[to];
  if (!p || q?.s === p.s || from === to) return false;
  const x = from % 9, y = Math.floor(from / 9), xx = to % 9, yy = Math.floor(to / 9);
  const dx = xx - x, dy = yy - y, ax = Math.abs(dx), ay = Math.abs(dy);
  switch (p.t) {
    case 'r': return betweenC(board, from, to, 9) === 0;
    case 'c': return betweenC(board, from, to, 9) === (q ? 1 : 0);
    case 'n': return ax * ay === 2 && !board[ay === 2 ? from + Math.sign(dy) * 9 : from + Math.sign(dx)];
    case 'b': return ax === 2 && ay === 2 && (p.s === 0 ? yy >= 5 : yy <= 4) && !board[from + Math.sign(dy) * 9 + Math.sign(dx)];
    case 'a': return ax === 1 && ay === 1 && xx >= 3 && xx <= 5 && (p.s === 0 ? yy >= 7 : yy <= 2);
    case 'k': return q?.t === 'k' && x === xx && betweenC(board, from, to, 9) === 0 || (ax + ay === 1 && xx >= 3 && xx <= 5 && (p.s === 0 ? yy >= 7 : yy <= 2));
    case 'p': return dx === 0 && dy === (p.s === 0 ? -1 : 1) || dy === 0 && ax === 1 && (p.s === 0 ? y <= 4 : y >= 5);
  }
  return false;
}
function xqCheckC(board, seat) {
  const king = board.findIndex(p => p?.s === seat && p.t === 'k');
  if (king < 0) return true;
  return board.some((p, i) => p && p.s !== seat && xqPseudoC(board, i, king));
}
function xqLegalC(board, f, t, s) {
  if (!Number.isInteger(f) || !Number.isInteger(t)
    || !inRangeC(f % 9, Math.floor(f / 9), 9, 10) || !inRangeC(t % 9, Math.floor(t / 9), 9, 10)
    || board[f]?.s !== s || !xqPseudoC(board, f, t)) return false;
  const b = board.slice(); b[t] = b[f]; b[f] = null;
  return !xqCheckC(b, s);
}
/* 选中棋子后把可走位置标出来（象棋专属） */
function xqHints(e, from, seat) {
  const out = [];
  for (let t = 0; t < 90; t++) if (t !== from && xqLegalC(e.board, from, t, seat)) out.push(t);
  return out;
}
function boardHTML(e) {
  diffBoard(e);
  const i = room.members.findIndex(m => m.id === profile.id);
  const names = e.kind === 'gomoku' ? ['黑棋', '白棋'] : ['红方', '黑方'];
  const w = e.kind === 'gomoku' ? 15 : 9, h = e.kind === 'xiangqi' ? 10 : 15;
  const labels = { k: ['帅', '将'], a: ['仕', '士'], b: ['相', '象'], n: ['马', '马'], r: ['车', '车'], c: ['炮', '炮'], p: ['兵', '卒'] };
  const opponent = room.members[1 - i];
  const hintCells = e.kind === 'xiangqi' && selected !== null ? new Set(xqHints(e, selected, i)) : new Set();
  return `<section class="qc-panel qc-boardPanel">
    <div class="qc-versus"><div class="vsSide me"><span class="qc-av">${esc(profile.avatar || '🙂')}</span><b>你</b><small>${names[i]}</small></div><span class="vsTag">VS</span><div class="vsSide"><span class="qc-av">${opponent ? esc(opponent.avatar) : '🤖'}</span><b>${opponent ? esc(opponent.nickname) : 'AI'}</b><small>${names[1 - i]}</small></div></div>
    <div class="qc-boardWrap"><div class="qc-boardRatio" style="padding-top:${(h / w * 100).toFixed(3)}%"><div class="qc-board" style="grid-template-columns:repeat(${w},1fr);grid-template-rows:repeat(${h},1fr)">${e.board.map((p, n) => {
      let cls = 'qc-cell', text = '';
      if (e.kind === 'gomoku') cls += p === 1 ? ' black' : p === 2 ? ' white' : '';
      else if (p) { cls += p.s === 0 ? ' red' : ''; text = `<span class="qc-piece">${labels[p.t][p.s]}</span>`; }
      if (selected === n) cls += ' selected';
      if (lastMark.includes(n)) cls += ' last';
      if (hintCells.has(n)) cls += e.board[n] ? ' hint-cap' : ' hint';
      return `<button class="${cls}" data-cell="${n}" type="button" aria-label="第 ${Math.floor(n / w) + 1} 行第 ${n % w + 1} 列">${text}</button>`;
    }).join('')}</div></div></div>
    <div class="qc-boardbar"><b>${e.over ? esc(e.reason) : (room.ai && e.turn !== i ? 'AI 思考中…' : `轮到${names[e.turn]}`)}</b><span class="qc-chip">你是${names[i] || '观众'}</span><button class="qc-btn" id="qcRules">规则</button></div>
    <p id="qcRuleText" class="qc-muted qc-rules" hidden>${e.kind === 'gomoku' ? '任一方向连续五子获胜，无禁手。' : '红先。马走日、象走田且不过河，士帅在九宫；不得送将或将帅照面。对方无合法走法判负。'}</p>
    ${e.over ? `<div class="qc-results">${esc(e.reason)} · ${e.winner === 'draw' ? '和棋' : e.winner === i ? '你赢了！' : '本局结束'}</div>` : ''}
  </section>`;
}
async function act(action) { const j = await api('room/action', { action }); room = j.room; renderRoom(); }
/* 服务端拒绝时把局面拉回来，避免本地预判的棋子留在屏幕上 */
async function resyncRoom() {
  try { const j = await api('room/current'); if (j.room) { room = j.room; selected = null; renderRoom(); } } catch (e) { }
}
function bindBoard() {
  $('qcRules').onclick = () => { $('qcRuleText').hidden = !$('qcRuleText').hidden; };
  for (const b of root.querySelectorAll('[data-cell]')) {
    b.onclick = () => safe(async () => {
      const e = room.engine, i = room.members.findIndex(m => m.id === profile.id), n = Number(b.dataset.cell);
      if (e.over) return;
      if (e.turn !== i) return toast('等待对方行棋');

      /* 五子棋：本地先落子，立刻能看到自己的棋子，服务端确认后覆盖 */
      if (e.kind === 'gomoku') {
        if (e.board[n]) return;
        window.QCSFX?.play('place');
        e.board[n] = i + 1;
        renderRoom();
        try {
          const j = await api('room/action', { action: { index: n } });
          room = j.room; renderRoom();
        } catch (err) { await resyncRoom(); throw err; }
        return;
      }

      /* 象棋：选中 → 高亮可走位；点合法落点 → 本地先走，再等服务端确认 */
      if (e.board[n]?.s === i) {
        selected = selected === n ? null : n;
        window.QCSFX?.play('select');
        renderRoom();
        return;
      }
      if (selected === null) return toast('先选中自己的棋子');
      const from = selected;
      if (!xqLegalC(e.board, from, n, i)) return toast('这步走不了');
      selected = null;
      window.QCSFX?.play('place');
      const piece = e.board[from];
      e.board[from] = null; e.board[n] = piece;
      renderRoom();
      try {
        const j = await api('room/action', { action: { from, to: n } });
        room = j.room; renderRoom();
      } catch (err) { await resyncRoom(); throw err; }
    });
  }
}

/* ---------------- 斗地主 ---------------- */
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS = ['♣', '♦', '♥', '♠'];
function cardInfo(c) {
  if (c === 52) return { rank: '小', suit: '王', red: false, joker: true };
  if (c === 53) return { rank: '大', suit: '王', red: true, joker: true };
  return { rank: RANKS[Math.floor(c / 4)], suit: SUITS[c % 4], red: c % 4 === 1 || c % 4 === 2, joker: false };
}
function cardFace(c, cls = '') {
  const i = cardInfo(c);
  return `<button class="pcard${i.red ? ' red' : ''}${i.joker ? ' joker' : ''}${cls}" data-card="${c}" type="button"><span class="pr">${i.rank}</span><span class="ps">${i.suit}</span><span class="pc">${i.suit}</span></button>`;
}
function cardMini(c) {
  const i = cardInfo(c);
  return `<span class="pcard mini${i.red ? ' red' : ''}${i.joker ? ' joker' : ''}"><span class="pr">${i.rank}</span><span class="ps">${i.suit}</span></span>`;
}
function landlordHTML(e) {
  const i = room.members.findIndex(m => m.id === profile.id);
  const left = (i + 1) % 3, right = (i + 2) % 3;
  const seat = (s, pos) => {
    const m = room.members[s];
    const isAI = !m;
    const name = s === i ? '你' : isAI ? 'AI ' + (s + 1) : m.nickname;
    const av = s === i ? (profile.avatar || '🙂') : isAI ? '🤖' : (m.avatar || '🙂');
    const land = e.landlord === s;
    const active = !e.over && e.turn === s;
    return `<div class="llSeat ${pos}${active ? ' active' : ''}${e.over && (e.winner === s || e.winningTeam?.includes(s)) ? ' win' : ''}">
      <span class="llAv">${av}${land ? '<i class="llCrown">👑</i>' : ''}</span>
      <span class="llText"><b>${esc(name)}</b><small>${land ? '地主 · ' : ''}${e.counts[s]} 张</small></span>
      ${active && pos !== 'me' ? '<em class="llTurn">思考中…</em>' : ''}
    </div>`;
  };
  const handRows = [];
  for (let k = 0; k < e.hand.length; k += 10) handRows.push(e.hand.slice(k, k + 10));
  const bottom = e.bottom.length
    ? e.bottom.map(cardMini).join('')
    : '<span class="pcard mini back"></span><span class="pcard mini back"></span><span class="pcard mini back"></span>';
  const last = e.last
    ? `<div class="llPlayed">${e.last.cards.map(cardMini).join('')}<small>${e.last.seat === i ? '你' : '上家'}出的</small></div>`
    : `<div class="llPlayed free">${e.phase === 'bid' ? '等待叫分' : '自由出牌'}</div>`;
  const bidding = e.phase === 'bid';
  const myTurn = !e.over && e.turn === i;
  const actions = e.over ? '' : bidding
    ? (myTurn
      ? `<div class="llBid">${[0, 1, 2, 3].map(n => `<button class="qc-btn ${n === 3 ? 'primary' : ''}" data-bid="${n}" ${n && n <= e.bidHigh ? 'disabled' : ''}>${n ? n + ' 分' : '不叫'}</button>`).join('')}</div>`
      : `<div class="llWait">等待 ${e.turn + 1} 号叫分…</div>`)
    : `<div class="llActions"><button class="qc-btn primary" id="qcPlayCards" ${myTurn ? '' : 'disabled'}>出牌</button><button class="qc-btn" id="qcPassCards" ${myTurn && e.last ? '' : 'disabled'}>不出</button><span class="llHint">${myTurn ? '点牌选中，再点出牌' : '等待其他玩家…'}</span></div>`;
  const result = e.over ? `<div class="llResult"><b>${e.winner === i || e.winningTeam?.includes(i) ? '你赢了！' : e.winner === 'draw' ? '本局结束' : '惜败'}</b><p>${esc(e.reason || '')}</p><div class="llResultBtns"><button class="qc-btn primary" id="qcAgain">再来一局</button><button class="qc-btn" id="qcLeaveGame">退出房间</button></div></div>` : '';
  return `<section class="qc-landlord">
    <div class="llTable">
      <div class="llFelt"></div>
      ${seat(left, 'left')}${seat(right, 'right')}
      <div class="llCenter"><div class="llBottom"><small>底牌</small>${bottom}</div>${last}</div>
      ${seat(i, 'me')}
    </div>
    <div class="llHandWrap">
      <div class="llHandInfo"><b>你的手牌</b><span>${e.hand.length} 张${e.landlord === i ? ' · 你是地主' : ''}</span></div>
      <div class="llHand">${handRows.map(row => `<div class="llHandRow">${row.map(c => cardFace(c, cardsSelected.has(c) ? ' sel' : '')).join('')}</div>`).join('')}</div>
      ${actions}
    </div>
    ${result}
  </section>`;
}
function bindLandlord() {
  for (const b of root.querySelectorAll('[data-card]')) {
    b.onclick = () => {
      const c = Number(b.dataset.card);
      cardsSelected.has(c) ? cardsSelected.delete(c) : cardsSelected.add(c);
      b.classList.toggle('sel', cardsSelected.has(c));
    };
  }
  for (const b of root.querySelectorAll('[data-bid]')) b.onclick = () => safe(() => act({ bid: Number(b.dataset.bid) }));
  $('qcPlayCards') && ($('qcPlayCards').onclick = () => safe(async () => {
    if (!cardsSelected.size) return toast('先选要出的牌');
    const cards = [...cardsSelected];
    cardsSelected.clear();
    await act({ cards });
  }));
  $('qcPassCards') && ($('qcPassCards').onclick = () => safe(async () => { cardsSelected.clear(); await act({ cards: [] }); }));
  $('qcAgain') && ($('qcAgain').onclick = () => safe(async () => { room = (await api('room/start')).room; cardsSelected.clear(); renderRoom(); }));
  $('qcLeaveGame') && ($('qcLeaveGame').onclick = () => safe(leaveRoom));
}

/* ---------------- 聚会工具箱 ---------------- */
let partyTool = 'truth';
function partyHTML(e) {
  const tools = [['truth', '💬', '开聊'], ['dice', '🎲', '骰子'], ['wheel', '🎡', '转盘']];
  return `<div class="qc-tooltabs">${tools.map(([k, i, n]) => `<button class="qc-tooltab ${partyTool === k ? 'on' : ''}" data-tool="${k}" type="button"><i>${i}</i><b>${n}</b></button>`).join('')}</div>
  <div id="qcPartyPanel">${partyPanel(e)}</div>
  <section class="qc-panel"><h2>本桌记录</h2>${e.log.map(t => `<p class="qc-log">${esc(t)}</p>`).join('') || '<p class="qc-muted">开局后，这里会留下欢乐记录。</p>'}</section>`;
}

/* ---- 聚会题库状态（模块级，重建面板不丢） ---- */
let partyCat = 'truth', partyAdult = false, partyTags = null, partyDrawn = '';
function qbank() { return window.QCTruthBank; }
function tagList() {
  const B = qbank();
  if (!B) return [];
  if (!partyTags) partyTags = new Set(B.TAGS.filter(t => t.def).map(t => t.key));
  return B.TAGS;
}
function activeTags() {
  const tags = tagList();
  return tags.filter(t => partyTags.has(t.key) && (!t.adult || partyAdult)).map(t => t.key);
}
function qbankPanel(e) {
  const B = qbank();
  if (!B) return `<section class="qc-panel"><h2>话题库加载中…</h2><p class="qc-muted">如果一直停在这里，刷新一下页面。</p></section>`;
  const tags = tagList();
  const act = activeTags();
  const n = B.count([partyCat], act);
  const cat = B.CATS.find(c => c.key === partyCat) || B.CATS[0];
  const tagNames = act.map(k => tags.find(t => t.key === k)?.name).filter(Boolean).join(' · ') || '未选题材';
  const plainTags = tags.filter(t => !t.adult);
  return `<section class="qc-panel qc-qbank">
    <div class="qc-qbankHead">
      <div>
        <p class="qc-qkicker">今晚聊什么</p>
        <h2>${cat.name}<span class="qc-chip">${n} 道</span></h2>
      </div>
      <button class="qc-btn qc-qopen" id="qcQOpen" type="button">🖥 全屏开聊</button>
    </div>
    <div class="qc-qcats">${B.CATS.map(c => `<button class="qc-qcat ${partyCat === c.key ? 'on' : ''}" data-qcat="${c.key}" type="button"><i>${c.icon}</i><b>${c.name}</b><small>${c.desc}</small></button>`).join('')}</div>
    <div class="qc-qtags">${plainTags.map(t => `<button class="qc-qtag ${partyTags.has(t.key) ? 'on' : ''}" data-qtag="${t.key}" type="button">${t.name}</button>`).join('')}</div>
    <label class="qc-qadultRow">
      <span class="qarIcon">🔞</span>
      <span class="qarText"><b>暧昧 / 成人向题目</b><small>默认关闭 · 打开后才会抽到偏暧昧的题</small></span>
      <span class="qc-switch"><input type="checkbox" id="qcQAdult" ${partyAdult ? 'checked' : ''}><i></i></span>
    </label>
    <div class="qc-qcard" id="qcQCard">
      <div class="qc-qmeta"><span>${cat.icon} ${cat.name}</span><em>${tagNames}</em></div>
      <p class="qc-question" id="qcQText">${esc(e.question || '点下面的按钮，抽一道属于本轮的题。')}</p>
    </div>
    <div class="qc-actions qc-center">
      <button class="qc-btn primary wide" id="qcTruth">抽一道题</button>
      <button class="qc-btn" id="qcQFull">投大屏</button>
    </div>
    <details class="qc-qcustom"><summary>自定义题目（每行一条，抽题时优先用）</summary><textarea id="qcTruthOptions" class="qc-input" placeholder="把你自己想玩的题目写在这里"></textarea><p class="qc-muted">留空则使用官方话题库。</p></details>
  </section>`;
}
function qbankFull(text) {
  if (!text) { toast('先抽一道题'); return; }
  const old = document.getElementById('qcBigQ');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'qcBigQ'; el.className = 'qc-bigq';
  el.innerHTML = `<div class="qc-bigqInner"><p>${esc(text)}</p><small>点任意处关闭</small></div>`;
  el.onclick = () => el.remove();
  document.body.append(el);
  window.QCSFX?.play('reveal');
}

function partyPanel(e) {
  if (partyTool === 'wheel') {
    const opt = localStorage.getItem('qc_wheel_template') || '唱一句歌\n夸一位朋友\n分享开心的事\n做一个鬼脸';
    return `<section class="qc-panel"><h2>自定义转盘</h2><p class="qc-muted">每行一个选项，2–30 个。模板只保存在当前设备。</p><textarea id="qcWheelOptions" class="qc-input" aria-label="每行一个转盘选项">${esc(opt)}</textarea><div class="qc-wheel" id="qcWheel"><span>${esc(e.choice || '下一份惊喜')}</span></div><div class="qc-actions qc-center"><button class="qc-btn primary" id="qcSpin">转起来</button><button class="qc-btn" id="qcSaveWheel">保存模板</button></div></section>`;
  }
  if (partyTool === 'truth') return qbankPanel(e);
  return `<section class="qc-panel"><h2>掷骰子</h2><p class="qc-muted">选好骰子数量，掷出这一轮的点数。</p><select id="qcDiceN" class="qc-input">${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select><div class="qc-dice">${e.dice.map(n => '⚀⚁⚂⚃⚄⚅'[n - 1]).join(' ') || '—'}</div><button class="qc-btn primary wide" id="qcRollDice">掷骰子</button></section>`;
}
function bindParty() {
  for (const b of root.querySelectorAll('[data-tool]')) b.onclick = () => { partyTool = b.dataset.tool; renderRoom(); };
  $('qcRollDice') && ($('qcRollDice').onclick = () => safe(() => act({ kind: 'dice', n: Number($('qcDiceN').value) })));
  $('qcSaveWheel') && ($('qcSaveWheel').onclick = () => { localStorage.setItem('qc_wheel_template', $('qcWheelOptions').value); toast('模板已保存在当前设备'); });
  $('qcSpin') && ($('qcSpin').onclick = () => safe(async () => {
    const options = $('qcWheelOptions').value.split('\n').map(v => v.trim()).filter(Boolean);
    localStorage.setItem('qc_wheel_template', $('qcWheelOptions').value);
    await act({ kind: 'wheel', options });
    $('qcWheel') && $('qcWheel').classList.add('qc-animate');
  }));
  $('qcTruth') && ($('qcTruth').onclick = () => safe(async () => {
    const custom = ($('qcTruthOptions')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const B = qbank();
    const qs = custom.length ? custom : (B ? B.pick([partyCat], activeTags(), 40) : []);
    if (!qs.length) { toast('这个组合下没有题目，换一个题材试试'); return; }
    await act({ kind: 'truth', questions: qs.slice(0, 60) });
    window.QCSFX?.play('reveal');
  }));
  for (const b of root.querySelectorAll('[data-qcat]')) b.onclick = () => { partyCat = b.dataset.qcat; renderRoom(); };
  for (const b of root.querySelectorAll('[data-qtag]')) b.onclick = () => {
    const k = b.dataset.qtag;
    const t = tagList().find(x => x.key === k);
    if (t?.adult && !partyAdult) { toast('先打开「暧昧/成人向」开关'); return; }
    if (partyTags.has(k)) partyTags.delete(k); else partyTags.add(k);
    if (!partyTags.size) partyTags.add(k);
    renderRoom();
  };
  $('qcQAdult') && ($('qcQAdult').onchange = ev => {
    partyAdult = ev.target.checked;
    if (partyAdult) partyTags.add('spicy');
    else partyTags.delete('spicy');
    renderRoom();
  });
  $('qcQFull') && ($('qcQFull').onclick = () => qbankFull($('qcQText')?.textContent?.trim() || room?.engine?.question || ''));
  $('qcQOpen') && ($('qcQOpen').onclick = () => safe(() => { window.QCSFX?.unlock(); openQPage(); }));
}

/* ---------------- 账本 ---------------- */
async function loadLedger() {
  try {
    const j = await api('ledger');
    ledger = j;
    const el = $('qcLedgerBody');
    if (!el) return;
    const participants = j.ledger.members || room.members;
    if (participants.length < 2) {
      el.innerHTML = `<h2>本桌账本</h2><div class="qc-empty small"><span>👥</span><b>还只有你一个人</b><p>把房间码 <b>${esc(room.code)}</b> 发给朋友，至少两个人才能开始记账。</p><button class="qc-btn primary" id="qcLedgerInvite">复制房间码</button></div>`;
      $('qcLedgerInvite').onclick = () => safe(async () => {
        try { await navigator.clipboard.writeText(room.code); toast('房间码已复制，发给朋友吧'); }
        catch { toast('房间码：' + room.code); }
      });
      return;
    }
    const opts = participants.map(m => `<option value="${esc(m.id)}">${esc(m.nickname)}</option>`).join('');
    const name = id => participants.find(m => m.id === id)?.nickname || id;
    el.innerHTML = `<h2>本桌账本</h2><p class="qc-muted">选择这笔谁应付谁。只记录关系，不会发起真实转账。</p>
      <div class="qc-cols"><div><label class="qc-label">应付方</label><select id="qcPayFrom" class="qc-input">${opts}</select></div><div><label class="qc-label">应收方</label><select id="qcPayTo" class="qc-input">${opts}</select></div></div>
      <label class="qc-label">金额（元）</label><input class="qc-input" id="qcAmount" type="number" min="0.01" step="0.01">
      <label class="qc-label">备注</label><input class="qc-input" id="qcLedgerNote" maxlength="100">
      <div class="qc-actions"><button id="qcAddEntry" class="qc-btn primary">记录一笔</button><button id="qcLedgerRefresh" class="qc-btn">刷新</button><button id="qcExportLedger" class="qc-btn">导出 CSV</button></div>
      <h2>净收支</h2>${Object.entries(j.balances).map(([id, n]) => `<div class="qc-balance"><span>${esc(name(id))}</span><b class="${n >= 0 ? 'in' : 'out'}">${n >= 0 ? '应收' : '应付'} ¥${(Math.abs(n) / 100).toFixed(2)}</b></div>`).join('')}
      <h2>结算建议</h2>${j.transfers.map(t => `<div class="qc-balance"><span>${esc(name(t.from))} → ${esc(name(t.to))}</span><b>¥${(t.cents / 100).toFixed(2)}</b></div>`).join('') || '<p class="qc-muted">目前无需结算。</p>'}
      <h2>流水</h2>${j.ledger.entries.slice().reverse().map(e => `<div class="qc-frow"><div class="qc-fmeta"><b>${esc(name(e.from))} → ${esc(name(e.to))} ¥${(e.cents / 100).toFixed(2)}</b><small>${esc(e.note)}${e.void ? '（已撤销）' : ''}</small></div>${!e.void ? `<button class="qc-btn" data-undo="${esc(e.id)}">撤销</button>` : ''}</div>`).join('') || '<p class="qc-muted">还没有流水，记下第一笔吧。</p>'}`;
    if (participants.length > 1) $('qcPayTo').selectedIndex = 1;
    $('qcAddEntry').onclick = () => safe(async () => {
      await api('ledger', { from: $('qcPayFrom').value, to: $('qcPayTo').value, amount: $('qcAmount').value, note: $('qcLedgerNote').value, requestId: crypto.randomUUID ? crypto.randomUUID() : guestId + Date.now(), revision: ledger.ledger.revision });
      await loadLedger();
    });
    $('qcLedgerRefresh').onclick = () => safe(loadLedger);
    $('qcExportLedger').onclick = () => {
      const rows = [['时间', '应付方', '应收方', '金额', '备注', '状态']].concat(j.ledger.entries.map(e => [new Date(e.time).toLocaleString(), name(e.from), name(e.to), (e.cents / 100).toFixed(2), e.note, e.void ? '已撤销' : '有效']));
      download('千城账本.csv', '\ufeff' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');
    };
    for (const b of el.querySelectorAll('[data-undo]')) b.onclick = () => safe(async () => { await api('ledger', { undo: b.dataset.undo }); await loadLedger(); });
  } catch (e) { toast(e.message); }
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- 旧游戏接入 ---------------- */
function legacyJoin(game, code) {
  hide();
  if (game === 'cat') {
    showPage('mode'); $('btnNet').click(); $('netCode').value = code;
    setTimeout(() => $('btnJoinRoom').click(), 300);
  } else {
    showPage('qqnet'); $('qqNetCode').value = code;
    setTimeout(() => { window.__qqNavAt = 0; $('qqBtnJoin').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, 300);
  }
}
async function legacyInvite() {
  await ensure();
  const j = await api('legacy/invite');
  page = 'legacyinvite'; backAction = () => renderRoom();
  shell('扫码邀请好友', `<section class="qc-panel"><p>进入同一间${j.game === 'cat' ? '生气猫' : '球球大作战'}房间，房间码 ${esc(j.code)}</p><img class="qc-qr" src="/invite-qr?legacy=1&token=${encodeURIComponent(userProfile.token)}" referrerpolicy="no-referrer" alt="好友入房二维码"><input class="qc-input" readonly value="${esc(location.origin + '/?legacy=' + j.game + '&code=' + j.code)}"><button class="qc-btn" id="qcBackLegacy">回到房间</button></section>`);
  $('qcBackLegacy').onclick = () => { root.style.display = 'none'; page = ''; };
}
for (const id of ['btnInvite', 'qqBtnInvite']) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopImmediatePropagation(); safe(legacyInvite); }, true);
  el.onclick = e => { e.preventDefault(); e.stopImmediatePropagation(); safe(legacyInvite); };
}

/* ---------------- 主题 ---------------- */
function themeName() {
  const pref = localStorage.getItem('qc_theme') || 'system';
  return { system: '跟随系统', light: '浅色', dark: '深色' }[pref] || '跟随系统';
}
function theme() {
  const pref = localStorage.getItem('qc_theme') || 'system';
  const dark = pref === 'dark' || pref === 'system' && matchMedia('(prefers-color-scheme:dark)').matches;
  document.documentElement.dataset.qcTheme = dark ? 'dark' : 'light';
  const b = $('qcTheme');
  if (b) b.textContent = '主题：' + themeName();
}
function cycleTheme() {
  const modes = ['system', 'light', 'dark'];
  localStorage.setItem('qc_theme', modes[(modes.indexOf(localStorage.getItem('qc_theme') || 'system') + 1) % 3]);
  theme();
}
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', theme);

/* ---------------- 旧游戏建房可见性 ---------------- */
for (const [id, container] of [['netVisibility', 'netJoinView'], ['qqNetVisibility', 'qqJoinView']]) {
  const box = $(container) || $(id === 'netVisibility' ? 'netLobby' : 'qqNet')?.querySelector('.panel');
  if (!box) continue;
  const label = document.createElement('label');
  label.className = 'qc-visRow';
  label.innerHTML = `建房可见性 <select id="${id}" class="qc-visSelect"><option value="public">公开房间</option><option value="private">私密房间</option></select>`;
  const createBtn = $(id === 'netVisibility' ? 'btnCreateRoom' : 'qqBtnCreate');
  if (createBtn && createBtn.parentNode) createBtn.parentNode.insertBefore(label, createBtn);
  else box.append(label);
}
const originalSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  try {
    const m = JSON.parse(data);
    if (m.t === 'create' || m.t === 'qqcreate') {
      m.visibility = $(m.t === 'create' ? 'netVisibility' : 'qqNetVisibility')?.value || 'private';
      data = JSON.stringify(m);
    }
  } catch {}
  return originalSend.call(this, data);
};

/* ---------------- 公告 ---------------- */
let annList = [];
async function fetchAnnouncements() {
  try {
    const j = await fetch('/api/announcement').then(r => r.json());
    annList = j.list || [];
    return j;
  } catch { return { ok: false }; }
}
const annKey = a => 'qc_ann_' + a.id;   // 每条公告最多只弹一次
async function loadAnnouncement() {
  const j = await fetchAnnouncements();
  const a = j.announcement;
  if (!a) return;
  const key = annKey(a);
  if (localStorage.getItem(key) === '1') return;
  if (a.popup === false) return showAnnBanner(a, key);
  showAnnModal(a, key);
}
function showAnnModal(a, key) {
  document.querySelector('.qc-annMask')?.remove();
  document.querySelector('.qc-annBar')?.remove();
  const mask = document.createElement('div');
  mask.className = 'qc-annMask';
  mask.innerHTML = `<div class="qc-annCard" role="dialog" aria-modal="true" aria-label="公告">
    <span class="qc-annBadge ${a.level === 'important' ? 'hot' : ''}">${a.level === 'important' ? '重要公告' : '公告'}</span>
    <h2>${esc(a.title)}</h2>
    <small class="qc-annTime">${new Date(a.updated || Date.now()).toLocaleString('zh-CN', { hour12: false })}</small>
    <div class="qc-annBody">${esc(a.body).replace(/\n/g, '<br>')}</div>
    <div class="qc-annOps"><button class="qc-btn primary wide" id="qcAnnOk">我知道了</button><button class="qc-btn" id="qcAnnAll">查看全部公告</button></div>
  </div>`;
  document.body.append(mask);
  const close = () => { localStorage.setItem(key, '1'); mask.remove(); };
  mask.querySelector('#qcAnnOk').onclick = close;
  mask.querySelector('#qcAnnAll').onclick = () => { close(); safe(() => showAnnouncements()); };
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
}
function showAnnBanner(a, key) {
  const main = document.querySelector('.lobbyMain');
  if (!main || document.querySelector('.qc-annBar')) return;
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'qc-annBar' + (a.level === 'important' ? ' hot' : '');
  bar.innerHTML = `<span class="qc-annBarTag">公告</span><b>${esc(a.title)}</b><span class="qc-annBarGo">查看 ›</span>`;
  bar.onclick = () => { bar.remove(); showAnnModal(a, key); };
  main.insertBefore(bar, main.querySelector('.lobbyGrid') || null);
}
async function showAnnouncements() {
  const from = page;
  page = 'announcements'; backAction = from === 'me' ? showMe : hide;
  if (!annList.length) await fetchAnnouncements();
  shell('公告', annList.length ? annList.map(a => `<section class="qc-panel qc-annItem">
      <div class="qc-annHead"><span class="qc-chip ${a.level === 'important' ? 'gold' : ''}">${a.level === 'important' ? '重要' : '公告'}</span><small>${new Date(a.updated || 0).toLocaleString('zh-CN', { hour12: false })}</small></div>
      <h2>${esc(a.title)}</h2>
      <p>${esc(a.body).replace(/\n/g, '<br>')}</p>
    </section>`).join('') : `<div class="qc-empty"><span>📢</span><b>还没有公告</b><p>有活动或版本更新时，会出现在这里。</p></div>`, '', `${annList.length} 条`);
}

/* ---------------- 启动 ---------------- */
window.addEventListener('qc-favorites-changed', e => {
  if (profile) api('profile', { favorites: e.detail }).catch(err => toast(err.message));
});
window.Platform = {
  openGame: g => safe(() => showGame(g)),
  openSection: n => safe(() => openSection(n)),
  account: () => safe(() => openSection('me')),
  rooms: () => safe(() => openSection('rooms')),
  arcade: () => safe(() => showArcade()),
  home: () => hide(),
  refreshLobby: () => refreshLobby(),
  api, hide
};
/* 大鱼吃小鱼（单机版）桥接：登录 / 战绩上报 / 道具 / 复活 / 返回详情页 */
window.QCFish = {
  report: async r => {
    const j = await api('solo/result', r);
    if (j?.profile) apply({ ...j.profile, guest: profile?.guest });
    return j;
  },
  buyShield: async count => {
    const j = await api('shield/buy', { count });
    if (j?.profile) apply({ ...j.profile, guest: profile?.guest });
    return j;
  },
  useShield: async matchId => {
    const j = await api('shield/use', { matchId });
    if (j?.profile) apply({ ...j.profile, guest: profile?.guest });
    return j;
  },
  revive: async matchId => {
    const j = await api('revive', { matchId });
    if (j?.profile) apply({ ...j.profile, guest: profile?.guest });
    return j;
  },
  profile: () => profile,
  /* 联机竞速：房间引擎读取 / WS 输入 / 离开房间 / 成员表 */
  roomEngine: () => room?.engine || null,
  sendInput: (x, y) => { try { if (socket && socket.readyState === 1) socket.send(JSON.stringify({ t: 'platformInput', x, y })); } catch (e) { } },
  leaveRoom: () => safe(leaveRoom),
  members: () => room?.members || [],
  mySeat: () => (room && profile ? room.members.findIndex(m => m.id === profile.id) : -1),
  track,
  back: () => { if (page !== 'game') safe(() => showGame('fish')); }
};
/* ---------------- 斗地主牌桌页面（独立 HTML，iframe 内嵌） ----------------
   页面是 /platform/dizhu.html（单文件、零依赖），通过 postMessage 回传战绩，
   金币只认服务端 clamp 后的结果，客户端上报的数值不可信。 */
function openDizhu() {
  closeDizhu();
  const el = document.createElement('div');
  el.id = 'qcDzWrap';
  el.className = 'qc-dzwrap';
  el.innerHTML = `<iframe id="qcDzFrame" src="/platform/dizhu.html?embed=1" title="斗地主牌桌" allow="autoplay; fullscreen"></iframe>`;
  document.body.append(el);
  document.documentElement.style.overflow = 'hidden';
  window.QCSFX?.unlock();
  track('game_open', { game: 'landlord', page: 'dizhu' });
}
function closeDizhu() {
  document.getElementById('qcDzWrap')?.remove();
  document.documentElement.style.overflow = '';
}
const DZ_MID = () => [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const d = e.data || {};
  if (d.type === 'dz-back') { closeDizhu(); return; }
  if (d.type !== 'dz-result') return;
  safe(async () => {
    const j = await api('solo/result', {
      game: 'landlord',
      win: !!d.win,
      score: Math.max(0, Math.min(999999, Math.abs(Math.round(Number(d.delta) || 0)))),
      bombs: Math.max(0, Math.min(12, Math.round(Number(d.bombs) || 0))),
      matchId: DZ_MID()
    });
    if (j?.profile) apply({ ...j.profile, guest: profile?.guest });
    toast(j?.coin ? `本局金币 +${j.coin}${j.record ? ' · 新纪录' : ''}` : '战绩已记录');
    window.QCSFX?.play(d.win ? 'cardWin' : 'cardLose');
  });
});

/* ---------------- 今晚聊什么（独立话题页面 /platform/party-q.html） ----------------
   比嵌在房间里的面板更好玩：3D 翻卡、光斑背景、大屏模式；页面自己带题库与音效。 */
/* 进聚会房间时自动打开「今晚聊什么」全屏页；同一间房只自动开一次，
   用户自己关掉后不会再被弹回来（想再看点面板上的「全屏开聊」） */
let qAutoFor = '';
function maybeAutoQ() {
  if (!room || room.game !== 'party') return;
  if (qAutoFor === room.id) return;
  qAutoFor = room.id;
  setTimeout(() => {
    if (room && room.game === 'party' && !document.getElementById('qcQWrap')) {
      try { window.QCSFX?.unlock(); } catch (e) { }
      openQPage();
    }
  }, 300);
}
function openQPage() {
  closeQPage();
  const el = document.createElement('div');
  el.id = 'qcQWrap';
  el.className = 'qc-dzwrap';
  const code = room?.code ? '&code=' + encodeURIComponent(room.code) : '';
  el.innerHTML = `<iframe id="qcQFrame" src="/platform/party-q.html?embed=1${code}" title="今晚聊什么" allow="autoplay"></iframe>`;
  document.body.append(el);
  document.documentElement.style.overflow = 'hidden';
}
function closeQPage() {
  document.getElementById('qcQWrap')?.remove();
  document.documentElement.style.overflow = '';
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'q-back') closeQPage();
});

/* 消消乐桥接：只暴露上报 / 返回 / 档案，游戏模块不直接碰 api */
window.QCM3 = {
  report: async r => {
    const j = await api('solo/result', r);
    if (j?.profile) apply({ ...j.profile, guest: profile?.guest });
    return j;
  },
  profile: () => profile,
  toast,
  back: () => safe(() => { page = ''; showGame('match3'); })
};
theme();
loadAnnouncement();
if (!sessionStorage.getItem('qc_visit')) { sessionStorage.setItem('qc_visit', '1'); track('visit'); }
if (userProfile.token) safe(async () => { const j = await api('me'); apply(j.profile); connect(); });
else refreshLobby();
const query = new URLSearchParams(location.search);
if (query.has('legacy')) safe(async () => { await ensure(); legacyJoin(query.get('legacy'), query.get('code')); history.replaceState({}, '', location.pathname); });
if (query.has('join')) safe(async () => { await join(query.get('join'), query.get('invite')); history.replaceState({}, '', location.pathname); });
})();

/* ==================== 大鱼吃小鱼 · 单机原生版 ====================
   从平台详情页进入的全屏单机游戏：吃小鱼长大，长成大白鲨通关。
   每类鱼有固定体型区间；3 条命；战绩经 /api/platform/solo/result 入库。
------------------------------------------------------------------ */
(() => {
'use strict';
if (window.QCFishGame) return;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const W = 480, H = 800;
/* 进化链：6 物种 × 3 等级 = 18 级（小白苗Ⅰ…大白鲨Ⅲ），成长线拉长 */
const GRADE_ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ'];
const SPECIES_CHAIN = [
  { name: '小鱼苗',  type: 'minnow',  c1: '#b3e5fc', c2: '#4fc3f7', from: 16, to: 20,  needs: [5, 6, 7] },
  { name: '小丑鱼',  type: 'clown',   c1: '#ffab40', c2: '#ff6d00', from: 24, to: 30,  needs: [7, 8, 9] },
  { name: '黄鳍鱼',  type: 'yellow',  c1: '#fff176', c2: '#fbc02d', from: 34, to: 42,  needs: [9, 10, 11] },
  { name: '河豚',    type: 'puffer',  c1: '#ce93d8', c2: '#8e24aa', from: 46, to: 56,  needs: [10, 11, 12] },
  { name: '石斑鱼',  type: 'grouper', c1: '#a5d6a7', c2: '#388e3c', from: 60, to: 72,  needs: [12, 13, 14] },
  { name: '大白鲨',  type: 'shark',   c1: '#e0e0e0', c2: '#78909c', from: 80, to: 104, needs: [14, 15, 16] },
];
const STAGES = [];
for (const sp of SPECIES_CHAIN) {
  for (let g = 0; g < 3; g++) {
    STAGES.push({
      name: sp.name + ' ' + GRADE_ROMAN[g],
      size: Math.round(sp.from + (sp.to - sp.from) * g / 2),
      need: sp.needs[g],
      type: sp.type, c1: sp.c1, c2: sp.c2,
    });
  }
}
const FINAL_STAGE = STAGES.length - 1;   // 17 = 大白鲨Ⅲ（进化模式通关点）
const SPECIES = [
  { type: 'minnow',  c1: '#b3e5fc', c2: '#4fc3f7', min: 10, max: 18 },
  { type: 'clown',   c1: '#ffab40', c2: '#ff6d00', min: 16, max: 28 },
  { type: 'yellow',  c1: '#fff176', c2: '#fbc02d', min: 22, max: 38 },
  { type: 'jelly',   c1: '#f48fb1', c2: '#ec407a', min: 20, max: 42 },
  { type: 'puffer',  c1: '#ce93d8', c2: '#8e24aa', min: 32, max: 52 },
  { type: 'grouper', c1: '#a5d6a7', c2: '#388e3c', min: 46, max: 72 },
  { type: 'shark',   c1: '#e0e0e0', c2: '#78909c', min: 65, max: 130 },   // 下探到 65：石斑鱼Ⅲ起可吃小鲨鱼
];

/* ---------- 操作模式（默认轮盘，记忆选择） ---------- */
let controlMode = 'joy';
try { if (localStorage.getItem('fg_mode') === 'follow') controlMode = 'follow'; } catch (e) { }

/* ---------- AI 素材（白底抠图后的 webp；加载失败自动回落矢量绘制） ---------- */
const SPRITES = {};
const SPRITE_SRC = {
  minnow: 'fish2-minnow', clown: 'fish2-clown', yellow: 'fish2-yellow', puffer: 'fish2-puffer',
  grouper: 'fish2-grouper', jelly: 'fish2-jelly', shark: 'fish2-shark3',
};
for (const [type, name] of Object.entries(SPRITE_SRC)) {
  const img = new Image();
  img.onload = () => { SPRITES[type] = img; };
  img.src = '/platform/assets/' + name + '.webp';
}

/* ---------- 样式（自包含，颜色挂平台变量） ---------- */
const css = `
#qcFishGame{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,#0e4d7d 0%,#06223d 100%);font-family:'Microsoft YaHei','PingFang SC',sans-serif}
#qcFishGame[hidden]{display:none}
.fg-stage{position:relative;box-shadow:0 12px 60px rgba(0,0,0,.55);border-radius:14px;overflow:hidden}
.fg-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:crosshair}
.fg-hud{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;gap:6px;padding:9px 11px;background:linear-gradient(180deg,rgba(4,32,60,.85),rgba(4,32,60,0));color:#fff;pointer-events:none}
.fg-box{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:5px 10px;backdrop-filter:blur(4px);font-size:12px;white-space:nowrap}
.fg-box b{color:#ffd54f;font-size:16px}
.fg-box .fg-name{font-weight:700;color:#8be9ff;font-size:13px}
.fg-grow{min-width:96px;flex:1;max-width:150px}
.fg-grow .lb{font-size:10px;opacity:.85;margin-bottom:3px}
.fg-barO{height:9px;background:rgba(255,255,255,.2);border-radius:6px;overflow:hidden}
.fg-barI{height:100%;width:0%;border-radius:6px;background:linear-gradient(90deg,#69f0ae,#00e5ff);transition:width .18s}
.fg-tip{position:absolute;bottom:7px;left:0;right:0;text-align:center;color:rgba(255,255,255,.75);font-size:11px;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.fg-pause{position:absolute;top:44px;right:10px;z-index:6;padding:5px 13px;border:1px solid #ffffff55;border-radius:10px;background:rgba(8,42,61,.72);color:#fff;font-size:14px;cursor:pointer;font-family:inherit}
.fg-pause:active{transform:scale(.95)}
.fg-sound{position:absolute;top:44px;left:10px;z-index:6;width:34px;height:34px;padding:0;border:1px solid #ffffff55;border-radius:10px;background:rgba(8,42,61,.72);color:#fff;font-size:15px;line-height:1;cursor:pointer;font-family:inherit}
.fg-sound:active{transform:scale(.95)}
.fg-sound.off{opacity:.55}
.fg-record{color:#ffd54f;font-weight:800;font-size:14px;margin-top:12px}
.fg-record[hidden]{display:none}
.fg-shield{position:absolute;top:84px;left:10px;z-index:6;padding:6px 13px;border:1px solid #ffd54faa;border-radius:10px;background:rgba(8,42,61,.72);color:#ffd54f;font-size:13px;cursor:pointer;font-family:inherit}
.fg-shield:active{transform:scale(.95)}
.fg-shield[hidden]{display:none}
.fg-exitmp{position:absolute;top:44px;right:10px;z-index:6;padding:6px 13px;border:1px solid #ffffff55;border-radius:10px;background:rgba(8,42,61,.72);color:#fff;font-size:13px;cursor:pointer;font-family:inherit}
.fg-exitmp:active{transform:scale(.95)}
.fg-exitmp[hidden]{display:none}
.fg-mpbar{position:absolute;top:38px;left:0;right:0;display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding:0 8px;pointer-events:none;z-index:3}
.fg-mpbar[hidden]{display:none}
.fg-mpchip{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:4px 9px;color:#fff;font-size:10.5px;backdrop-filter:blur(4px);white-space:nowrap}
.fg-mpchip.dead{opacity:.5;text-decoration:line-through}
.fg-countdown{width:min(260px,80%);height:8px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden;margin-top:16px}
.fg-countdown div{height:100%;width:100%;background:linear-gradient(90deg,#ffd54f,#ff8a80);transition:width .1s linear}
.fg-col{flex-direction:column;align-items:stretch;gap:9px;min-width:230px}
.fg-col .fg-btn{border-radius:12px;letter-spacing:1px}
.fg-modes{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:8px 10px}
.fg-modeLabel{font-size:12px;color:#cfeaff;white-space:nowrap;margin-right:auto}
.fg-mode{padding:7px 13px;font-size:12.5px;opacity:.6;border-radius:9px}
.fg-mode.on{opacity:1;background:linear-gradient(180deg,#7fe7ff,#26c6da);color:#06304f;border-color:transparent}
body.fg-lock{overflow:hidden}
.fg-over{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(3,24,46,.82);color:#fff;text-align:center;padding:22px}
.fg-over[hidden]{display:none}
.fg-big{font-size:30px;font-weight:900;letter-spacing:2px}
.fg-sub{margin-top:8px;font-size:14px;color:#cfeaff;line-height:1.9}
.fg-sub b{color:#ffd54f;font-size:20px}
.fg-btns{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;justify-content:center}
.fg-btn{border:0;border-radius:999px;padding:11px 30px;font-size:15px;font-weight:700;letter-spacing:2px;cursor:pointer;font-family:inherit;transition:transform .12s}
.fg-btn.primary{background:linear-gradient(180deg,#7fe7ff,#26c6da);color:#06304f;box-shadow:0 6px 18px rgba(38,198,218,.45)}
.fg-btn.plain{background:var(--qc-panel,#fff);color:var(--qc-text,#333);border:1px solid var(--qc-line,#ccc)}
.fg-btn:active{transform:scale(.96)}
.fg-stick{position:absolute;left:0;top:0;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(255,255,255,.12);z-index:4;pointer-events:none;will-change:transform}
.fg-stick i{position:absolute;left:50%;top:50%;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:rgba(255,255,255,.6);box-shadow:0 2px 8px rgba(0,0,0,.2);will-change:transform}
body.fg-lock{overflow:hidden}
`;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

/* ---------- DOM ---------- */
const wrap = document.createElement('div');
wrap.id = 'qcFishGame';
wrap.hidden = true;
wrap.innerHTML = `
  <div class="fg-stage">
    <canvas id="fgCv"></canvas>
    <div class="fg-hud">
      <div class="fg-box">分数 <b id="fgScore">0</b></div>
      <div class="fg-box" id="fgLives">❤️❤️❤️</div>
      <div class="fg-box fg-grow"><div class="lb"><span id="fgStageName">小鱼苗</span> · <span id="fgGrowText">0/6</span> · <span id="fgTime">0:00</span></div><div class="fg-barO"><div class="fg-barI" id="fgBar"></div></div></div>
    </div>
    <button class="fg-pause" id="fgPause" type="button">⏸ 暂停</button>
    <button class="fg-sound" id="fgSnd" type="button" title="音效开关">🔊</button>
    <button class="fg-exitmp" id="fgExitMp" type="button" hidden>🚪 退出房间</button>
    <button class="fg-shield" id="fgShield" type="button" hidden>🛡️ 护盾</button>
    <div class="fg-stick" id="fgStick" hidden><i></i></div>
    <div class="fg-mpbar" id="fgMpBar" hidden></div>
    <div class="fg-tip">吃掉比你小的鱼长大 · 长成大白鲨即获胜！</div>
    <div class="fg-over" id="fgPauseMenu" hidden>
      <div class="fg-big" style="font-size:24px;">⏸ 暂停中</div>
      <div class="fg-btns fg-col">
        <button class="fg-btn primary" id="fgResume" type="button">▶ 继续游戏</button>
        <button class="fg-btn plain" id="fgQuit" type="button">🚪 退出游戏</button>
        <button class="fg-btn plain" id="fgRestart" type="button">🔄 重新开始</button>
        <div class="fg-modes"><span class="fg-modeLabel">操作模式</span><button class="fg-mode fg-btn plain" id="fgModeJoy" type="button">🕹 轮盘</button><button class="fg-mode fg-btn plain" id="fgModeFollow" type="button">👆 跟随手指</button></div>
      </div>
    </div>
    <div class="fg-over" id="fgRevive" hidden>
      <div class="fg-big" style="font-size:24px;">💥 3 条命用完了</div>
      <div class="fg-sub">花 <b style="color:#ffd54f">50 金币</b> 原地复活？<br>复活后 5 秒无敌，得分与进化进度保留</div>
      <div class="fg-countdown"><div id="fgReviveBar"></div></div>
      <div class="fg-btns fg-col" style="min-width:230px">
        <button class="fg-btn primary" id="fgReviveYes" type="button">💛 复活（50 金币）</button>
        <button class="fg-btn plain" id="fgReviveNo" type="button">放弃结算</button>
      </div>
    </div>
    <div class="fg-over" id="fgMPResult" hidden>
      <div class="fg-big" id="fgMpTitle">🏁 对局结束</div>
      <div class="fg-sub" id="fgMpSub"></div>
      <div class="fg-btns"><button class="fg-btn primary" id="fgMpRoom" type="button">返回房间</button><button class="fg-btn plain" id="fgMpLobby" type="button">离开房间</button></div>
    </div>
    <div class="fg-over" id="fgWin" hidden>
      <div class="fg-big" style="color:#ffd54f">🏆 恭喜通关！</div>
      <div class="fg-sub">你吃成了海底霸主 —— 大白鲨Ⅲ！</div>
      <div class="fg-sub">最终得分 <b id="fgWinScore">0</b> · 通关用时 <b id="fgWinTime">0:00</b><br>共吞掉 <span id="fgWinCount">0</span> 条鱼 · 本局金币 <b id="fgWinCoin" style="color:#ffd54f">+0</b></div>
      <div class="fg-record" id="fgRecW" hidden>🎉 新纪录！已登上速通榜</div>
      <div class="fg-btns"><button class="fg-btn primary" id="fgAgain1" type="button">再来一局</button><button class="fg-btn plain" id="fgBack1" type="button">返回大厅</button></div>
    </div>
    <div class="fg-over" id="fgLose" hidden>
      <div class="fg-big" style="color:#ff8a80" id="fgLoseTitle">💀 你被大鱼吃掉了！</div>
      <div class="fg-sub" id="fgLoseSub">最终得分 <b id="fgLoseScore">0</b> · 成长到 <span id="fgLoseStage">小鱼苗</span><br>共吞掉 <span id="fgLoseCount">0</span> 条鱼</div>
      <div class="fg-sub">本局金币 <b id="fgLoseCoin" style="color:#ffd54f">+0</b></div>
      <div class="fg-record" id="fgRecL" hidden>🎉 新纪录！已登上分数榜</div>
      <div class="fg-btns"><button class="fg-btn primary" id="fgAgain2" type="button">重新开始</button><button class="fg-btn plain" id="fgBack2" type="button">返回大厅</button></div>
    </div>
  </div>`;
document.body.append(wrap);
const cv = $('fgCv'), ctx = cv.getContext('2d');
const elScore = $('fgScore'), elLives = $('fgLives'), elStage = $('fgStageName'), elGrow = $('fgGrowText'), elBar = $('fgBar'), elTime = $('fgTime');
const ovWin = $('fgWin'), ovLose = $('fgLose');

/* ---------- 音效引擎（WebAudio 全合成，零外部资源；手势解锁 + 可静音） ---------- */
const sfx = (() => {
  let ac = null, master = null, muted = false;
  try { muted = localStorage.getItem('fg_snd') === '0'; } catch (e) { }
  function ensure() {
    if (ac) return ac;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      let tail = master;
      try {   // 压限器：多层音叠在一起不爆音
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 6;
        master.connect(comp); tail = comp;
      } catch (e) { }
      tail.connect(ac.destination);
      return ac;
    } catch (e) { return null; }
  }
  /* 关键：必须在用户手势里调用一次。手机浏览器（iOS Safari / 微信）不解锁的话，
     AudioContext 会一直停在 suspended，整局静音——这就是之前"没有音效"的根因。 */
  function unlock() {
    const c = ensure(); if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) { } }
    if (!c.__fgOpen) {
      c.__fgOpen = true;
      try {   // 播一段 1 帧静音，真正打开音频通道
        const b = c.createBuffer(1, 1, c.sampleRate);
        const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      } catch (e) { }
    }
  }
  addEventListener('pointerdown', unlock, true);
  addEventListener('touchstart', unlock, true);
  addEventListener('keydown', unlock, true);

  function tone(o) {
    const c = ensure(); if (!c || muted || !master) return;
    const t = c.currentTime + (o.delay || 0), dur = o.dur || 0.12;
    const f1 = Math.max(24, o.f1), f2 = Math.max(24, o.f2 == null ? o.f1 : o.f2);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const vol = Math.max(0.0004, o.vol == null ? 0.12 : o.vol);
    const atk = o.atk == null ? 0.005 : o.atk;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = o.lpType || 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 1; osc.connect(f); out = f; }
    out.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.04);
  }
  function noise(o) {
    const c = ensure(); if (!c || muted || !master) return;
    const t = c.currentTime + (o.delay || 0), dur = o.dur || 0.1;
    const n = Math.max(1, Math.floor(dur * c.sampleRate));
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, o.decay == null ? 2 : o.decay);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(Math.max(40, o.f1 || 1200), t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t + dur);
    f.Q.value = o.q == null ? 1 : o.q;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol == null ? 0.1 : o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  return {
    unlock,
    muted: () => muted,
    setMuted(v) {
      muted = !!v;
      try { localStorage.setItem('fg_snd', muted ? '0' : '1'); } catch (e) { }
      if (master) master.gain.value = muted ? 0 : 0.9;
      if (!muted) unlock();
    },
    /* 吞鱼：目标越小音调越高；吃到大鱼再叠一层低沉闷响 */
    eat(size) {
      const s = clamp(size || 20, 8, 130);
      const f = clamp(1000 - s * 5.6, 300, 920);
      tone({ f1: f, f2: f * 0.5, dur: 0.085, type: 'sine', vol: 0.17, atk: 0.003 });
      noise({ f1: 700 + f, f2: 320, dur: 0.07, vol: 0.075, filter: 'bandpass', q: 1.3 });
      if (s > 46) tone({ f1: f * 0.5, f2: f * 0.32, dur: 0.15, type: 'triangle', vol: 0.11, delay: 0.015 });
    },
    /* 进化：上行琶音 + 亮片 */
    grow() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ f1: f, dur: i === 3 ? 0.3 : 0.11, type: 'triangle', vol: 0.17, delay: i * 0.085 }));
      noise({ f1: 2600, f2: 5600, dur: 0.3, vol: 0.05, filter: 'bandpass', q: 1.6, delay: 0.24 });
    },
    /* 受伤掉命（还有命） */
    hurt() {
      tone({ f1: 260, f2: 84, dur: 0.26, type: 'sawtooth', vol: 0.17, lp: 1500 });
      noise({ f1: 760, f2: 170, dur: 0.2, vol: 0.1, filter: 'lowpass', q: 0.7, decay: 2.6 });
    },
    /* 阵亡：一路下坠 */
    die() {
      tone({ f1: 430, f2: 80, dur: 0.65, type: 'sawtooth', vol: 0.17, lp: 1200 });
      tone({ f1: 200, f2: 52, dur: 0.9, type: 'sine', vol: 0.13, delay: 0.08 });
      noise({ f1: 900, f2: 110, dur: 0.55, vol: 0.09, filter: 'lowpass', q: 0.6, decay: 2.4 });
    },
    lose() { [392, 330, 262].forEach((f, i) => tone({ f1: f, dur: 0.3, type: 'triangle', vol: 0.13, delay: i * 0.16 })); },
    win() {
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ f1: f, dur: i > 3 ? 0.34 : 0.14, type: 'triangle', vol: 0.17, delay: i * 0.115 }));
      tone({ f1: 262, dur: 0.55, type: 'sine', vol: 0.1, delay: 0.2 });
      noise({ f1: 3000, f2: 7000, dur: 0.55, vol: 0.045, filter: 'bandpass', q: 1.4, delay: 0.55 });
    },
    record() { [1047, 1319, 1568, 2093].forEach((f, i) => tone({ f1: f, dur: 0.18, type: 'sine', vol: 0.13, delay: i * 0.075 })); },
    coin() {
      tone({ f1: 1046, dur: 0.09, type: 'triangle', vol: 0.13 });
      tone({ f1: 1568, dur: 0.16, type: 'triangle', vol: 0.11, delay: 0.06 });
      noise({ f1: 4200, f2: 6800, dur: 0.12, vol: 0.04, filter: 'bandpass', q: 2, delay: 0.02 });
    },
    shield() {
      tone({ f1: 300, f2: 1000, dur: 0.34, type: 'sine', vol: 0.13 });
      tone({ f1: 600, f2: 1600, dur: 0.3, type: 'triangle', vol: 0.07, delay: 0.04 });
    },
    revive() { [392, 523, 659, 880].forEach((f, i) => tone({ f1: f, f2: f * 1.5, dur: 0.26, type: 'sine', vol: 0.14, delay: i * 0.07 })); },
    /* 无尽模式鱼群涌：水流声 + 低频轰鸣 */
    wave() {
      noise({ f1: 180, f2: 2200, dur: 0.75, vol: 0.1, filter: 'lowpass', q: 0.6, decay: 1.4 });
      tone({ f1: 90, f2: 55, dur: 0.9, type: 'sine', vol: 0.11 });
    },
    start() {
      noise({ f1: 260, f2: 1500, dur: 0.5, vol: 0.09, filter: 'lowpass', q: 0.6 });
      [392, 523, 659].forEach((f, i) => tone({ f1: f, dur: 0.16, type: 'triangle', vol: 0.13, delay: 0.06 + i * 0.09 }));
    },
    tick() { tone({ f1: 880, f2: 880, dur: 0.05, type: 'square', vol: 0.06 }); },
    ui() { tone({ f1: 640, f2: 900, dur: 0.055, type: 'sine', vol: 0.05, atk: 0.004 }); },
  };
})();

/* ---------- 状态 ---------- */
let isOpen = false, state = 'idle', raf = 0, lastT = 0, timeSec = 0, shakeT = 0, spawnTimer = 0, paused = false;
let score = 0, totalEaten = 0, lives = 3, matchId = '';
let mode = 'evolution';                 // evolution=进化通关 | endless=无尽生存
let runTime = 0, waveT = 55, waveOn = 0;
let coinsEaten = 0, coinItems = [], coinTimer = 6, coinSpawned = 0;   // 局内金币
let shieldUsed = false, reviveOffered = false, reviveLeft = 0, reviveTick = null;
let mpResultShown = false, lastSent = 0, lastIx = 0, lastIy = 0;
/* 联机本地预测：自己的球不等服务器回包，输入立刻生效，快照回来只做柔性校正。
   这是"跟手"的关键——不然每次操作都要等 上行+RTT+广播 才看得到。 */
const mpInput = { ix: 0, iy: 0 };
let mpMine = null;
const smoothP = new Map(), smoothF = new Map();
let fishes = [], particles = [], floatTexts = [], bubbles = [];
const player = { x: W / 2, y: H / 2, vx: 0, vy: 0, size: 16, stage: 0, eaten: 0, dir: 1, phase: 0, dead: false, deadT: 0, inv: 0, shield: 0 };
const keys = {};
let pX = null, pY = null;   // 指针目标

/* 阶段信息：进化模式止步大白鲨Ⅲ(17)；无尽模式继续巨鲨Ⅰ/Ⅱ/Ⅲ…（成长渐慢、体型封顶） */
function stageInfo(s) {
  if (s <= FINAL_STAGE) return STAGES[s];
  const k = s - FINAL_STAGE;   // k=1 巨鲨Ⅰ
  const roman = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'][Math.min(k - 1, 9)];
  return {
    name: '巨鲨 ' + roman + (k > 10 ? '+' : ''),
    size: Math.min(104 + 16 * k, 170),
    need: 16 + 3 * k,
    type: 'shark', c1: '#e0e0e0', c2: '#78909c',
  };
}
const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s) % 60).padStart(2, '0');

/* ---------- 画布适配 ---------- */
const stageEl = wrap.querySelector('.fg-stage');
function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = Math.min((window.innerWidth - 16) / W, (window.innerHeight - 16) / H, 1.1);
  stageEl.style.width = Math.round(W * scale) + 'px';
  stageEl.style.height = Math.round(H * scale) + 'px';
}
addEventListener('resize', () => { if (isOpen) fit(); });

/* ---------- 输入（触屏=虚拟轮盘，鼠标=跟随，键盘=WASD/方向键） ---------- */
function toXY(e) {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
}
const stickEl = $('fgStick'), stickKnob = stickEl.querySelector('i');
let joy = null;   // {id, cx, cy, dx, dy} 轮盘向量，dx/dy ∈ [-1,1]
const JOY_R = 46; // 轮盘半径（CSS px）
cv.addEventListener('pointerdown', e => {
  if (!isOpen || menuOpen) return;
  e.preventDefault();
  if (e.pointerType === 'touch' && controlMode === 'joy') {
    const r = stageEl.getBoundingClientRect();
    joy = { id: e.pointerId, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0 };
    stickEl.hidden = false;
    stickEl.style.transform = `translate3d(${(e.clientX - r.left).toFixed(1)}px,${(e.clientY - r.top).toFixed(1)}px,0)`;
    stickKnob.style.transform = 'translate(0,0)';
  } else {
    [pX, pY] = toXY(e);
  }
});
cv.addEventListener('pointermove', e => {
  if (!isOpen || menuOpen) return;
  if (joy && e.pointerId === joy.id) {
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
    joy.dx = dx / JOY_R; joy.dy = dy / JOY_R;
    stickKnob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
  } else if (e.pointerType === 'mouse' || (e.pointerType === 'touch' && controlMode === 'follow')) {
    [pX, pY] = toXY(e);
  }
});
const endJoy = e => {
  if (joy && e.pointerId === joy.id) { joy = null; stickEl.hidden = true; }
  if (e.pointerType === 'touch') { pX = pY = null; }   // 手指抬起点消失
};
cv.addEventListener('pointerup', endJoy);
cv.addEventListener('pointercancel', endJoy);
addEventListener('keydown', e => {
  if (!isOpen) return;
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
});
addEventListener('keyup', e => { if (isOpen) keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; pX = pY = null; joy = null; stickEl.hidden = true; });

/* ---------- 物种与生成 ---------- */
function pickSpecies(lo, hi) {
  for (let i = 0; i < 12; i++) {
    const sp = SPECIES[randi(0, SPECIES.length - 1)];
    if (sp.max >= lo && sp.min <= hi) return sp;
  }
  return SPECIES[randi(0, SPECIES.length - 1)];
}
function spawnFish(forceSize) {
  const pSize = player.size;
  let lo, hi;
  if (forceSize) { lo = hi = forceSize; }
  else {
    // 同屏危险鱼（明显比玩家大）超过上限时，本条强制生成小鱼，避免后期满屏大鱼无处可躲
    const dangerCount = fishes.reduce((n, f) => n + (f.size > pSize * 1.12 ? 1 : 0), 0);
    const cap = 3 + Math.floor(player.stage / 4) + (waveOn > 0 ? 2 : 0);
    const r = Math.random();
    if (dangerCount >= cap) { lo = pSize * 0.3; hi = pSize * 0.8; }
    else if (r < 0.58) { lo = pSize * 0.35; hi = pSize * 0.85; }
    else if (r < 0.80) { lo = pSize * 1.15; hi = pSize * 1.45; }
    else { lo = pSize * 1.6; hi = pSize * 2.2; }
  }
  let sp = pickSpecies(lo, hi);
  // 无尽模式后期：仅当本条本该生成"大鱼"时，才把野鲨范围抬起来（小鱼区间仍出可吃的小鲨鱼）
  if (mode === 'endless' && sp.type === 'shark' && lo >= 95) {
    sp = { ...sp, min: Math.max(95, pSize * 1.2), max: Math.max(130, pSize * 1.9) };
  }
  const a = Math.max(sp.min, lo), b = Math.min(sp.max, hi);
  const size = clamp(rand(Math.min(a, b), Math.max(a, b)), sp.min, sp.max);
  const fromLeft = Math.random() < 0.5;
  const isJelly = sp.type === 'jelly';
  const speedMult = (mode === 'endless' && player.stage > FINAL_STAGE) ? 1 + Math.min(0.8, (player.stage - FINAL_STAGE) * 0.12) : 1;
  const speedBase = (isJelly ? rand(20, 32) : clamp(150 - size, 38, 130) * rand(0.7, 1.0)) * speedMult;
  const f = {
    x: fromLeft ? -size * 1.6 : W + size * 1.6,
    y: rand(H * 0.08, H * 0.92),
    vx: (fromLeft ? 1 : -1) * speedBase, vy: 0,
    size, type: sp.type, c1: sp.c1, c2: sp.c2,
    dir: fromLeft ? 1 : -1, phase: rand(0, Math.PI * 2),
    bobAmp: isJelly ? 0 : rand(6, 18), bobFreq: rand(0.8, 1.8),
    baseY: 0, t: 0, jellyDir: Math.random() < 0.5 ? 1 : -1, jellyV: rand(18, 32),
  };
  f.baseY = f.y;
  fishes.push(f);
}

/* ---------- 粒子 / 飘字 ---------- */
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(40, 160);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.8), maxLife: 0.8, r: rand(2, 5), color });
  }
}
function floatText(x, y, text, color) { floatTexts.push({ x, y, text, color, life: 0.9 }); }

/* ---------- HUD ---------- */
function updateHUD() {
  elScore.textContent = score;
  elLives.textContent = '❤️'.repeat(Math.max(0, lives)) + '🤍'.repeat(Math.max(0, 3 - lives));
  const st = stageInfo(player.stage);
  elStage.textContent = st.name;
  elTime.textContent = fmtT(runTime);
  if (mode === 'evolution' && player.stage >= FINAL_STAGE) { elGrow.textContent = '最终形态!'; elBar.style.width = '100%'; }
  else { elGrow.textContent = player.eaten + '/' + st.need; elBar.style.width = (player.eaten / st.need * 100) + '%'; }
}

/* ---------- 流程 ---------- */
function resetGame() {
  score = 0; totalEaten = 0; lives = 3;
  fishes = []; particles = []; floatTexts = []; bubbles = [];
  coinsEaten = 0; coinItems = []; coinTimer = 6; coinSpawned = 0;
  shieldUsed = false; reviveOffered = false;
  if (reviveTick) { clearInterval(reviveTick); reviveTick = null; }
  spawnTimer = 0; timeSec = 0; shakeT = 0;
  runTime = 0; waveT = 40; waveOn = 0;
  player.x = W / 2; player.y = H / 2; player.vx = player.vy = 0;
  player.stage = 0; player.eaten = 0; player.size = STAGES[0].size;
  player.dir = 1; player.dead = false; player.deadT = 0; player.inv = 0; player.shield = 0;
  joy = null; stickEl.hidden = true;
  $('fgRecW').hidden = true; $('fgRecL').hidden = true; $('fgRevive').hidden = true;
  $('fgShield').hidden = !(mode === 'evolution' && (window.QCFish?.profile?.()?.shields || 0) > 0);
  matchId = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 10; i++) spawnFish();
  ovWin.hidden = true; ovLose.hidden = true;
  updateHUD();
}
function report(win) {
  try {
    const p = window.QCFish?.report?.({ game: 'fish', mode, win, score, time: Math.round(runTime), coinsEaten, matchId });
    p?.then?.(j => {
      if (j && j.record) {
        const el = state === 'win' ? $('fgRecW') : $('fgRecL');
        if (el) el.hidden = false;
        sfx.record();
      }
    });
  } catch (e) { }
}
function gameWin() {
  state = 'win'; sfx.win();
  $('fgWinScore').textContent = score;
  $('fgWinTime').textContent = fmtT(runTime);
  $('fgWinCount').textContent = totalEaten;
  $('fgWinCoin').textContent = '+' + (20 + coinsEaten * 5) + ' 🪙';
  ovWin.hidden = false;
  report(true);
}
function gameLose() {
  player.dead = true; player.deadT = 0; shakeT = 0.4;
  sfx.die();
  burst(player.x, player.y, '#ff8a80', 26);
  state = 'dying';
}
function showRevive() {
  state = 'revive';
  const ov = $('fgRevive'), bar = $('fgReviveBar'), yes = $('fgReviveYes');
  const coins = window.QCFish?.profile?.()?.coins || 0;
  if (coins >= 50) { yes.disabled = false; yes.textContent = '💛 复活（50 金币）'; }
  else { yes.disabled = true; yes.textContent = '金币不足（需 50）'; }
  ov.hidden = false;
  reviveLeft = 5;
  bar.style.width = '100%';
  if (reviveTick) clearInterval(reviveTick);
  reviveTick = setInterval(() => {
    reviveLeft -= 0.1;
    bar.style.width = Math.max(0, reviveLeft / 5 * 100) + '%';
    if (reviveLeft <= 0) { clearInterval(reviveTick); reviveTick = null; ov.hidden = true; showLose(); }
    else if (reviveLeft <= 3.05 && Math.ceil(reviveLeft) !== Math.ceil(reviveLeft + 0.1)) sfx.tick();   // 最后 3 秒滴答
  }, 100);
}
function doRevive() {
  if (reviveTick) { clearInterval(reviveTick); reviveTick = null; }
  window.QCFish?.revive?.(matchId)?.then?.(j => {
    if (!j || !j.ok) { if (j && j.msg) floatText(player.x, player.y - 30, j.msg, '#ff8a80'); return; }
    $('fgRevive').hidden = true;
    lives = 1; player.dead = false; player.deadT = 0; player.inv = 5;
    state = 'playing'; lastT = performance.now();
    updateHUD();
    floatText(player.x, player.y - player.size - 14, '原地复活！5 秒无敌', '#ffd54f');
    sfx.revive();
  })?.catch?.(e => floatText(player.x, player.y - 30, e.message || '复活失败', '#ff8a80'));
}
function showLose() {
  state = 'lose';
  sfx.lose();
  const endless = mode === 'endless';
  const coinGain = endless ? 5 + Math.min(25, Math.floor(score / 100)) + coinsEaten * 5 : 5 + coinsEaten * 5;
  $('fgLoseTitle').textContent = endless ? '🌊 海域生存结束！' : '💀 你被大鱼吃掉了！';
  $('fgLoseSub').innerHTML = '最终得分 <b id="fgLoseScore">' + score + '</b> · ' +
    (endless ? '生存 ' + fmtT(runTime) + ' · 成长到 ' : '成长到 ') + stageInfo(player.stage).name +
    '<br>共吞掉 <span>' + totalEaten + '</span> 条鱼';
  $('fgLoseCoin').textContent = '+' + coinGain + ' 🪙';
  ovLose.hidden = false;
  report(false);
}

/* ---------- 更新 ---------- */
function updatePlayer(dt) {
  if (player.dead) return;
  if (player.inv > 0) player.inv -= dt;
  if (player.shield > 0) player.shield -= dt;
  runTime += dt;
  const maxSpeed = 320 - Math.min(player.stage, FINAL_STAGE) * 6;
  const accel = 1400;
  let ix = 0, iy = 0;
  if (keys['arrowleft'] || keys['a']) ix -= 1;
  if (keys['arrowright'] || keys['d']) ix += 1;
  if (keys['arrowup'] || keys['w']) iy -= 1;
  if (keys['arrowdown'] || keys['s']) iy += 1;
  if (ix || iy) {
    const len = Math.hypot(ix, iy);
    player.vx += (ix / len) * accel * dt;
    player.vy += (iy / len) * accel * dt;
    pX = pY = null;
  } else if (joy && (joy.dx || joy.dy)) {
    // 虚拟轮盘：向量长度即油门，轻推慢游、推满全速
    const mag = Math.hypot(joy.dx, joy.dy);
    const sp = maxSpeed * Math.min(1, mag);
    player.vx += (joy.dx / mag) * sp * 10 * dt;
    player.vy += (joy.dy / mag) * sp * 10 * dt;
    pX = pY = null;
  } else if (pX !== null) {
    const dx = pX - player.x, dy = pY - player.y, d = Math.hypot(dx, dy);
    if (d > 4) {
      const sp = Math.min(maxSpeed, d * 6);
      player.vx += (dx / d) * sp * 10 * dt;
      player.vy += (dy / d) * sp * 10 * dt;
    }
  }
  const damp = Math.pow(0.0025, dt);
  player.vx *= damp; player.vy *= damp;
  const spd = Math.hypot(player.vx, player.vy);
  if (spd > maxSpeed) { player.vx = player.vx / spd * maxSpeed; player.vy = player.vy / spd * maxSpeed; }
  player.x = clamp(player.x + player.vx * dt, player.size * 0.6, W - player.size * 0.6);
  player.y = clamp(player.y + player.vy * dt, player.size * 0.6 + 34, H - player.size * 0.6);
  if (Math.abs(player.vx) > 12) player.dir = player.vx > 0 ? 1 : -1;
  player.phase += dt * (6 + spd * 0.03);
  const target = stageInfo(player.stage).size;
  player.size += (target - player.size) * Math.min(1, dt * 3);
}
function updateFishes(dt) {
  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    f.t += dt;
    f.phase += dt * (4 + 40 / f.size);
    if (f.type === 'jelly') {
      f.x += f.vx * dt * 0.5;
      f.y += f.jellyDir * f.jellyV * dt;
      if (f.y < H * 0.1) f.jellyDir = 1;
      if (f.y > H * 0.9) f.jellyDir = -1;
      f.dir = f.vx > 0 ? 1 : -1;
    } else {
      f.x += f.vx * dt;
      f.y = f.baseY + Math.sin(f.t * f.bobFreq) * f.bobAmp;
    }
    if ((f.vx < 0 && f.x < -f.size * 2.2) || (f.vx > 0 && f.x > W + f.size * 2.2)) fishes.splice(i, 1);
  }
  spawnTimer -= dt;
  // 无尽模式：每 55~70 秒一波「鱼群涌」，8 秒内密度翻倍
  if (state === 'playing' && mode === 'endless') {
    waveT -= dt;
    if (waveT <= 0 && waveOn <= 0) {
      waveOn = 8; waveT = 55 + rand(0, 15);
      floatText(W / 2, H * 0.32, '🌊 鱼群涌来袭！', '#ffd54f');
      sfx.wave();
    }
    if (waveOn > 0) waveOn -= dt;
  }
  if (spawnTimer <= 0 && fishes.length < 18) {
    spawnFish();
    spawnTimer = rand(0.5, 1.1) * (waveOn > 0 ? 0.45 : 1);
  }
}
function updateCollisions() {
  if (player.dead) return;
  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    const rSum = (f.size + player.size) * 0.62;
    if (dist2(f.x, f.y, player.x, player.y) < rSum * rSum) {
      if (f.size < player.size * 0.9) {
        const pts = Math.max(1, Math.round(f.size / 9));
        score += pts; totalEaten++;
        burst(f.x, f.y, f.c1, 10);
        floatText(f.x, f.y - 10, '+' + pts, '#aef3ff');
        sfx.eat(f.size);
        fishes.splice(i, 1);
        player.eaten++;
        const st = stageInfo(player.stage);
        if (player.eaten >= st.need) {
          player.stage++; player.eaten = 0;
          floatText(player.x, player.y - player.size - 14, '进化！ ' + stageInfo(player.stage).name + '!', '#ffd54f');
          burst(player.x, player.y, '#ffd54f', 22);
          sfx.grow();
          if (mode === 'evolution' && player.stage >= FINAL_STAGE) { updateHUD(); gameWin(); return; }
        }
        updateHUD();
      } else if (f.size > player.size * 1.12) {
        if (player.inv > 0 || player.shield > 0) { /* 无敌/护盾中穿过 */ }
        else {
          lives--; updateHUD();
          sfx.hurt();
          burst(player.x, player.y, '#ff8a80', 20);
          shakeT = 0.35;
          if (lives <= 0) { gameLose(); return; }
          player.inv = 2.5;
          floatText(player.x, player.y - player.size - 14, '剩 ' + lives + ' 条命！', '#ff8a80');
        }
      }
    }
  }
}
function updateCoins(dt) {
  // 掉落节奏：每 12 秒一枚，一局最多 20 枚（约 4 分钟掉完）
  if (coinSpawned < 20) {
    coinTimer -= dt;
    if (coinTimer <= 0) {
      coinTimer = 12;
      coinSpawned++;
      coinItems.push({ x: rand(50, W - 50), y: rand(90, H - 70), t: 10, phase: rand(0, Math.PI * 2) });
    }
  }
  for (let i = coinItems.length - 1; i >= 0; i--) {
    const c = coinItems[i];
    c.t -= dt;
    if (c.t <= 0) { coinItems.splice(i, 1); continue; }
    if (!player.dead && dist2(c.x, c.y, player.x, player.y) < Math.pow(player.size * 0.7 + 16, 2)) {
      coinItems.splice(i, 1);
      coinsEaten++;
      floatText(c.x, c.y - 12, '+5 💰', '#ffd54f');
      sfx.coin();
    }
  }
}
function drawCoins() {
  for (const c of coinItems) {
    const bob = Math.sin(timeSec * 2 + c.phase) * 4;
    ctx.save();
    ctx.globalAlpha = c.t < 2.5 ? (Math.sin(timeSec * 12) > 0 ? 1 : 0.35) : 1;   // 消失前闪烁
    ctx.translate(c.x, c.y + bob);
    ctx.fillStyle = 'rgba(255, 213, 79, 0.25)';
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(-4, -4, 2, 0, 0, 13);
    g.addColorStop(0, '#fff3c2'); g.addColorStop(0.6, '#ffd54f'); g.addColorStop(1, '#f5a623');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8d6708';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('¥', 0, 1);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function updateEffects(dt) {  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.96; p.vy *= 0.96;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const t = floatTexts[i];
    t.life -= dt; t.y -= 36 * dt;
    if (t.life <= 0) floatTexts.splice(i, 1);
  }
  if (Math.random() < dt * 3) bubbles.push({ x: rand(0, W), y: H + 10, r: rand(2, 7), v: rand(24, 60), sway: rand(0, Math.PI * 2) });
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y -= b.v * dt; b.x += Math.sin(b.sway + b.y * 0.02) * 0.3;
    if (b.y < -10) bubbles.splice(i, 1);
  }
}

/* ---------- 绘制 ---------- */
let bgGrad = null, bgGradH = 0;
function drawBackground(t) {
  if (!bgGrad || bgGradH !== H) {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#4dd0e1'); bgGrad.addColorStop(0.45, '#29b6f6'); bgGrad.addColorStop(1, '#0d5c9e');
    bgGradH = H;
  }
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.10; ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const x = (i * 140 + 40 + Math.sin(t * 0.3 + i) * 18);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 55, 0); ctx.lineTo(x + 130, H); ctx.lineTo(x + 40, H); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  function weed(x, h, w, phase) {
    ctx.save(); ctx.fillStyle = 'rgba(46,125,50,0.75)';
    ctx.beginPath(); ctx.moveTo(x - w, H);
    for (let i = 0; i <= 5; i++) { const p = i / 5, sway = Math.sin(t * 1.2 + phase + p * 2) * 14 * p; ctx.lineTo(x - w * (1 - p) + sway, H - h * p); }
    for (let i = 5; i >= 0; i--) { const p = i / 5, sway = Math.sin(t * 1.2 + phase + p * 2) * 14 * p; ctx.lineTo(x + w * (1 - p) + sway, H - h * p); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  weed(50, 130, 12, 0); weed(120, 90, 9, 1.7); weed(430, 150, 13, 3.1);
  weed(350, 80, 8, 4.5); weed(230, 110, 10, 5.6); weed(300, 60, 7, 2.2);
  ctx.fillStyle = 'rgba(255,241,178,0.35)';
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H - 18 - Math.sin(x * 0.05) * 8);
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.save();
  for (const b of bubbles) {
    ctx.globalAlpha = 0.45; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawShark(f) {
  const s = f.size, wag = Math.sin(f.phase) * 0.3;
  ctx.fillStyle = f.c2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.6, 0); ctx.lineTo(-s * 1.25, -s * 0.55 + wag * s * 0.3); ctx.lineTo(-s * 1.0, wag * s * 0.2); ctx.lineTo(-s * 1.3, s * 0.4 + wag * s * 0.3);
  ctx.closePath(); ctx.fill();
  const g = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
  g.addColorStop(0, '#f5f5f5'); g.addColorStop(0.6, f.c1); g.addColorStop(1, f.c2);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s * 1.02, s * 0.05);
  ctx.quadraticCurveTo(s * 0.45, -s * 0.52, -s * 0.35, -s * 0.38);
  ctx.quadraticCurveTo(-s * 0.7, -s * 0.15, -s * 0.68, 0);
  ctx.quadraticCurveTo(-s * 0.7, s * 0.15, -s * 0.35, s * 0.38);
  ctx.quadraticCurveTo(s * 0.45, s * 0.52, s * 1.02, s * 0.05);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = f.c2;
  ctx.beginPath(); ctx.moveTo(-s * 0.05, -s * 0.42); ctx.quadraticCurveTo(s * 0.06, -s * 0.95, s * 0.38, -s * 0.4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(s * 0.08, s * 0.2); ctx.quadraticCurveTo(-s * 0.15, s * 0.7 + wag * s * 0.15, s * 0.3, s * 0.32); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = Math.max(1, s * 0.03);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(s * (0.28 - i * 0.08), -s * 0.18);
    ctx.quadraticCurveTo(s * (0.24 - i * 0.08), 0, s * (0.28 - i * 0.08), s * 0.18);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath(); ctx.moveTo(s * 0.55, s * 0.16); ctx.quadraticCurveTo(s * 0.75, s * 0.3, s * 0.95, s * 0.15); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.5, -s * 0.12, s * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a2e'; ctx.beginPath(); ctx.arc(s * 0.53, -s * 0.12, s * 0.05, 0, Math.PI * 2); ctx.fill();
}
function drawJelly(f) {
  const s = f.size;
  ctx.save(); ctx.translate(f.x, f.y);
  const g = ctx.createRadialGradient(0, -s * 0.2, s * 0.1, 0, 0, s);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, f.c1); g.addColorStop(1, f.c2);
  ctx.globalAlpha = 0.9; ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, s, Math.PI, 0);
  ctx.quadraticCurveTo(s * 0.7, s * 0.35, 0, s * 0.3);
  ctx.quadraticCurveTo(-s * 0.7, s * 0.35, -s, 0);
  ctx.fill();
  ctx.strokeStyle = f.c2; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.globalAlpha = 0.75;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * s * 0.3, s * 0.22);
    const wob = Math.sin(f.phase * 1.5 + i) * s * 0.22;
    ctx.quadraticCurveTo(i * s * 0.3 + wob, s * 0.9, i * s * 0.3 + wob * 1.6, s * 1.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.15, s * 0.14, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.15, s * 0.14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#880e4f';
  ctx.beginPath(); ctx.arc(-s * 0.27, -s * 0.15, s * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.33, -s * 0.15, s * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawNormalFish(f) {
  const s = f.size, wag = Math.sin(f.phase) * 0.35;
  ctx.save(); ctx.translate(f.x, f.y); ctx.scale(f.dir, 1);
  ctx.fillStyle = f.c2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, 0);
  ctx.quadraticCurveTo(-s * 0.95, -s * 0.2, -s * 1.3, -s * 0.5 + wag * s * 0.4);
  ctx.quadraticCurveTo(-s * 1.0, wag * s * 0.15, -s * 1.3, s * 0.5 + wag * s * 0.4);
  ctx.quadraticCurveTo(-s * 0.95, s * 0.2, -s * 0.5, 0);
  ctx.closePath(); ctx.fill();
  const g = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.6);
  g.addColorStop(0, f.c1); g.addColorStop(1, f.c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.58, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = f.c2;
  ctx.beginPath(); ctx.moveTo(-s * 0.15, -s * 0.5); ctx.quadraticCurveTo(s * 0.02, -s * 0.95, s * 0.35, -s * 0.45); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-s * 0.05, s * 0.45); ctx.quadraticCurveTo(s * 0.0, s * 0.85, s * 0.3, s * 0.42); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(s * 0.02, s * 0.15, s * 0.3, s * 0.15, 0.6 + wag * 0.35, 0, Math.PI * 2); ctx.fill();
  if (f.type === 'clown') {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.58, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillRect(-s * 0.45, -s * 0.6, s * 0.2, s * 1.2);
    ctx.fillRect(s * 0.12, -s * 0.6, s * 0.18, s * 1.2);
    ctx.fillRect(s * 0.6, -s * 0.6, s * 0.16, s * 1.2);
    ctx.restore();
  }
  if (f.type === 'puffer') {
    ctx.fillStyle = f.c2;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const px = Math.cos(a) * s * 0.92, py = Math.sin(a) * s * 0.55;
      ctx.beginPath();
      ctx.moveTo(px * 1.05, py * 1.05 - s * 0.05);
      ctx.lineTo(px * 1.28, py * 1.28);
      ctx.lineTo(px * 1.05, py * 1.05 + s * 0.05);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.45, -s * 0.15, s * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#16324a'; ctx.beginPath(); ctx.arc(s * 0.5, -s * 0.15, s * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(s * 0.53, -s * 0.19, s * 0.03, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawFish(f) {
  const img = SPRITES[f.type];
  if (img && img.complete && img.naturalWidth) {
    ctx.save();
    ctx.translate(f.x, f.y);
    if (f.type === 'jelly') {
      ctx.scale(1, 1 + Math.sin(f.phase) * 0.07);   // 水母脉动
    } else {
      ctx.scale(f.dir || 1, 1);
    }
    const h = f.size * 2.35, w = h * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }
  if (f.type === 'jelly') { drawJelly(f); return; }
  ctx.save();
  if (f.type === 'shark') { ctx.translate(f.x, f.y); ctx.scale(f.dir, 1); drawShark(f); }
  else drawNormalFish(f);
  ctx.restore();
}
function drawPlayer() {
  if (player.dead) return;
  const st = stageInfo(player.stage);
  const fake = { x: player.x, y: player.y, size: player.size, dir: player.dir, phase: player.phase, type: st.type, c1: st.c1, c2: st.c2 };
  ctx.save();
  if (player.inv > 0) {
    const blink = Math.sin(player.inv * 14) > 0;
    ctx.globalAlpha = blink ? 0.35 : 0.8;
    ctx.strokeStyle = 'rgba(126,247,255,0.7)'; ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(player.x, player.y, player.size * 1.35, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (player.shield > 0) {
    // 道具护盾：金色实线圈 + 呼吸脉动
    ctx.strokeStyle = 'rgba(255,213,79,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.size * 1.5 + Math.sin(performance.now() / 140) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.arc(player.x, player.y, player.size * 1.5, 0, Math.PI * 2); ctx.fill();
  drawFish(fake);
  ctx.restore();
}
function drawEffects() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.font = "bold 16px 'Microsoft YaHei', sans-serif";
  ctx.textAlign = 'center';
  for (const t of floatTexts) {
    ctx.globalAlpha = Math.max(0, t.life);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* ---------- 主循环 ---------- */
function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!isOpen || paused || menuOpen) { lastT = now; return; }
  const dt = Math.min(0.033, (now - lastT) / 1000 || 0.016);
  lastT = now;
  timeSec += dt;
  if (shakeT > 0) shakeT -= dt;
  if (mode === 'mp') {
    const eng = window.QCFish?.roomEngine?.();
    if (!eng || eng.kind !== 'fishmp') { closeMPToRoom(); return; }
    sendMPInput();
    updateEffects(dt);
    ctx.save();
    if (shakeT > 0) ctx.translate(rand(-6, 6) * shakeT, rand(-6, 6) * shakeT);
    drawBackground(timeSec);
    if (smoothF.size > 80) smoothF.clear();
    for (const f of eng.fishes) {
      const t = smoothF.get(f.id) || { x: f.x, y: f.y };
      t.x += (f.x - t.x) * Math.min(1, dt * 14);
      t.y += (f.y - t.y) * Math.min(1, dt * 14);
      smoothF.set(f.id, t);
      drawFish({ x: t.x, y: t.y, size: f.size, dir: f.dir, phase: timeSec * 6 + f.id, type: f.type, c1: '#fff', c2: '#fff' });
    }
    const myNow = mySeatI >= 0 ? eng.players[mySeatI] : null;
    /* ---- 本地预测：先按输入把"我"推到新位置，再用服务端坐标柔性拉回 ---- */
    if (myNow && !myNow.dead) {
      if (!mpMine) mpMine = { x: myNow.x, y: myNow.y };
      const il = Math.hypot(mpInput.ix, mpInput.iy);
      const spd = 320 - Math.min(myNow.stage, 17) * 6;
      if (il > 0.05) {
        mpMine.x += (mpInput.ix / il) * spd * dt;
        mpMine.y += (mpInput.iy / il) * spd * dt;
      }
      /* 只做"蚕食误差"的软校正，不做硬吸附，否则会跟自己的预测打架 */
      const k = Math.min(1, dt * 4.5);
      mpMine.x += (myNow.x - mpMine.x) * k;
      mpMine.y += (myNow.y - mpMine.y) * k;
      /* 差太多（重生/被推挤）直接吸附，避免拖影 */
      if (Math.hypot(myNow.x - mpMine.x, myNow.y - mpMine.y) > 150) { mpMine.x = myNow.x; mpMine.y = myNow.y; }
      const half = myNow.size * 0.6;
      mpMine.x = clamp(mpMine.x, half, eng.W - half);
      mpMine.y = clamp(mpMine.y, half + 34, eng.H - half);
    } else if (!myNow || myNow.dead) {
      mpMine = null;
    }
    /* 联机模式没有本地碰撞，靠服务端快照的分数/命数变化补音效 */
    if (myNow) {
      if (mpSeen.score >= 0 && myNow.score > mpSeen.score) sfx.eat(18 + Math.min(70, (myNow.score - mpSeen.score) * 8));
      if (mpSeen.lives >= 0 && myNow.lives < mpSeen.lives) sfx.hurt();
      mpSeen.score = myNow.score; mpSeen.lives = myNow.lives;
    } else { mpSeen.score = -1; mpSeen.lives = -1; }
    eng.players.forEach((p, i) => {
      if (p.dead) { smoothP.delete(i); return; }
      let t;
      if (i === mySeatI && mpMine) {
        t = mpMine;                        /* 自己：直接用本地预测，零延迟跟手 */
        smoothP.set(i, { x: mpMine.x, y: mpMine.y });
      } else {
        t = smoothP.get(i) || { x: p.x, y: p.y };
        t.x += (p.x - t.x) * Math.min(1, dt * 10);
        t.y += (p.y - t.y) * Math.min(1, dt * 10);
        smoothP.set(i, t);
      }
      const st = stageInfo(p.stage);
      const fake = { x: t.x, y: t.y, size: p.size, dir: p.dir, phase: timeSec * 6 + i * 2, type: st.type, c1: st.c1, c2: st.c2 };
      ctx.save();
      if (p.inv) ctx.globalAlpha = Math.sin(timeSec * 14) > 0 ? 0.45 : 0.85;
      if (i === mySeatI) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath(); ctx.arc(t.x, t.y, p.size * 1.5, 0, Math.PI * 2); ctx.fill();
        drawFish(fake);
      } else {
        drawFish(fake);
        ctx.font = "bold 12px 'Microsoft YaHei', sans-serif"; ctx.textAlign = 'center';
        const nm = memberName(i);
        const w = ctx.measureText(nm).width + 14;
        ctx.fillStyle = 'rgba(3,24,46,.66)';
        ctx.fillRect(t.x - w / 2, t.y - p.size - 26, w, 18);
        ctx.fillStyle = '#8be9ff';
        ctx.fillText(nm, t.x, t.y - p.size - 13);
      }
      ctx.restore();
    });
    drawEffects();
    ctx.restore();
    updateMPHUD(eng);
    if (myNow && myNow.dead && !eng.over) {
      ctx.fillStyle = 'rgba(3,24,46,.6)'; ctx.fillRect(0, H / 2 - 28, W, 56);
      ctx.fillStyle = '#fff'; ctx.font = "bold 17px 'Microsoft YaHei', sans-serif"; ctx.textAlign = 'center';
      ctx.fillText('💀 你出局了 · 观战中…', W / 2, H / 2 + 6);
    }
    if (eng.over && !mpResultShown) { mpResultShown = true; if (eng.winner === mySeatI) sfx.win(); else if (eng.winner === 'draw') sfx.record(); else sfx.lose(); showMPResult(eng); }
    return;
  }
  if (state === 'playing') {
    updatePlayer(dt); updateFishes(dt); updateCollisions(); updateCoins(dt);
    elTime.textContent = fmtT(runTime);   // 计时每帧刷新
  } else if (state === 'dying') {
    player.deadT += dt; updateFishes(dt);
    if (player.deadT > 0.9) {
      if (mode === 'evolution' && !reviveOffered) { reviveOffered = true; showRevive(); }
      else showLose();
    }
  } else {
    updateFishes(dt);
  }
  updateEffects(dt);
  ctx.save();
  if (shakeT > 0) ctx.translate(rand(-6, 6) * shakeT, rand(-6, 6) * shakeT);
  drawBackground(timeSec);
  for (const f of fishes) drawFish(f);
  drawCoins();
  if (state === 'playing' || state === 'dying') drawPlayer();
  drawEffects();
  ctx.restore();
}
raf = requestAnimationFrame(loop);

document.addEventListener('visibilitychange', () => { paused = document.hidden; lastT = performance.now(); });

/* ---------- 开关 ---------- */
function open(m) {
  mode = m === 'endless' ? 'endless' : 'evolution';
  if (isOpen) return;
  isOpen = true; paused = false; menuOpen = false;
  sfx.unlock(); sfx.start();
  $('fgPauseMenu').hidden = true; $('fgPause').hidden = false; $('fgExitMp').hidden = true; $('fgMpBar').hidden = true; $('fgMPResult').hidden = true;
  wrap.hidden = false;
  document.body.classList.add('fg-lock');
  document.querySelector('.fg-tip').textContent = mode === 'endless'
    ? '吃掉比你小的鱼不断进化 · 看你能在这片海活多久！'
    : '吃掉比你小的鱼长大 · 长成大白鲨即获胜！';
  fit();
  resetGame();
  state = 'playing';
  lastT = performance.now();
}
/* ---------- 联机竞速（fishmp）：渲染服务端状态 + 上报输入 ---------- */
let mySeatI = -1;
const mpSeen = { score: -1, lives: -1 };   // 联机音效用：上一帧自己的分数/命数
function resetMP() {
  fishes = []; particles = []; floatTexts = []; bubbles = []; coinItems = [];
  shakeT = 0; timeSec = 0; runTime = 0; mpResultShown = false;
  mpSeen.score = -1; mpSeen.lives = -1;
  smoothP.clear(); smoothF.clear();
  ovWin.hidden = true; ovLose.hidden = true;
  $('fgMPResult').hidden = true; $('fgRevive').hidden = true; $('fgRecW').hidden = true; $('fgRecL').hidden = true;
  joy = null; stickEl.hidden = true;
  for (const k in keys) keys[k] = false;
  pX = pY = null;
}
function openMP() {
  if (isOpen && mode === 'mp') return;
  if (isOpen) { isOpen = false; }
  mode = 'mp';
  isOpen = true; paused = false; menuOpen = false;
  sfx.unlock(); sfx.start();
  $('fgPause').hidden = true; $('fgPauseMenu').hidden = true; $('fgShield').hidden = true;
  $('fgExitMp').hidden = false; $('fgMpBar').hidden = false;
  document.querySelector('.fg-tip').textContent = '抢鱼竞速 · 先进化成大白鲨Ⅲ 者获胜！';
  wrap.hidden = false;
  document.body.classList.add('fg-lock');
  fit();
  resetMP();
  mySeatI = window.QCFish?.mySeat?.() ?? -1;
  state = 'playing';
  lastT = performance.now();
}
function memberName(i) {
  return window.QCFish?.members?.()[i]?.nickname || ('玩家' + (i + 1));
}
function sendMPInput() {
  const now = performance.now();
  let ix = 0, iy = 0;
  if (keys['arrowleft'] || keys['a']) ix -= 1;
  if (keys['arrowright'] || keys['d']) ix += 1;
  if (keys['arrowup'] || keys['w']) iy -= 1;
  if (keys['arrowdown'] || keys['s']) iy += 1;
  if (!ix && !iy && joy && (joy.dx || joy.dy)) { ix = joy.dx; iy = joy.dy; }
  if (!ix && !iy && pX !== null) {
    const m = smoothP.get(mySeatI) || { x: W / 2, y: H / 2 };
    const dx = pX - m.x, dy = pY - m.y, d = Math.hypot(dx, dy);
    if (d > 6) { ix = dx / d; iy = dy / d; }
  }
  const l = Math.hypot(ix, iy);
  if (l > 1) { ix /= l; iy /= l; }
  mpInput.ix = ix; mpInput.iy = iy;      /* 本地预测直接吃这个输入 */
  if (now - lastSent >= 60 || Math.abs(ix - lastIx) > 0.04 || Math.abs(iy - lastIy) > 0.04) {
    window.QCFish?.sendInput?.(+ix.toFixed(2), +iy.toFixed(2));
    lastSent = now; lastIx = ix; lastIy = iy;
  }
}
function updateMPHUD(eng) {
  const my = mySeatI >= 0 ? eng.players[mySeatI] : null;
  if (my) {
    elScore.textContent = my.score;
    elLives.textContent = '❤️'.repeat(Math.max(0, my.lives)) + '🤍'.repeat(Math.max(0, 3 - my.lives));
    const st = stageInfo(my.stage);
    elStage.textContent = st.name;
    elGrow.textContent = my.eaten + '/' + st.need;
    elBar.style.width = (st.need ? my.eaten / st.need * 100 : 100) + '%';
    elTime.textContent = fmtT(eng.time);
  }
  const bar = $('fgMpBar');
  bar.hidden = false;
  bar.innerHTML = eng.players.map((p, i) => i === mySeatI ? '' :
    `<span class="fg-mpchip${p.dead ? ' dead' : ''}">${esc(memberName(i))} · ${p.score}分 · ${stageInfo(p.stage).name}${p.dead ? ' · 💀出局' : ' · ' + '❤️'.repeat(Math.max(0, p.lives))}</span>`).join('');
}
function showMPResult(eng) {
  state = 'over';
  const my = mySeatI >= 0 ? eng.players[mySeatI] : null;
  const win = eng.winner === mySeatI;
  $('fgMpTitle').textContent = eng.winner === 'draw' ? '🤝 平局' : win ? '🏆 你赢了！' : '😵 惜败！';
  const wname = eng.winner === 'draw' ? '' : memberName(eng.winner);
  $('fgMpSub').innerHTML = (eng.reason ? esc(eng.reason) + '<br>' : '') +
    (eng.winner === 'draw' ? '' : '胜者：<b style="color:#ffd54f">' + esc(wname) + '</b><br>') +
    '你的得分 <b style="color:#ffd54f">' + (my ? my.score : 0) + '</b> · 成长到 ' + stageInfo(my ? my.stage : 0).name +
    ' · 用时 ' + fmtT(eng.time) + '<br>金币与战绩已自动入账';
  $('fgMPResult').hidden = false;
}
function closeMPToRoom() {
  isOpen = false; state = 'idle';
  wrap.hidden = true;
  document.body.classList.remove('fg-lock');
  if (reviveTick) { clearInterval(reviveTick); reviveTick = null; }
  for (const k in keys) keys[k] = false;
  pX = pY = null; joy = null; stickEl.hidden = true;
}
function close() {
  if (!isOpen) return;
  isOpen = false; state = 'idle'; menuOpen = false;
  if (reviveTick) { clearInterval(reviveTick); reviveTick = null; }
  $('fgPauseMenu').hidden = true; $('fgPause').hidden = false;
  wrap.hidden = true;
  document.body.classList.remove('fg-lock');
  for (const k in keys) keys[k] = false;
  pX = pY = null; joy = null; stickEl.hidden = true;
  try { window.QCFish?.back?.(); } catch (e) { }
}

/* ---------- 暂停菜单 ---------- */
let menuOpen = false;
function setMenu(on) {
  menuOpen = on;
  $('fgPauseMenu').hidden = !on;
  $('fgPause').hidden = on;
  sfx.ui();
  if (on) { joy = null; stickEl.hidden = true; pX = pY = null; }
}
function refreshModes() {
  $('fgModeJoy').classList.toggle('on', controlMode === 'joy');
  $('fgModeFollow').classList.toggle('on', controlMode === 'follow');
}
$('fgPause').onclick = () => { if (state === 'playing') setMenu(true); };
$('fgResume').onclick = () => setMenu(false);
$('fgQuit').onclick = close;
$('fgRestart').onclick = () => { setMenu(false); resetGame(); state = 'playing'; sfx.ui(); };
$('fgModeJoy').onclick = () => { controlMode = 'joy'; try { localStorage.setItem('fg_mode', 'joy'); } catch (e) { } refreshModes(); sfx.ui(); };
$('fgModeFollow').onclick = () => { controlMode = 'follow'; try { localStorage.setItem('fg_mode', 'follow'); } catch (e) { } refreshModes(); sfx.ui(); };
$('fgAgain1').onclick = () => { ovWin.hidden = true; resetGame(); state = 'playing'; sfx.ui(); };
$('fgAgain2').onclick = () => { ovLose.hidden = true; resetGame(); state = 'playing'; sfx.ui(); };
$('fgBack1').onclick = close;
$('fgBack2').onclick = close;
$('fgShield').onclick = () => {
  if (state !== 'playing' || shieldUsed) return;
  window.QCFish?.useShield?.(matchId)?.then?.(j => {
    if (!j || !j.ok) { floatText(player.x, player.y - 30, (j && j.msg) || '使用失败', '#ff8a80'); return; }
    shieldUsed = true;
    player.shield = 8;
    $('fgShield').hidden = true;
    floatText(player.x, player.y - player.size - 14, '🛡️ 护盾开启 8 秒！', '#ffd54f');
    sfx.shield();
  })?.catch?.(e => floatText(player.x, player.y - 30, e.message || '使用失败', '#ff8a80'));
};
$('fgReviveYes').onclick = doRevive;
$('fgReviveNo').onclick = () => { if (reviveTick) { clearInterval(reviveTick); reviveTick = null; } $('fgRevive').hidden = true; showLose(); };
$('fgExitMp').onclick = () => { window.QCFish?.leaveRoom?.(); closeMPToRoom(); };
$('fgMpRoom').onclick = () => closeMPToRoom();
$('fgMpLobby').onclick = () => { window.QCFish?.leaveRoom?.(); closeMPToRoom(); };
/* ---------- 音效开关 ---------- */
function syncSnd() {
  const b = $('fgSnd'); if (!b) return;
  const m = sfx.muted();
  b.textContent = m ? '🔇' : '🔊';
  b.classList.toggle('off', m);
  b.title = m ? '音效已静音（点击开启）' : '音效已开启（点击静音）';
}
$('fgSnd').onclick = () => {
  sfx.setMuted(!sfx.muted());
  syncSnd();
  if (!sfx.muted()) sfx.ui();
};
syncSnd();
refreshModes();

window.QCFishGame = { open, close, openMP };
/* 联机自查口（不参与玩法）：对比本地预测与服务端坐标，验证跟手与收敛 */
window.__fishMP = () => {
  const eng = window.QCFish?.roomEngine?.();
  const p = eng && mySeatI >= 0 ? eng.players[mySeatI] : null;
  return {
    snaps: window.__fishSnaps || 0,
    input: { ix: mpInput.ix, iy: mpInput.iy },
    mine: mpMine ? { x: Math.round(mpMine.x), y: Math.round(mpMine.y) } : null,
    server: p ? { x: Math.round(p.x), y: Math.round(p.y), stage: p.stage, lives: p.lives } : null,
    diff: p && mpMine ? Math.round(Math.hypot(mpMine.x - p.x, mpMine.y - p.y)) : null,
  };
};
})();
