/* 生气猫 联机服务器
 * - 房间制：房主创建拿 4 位房间码，好友输码加入（最多 5 人）
 * - 房主可勾选"补全AI对手"；不勾则几个人就几个人打（2~5 都支持）
 * - 服务器权威：牌堆/愤怒值/回合/超时全部服务端裁决，客户端只展示和出牌
 * - 聊天广播；输入 \ai 只对输入者本人回执 revealAI（彩蛋）
 * 端口 39090（防火墙 39000-40000 已放行）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 39090;
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, {recursive:true});
let platform;
function readHTML() {
  try { return fs.readFileSync(path.join(__dirname, 'index.html')); }
  catch (e) { return '游戏页面未部署'; }
}

/* ================== 账号存储（JSON 文件） ================== */
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = {}; }
let meta = { regDate: '', regCount: 0 };
try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch (e) { meta = { regDate: '', regCount: 0 }; }
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
let analytics = { days: {} };
try { analytics = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')); } catch (e) { analytics = { days: {} }; }
if (!analytics.days) analytics.days = {};
let analyticsDirty = false;
function saveAnalytics() {
  analyticsDirty = false;
  const keys = Object.keys(analytics.days).sort();
  while (keys.length > 30) delete analytics.days[keys.shift()];
  try { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics)); } catch (e) { }
}
function analyticsFlush() { if (analyticsDirty) saveAnalytics(); }
setInterval(analyticsFlush, 5000).unref();
const dayKey = () => new Date().toLocaleDateString('sv-SE');
function trackEvent(event, vid, game) {
  const day = dayKey();
  const d = analytics.days[day] || (analytics.days[day] = { vids: [], pv: 0, events: {}, games: {} });
  d.pv = (d.pv || 0) + 1;
  d.events = d.events || {}; d.games = d.games || {};
  if (vid && !(d.vids || []).includes(vid) && (d.vids || []).length < 5000) { (d.vids = d.vids || []).push(vid); }
  const ev = String(event || 'visit').slice(0, 20);
  d.events[ev] = (d.events[ev] || 0) + 1;
  if (game) { const g = String(game).slice(0, 20); d.games[g] = (d.games[g] || 0) + 1; }
  analyticsDirty = true;
}
function countNewUsers(key) {
  let n = 0;
  for (const k in users) {
    const u = users[k] || {};
    if (u.guest) continue;               // 游客自动建的号不算注册
    const c = u.created;
    if (!c) continue;
    try { if (new Date(c).toLocaleDateString('sv-SE') === key) n++; } catch (e) { }
  }
  return n;
}
const ANNOUNCE_FILE = path.join(DATA_DIR, 'announcements.json');
let announcements = [];
try { announcements = JSON.parse(fs.readFileSync(ANNOUNCE_FILE, 'utf8')); } catch (e) { announcements = []; }
if (!Array.isArray(announcements)) announcements = [];
function saveAnnouncements() {
  const tmp = ANNOUNCE_FILE + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(announcements, null, 1)); fs.renameSync(tmp, ANNOUNCE_FILE); } catch (e) { }
}
function saveUsers() { const tmp=USERS_FILE+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(users,null,1)); if(fs.existsSync(USERS_FILE))fs.copyFileSync(USERS_FILE,USERS_FILE+'.bak'); fs.renameSync(tmp,USERS_FILE); }
function saveMeta() { try { fs.writeFileSync(META_FILE, JSON.stringify(meta)); } catch (e) { } }
function hashPwd(salt, pwd) { return crypto.createHash('sha256').update(salt + '|' + pwd).digest('hex'); }
function findUserEntryByToken(token) {
  if (!token) return null;
  for (const phone in users) if (users[phone].token === token) return [phone, users[phone]];
  return null;
}
function findUserByToken(token) {
  return platform?.lookup(token) || (findUserEntryByToken(token)||[])[1] || null;
}
const DAILY_REG_LIMIT = 30; // 每天最多注册数（防批量注册）
function regQuotaLeft() {
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  if (meta.regDate !== today) { meta.regDate = today; meta.regCount = 0; saveMeta(); }
  return Math.max(0, DAILY_REG_LIMIT - meta.regCount);
}
function regQuotaConsume() {
  regQuotaLeft();
  meta.regCount++;
  saveMeta();
}
/* 上线记录：每次注册/登录计一次；loginDays 去重存日期，loginLog 存最近 10 次时间点 */
function markSeen(u) {
  if (!u) return;
  const t = Date.now();
  u.lastLogin = t;
  u.loginCount = (u.loginCount || 0) + 1;
  const today = dayKey();
  if (!Array.isArray(u.loginDays)) u.loginDays = [];
  if (!u.loginDays.includes(today)) {
    u.loginDays.push(today);
    if (u.loginDays.length > 180) u.loginDays = u.loginDays.slice(-180);
  }
  if (!Array.isArray(u.loginLog)) u.loginLog = [];
  u.loginLog.push(t);
  if (u.loginLog.length > 10) u.loginLog = u.loginLog.slice(-10);
}

/* ================== 管理员后台 ================== */
let ADMIN_PASS = 'qcadmin168';   // 默认管理密码，可在 admin.json 里改 {"pass":"你的密码"}
try { const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin.json'), 'utf8')); if (cfg.pass) ADMIN_PASS = cfg.pass; } catch (e) { }
const adminTokens = new Set();
function readAdminHTML() {
  try { return fs.readFileSync(path.join(__dirname, 'admin.html')); }
  catch (e) { return 'admin.html 未部署'; }
}
function handleApi(req, res, body) {
  let j = {};
  try { j = JSON.parse(body || '{}'); } catch (e) { }
  const url = req.url.split('?')[0];
  if (url === '/api/track') {
    trackEvent(j.event || 'visit', String(j.vid || '').slice(0, 40), j.game ? String(j.game) : '');
    return { ok: true };
  }
  if (url === '/api/announcement') {
    const list = announcements.filter(a => a && a.active && a.title)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return { ok: true, announcement: list[0] || null, list: list.slice(0, 20), count: list.length };
  }
  const extended=platform?.api(req,j) ?? platform?.legacyApi(req,j);
  if(extended!==undefined)return extended;
  if (url === '/api/register') {
    const phone = String(j.phone || '').trim();
    const pass = String(j.password || '');
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, msg: '手机号必须是有效的11位手机号' };
    if (pass.length < 4 || pass.length > 20) return { ok: false, msg: '密码需要 4~20 位' };
    if (users[phone]) return { ok: false, msg: '该手机号已注册，请直接登录' };
    if (regQuotaLeft() <= 0) return { ok: false, msg: '今日注册名额已满（每天30个），明天再来吧' };
    const salt = crypto.randomBytes(8).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    users[phone] = {
      salt, hash: hashPwd(salt, pass), token,
      nickname: '猫友' + phone.slice(-4),   // 注册不再要求昵称，默认生成
      avatar: String(j.avatar || '🙂').slice(0, 8),
      coins: 200,                            // 新用户初始金币
      stats: { games: 0, wins: 0 },          // 局数/胜局（金币为正算赢）
      frames: [],                            // 已拥有的头像框
      frame: '',                             // 当前佩戴的头像框
      lastSign: '',                          // 最后签到日期
      created: Date.now(),
      lastLogin: 0, loginCount: 0, loginDays: [], loginLog: [],  // 上线埋点
    };
    markSeen(users[phone]);
    saveUsers();
    regQuotaConsume();
    log('新注册', phone.slice(0,3) + '****' + phone.slice(-4));
    const u = users[phone];
    return { ok: true, token, coins: u.coins, stats: u.stats, lastSign: u.lastSign,
             frames: u.frames || [], frame: u.frame || '',
             profile: { nickname: u.nickname, avatar: u.avatar } };
  }
  if (url === '/api/login') {
    const phone = String(j.phone || '').trim();
    const u = users[phone];
    if (!u) return { ok: false, msg: '该手机号还没注册' };
    if (u.hash !== hashPwd(u.salt, String(j.password || ''))) return { ok: false, msg: '密码不对' };
    u.token = crypto.randomBytes(16).toString('hex');
    if (!u.stats) u.stats = { games: 0, wins: 0 };
    if (typeof u.coins !== 'number') u.coins = 200;
    if (!u.frames) u.frames = [];
    if (typeof u.frame !== 'string') u.frame = '';
    markSeen(u);
    saveUsers();
    log('登录', phone.slice(0,3) + '****' + phone.slice(-4));
    return { ok: true, token: u.token, coins: u.coins, stats: u.stats, lastSign: u.lastSign || '',
             frames: u.frames, frame: u.frame,
             profile: { nickname: u.nickname, avatar: u.avatar } };
  }
  if (url === '/api/leaderboard') {
    const list = Object.keys(users).map(phone => ({
      phone,
      nickname: users[phone].nickname, avatar: users[phone].avatar,
      frame: users[phone].frame || '',
      coins: users[phone].coins || 0,
      games: (users[phone].stats || {}).games || 0,
      wins: (users[phone].stats || {}).wins || 0,
    }));
    list.sort((a, b) => b.coins - a.coins);
    const tokenQ = req.url.split('token=')[1];
    const entry = tokenQ ? findUserEntryByToken(tokenQ) : null;
    const myIdx = entry ? list.findIndex(u => u.phone === entry[0]) : -1;
    return {
      ok: true, total: list.length,
      top: list.slice(0, 10).map((u, i) => ({ rank: i + 1, nickname: u.nickname, avatar: u.avatar, frame: u.frame || '', coins: u.coins, games: u.games, wins: u.wins })),
      me: myIdx >= 0 ? { rank: myIdx + 1, nickname: list[myIdx].nickname, avatar: list[myIdx].avatar, frame: list[myIdx].frame || '', coins: list[myIdx].coins, games: list[myIdx].games, wins: list[myIdx].wins } : null,
    };
  }
  if (url === '/api/profile') {
    if (req.method === 'GET') {
      const u = findUserByToken(req.url.split('token=')[1]);
      if (!u) return { ok: false, msg: '登录已过期' };
      return { ok: true, profile: { nickname: u.nickname, avatar: u.avatar }, frames: u.frames || [], frame: u.frame || '' };
    }
    const u = findUserByToken(j.token);
    if (!u) return { ok: false, msg: '登录已过期' };
    if (j.nickname) u.nickname = String(j.nickname).slice(0, 8);
    if (j.avatar) u.avatar = String(j.avatar).slice(0, 8);
    if (typeof j.frame === 'string' && (j.frame === '' || (u.frames || []).includes(j.frame))) u.frame = j.frame;
    saveUsers();
    return { ok: true, profile: { nickname: u.nickname, avatar: u.avatar }, frame: u.frame || '' };
  }
  if (url === '/api/gameover') {
    const u = findUserByToken(j.token);
    if (!u) return { ok: false, msg: '登录已过期' };
    const change = Math.max(-50, Math.min(50, Number(j.change) || 0));
    u.coins = (typeof u.coins === 'number' ? u.coins : 200) + change;
    if (!u.stats) u.stats = { games: 0, wins: 0 };
    u.stats.games++;
    if (change > 0) u.stats.wins++;   // 结算为正就算赢
    saveUsers();
    return { ok: true, coins: u.coins, stats: u.stats };
  }
  if (url === '/api/buyFrame') {
    const u = findUserByToken(j.token);
    if (!u) return { ok: false, msg: '登录已过期' };
    const PRICES = { S: 2000, A: 1000, B: 500, C: 50 };
    const id = String(j.id || '');
    if (!PRICES[id]) return { ok: false, msg: '没有这个头像框' };
    if (!u.frames) u.frames = [];
    if (u.frames.includes(id)) return { ok: false, msg: '已拥有，直接佩戴即可' };
    if ((u.coins || 0) < PRICES[id]) return { ok: false, msg: '金币不足' };
    u.coins -= PRICES[id];
    u.frames.push(id);
    u.frame = id;
    saveUsers();
    log('购买头像框', id);
    return { ok: true, coins: u.coins, frames: u.frames, frame: u.frame };
  }
  if (url === '/api/changePassword') {
    const entry = findUserEntryByToken(j.token);
    if (!entry) return { ok: false, msg: '登录已过期' };
    const [phone, u] = entry;
    if (u.hash !== hashPwd(u.salt, String(j.oldPassword || ''))) return { ok: false, msg: '当前密码不对' };
    const np = String(j.newPassword || '');
    if (np.length < 4 || np.length > 20) return { ok: false, msg: '新密码需要 4~20 位' };
    u.salt = crypto.randomBytes(8).toString('hex');
    u.hash = hashPwd(u.salt, np);
    u.token = crypto.randomBytes(16).toString('hex'); // 改密后旧登录失效，需重新登录
    saveUsers();
    log('修改密码', phone.slice(0,3) + '****' + phone.slice(-4));
    return { ok: true };
  }
  if (url === '/api/sign') {
    const u = findUserByToken(j.token);
    if (!u) return { ok: false, msg: '登录已过期' };
    const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
    if (u.lastSign === today) return { ok: true, already: true, coins: u.coins };
    u.lastSign = today;
    u.coins = (typeof u.coins === 'number' ? u.coins : 200) + 50;
    saveUsers();
    return { ok: true, coins: u.coins };
  }
  if (url === '/api/changePhone') {
    const entry = findUserEntryByToken(j.token);
    if (!entry) return { ok: false, msg: '登录已过期' };
    const [oldPhone, u] = entry;
    const newPhone = String(j.newPhone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(newPhone)) return { ok: false, msg: '新手机号必须是有效的11位手机号' };
    if (users[newPhone]) return { ok: false, msg: '新手机号已被占用' };
    if (u.hash !== hashPwd(u.salt, String(j.password || ''))) return { ok: false, msg: '当前密码不对' };
    users[newPhone] = u;
    delete users[oldPhone];
    saveUsers();
    log('换绑手机', oldPhone.slice(0,3) + '****' + oldPhone.slice(-4), '->', newPhone.slice(0,3) + '****' + newPhone.slice(-4));
    return { ok: true, phone: newPhone };
  }
  if (url === '/api/deleteAccount') {
    const entry = findUserEntryByToken(j.token);
    if (!entry) return { ok: false, msg: '登录已过期' };
    const [phone, u] = entry;
    if (u.hash !== hashPwd(u.salt, String(j.password || ''))) return { ok: false, msg: '密码不对，无法注销' };
    delete users[phone];
    saveUsers();
    log('注销账号', phone.slice(0,3) + '****' + phone.slice(-4));
    return { ok: true };
  }
  return { ok: false, msg: 'unknown api' };
}

/* ---------------- 安卓 APP 安装包下载 ---------------- */
const APP_DIR = path.join(__dirname, 'downloads');
const APP_APK = 'qcgame.apk';
const APP_VERSION = '1.0.0';
function serveApp(req, res) {
  const p = new URL(req.url, 'http://local').pathname;
  if (!p.startsWith('/app/')) return false;
  const fp = path.join(APP_DIR, APP_APK);
  if (p === '/app/qcgame.apk' || p === '/app/download') {
    if (!fs.existsSync(fp)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('安装包暂未上传'); return true; }
    const st = fs.statSync(fp);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': st.size,
      'Content-Disposition': 'attachment; filename="qcgame-' + APP_VERSION + '.apk"',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(fp).pipe(res);
    return true;
  }
  if (p === '/app/version.json') {
    const size = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ version: APP_VERSION, size, url: '/app/qcgame.apk', note: '安卓独立客户端' }));
    return true;
  }
  if (p === '/app/qr') {
    const base = process.env.PUBLIC_ORIGIN || ('http://' + (req.headers.host || '124.220.191.183'));
    let QR = null;
    try { QR = require('qrcode'); } catch (e) { QR = null; }
    if (!QR) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('qrcode 模块缺失'); return true; }
    QR.toString(base + '/app/qcgame.apk', { type: 'svg', margin: 1, width: 380, errorCorrectionLevel: 'M' }).then(svg => {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public,max-age=300' });
      res.end(svg);
    }).catch(() => { res.writeHead(500); res.end(); });
    return true;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
  return true;
}

const server = http.createServer((req, res) => {
  if (serveApp(req, res)) return;
  if(platform?.serve(req,res))return;
  // 管理后台页面（入口隐蔽：/admin）
  if (req.url.startsWith('/frames/')) {
    const fn = path.basename(req.url);
    try {
      const f = fs.readFileSync(path.join(__dirname, 'frames', fn));
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(f);
    } catch (e) { res.writeHead(404); res.end(); }
    return;
  }
  if (req.url === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(readAdminHTML());
    return;
  }
  if (req.url.startsWith('/api/admin/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) { }
      let reply = { ok: false, msg: 'unknown admin api' };
      if (req.url === '/api/admin/login') {
        if (String(j.pass || '') === ADMIN_PASS) {
          const t = crypto.randomBytes(24).toString('hex');
          adminTokens.add(t);
          reply = { ok: true, adminToken: t };
        } else reply = { ok: false, msg: '管理密码错误' };
      } else if (adminTokens.has(j.adminToken)) {
        if (req.url === '/api/admin/users') {
          const today = dayKey();
          regQuotaLeft();                       // 关键：读列表时也要跨天归零，否则没新注册就一直显示旧数字
          const todayNew = countNewUsers(today);
          const list = Object.keys(users).map(key => {
            const u = users[key] || {};
            return {
              phone: key,
              id: u.id || '',
              guest: !!u.guest,
              nickname: u.nickname,
              avatar: u.avatar,
              frame: u.frame || '',
              coins: u.coins || 0,
              games: (u.stats || {}).games || 0,
              wins: (u.stats || {}).wins || 0,
              registered: u.created || 0,
              lastLogin: u.lastLogin || 0,
              loginCount: u.loginCount || 0,
              loginDays: Array.isArray(u.loginDays) ? u.loginDays.length : 0,
              loginLog: Array.isArray(u.loginLog) ? u.loginLog.slice(-10) : [],
              lastSign: u.lastSign || '',
            };
          });
          reply = { ok: true, users: list, quota: { date: today, count: meta.regCount, limit: DAILY_REG_LIMIT, todayNew } };
        } else if (req.url === '/api/admin/update') {
          const u = users[j.phone];
          if (!u) reply = { ok: false, msg: '用户不存在' };
          else {
            if (typeof j.coins === 'number') u.coins = Math.max(0, Math.min(9999999, j.coins));
            if (j.nickname) u.nickname = String(j.nickname).slice(0, 8);
            if (j.avatar) u.avatar = String(j.avatar).slice(0, 8);
            if (j.newPassword) {
              u.salt = crypto.randomBytes(8).toString('hex');
              u.hash = hashPwd(u.salt, String(j.newPassword));
              u.token = crypto.randomBytes(16).toString('hex'); // 重置密码后踢下线
            }
            saveUsers();
            log('[管理员] 修改用户', j.phone);
            reply = { ok: true };
          }
        } else if (req.url === '/api/admin/delete') {
          if (users[j.phone]) {
            delete users[j.phone];
            saveUsers();
            log('[管理员] 删除用户', j.phone);
            reply = { ok: true };
          } else reply = { ok: false, msg: '用户不存在' };
        } else if (req.url === '/api/admin/feedback') {
          reply=platform.admin(req,j);
        } else if (req.url === '/api/admin/stats') {
          const today = dayKey();
          regQuotaLeft();                       // 关键：看板读取时也跨天归零
          const d = analytics.days[today] || { vids: [], pv: 0, events: {}, games: {} };
          const series = [];
          for (let i = 6; i >= 0; i--) {
            const dt = new Date();
            dt.setDate(dt.getDate() - i);
            const key = dt.toLocaleDateString('sv-SE');
            const dd = analytics.days[key] || {};
            series.push({ date: key, uv: (dd.vids || []).length, pv: dd.pv || 0, newUsers: countNewUsers(key) });
          }
          const games = Object.entries(d.games || {}).map(([k, v]) => ({ game: k, count: v })).sort((a, b) => b.count - a.count);
          reply = {
            ok: true,
            today: { date: today, uv: (d.vids || []).length, pv: d.pv || 0, newUsers: countNewUsers(today), events: d.events || {}, games },
            series,
            totals: { users: Object.keys(users).length, activeAnnouncements: announcements.filter(a => a.active).length },
            quota: { date: today, count: meta.regCount, limit: DAILY_REG_LIMIT, todayNew: countNewUsers(today) }
          };
        } else if (req.url === '/api/admin/announcements') {
          reply = { ok: true, announcements: announcements.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)) };
        } else if (req.url === '/api/admin/announce/save') {
          const title = String(j.title || '').trim().slice(0, 60);
          const body = String(j.body || '').trim().slice(0, 3000);
          if (!title) reply = { ok: false, msg: '标题不能为空' };
          else if (!body) reply = { ok: false, msg: '正文不能为空' };
          else {
            const now = Date.now();
            let a = announcements.find(x => x.id === j.id);
            if (a) {
              Object.assign(a, { title, body, level: j.level === 'important' ? 'important' : 'normal', popup: !!j.popup, active: !!j.active, updated: now });
            } else {
              a = { id: crypto.randomBytes(6).toString('hex'), title, body, level: j.level === 'important' ? 'important' : 'normal', popup: !!j.popup, active: !!j.active, created: now, updated: now };
              announcements.unshift(a);
            }
            saveAnnouncements();
            log('[管理员] 保存公告', a.id, a.active ? '发布' : '草稿');
            reply = { ok: true, announcement: a };
          }
        } else if (req.url === '/api/admin/announce/delete') {
          const i = announcements.findIndex(x => x.id === j.id);
          if (i >= 0) { announcements.splice(i, 1); saveAnnouncements(); reply = { ok: true }; }
          else reply = { ok: false, msg: '公告不存在' };
        } else if (req.url === '/api/admin/resetQuota') {
          meta.regCount = 0; saveMeta();
          reply = { ok: true };
        }
      } else {
        reply = { ok: false, msg: '管理员未登录' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(reply));
    });
    return;
  }
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let reply; try { reply = handleApi(req, res, body); } catch(e){ console.error('API failure:',e.message); reply={ok:false,msg:'服务暂时不可用，请稍后重试'}; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(reply));
    });
    return;
  }
  if (req.url.split('?')[0] === '/' || req.url.split('?')[0] === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readHTML());
  } else {
    res.writeHead(404); res.end('not found');
  }
});
const wss = new WebSocketServer({ server, maxPayload:16384 });

/* ================== 工具 ================== */
const rooms = new Map();       // code -> room
const conns = new Map();       // connId -> conn
let nextConnId = 1;
let nextUid = 1;

const AI_NAMES = ['橘仔', '团团', '雪球', '煤球'];
const AI_FACES = ['🐱', '😺', '😸', '😻'];
const HUMAN_FACES = ['🙂', '😀', '😊', '😄', '😃'];

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function genCode() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)||qqRooms.has(c)); return c; }
function send(ws, obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { } }
function broadcast(room, obj, exceptConnId) {
  for (const p of room.players) {
    if (p.connId && p.connId !== exceptConnId) {
      const c = conns.get(p.connId);
      if (c) send(c.ws, obj);
    }
  }
}
function log(...a) { console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a); }

/* ================== 牌堆（与单机一致） ================== */
const NUM_COPIES = 4, CNT_MINUS10 = 5, CNT_REVERSE = 5, CNT_DOUBLE = 5, CNT_SWAP = 3;
const HAND_SIZE = 4, ANGER_MAX = 100;
const TIME_NORMAL = 6, TIME_FAST = 3, SPEED_AT_MS = 90000;
const COIN_5P = { 1: 10, 2: 5, 3: 0, 4: -5, 5: -10 };
const COIN_4P = { 1: 10, 2: 5, 3: -5, 4: -10 };
const COIN_3P = { 1: 10, 2: 0, 3: -10 };
const COIN_2P = { 1: 10, 2: -10 };

function buildDeck() {
  const d = [];
  for (let v = 0; v <= 9; v++) for (let k = 0; k < NUM_COPIES; k++) d.push({ type: 'num', v });
  for (let k = 0; k < CNT_MINUS10; k++) d.push({ type: 'minus10' });
  for (let k = 0; k < CNT_REVERSE; k++) d.push({ type: 'reverse' });
  for (let k = 0; k < CNT_DOUBLE; k++) d.push({ type: 'double' });
  for (let k = 0; k < CNT_SWAP; k++) d.push({ type: 'swap' });
  d.forEach(c => c.uid = nextUid++);
  return shuffle(d);
}
function draw(st) {
  if (st.deck.length === 0) {
    if (st.discard.length === 0) return null;
    st.deck = shuffle(st.discard.splice(0));
  }
  return st.deck.pop();
}
function nextLiving(st, from) {
  let i = from;
  for (let k = 0; k < st.N; k++) {
    i = (i + st.direction + st.N) % st.N;
    if (st.seats[i].alive) return i;
  }
  return from;
}
function aliveList(st) { return st.seats.filter(p => p.alive); }

/* ================== AI 策略（与单机一致） ================== */
function chooseCard(hand, anger, swapped) {
  const nums = hand.filter(c => c.type === 'num');
  const safe = nums.filter(c => anger + c.v < ANGER_MAX);
  const minus = hand.find(c => c.type === 'minus10');
  const rev = hand.find(c => c.type === 'reverse');
  const dbl = hand.find(c => c.type === 'double');
  const swp = hand.find(c => c.type === 'swap');
  if (anger >= 70) {
    if (minus) return minus;
    if (rev) return rev;
    if (dbl) return dbl;
    if (safe.length) return safe.reduce((a, b) => a.v > b.v ? a : b);
    if (swp && !swapped) return swp;
    if (nums.length) return nums.reduce((a, b) => a.v < b.v ? a : b);
    return hand[0];
  }
  if (safe.length) return safe.reduce((a, b) => a.v > b.v ? a : b);
  if (minus) return minus;
  if (rev) return rev;
  if (dbl) return dbl;
  if (swp && !swapped) return swp;
  return hand[0];
}
function pickSwapTarget(st, p) {
  let best = -1, bs = Infinity;
  st.seats.forEach(q => {
    if (q === p || !q.alive) return;
    const s = q.hand.reduce((t, c) => t + (c.type === 'num' ? c.v : 0), 0);
    if (s < bs) { bs = s; best = q.idx; }
  });
  return best;
}

/* ================== 房间 ================== */
function makeRoom(conn, name, fillAI, code) {
  const finalCode = (code && /^\d{4}$/.test(code) && !rooms.has(code)) ? code : genCode();
  const room = {
    code: finalCode, fillAI: !!fillAI, state: null,
    players: [{ connId: conn.id, name: (name || '玩家').slice(0, 8) }],
    lastActive: Date.now(),
  };
  conn.roomCode = finalCode; conn.seatIdx = 0;
  rooms.set(finalCode, room);
  return room;
}
function lobbyMsg(room) {
  return {
    t: 'lobby', code: room.code, fillAI: room.fillAI,
    hostConnId: room.hostConnId,
    players: room.players.map(p => {
      const c = conns.get(p.connId);
      const u = (c && c.token) ? findUserByToken(c.token) : null;
      return {
        name: u ? u.nickname : p.name,
        isHost: p.connId === room.hostConnId,
        avatar: u ? (u.avatar || '👤') : '👤',
        frame: u ? (u.frame || '') : '',
      };
    }),
  };
}
function sendLobby(room) {
  for (const p of room.players) {
    const c = conns.get(p.connId);
    if (c) {
      const m = lobbyMsg(room);
      m.youAreHost = p.connId === room.hostConnId;
      send(c.ws, m);
    }
  }
}
function removeConnFromRoom(conn) {
  const room = rooms.get(conn.roomCode);
  if (!room) return;
  if (!room.state) {
    // 大厅阶段：直接移人
    room.players = room.players.filter(p => p.connId !== conn.id);
    if (room.rematch) {
      room.rematch.set.delete(conn.id);
      if (room.players.length > 0) {
        broadcast(room, { t: 'rematch', count: room.rematch.set.size, total: room.players.length });
        if (room.rematch.set.size >= room.players.length && room.rematch.set.size > 0) {
          clearTimeout(room.rematch.timer);
          room.rematch = null;
          startGame(room);
          return;
        }
      }
    }
    if (room.players.length === 0) { rooms.delete(room.code); log('房间', room.code, '空置解散'); return; }
    if (room.hostConnId === conn.id) room.hostConnId = room.players[0].connId;
    sendLobby(room);
  } else {
    // 游戏中：有账号的玩家保留座位60秒等待重连（期间超时自动出牌）；匿名玩家直接AI接管
    const seat = room.state.seats[conn.seatIdx];
    if (seat && seat.type === 'human' && seat.token) {
      seat.disconnected = true;
      broadcast(room, { t: 'chat', from: '系统', text: seat.name + ' 掉线了，AI 暂时接管，重连后即可收回控制权' });
    } else {
      if (seat && seat.type === 'human') {
        seat.type = 'ai'; seat.connId = null;
        broadcast(room, { t: 'chat', from: '系统', text: seat.name + ' 掉线了，AI 接管TA的手牌' });
      }
      room.players = room.players.filter(p => p.connId !== conn.id);
      if (room.players.length === 0) { room.state.dead = true; rooms.delete(room.code); log('房间', room.code, '无人解散'); }
    }
  }
}

/* ================== 开局 ================== */
function startGame(room) {
  const N = room.fillAI ? 5 : Math.max(2, room.players.length);
  const seats = [];
  room.players.forEach((p, i) => {
    const c = conns.get(p.connId);
    const u = (c && c.token) ? findUserByToken(c.token) : null;
    seats.push({
      idx: i, name: u ? u.nickname : p.name, type: 'human', connId: p.connId,
      token: (c && c.token) ? c.token : null,
      face: u ? (u.avatar || HUMAN_FACES[i % HUMAN_FACES.length]) : HUMAN_FACES[i % HUMAN_FACES.length],
      hand: [], alive: true, pendingDouble: 0, rank: null, swapped: false,
    });
    if (c) c.seatIdx = i;
  });
  let ai = 0;
  while (seats.length < N) {
    seats.push({
      idx: seats.length, name: AI_NAMES[ai % 4], type: 'ai', connId: null,
      face: AI_FACES[ai % 4],
      hand: [], alive: true, pendingDouble: 0, rank: null, swapped: false,
    });
    ai++;
  }
  const statsArr = seats.map(s2 => {
    if (s2.type !== 'human' || !s2.connId) return null;
    const c2 = conns.get(s2.connId);
    const u = (c2 && c2.token) ? findUserByToken(c2.token) : null;
    return u ? { games: (u.stats || { games: 0 }).games, wins: (u.stats || { wins: 0 }).wins } : null;
  });
  const st = {
    N, seats, room, statsArr,
    anger: (1 + Math.floor(Math.random() * 5)) * 10,
    direction: 1, deck: buildDeck(), discard: [],
    curIdx: Math.floor(Math.random() * N),
    elimCount: 0, startTime: Date.now(), speedMode: false, dead: false,
  };
  for (const s of seats) for (let k = 0; k < HAND_SIZE; k++) { const c = draw(st); if (c) { c.slot = s.hand.length; s.hand.push(c); } }
  room.state = st;
  // gamestart：各自收到自己的手牌
  for (const s of seats) {
    if (s.type !== 'human' || !s.connId) continue;
    const c = conns.get(s.connId);
    if (!c) continue;
    send(c.ws, {
      t: 'gamestart', seatIdx: s.idx, N, anger: st.anger, stats: st.statsArr,
      seats: seats.map(q => ({ name: q.name, face: q.face, type: q.type, frame: q.frame || '' })),
      yourHand: s.hand.map(c2 => ({ uid: c2.uid, slot: c2.slot, type: c2.type, v: c2.v })),
    });
  }
  log('房间', room.code, '开局，', N, '人（AI', seats.filter(s => s.type === 'ai').length + '）');
  // 给翻牌动画留时间再进主循环
  setTimeout(() => { if (!st.dead) gameLoop(room); }, 3000);
  // 加速模式检测
  st.speedTimer = setInterval(() => {
    if (st.dead) { clearInterval(st.speedTimer); return; }
    if (!st.speedMode && Date.now() - st.startTime >= SPEED_AT_MS) {
      st.speedMode = true;
      broadcast(room, { t: 'ev', ev: { k: 'speed' } });
    }
  }, 500);
}
function syncAll(room) {
  const st = room.state; if (!st) return;
  for (const s of st.seats) {
    if (s.type !== 'human' || !s.connId) continue;
    const c = conns.get(s.connId); if (!c) continue;
    send(c.ws, {
      t: 'sync',
      yourHand: s.hand.map(c2 => ({ uid: c2.uid, slot: c2.slot, type: c2.type, v: c2.v })),
      handCounts: st.seats.map(q => q.hand.length),
      alive: st.seats.map(q => q.alive),
      anger: st.anger, direction: st.direction, curIdx: st.curIdx,
      speedMode: st.speedMode,
    });
  }
}
function timeLimit(st) { return st.speedMode ? TIME_FAST : TIME_NORMAL; }

/* ================== 回合流程 ================== */
async function gameLoop(room) {
  const st = room.state;
  while (!st.dead && aliveList(st).length > 1) {
    await takeTurn(room, st, st.seats[st.curIdx]);
    if (st.dead) return;
    if (aliveList(st).length <= 1) break;
    st.curIdx = nextLiving(st, st.curIdx);
  }
  finishGame(room);
}

function takeTurn(room, st, p) {
  return new Promise(async (resolve) => {
    let required = p.pendingDouble > 0 ? p.pendingDouble : 1;
    p.pendingDouble = 0;
    let plays = 0;
    let dead = false;

    broadcast(room, { t: 'ev', ev: { k: 'turn', seatIdx: p.idx, deadline: Date.now() + timeLimit(st) * 1000 } });
    syncAll(room);

    while (!st.dead && p.alive && p.hand.length > 0 && aliveList(st).length > 1) {
      let card, targetIdx = null;
      if (p.type === 'human' && p.connId) {
        // 等人类出牌，限时超时自动出
        const limit = timeLimit(st) * 1000;
        let waitResolve;
        const waitP = new Promise(r => waitResolve = r);
        st.waiting = { seatIdx: p.idx, resolve: waitResolve };
        const timer = setTimeout(() => {
          if (st.waiting && st.waiting.seatIdx === p.idx) {
            const c = chooseCard(p.hand, st.anger, p.swapped);
            const t = c.type === 'swap' ? pickSwapTarget(st, p) : null;
            waitResolve({ card: c, targetIdx: t, timeout: true });
          }
        }, limit);
        const r = await waitP;
        clearTimeout(timer);
        st.waiting = null;
        card = r.card; targetIdx = r.targetIdx;
        if (r.timeout) {
          const c = conns.get(p.connId);
          if (c) send(c.ws, { t: 'chat', from: '系统', text: '你超时了，系统自动替你出牌' });
        }
      } else {
        await new Promise(r => setTimeout(r, st.speedMode ? 800 + Math.random() * 500 : 1300 + Math.random() * 800));
        card = chooseCard(p.hand, st.anger, p.swapped);
        if (card.type === 'swap') targetIdx = pickSwapTarget(st, p);
      }
      if (!card) break;

      // 牌离手进弃牌堆（换牌也进，之后补一张到原槽位）
      p.hand.splice(p.hand.indexOf(card), 1);
      st.discard.push(card);
      if (card.type !== 'swap') plays++;
      const d = draw(st);
      if (d) { d.slot = card.slot; p.hand.push(d); }

      // 广播出牌事件（语音/动画在客户端瞬间触发）
      broadcast(room, { t: 'ev', ev: { k: 'play', seatIdx: p.idx, card: { type: card.type, v: card.v, uid: card.uid } } });

      if (card.type === 'swap') {
        const target = st.seats[targetIdx];
        const tmp = p.hand; p.hand = target.hand; target.hand = tmp;
        p.swapped = true;
        broadcast(room, { t: 'ev', ev: { k: 'swapped', seatIdx: p.idx, targetIdx } });
        syncAll(room);
        await new Promise(r => setTimeout(r, st.speedMode ? 500 : 900));
        continue; // 换完还是自己出
      }

      if (card.type === 'num') {
        const before = st.anger;
        st.anger += card.v;
        let boom = false;
        if (st.anger >= ANGER_MAX) {
          boom = true;
          st.anger = before;
          p.alive = false;
          st.elimCount++;
          p.rank = st.N + 1 - st.elimCount; // 第1个炸=最后一名
          st.discard.push(...p.hand); p.hand = [];
          broadcast(room, { t: 'ev', ev: { k: 'play', seatIdx: p.idx, card: { type: 'num', v: card.v }, angerBefore: before, angerAfter: st.anger, boom: true } });
          syncAll(room);
          await new Promise(r => setTimeout(r, st.speedMode ? 1100 : 1500));
          dead = true;
        } else {
          broadcast(room, { t: 'ev', ev: { k: 'play', seatIdx: p.idx, card: { type: 'num', v: card.v }, angerBefore: before, angerAfter: st.anger } });
          syncAll(room);
          await new Promise(r => setTimeout(r, st.speedMode ? 600 : 1000));
        }
        if (dead) break;
      } else if (card.type === 'minus10') {
        st.anger = Math.max(0, st.anger - 10);
        broadcast(room, { t: 'ev', ev: { k: 'play', seatIdx: p.idx, card: { type: 'minus10' }, angerAfter: st.anger } });
        syncAll(room);
        await new Promise(r => setTimeout(r, st.speedMode ? 500 : 900));
      } else if (card.type === 'reverse') {
        st.direction *= -1;
        const remaining = required > 1 ? 2 : 0;
        if (remaining > 0) st.seats[nextLiving(st, p.idx)].pendingDouble = remaining;
        broadcast(room, { t: 'ev', ev: { k: 'play', seatIdx: p.idx, card: { type: 'reverse' }, direction: st.direction } });
        syncAll(room);
        await new Promise(r => setTimeout(r, st.speedMode ? 500 : 900));
        break; // 转向跳过自己
      } else if (card.type === 'double') {
        st.seats[nextLiving(st, p.idx)].pendingDouble = 2;
        broadcast(room, { t: 'ev', ev: { k: 'play', seatIdx: p.idx, card: { type: 'double' } } });
        syncAll(room);
        await new Promise(r => setTimeout(r, st.speedMode ? 500 : 900));
        break;
      }

      if (plays >= required) break;
    }
    resolve();
  });
}

function finishGame(room) {
  const st = room.state;
  if (st.dead) return;
  const survivor = st.seats.find(q => q.alive);
  if (survivor) survivor.rank = 1;
  // 淘汰序里最后一个没拿到名次的（未爆完就结束的极端情况）兜底
  st.seats.forEach(s => { if (s.rank === null) s.rank = 2; });
  const table = st.N === 5 ? COIN_5P : st.N === 4 ? COIN_4P : st.N === 3 ? COIN_3P : COIN_2P;
  const results = st.seats.map(s => ({ seatIdx: s.idx, name: s.name, rank: s.rank, change: table[s.rank] || 0 }));
  const matchId=st.platformMatchId??=crypto.randomBytes(12).toString('hex');
  for(const result of results){ const seat=st.seats[result.seatIdx];if(seat?.token)platform.legacyResult(seat.token,{id:matchId,game:'cat',win:result.rank===1,rank:result.rank,coin:result.change,rated:true}); }
  broadcast(room, { t: 'ev', ev: { k: 'over', results, anger: st.anger } });
  log('房间', room.code, '结束，冠军:', (st.seats.find(s => s.rank === 1) || {}).name);
  clearInterval(st.speedTimer);
  // 回到大厅（同一批人可以再来一局）
  room.state = null;
  room.rematch = null;
  room.players = room.players.filter(p => conns.has(p.connId));
  if (room.players.length === 0) { rooms.delete(room.code); log('房间', room.code, '战后空置解散'); return; }
  if (!room.players.some(p => p.connId === room.hostConnId)) room.hostConnId = room.players[0].connId;
  for (const p of room.players) { const c = conns.get(p.connId); if (c) c.seatIdx = room.players.indexOf(p); }
  setTimeout(() => { if (rooms.has(room.code)) sendLobby(room); }, 500);
}

/* ================== 再来一局（20秒全员确认制） ================== */
function handleRematch(room, conn) {
  if (room.state) return;
  if (!room.rematch) {
    room.rematch = { set: new Set(), timer: null };
    room.rematch.timer = setTimeout(() => {
      if (!room.rematch) return;
      room.rematch = null;
      broadcast(room, { t: 'rematchCancel' });
      log('房间', room.code, '再来一局超时取消');
    }, 20000);
  }
  room.rematch.set.add(conn.id);
  broadcast(room, { t: 'rematch', count: room.rematch.set.size, total: room.players.length });
  if (room.rematch.set.size >= room.players.length) {
    clearTimeout(room.rematch.timer);
    room.rematch = null;
    log('房间', room.code, '全员确认，再来一局');
    startGame(room);
  }
}

/* ================== WebSocket 连接 ================== */
wss.on('connection', (ws) => {
  const conn = { id: nextConnId++, ws, roomCode: null, seatIdx: -1, name: '' };
  conns.set(conn.id, conn);
  log('连接进来', conn.id);

  ws.on('message', (raw) => {
    if(Date.now()-(conn.budgetAt||0)>1000){conn.budgetAt=Date.now();conn.budget=0;}if(++conn.budget>80)return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if(platform?.socket(conn,m))return;
    if(['create','join','qqcreate','qqjoin','hello','qqhello'].includes(m.t)){conn.token=platform.lookup(m.token)?m.token:'';m.token=conn.token;}
    const room = conn.roomCode ? rooms.get(conn.roomCode) : null;
    if (room) room.lastActive = Date.now();

    if (m.t === 'create') {
      if (room) return;
      conn.name = (m.name || '玩家').slice(0, 8);
      conn.token = m.token || '';
      // 支持自定义房间码（和好友约好同一个码），被占用则提示
      if (m.code && rooms.has(String(m.code))) {
        return send(ws, { t: 'err', msg: '房间码 ' + m.code + ' 已被占用，换一个或直接加入' });
      }
      const r = makeRoom(conn, conn.name, m.fillAI, m.code ? String(m.code) : null);
      r.hostConnId = conn.id;
      r.visibility=m.visibility==='public'?'public':'private';r.invite=require('crypto').randomBytes(16).toString('hex');
      send(ws, { t: 'created', code: r.code });
      sendLobby(r);
      log('创建房间', r.code, 'by', conn.name);
      return;
    }
    if (m.t === 'join') {
      if (room) return;
      const r = rooms.get(String(m.code));
      if (!r) return send(ws, { t: 'err', msg: '房间不存在' });
      if (r.state) return send(ws, { t: 'err', msg: '这局已经开始了，等下一局吧' });
      if (r.players.length >= 5) return send(ws, { t: 'err', msg: '房间满员（5人）' });
      conn.name = (m.name || '玩家').slice(0, 8);
      conn.token = m.token || '';
      r.players.push({ connId: conn.id, name: conn.name });
      conn.roomCode = r.code; conn.seatIdx = r.players.length - 1;
      send(ws, { t: 'joined', code: r.code, seatIdx: conn.seatIdx });
      sendLobby(r);
      log(conn.name, '加入房间', r.code);
      return;
    }
    if (m.t === 'hello') {
      const token = String(m.token || '');
      if (!token) return;
      for (const r2 of rooms.values()) {
        if (!r2.state) continue;
        const seat = r2.state.seats.find(s2 => s2.type === 'human' && s2.disconnected && s2.token === token);
        if (!seat) continue;
        const st2 = r2.state;
        const oldConnId = seat.connId;
        seat.disconnected = false;
        seat.connId = conn.id;
        conn.roomCode = r2.code; conn.seatIdx = seat.idx; conn.name = seat.name; conn.token = token;
        const lp = r2.players.find(p => p.connId === oldConnId);
        if (lp) lp.connId = conn.id;
        if (r2.hostConnId === oldConnId) r2.hostConnId = conn.id;
        send(conn.ws, {
          t: 'gamestart', rejoin: true, seatIdx: seat.idx, N: st2.N, anger: st2.anger, stats: st2.statsArr,
          seats: st2.seats.map(q => ({ name: q.name, face: q.face, type: q.type })),
          yourHand: seat.hand.map(c2 => ({ uid: c2.uid, slot: c2.slot, type: c2.type, v: c2.v })),
        });
        syncAll(r2);
        broadcast(r2, { t: 'chat', from: '系统', text: seat.name + ' 重新连接到了对局' });
        log('重连成功', r2.code, seat.name);
        return;
      }
      return;
    }
    /* ---------- 球球大作战联机（5 队 x 2 人，服务器权威模拟） ---------- */
    if (m.t === 'qqhello') {
      const token = String(m.token || '');
      if (!token) return;
      for (const r2 of qqRooms.values()) {
        if (!r2.state) continue;
        const seat = r2.state.seats.find(s2 => s2.type === 'human' && s2.disconnected && s2.token === token);
        if (!seat) continue;
        seat.disconnected = false; seat.connId = conn.id;
        conn.qqRoomCode = r2.code; conn.name = seat.name;
        const h = r2.humans[seat.idx];
        if (h) h.connId = conn.id;
        if (!conns.has(r2.hostConnId)) r2.hostConnId = conn.id;
        qqSendStart(r2, seat.idx, true);
        log('QQ重连成功', r2.code, seat.name);
        return;
      }
      return;
    }
    if (m.t === 'qqcreate') {
      if (conn.qqRoomCode) return;
      conn.name = (m.name || '玩家').slice(0, 8);
      if (qqRooms.size >= 50) return qqSend(ws, { t: 'qqerr', msg: '房间数已达上限，稍后再试' });
      const r = qqCreate(conn, m.code ? String(m.code) : null);
      r.visibility=m.visibility==='public'?'public':'private';r.invite=require('crypto').randomBytes(16).toString('hex');
      qqSend(ws, { t: 'qqcreated', code: r.code });
      qqLobbyBroadcast(r);
      log('QQ创建房间', r.code, 'by', conn.name);
      return;
    }
    if (m.t === 'qqjoin') {
      if (conn.qqRoomCode) return;
      const r = qqRooms.get(String(m.code));
      if (!r) return qqSend(ws, { t: 'qqerr', msg: '房间不存在' });
      if (r.state) {
        // 对局中：同账号掉线重连
        const seat = r.state.seats.find(s2 => s2.type === 'human' && s2.token === String(m.token || '') && s2.disconnected);
        if (!seat) return qqSend(ws, { t: 'qqerr', msg: '这局已经开始啦' });
        seat.disconnected = false; seat.connId = conn.id;
        conn.qqRoomCode = r.code; conn.name = seat.name;
        const h = r.humans[seat.idx];
        if (h) h.connId = conn.id;
        qqSendStart(r, seat.idx, true);
        return;
      }
      if (r.humans.length >= 10) return qqSend(ws, { t: 'qqerr', msg: '房间满员（10 人 = 5 支队伍）' });
      conn.name = (m.name || '玩家').slice(0, 8);
      r.humans.push({ connId: conn.id, name: conn.name, token: m.token || '' });
      conn.qqRoomCode = r.code;
      qqSend(ws, { t: 'qqjoined', code: r.code });
      qqLobbyBroadcast(r);
      log(conn.name, '加入QQ房间', r.code);
      return;
    }
    if (m.t === 'qqsetfill') {
      const r = conn.qqRoomCode ? qqRooms.get(conn.qqRoomCode) : null;
      if (r && !r.state && r.hostConnId === conn.id) { r.fillAI = !!m.fill; qqLobbyBroadcast(r); }
      return;
    }
    if (m.t === 'qqstart') {
      const r = conn.qqRoomCode ? qqRooms.get(conn.qqRoomCode) : null;
      if (r && !r.state && r.hostConnId === conn.id) {
        if (r.humans.length < 2 && !r.fillAI) return qqSend(ws, { t: 'qqerr', msg: '至少需要 2 名玩家，或勾选补齐AI' });
        if([...qqRooms.values()].filter(q=>q.state&&!q.state.over).length>=3)return qqSend(ws,{t:'qqerr',msg:'实时房间暂时满员，请稍后'});
        qqStart(r);
      }
      return;
    }
    if (m.t === 'qqinput') {
      const r = conn.qqRoomCode ? qqRooms.get(conn.qqRoomCode) : null;
      if (!r || !r.state) return;
      const hi = r.humans.findIndex(h => h.connId === conn.id);
      if (hi < 0) return;
      const s = r.state.seats[hi];
      if (!s || s.disconnected || s.dead) return;
      s.inX = Math.max(-1, Math.min(1, +m.x || 0));
      s.inY = Math.max(-1, Math.min(1, +m.y || 0));
      return;
    }
    if (m.t === 'qqact') {
      const r = conn.qqRoomCode ? qqRooms.get(conn.qqRoomCode) : null;
      if (!r || !r.state) return;
      const hi = r.humans.findIndex(h => h.connId === conn.id);
      if (hi < 0) return;
      const s = r.state.seats[hi];
      if (!s || s.disconnected || s.dead) return;
      if (m.k === 'eject') qqEject(r.state, s);
      else if (m.k === 'split') qqSplit(r.state, s);
      else if (m.k === 'gather') s.gatherUntil = r.state.time + 2.2;
      return;
    }
    if (m.t === 'qqleave') {
      if (conn.qqRoomCode) qqRemoveConn(conn);
      return;
    }
    if (!room) return;

    if (m.t === 'setFill') {
      if (room.hostConnId === conn.id && !room.state) {
        room.fillAI = !!m.fill;
        sendLobby(room);
      }
      return;
    }
    if (m.t === 'start') {
      if (room.hostConnId !== conn.id || room.state) return;
      if (!room.fillAI && room.players.length < 2) return send(ws, { t: 'err', msg: '至少需要 2 名玩家，或勾选补全AI对手' });
      startGame(room);
      return;
    }
    if (m.t === 'play') {
      const st = room.state;
      if (!st || !st.waiting || st.waiting.seatIdx !== conn.seatIdx) return;
      const p = st.seats[conn.seatIdx];
      const card = p.hand.find(c => c.uid === m.uid);
      if (!card) return;
      let targetIdx = null;
      if (card.type === 'swap') {
        targetIdx = (typeof m.target === 'number') ? m.target : pickSwapTarget(st, p);
        const t2 = st.seats[targetIdx];
        if (!t2 || !t2.alive || t2 === p) targetIdx = pickSwapTarget(st, p);
      }
      const res = st.waiting.resolve;
      st.waiting = null;
      res({ card, targetIdx });
      return;
    }
    if (m.t === 'rematch') {
      if (!room.state) handleRematch(room, conn);
      return;
    }
    if (m.t === 'chat') {
      const text = String(m.text || '').trim().slice(0, 60);
      if (!text) return;
      if (text === '\\ai' || text.toLowerCase() === '\\ai') {
        send(ws, { t: 'revealAI' }); // 彩蛋：只对输入者本人生效，不广播
        return;
      }
      const p = room.players.find(q => q.connId === conn.id);
      broadcast(room, { t: 'chat', from: p ? p.name : conn.name, text, connId: conn.id });
      return;
    }
  });

  ws.on('close', () => {
    conns.delete(conn.id);
    log('连接断开', conn.id, conn.name || '');
    if (conn.roomCode) removeConnFromRoom(conn);
  });
});

// 兜底清扫：空房间立即释放，闲置超30分钟的大厅也释放（房间码不长期占用）
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const humans = room.players.filter(p => p.connId && conns.has(p.connId)).length;
    if (humans === 0) { rooms.delete(code); log('清扫：空房间', code, '已释放'); continue; }
    if (!room.state && now - (room.lastActive || now) > 30 * 60 * 1000) {
      rooms.delete(code); log('清扫：闲置房间', code, '超30分钟已释放');
    }
  }
}, 60000);

/* ================== 球球大作战联机（5 队 x 2 人，服务器权威模拟） ================== */
const qqRooms = new Map();          // code -> qqRoom
const QQW = 4800, QQ_FOOD = 900, QQ_VIRUS = 16, QQ_MATCH = 480;   // 480 秒 = 8 分钟
const QQ_TICK = 66, QQ_SYNC = 100;
const QQ_PAL = [[8,85,62],[350,78,62],[28,92,62],[45,92,60],[95,62,54],[160,68,50],[190,78,58],[212,85,62],[258,72,66],[288,72,64]];
const QQ_TEAM_COIN = { 1:30, 2:15, 3:5, 4:-5, 5:-15 };
const QQ_BOT_NAMES = ['小球球','大胃王','圆圆','吞天蛤','泡泡','肉丸子','球王','糯米团','波波','钢铁球','流星球','奶球','糖豆','巨人球','闪电球','墨鱼丸'];
const qqR = (a,b)=>a+Math.random()*(b-a);
const qqMR = m=>4*Math.sqrt(m);
const qqCl = (v,a,b)=>v<a?a:v>b?b:v;
const qqTAU = Math.PI*2;
function qqSend(ws,o){ try{ if(ws&&ws.readyState===1) ws.send(JSON.stringify(o)); }catch(e){} }
function qqFood(){ const f = { x:qqR(20,QQW-20), y:qqR(20,QQW-20), ci:Math.floor(qqR(0,10)), r:qqR(3.4,5.4) }; f.mass = 1.3; return f; }
function qqVirus(){ const m = qqR(50,199); return { x:qqR(150,QQW-150), y:qqR(150,QQW-150), vx:0, vy:0, mass:m, r:qqMR(m), rot:qqR(0,qqTAU) }; }
function qqGenCode(){ let c; do{ c=String(Math.floor(1000+Math.random()*9000)); }while(qqRooms.has(c)||rooms.has(c)); return c; }
function qqCreate(conn, code){
  const finalCode = (code && /^\d{4}$/.test(code) && !qqRooms.has(code) && !rooms.has(code)) ? code : qqGenCode();
  const room = { code:finalCode, hostConnId:conn.id, fillAI:true, humans:[{connId:conn.id, name:(conn.name||'玩家'), token:conn.token||''}], state:null, lastTick:0, lastSync:0 };
  conn.qqRoomCode = finalCode;
  qqRooms.set(finalCode, room);
  return room;
}
function qqLobbyBroadcast(room){
  for(const h of room.humans){
    const c = conns.get(h.connId); if(!c) continue;
    const u = h.token ? findUserByToken(h.token) : null;
    qqSend(c.ws, { t:'qqlobby', code:room.code, fillAI:room.fillAI, youAreHost: room.hostConnId===h.connId,
      seats: room.humans.map((h2,i)=>{
        const u2 = h2.token ? findUserByToken(h2.token) : null;
        return { i, name: u2 ? u2.nickname : h2.name, isHost: h2.connId===room.hostConnId,
          avatar: u2 ? (u2.avatar||'⚪') : '⚪' };
      }) });
  }
}
function qqRemoveConn(conn){
  const room = conn.qqRoomCode ? qqRooms.get(conn.qqRoomCode) : null;
  conn.qqRoomCode = null;
  if(!room) return;
  const hi = room.humans.findIndex(h => h.connId === conn.id);
  if(hi >= 0){
    if(room.state){
      const seat = room.state.seats[hi];
      if(seat) seat.disconnected = true;   // AI 接管，等待重连
      for(const h of room.humans){ const c = conns.get(h.connId); if(c) qqSend(c.ws, { t:'qqchat', from:'系统', text:(conn.name||'玩家')+' 掉线了，AI 暂时接管' }); }
    } else {
      room.humans.splice(hi, 1);
      if(room.humans.length === 0){ qqRooms.delete(room.code); log('清扫：QQ空房间', room.code); return; }
      if(room.hostConnId === conn.id && room.humans.length) room.hostConnId = room.humans[0].connId;
      qqLobbyBroadcast(room);
    }
  }
}
function qqNewSeatFields(){
  return { cells:[], inX:0, inY:0, smX:0, smY:0, kbX:0, kbY:0, lastSrc:'kb', lastEjX:0, lastEjY:-1,
    gatherUntil:0, dead:false, kills:0, bestMass:0, respawnAt:0, bornAt:0,
    reactDelay:qqR(0.5,1.4), commit:qqR(1.5,3), aiState:'wander', aiStateUntil:0, chaseSince:0,
    threatSince:0, threatX:0, threatY:0, preyCell:null, aiAt:0, wander:qqR(0,qqTAU) };
}
function qqSpawn(st, s, isRespawn){
  let x = qqR(200,QQW-200), y = qqR(200,QQW-200);
  for(let t=0;t<15;t++){
    x = qqR(200,QQW-200); y = qqR(200,QQW-200); let ok = true;
    for(const q of st.seats) for(const c of q.cells)
      if(c.mass > 60 && (c.x-x)**2 + (c.y-y)**2 < 1200**2){ ok=false; break; }
    if(ok) break;
  }
  let m0 = 25;
  if(isRespawn) m0 = qqR(25,55);
  else if(s.type === 'ai') m0 = qqR(25,200);
  s.cells = [{ id: st.nextCid++, x, y, vx:0, vy:0, mass:m0, r:qqMR(m0), splitAt:0, phase:qqR(0,qqTAU), mother:true }];
  s.dead = false; s.bornAt = st.time; s.bestMass = m0; s.inX = 0; s.inY = 0; s.smX = 0; s.smY = 0;
}
function qqStart(room){
  const seats = []; let botN = 0;
  room.humans.forEach((h) => {
    const u = h.token ? findUserByToken(h.token) : null;
    seats.push(Object.assign({ idx:seats.length, team:Math.floor(seats.length/2), type:'human',
      name: u ? u.nickname : h.name, token:h.token||'', connId:h.connId, disconnected:false,
      col: QQ_PAL[seats.length % 10] }, qqNewSeatFields()));
  });
  if(room.fillAI){
    while(seats.length < 10){
      seats.push(Object.assign({ idx:seats.length, team:Math.floor(seats.length/2), type:'ai',
        name: QQ_BOT_NAMES[botN % QQ_BOT_NAMES.length], token:'', connId:null, disconnected:false,
        col: QQ_PAL[seats.length % 10] }, qqNewSeatFields()));
      botN++;
    }
  }
  const st = { seats, time:0, over:false, foods:[], viruses:[], ejected:[], foodEv:[], nextPid:1, nextCid:1 };
  for(let i=0;i<QQ_FOOD;i++) st.foods.push(qqFood());
  for(let i=0;i<QQ_VIRUS;i++) st.viruses.push(qqVirus());
  for(const s of seats) qqSpawn(st, s, false);
  room.state = st; room.lastTick = Date.now(); room.lastSync = 0;
  for(const s of seats){
    if(s.type !== 'human' || !s.connId) continue;
    const c = conns.get(s.connId); if(!c) continue;
    qqSend(c.ws, { t:'qqgamestart', rejoin:false, seatIdx:s.idx, world:QQW, matchLen:QQ_MATCH,
      seats: seats.map(q=>({ idx:q.idx, team:q.team, name:q.name, type:q.type, col:q.col })),
      foods: st.foods.map(f=>[Math.round(f.x), Math.round(f.y), f.ci, Math.round(f.r*10)/10]),
      viruses: st.viruses.map(v=>[Math.round(v.x), Math.round(v.y)]),
      myName: s.name });
  }
  log('QQ对局开始', room.code, '真人', room.humans.length);
}
function qqSendStart(room, seatIdx, rejoin){
  const st = room.state; if(!st) return;
  const s = st.seats[seatIdx]; if(!s) return;
  const c = conns.get(s.connId); if(!c) return;
  qqSend(c.ws, { t:'qqgamestart', rejoin:!!rejoin, seatIdx, world:QQW, matchLen:QQ_MATCH,
    seats: st.seats.map(q=>({ idx:q.idx, team:q.team, name:q.name, type:q.type, col:q.col })),
    foods: st.foods.map(f=>[Math.round(f.x), Math.round(f.y), f.ci, Math.round(f.r*10)/10]),
    viruses: st.viruses.map(v=>[Math.round(v.x), Math.round(v.y)]),
    myName: s.name });
}
function qqTotalMass(s){ let m=0; for(const c of s.cells) m+=c.mass; return m; }
function qqMergeDelay(m){ return qqCl(10 + m*0.02, 10, 40); }
const QQ_EJECT_NEAR = 80, QQ_EJECT_FAR = 220;   // 吐球飞行距离：原地 80 → 拉满 220
const QQ_EJECT_K = 2.9;                          // 减速系数（负加速度滑行）
function qqEject(st, s){
  const mag = qqCl(Math.hypot(s.inX, s.inY), 0, 1);
  const gathering = s.gatherUntil > st.time;
  let dx, dy;
  if(!gathering && mag > 0.05){ dx = s.inX/mag; dy = s.inY/mag; s.lastEjX = dx; s.lastEjY = dy; }
  else { dx = s.lastEjX; dy = s.lastEjY; }
  const useMag = gathering ? 0 : mag;
  for(const c of s.cells){
    if(c.mass < 36) continue;
    c.mass -= 18; c.r = qqMR(c.mass);
    // 方向动态过渡：原地=吐向质心，拉满=水平吐，半拉=交叉带外（与离线版一致）
    let ex, ey;
    if(useMag < 0.999){
      let gx=0, gy=0, gm=0;
      for(const cc of s.cells){ gx += cc.x*cc.mass; gy += cc.y*cc.mass; gm += cc.mass; }
      gx/=gm; gy/=gm;
      const ddx = gx-c.x, ddy = gy-c.y, dd = Math.hypot(ddx,ddy);
      if(dd > 2){
        ex = (ddx/dd)*(1-useMag) + dx*useMag;
        ey = (ddy/dd)*(1-useMag) + dy*useMag;
        const el = Math.hypot(ex,ey);
        if(el > 0.01){ ex/=el; ey/=el; } else { ex = dx; ey = dy; }
      } else { ex = dx; ey = dy; }
    } else { ex = dx; ey = dy; }
    const pr = qqMR(18);
    const fly = QQ_EJECT_NEAR + (QQ_EJECT_FAR - QQ_EJECT_NEAR)*useMag;
    const v0 = fly*QQ_EJECT_K;
    const sx = c.x + ex*(c.r + pr), sy = c.y + ey*(c.r + pr);   // 从最外围边缘生成
    st.ejected.push({ pid: st.nextPid++, x:sx, y:sy, vx:ex*v0, vy:ey*v0, settled:false, age:0,
      mass:18, r:pr, ci:s.idx % 10, eid:c.id, own:s.idx });
  }
}
// 方向动态过渡：原地=朝质心，拉满=输入方向，半拉=交叉带外（与离线版一致，吐球/分身共用）
function qqBlendedDir(st, s, c, useMag, dx, dy){
  if(useMag >= 0.999) return [dx, dy];
  let gx=0, gy=0, gm=0;
  for(const cc of s.cells){ gx += cc.x*cc.mass; gy += cc.y*cc.mass; gm += cc.mass; }
  gx/=gm; gy/=gm;
  const ddx = gx-c.x, ddy = gy-c.y, dd = Math.hypot(ddx,ddy);
  if(dd <= 2) return [dx, dy];
  let ex = (ddx/dd)*(1-useMag) + dx*useMag;
  let ey = (ddy/dd)*(1-useMag) + dy*useMag;
  const el = Math.hypot(ex,ey);
  if(el < 0.01) return [dx, dy];
  return [ex/el, ey/el];
}
function qqSplit(st, s){
  const snap = [...s.cells].sort((a,b)=>b.mass-a.mass);
  const mag = qqCl(Math.hypot(s.inX, s.inY), 0, 1);
  let dx, dy;
  if(mag > 0.05){ dx = s.inX/mag; dy = s.inY/mag; s.lastEjX = dx; s.lastEjY = dy; }
  else { dx = s.lastEjX; dy = s.lastEjY; }
  const useMag = mag;   // 分身与吐球一样受摇杆幅度控制
  for(const c of snap){
    if(s.cells.length >= 16) break;
    if(c.mass < 36) continue;
    const [ex, ey] = qqBlendedDir(st, s, c, useMag, dx, dy);
    const half = c.mass/2; c.mass = half; c.r = qqMR(half);
    const nr = qqMR(half);
    // 分身以母球最外围边缘为基准飞出；幅度越小初速越低、方向越往质心带
    const v0 = 200 + 296*useMag;   // 拉满 496，滑行约 190px = 旧 238 的 80%
    const nc = { id: st.nextCid++, x:c.x + ex*(c.r + nr + 2), y:c.y + ey*(c.r + nr + 2),
      vx:ex*v0, vy:ey*v0, mass:half, r:qqMR(half),
      splitAt: st.time + qqMergeDelay(half), phase:c.phase, mother:false };
    c.splitAt = st.time + qqMergeDelay(half);
    s.cells.push(nc);
  }
}
function qqExplode(st, s, c){
  const slots = 16 - s.cells.length; if(slots <= 0) return;
  const n = qqCl(Math.floor(c.mass/26), 2, slots);
  const per = c.mass/(n+1);
  c.mass = per; c.r = qqMR(per); c.splitAt = st.time + qqMergeDelay(per);
  for(let i=0;i<n;i++){
    const a = qqR(0,qqTAU);
    const nc = { id: st.nextCid++, x:c.x+Math.cos(a)*c.r*0.4, y:c.y+Math.sin(a)*c.r*0.4,
      vx:Math.cos(a)*qqR(500,900), vy:Math.sin(a)*qqR(500,900),
      mass:per*qqR(0.7,1.3), r:qqMR(per), splitAt: st.time + qqMergeDelay(per), phase:qqR(0,qqTAU), mother:false };
    s.cells.push(nc);
  }
}
function qqSetDir(s, dx, dy){ const d = Math.hypot(dx,dy)||1; s.inX = dx/d; s.inY = dy/d; }
function qqAI(st, s){
  if(st.time < s.aiAt) return;
  s.aiAt = st.time + qqR(0.12, 0.25);
  const myC = s.cells[0]; if(!myC) return;
  let threat=null, threatD=1e18, prey=null, preyD=1e18;
  for(const q of st.seats){
    if(q===s || q.dead) continue;
    if(q.team === s.team) continue;
    for(const c of q.cells){
      const d2 = (c.x-myC.x)**2 + (c.y-myC.y)**2;
      if(c.mass > myC.mass*1.3 && d2 < 480**2 && d2 < threatD){ threatD=d2; threat=c; }
      if(myC.mass > c.mass*1.3 && d2 < 720**2 && d2 < preyD){ preyD=d2; prey=c; }
    }
  }
  if(threat){
    if(s.threatSince === 0) s.threatSince = st.time;
    if(s.aiState !== 'flee' && st.time - s.threatSince > s.reactDelay){
      s.aiState = 'flee'; s.aiStateUntil = st.time + qqR(1.2,2.2);
      s.threatX = threat.x; s.threatY = threat.y;
    }
  } else if(s.threatSince && st.time - s.threatSince > 2){ s.threatSince = 0; }
  if(s.aiState === 'flee'){
    if(st.time > s.aiStateUntil && !threat){ s.aiState = 'wander'; s.threatSince = 0; }
    else {
      if(threat){ s.threatX = threat.x; s.threatY = threat.y; }
      let fx = myC.x - s.threatX, fy = myC.y - s.threatY;
      if(myC.x < 300) fx += 1; if(myC.x > QQW-300) fx -= 1;
      if(myC.y < 300) fy += 1; if(myC.y > QQW-300) fy -= 1;
      qqSetDir(s, fx, fy); return;
    }
  }
  if(s.aiState === 'chase' && st.time < s.aiStateUntil){
    const t = s.preyCell;
    if(t && !t.dead){ qqSetDir(s, t.x-myC.x, t.y-myC.y); qqMaybeSplit(st, s, myC, t); return; }
    s.aiState = 'wander';
  }
  if(prey){
    if(s.aiState !== 'chase') s.chaseSince = st.time;
    s.aiState = 'chase'; s.aiStateUntil = st.time + s.commit; s.preyCell = prey;
    qqSetDir(s, prey.x-myC.x, prey.y-myC.y);
    qqMaybeSplit(st, s, myC, prey);
    return;
  }
  // 队友跟团
  let tx=0, ty=0, tm=0;
  for(const q of st.seats) if(q.team===s.team && !q.dead)
    for(const c of q.cells){ tx += c.x; ty += c.y; tm++; }
  if(tm > 0){
    tx/=tm; ty/=tm;
    if(Math.hypot(tx-myC.x, ty-myC.y) > 420){ qqSetDir(s, tx-myC.x, ty-myC.y); return; }
  }
  let food=null, fd=1e18;
  for(let i=0;i<st.foods.length;i+=2){
    const f = st.foods[i];
    const d2 = (f.x-myC.x)**2 + (f.y-myC.y)**2;
    if(d2 < 700**2 && d2 < fd){ fd=d2; food=f; }
  }
  if(food) qqSetDir(s, food.x-myC.x, food.y-myC.y);
  else {
    if(Math.random() < 0.3) s.wander += qqR(-0.8,0.8);
    qqSetDir(s, Math.cos(s.wander), Math.sin(s.wander));
  }
  for(const v of st.viruses){
    const d2 = (v.x-myC.x)**2 + (v.y-myC.y)**2;
    if(myC.mass > 70 && d2 < 220**2){ qqSetDir(s, myC.x-v.x, myC.y-v.y); break; }
  }
}
function qqMaybeSplit(st, s, myC, t){
  if(s.aiState !== 'chase' || s.cells.length > 1) return;
  if(st.time - (s.chaseSince||0) < 1.2) return;
  if(myC.mass > 90 && myC.mass > t.mass*2.6){
    const d2 = (t.x-myC.x)**2 + (t.y-myC.y)**2;
    if(d2 < 300**2 && d2 > 110**2 && Math.random() < 0.012) qqSplit(st, s);
  }
}
function qqUpdateSeat(st, s, dt){
  if(s.dead) return;
  if(s.type === 'ai' || s.disconnected) qqAI(st, s);
  const rate = (s.inX || s.inY) ? 14 : 2.0;
  s.smX += (s.inX - s.smX) * (1 - Math.exp(-rate*dt));
  s.smY += (s.inY - s.smY) * (1 - Math.exp(-rate*dt));
  if(Math.abs(s.smX) < 0.01 && Math.abs(s.smY) < 0.01){ s.smX = 0; s.smY = 0; }
  const moveMag = qqCl(Math.hypot(s.smX, s.smY), 0, 1);
  const moveDirLen = moveMag || 1;
  const moveDx = s.smX / moveDirLen, moveDy = s.smY / moveDirLen;
  // 移动和吐球、分身共用同一套方向混合：轻推时各球朝质心交叉靠拢，拉满后再平行前进。
  const moveUseMag = (s.type === 'ai' || s.disconnected) ? 1 : (s.gatherUntil > st.time ? 0 : moveMag);
  for(const c of s.cells){
    const sp = 320 / Math.pow(c.r/10, 0.5);   // 小球快、大球慢（指数 0.5，与离线版一致）
    const [mx, my] = qqBlendedDir(st, s, c, moveUseMag, moveDx, moveDy);
    c.x += (mx*sp + c.vx)*dt; c.y += (my*sp + c.vy)*dt;
    const f = Math.exp(-dt*2.6); c.vx *= f; c.vy *= f;
    c.x = qqCl(c.x, c.r*0.5, QQW - c.r*0.5); c.y = qqCl(c.y, c.r*0.5, QQW - c.r*0.5);
    c.r = qqMR(c.mass);
    if(c.mass > 150) c.mass -= c.mass*0.00004*dt*60;
  }
  const cells = s.cells;
  const allMergeable = cells.every(c => st.time > c.splitAt);
  for(let i=0;i<cells.length;i++) for(let j=i+1;j<cells.length;j++){
    const a = cells[i], b = cells[j];
    const dx = b.x-a.x, dy = b.y-a.y;
    const d = Math.hypot(dx,dy) || 0.01;
    const canMerge = st.time > a.splitAt && st.time > b.splitAt;
    if(canMerge){
      if(d < Math.max(a.r,b.r)*0.9){
        if(a.mass >= b.mass){ a.mass += b.mass; a.r = qqMR(a.mass); a.mother = a.mother || b.mother; cells.splice(j,1); }
        else { b.mass += a.mass; b.r = qqMR(b.mass); b.mother = a.mother || b.mother; cells.splice(i,1); }
        return;
      }
    } else if(d < a.r + b.r){
      // 软性排斥按体重加权：大球几乎推不动，小球被挤开
      const ov = (a.r + b.r - d)*0.35;
      const nx = dx/d, ny = dy/d;
      const tot = a.mass + b.mass;
      a.x -= nx*ov*(b.mass/tot); a.y -= ny*ov*(b.mass/tot);
      b.x += nx*ov*(a.mass/tot); b.y += ny*ov*(a.mass/tot);
    }
  }
  let bm = 0; for(const c of cells) bm += c.mass;
  if(bm > s.bestMass) s.bestMass = bm;
}
function qqMoveViruses(st, dt){
  for(const v of st.viruses){
    if(!v.vx && !v.vy) continue;
    v.x += v.vx*dt; v.y += v.vy*dt;
    const f = Math.exp(-dt*1.4); v.vx *= f; v.vy *= f;
    if(Math.abs(v.vx) < 2) v.vx = 0;
    if(Math.abs(v.vy) < 2) v.vy = 0;
    v.x = qqCl(v.x, v.r, QQW - v.r); v.y = qqCl(v.y, v.r, QQW - v.r);
  }
}
// 吐出的球飞行/落地（与离线版一致：负加速度滑行减速，速度低于 40 自然停下）
function qqMoveEjected(st, dt){
  for(const e of st.ejected){
    if(!e.settled){
      e.age += dt;
      e.x += e.vx*dt; e.y += e.vy*dt;
      const f = Math.exp(-dt*QQ_EJECT_K);
      e.vx *= f; e.vy *= f;
      if(e.vx*e.vx + e.vy*e.vy < 40*40){ e.vx = 0; e.vy = 0; e.settled = true; }
    }
    e.x = qqCl(e.x, e.r, QQW - e.r); e.y = qqCl(e.y, e.r, QQW - e.r);
  }
}
// 吐球推刺：飞行的吐球命中刺 → 刺变大+被推动；长到 200 分裂成两半，新刺向前弹（与离线版一致）
function qqPelletPushVirus(st){
  for(let i=st.ejected.length-1;i>=0;i--){
    const e = st.ejected[i];
    if(e.settled) continue;
    const espd = Math.hypot(e.vx, e.vy) || 1;
    const dirX = e.vx/espd, dirY = e.vy/espd;
    for(let vi=st.viruses.length-1;vi>=0;vi--){
      const v = st.viruses[vi];
      const rr = v.r + e.r;
      if((e.x-v.x)**2 + (e.y-v.y)**2 < rr*rr){
        v.mass += e.mass; v.r = qqMR(v.mass);
        v.vx += dirX*420; v.vy += dirY*420;
        st.ejected.splice(i,1);
        if(v.mass >= 200){
          v.mass /= 2; v.r = qqMR(v.mass);
          st.viruses.push({ x: v.x + dirX*(v.r+12), y: v.y + dirY*(v.r+12),
            vx: dirX*560, vy: dirY*560, mass: v.mass, r: qqMR(v.mass), rot: qqR(0,qqTAU) });
        }
        break;
      }
    }
  }
}
function qqEat(st){
  for(const s of st.seats){
    if(s.dead) continue;
    for(const c of s.cells){
      for(let i=0;i<st.foods.length;i++){
        const f = st.foods[i];
        const rr = c.r - f.r*0.5;
        if((c.x-f.x)**2 + (c.y-f.y)**2 < rr*rr){
          c.mass += f.mass;
          const nf = qqFood();
          st.foods[i] = nf;
          st.foodEv.push([i, Math.round(nf.x), Math.round(nf.y), nf.ci]);
        }
      }
      for(let i=st.ejected.length-1;i>=0;i--){
        const e = st.ejected[i];
        if(e.eid === c.id && !e.settled) continue;   // 只保护吐出者本人；自己的其他球可以半路接住吐球（=喂分身）
        const rr = c.r - e.r*0.4;
        if((c.x-e.x)**2 + (c.y-e.y)**2 < rr*rr){ c.mass += e.mass; st.ejected.splice(i,1); }
      }
    }
  }
  // 敌对：大吃小
  for(const A of st.seats){
    if(A.dead) continue;
    for(const B of st.seats){
      if(A===B || B.dead || A.team === B.team) continue;
      for(const a of A.cells){
        for(let bi=B.cells.length-1;bi>=0;bi--){
          const b = B.cells[bi];
          if(a.mass < b.mass*1.15) continue;
          const rr = a.r - b.r*0.4;
          if(rr <= 0) continue;
          if((a.x-b.x)**2 + (a.y-b.y)**2 < rr*rr){
            a.mass += b.mass; a.r = qqMR(a.mass);
            B.cells.splice(bi,1);
            A.kills++;
            if(B.cells.length === 0){ B.dead = true; B.respawnAt = st.time + qqR(4,5); }
          }
        }
      }
    }
  }
  // 同队：只能吃队友的分身（mother 母球永远吃不掉）
  for(const A of st.seats){
    if(A.dead) continue;
    for(const B of st.seats){
      if(A===B || B.dead || A.team !== B.team) continue;
      for(const a of A.cells){
        for(let bi=B.cells.length-1;bi>=0;bi--){
          const b = B.cells[bi];
          if(b.mother) continue;
          if(a.mass < b.mass*1.15) continue;
          const rr = a.r - b.r*0.4;
          if(rr <= 0) continue;
          if((a.x-b.x)**2 + (a.y-b.y)**2 < rr*rr){
            a.mass += b.mass; a.r = qqMR(a.mass);
            B.cells.splice(bi,1);
          }
        }
      }
    }
  }
  // 病毒：大球碰到爆裂；被吐球推动的刺撞上大球同样爆
  for(const s of st.seats){
    if(s.dead) continue;
    for(const c of s.cells){
      for(let i=st.viruses.length-1;i>=0;i--){
        const v = st.viruses[i];
        if(c.mass < v.mass*1.15) continue;
        const rr = c.r - v.r*0.4;
        if(rr > 0 && (c.x-v.x)**2 + (c.y-v.y)**2 < rr*rr){
          c.mass += v.mass;
          st.viruses[i] = qqVirus();
          qqExplode(st, s, c);
        }
      }
    }
  }
}
function qqSync(room){
  const st = room.state; if(!st) return;
  const p = [];
  for(const s of st.seats){
    if(s.dead || s.cells.length === 0) continue;
    p.push([s.idx, s.cells.map(c=>[c.id, Math.round(c.x), Math.round(c.y), Math.round(c.mass)])]);
  }
  const d = st.seats.filter(s=>s.dead).map(s=>[s.idx, Math.max(0, Math.round(s.respawnAt - st.time))]);
  const msg = { t:'qqs', k:Math.round(st.time*10)/10, p,
    v: st.viruses.map(v=>[Math.round(v.x), Math.round(v.y), Math.round(v.vx), Math.round(v.vy), Math.round(v.mass||100)]),
    pe: st.ejected.map(e=>[e.pid, Math.round(e.x), Math.round(e.y), e.ci]),
    fe: st.foodEv.splice(0), d };
  for(const h of room.humans){ const c = conns.get(h.connId); if(c) qqSend(c.ws, msg); }
}
function qqFinish(room, reason){
  const st = room.state; if(!st) return;
  const tm = {};
  for(const s of st.seats) tm[s.team] = (tm[s.team]||0) + qqTotalMass(s);
  const order = Object.keys(tm).map(t=>({ team:+t, mass:Math.round(tm[t]) })).sort((a,b)=>b.mass-a.mass);
  order.forEach((o,i)=>o.rank = i+1);
  const seatsInfo = st.seats.map(s=>{
    const rank = (order.find(o=>o.team===s.team)||{}).rank || 5;
    return { idx:s.idx, team:s.team, coin: s.type==='human' ? (QQ_TEAM_COIN[rank]||0) : 0, mass:Math.round(s.bestMass), rank };
  });
  st.over = true;
  const matchId=st.platformMatchId??=crypto.randomBytes(12).toString('hex');
  if(reason==='time')for(const result of seatsInfo){const seat=st.seats[result.idx];if(seat?.token)platform.legacyResult(seat.token,{id:matchId,game:'qq',win:result.rank===1,rank:result.rank,coin:result.coin,rated:true});}
  qqBroadcastQQ(room, { t:'qqover', reason, teams: order, seats: seatsInfo });
  log('QQ对局结束', room.code, reason);
  room.state = null;
  setTimeout(()=>{ if(qqRooms.has(room.code) && !room.state) qqLobbyBroadcast(room); }, 800);
}
function qqBroadcastQQ(room, o){
  for(const h of room.humans){ const c = conns.get(h.connId); if(c) qqSend(c.ws, o); }
}
setInterval(() => {
  const now = Date.now();
  for(const room of qqRooms.values()){
    if(!room.state || room.state.over) continue;
    const st = room.state;
    const dt = qqCl((now - (room.lastTick||now))/1000, 0, 0.1);
    room.lastTick = now;
    st.time += dt;
    for(const s of st.seats){ if(s.dead && st.time >= s.respawnAt) qqSpawn(st, s, true); }
    for(const s of st.seats) qqUpdateSeat(st, s, dt);
    qqMoveEjected(st, dt);
    qqPelletPushVirus(st);
    qqMoveViruses(st, dt);
    qqEat(st);
    if(st.time >= QQ_MATCH){ qqFinish(room, 'time'); continue; }
    if(now - (room.lastSync||0) >= QQ_SYNC){ room.lastSync = now; qqSync(room); }
  }
}, QQ_TICK);
setInterval(() => {
  for(const [code, room] of qqRooms){
    const humans = room.humans.filter(h => conns.has(h.connId)).length;
    if(humans === 0){
      if(room.state){ qqFinish(room, 'abort'); }
      qqRooms.delete(code);
      log('清扫：QQ房间', code);
    }
  }
}, 30000);


platform=require('./platform/server')({users,saveUsers,hashPwd,dataDir:DATA_DIR,
 regQuota:{left:()=>regQuotaLeft(),consume:()=>regQuotaConsume()},
 legacyRooms(){return [...rooms.values()].map(r=>({id:'cat-'+(r.publicId??=crypto.randomBytes(8).toString('hex')),game:'cat',name:'生气猫',count:r.players.length,max:5,host:r.players[0]?.name||'',state:r.state?'playing':'waiting',visibility:r.visibility||'private',locked:r.visibility!=='public',code:r.visibility==='public'?r.code:undefined})).concat([...qqRooms.values()].map(r=>({id:'qq-'+(r.publicId??=crypto.randomBytes(8).toString('hex')),game:'qq',name:'球球大作战',count:r.humans.length,max:10,host:r.humans[0]?.name||'',state:r.state?'playing':'waiting',visibility:r.visibility||'private',locked:r.visibility!=='public',code:r.visibility==='public'?r.code:undefined})));},
 legacyResolve(code){if(rooms.has(code))return {game:'cat',code};if(qqRooms.has(code))return {game:'qq',code};},
 legacyInvite(token){const u=findUserByToken(token);if(!u)return null;for(const c of conns.values()){if(findUserByToken(c.token)?.id!==u.id)continue;const game=c.roomCode?'cat':c.qqRoomCode?'qq':null;if(!game)continue;const r=game==='cat'?rooms.get(c.roomCode):qqRooms.get(c.qqRoomCode);if(r)return {legacy:game,game,id:game+'-'+(r.publicId??=crypto.randomBytes(8).toString('hex')),code:r.code,invite:r.invite,visibility:r.visibility};}return null;},
 legacyPresence(u){for(const c of conns.values()){if(findUserByToken(c.token)?.id!==u.id)continue;const game=c.roomCode?'cat':c.qqRoomCode?'qq':null;if(!game)continue;const r=game==='cat'?rooms.get(c.roomCode):qqRooms.get(c.qqRoomCode);if(r)return {status:r.state?'游戏中':'在线',game:game==='cat'?'生气猫':'球球大作战',room:r.visibility==='public'?game+'-'+(r.publicId??=crypto.randomBytes(8).toString('hex')):null};}return null;}
});
server.listen(PORT, process.env.HOST||'0.0.0.0', () => log('千城服务器启动，端口', PORT));
