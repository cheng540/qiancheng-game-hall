'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),https=require('https');
const QR=require('qrcode');
const {createEngine,actionEngine,tickEngine,publicEngine,aiStep}=require('./engines');
const GAMES={cat:{name:'生气猫',max:5},qq:{name:'球球大作战',max:10},fish:{name:'大鱼吃小鱼',max:4},gomoku:{name:'五子棋',max:2},xiangqi:{name:'中国象棋',max:2},landlord:{name:'斗地主',max:3},party:{name:'聚会工具箱',max:12},ledger:{name:'组队账本',max:20}};
const SOLO_GAMES={fish:1,match3:1,landlord:1};   /* 纯单机（客户端本地运行，只上报战绩） */
const usedShields=new Set(),revivedMids=new Set();   /* 护盾/复活按对局去重（内存，重启清零） */
module.exports=function(ctx){
 const file=path.join(ctx.dataDir,'platform.json');
 let db={version:1,profiles:{},feedback:[],ledgers:{},seasonArchive:[]};
 if(fs.existsSync(file)){try{db=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){throw Error('platform.json 无法解析，拒绝覆盖现有数据');}}
 const live=new Map(),rooms=new Map(),limits=new Map();
 const now=()=>Date.now(),uid=()=>crypto.randomBytes(12).toString('hex'),digest=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
 const day=()=>new Date(now()+8*3600000).toISOString().slice(0,10);
 const season=()=>day().slice(0,7);
 function write(){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));if(fs.existsSync(file))fs.copyFileSync(file,file+'.bak');fs.renameSync(tmp,file);}
 function userId(u){if(!u.id)u.id='QC'+crypto.randomBytes(5).toString('hex').toUpperCase();return u.id;}
 function extra(u){const id=userId(u);if(!db.profiles[id])db.profiles[id]={friends:[],requests:[],favorites:[],recent:[],history:[],rated:1000,season:season(),claims:[],signDays:0,shields:0};return db.profiles[id];}
 for(const u of Object.values(ctx.users)){userId(u);extra(u);}ctx.saveUsers();write();
 function lookup(token){if(!token)return null;const h=digest(token);return Object.values(ctx.users).find(u=>u.token===token||(u.sessions||[]).some(s=>s.hash===h&&s.expires>now()))||null;}
 function markSeen(u){const t=now();u.lastLogin=t;u.loginCount=(u.loginCount||0)+1;const d=day();u.loginDays=Array.isArray(u.loginDays)?u.loginDays:[];if(!u.loginDays.includes(d)){u.loginDays.push(d);if(u.loginDays.length>180)u.loginDays=u.loginDays.slice(-180);}u.loginLog=Array.isArray(u.loginLog)?u.loginLog:[];u.loginLog.push(t);if(u.loginLog.length>10)u.loginLog=u.loginLog.slice(-10);}
 function issue(u){const token=crypto.randomBytes(32).toString('hex');u.sessions=(u.sessions||[]).filter(s=>s.expires>now()).slice(-9);u.sessions.push({hash:digest(token),expires:now()+30*86400000});markSeen(u);ctx.saveUsers();return token;}
 function rate(req,key,max=30){const k=(req.socket.remoteAddress||'')+':'+key,t=now();const a=(limits.get(k)||[]).filter(x=>x>t-60000);if(a.length>=max)return false;a.push(t);limits.set(k,a);return true;}
 function assert(b,msg){if(!b)throw Error(msg);}
 function actor(token){const u=lookup(token);assert(u,'请先登录');return u;}
 function view(u){const x=extra(u);return {id:u.id,guest:!!u.guest,nickname:u.nickname,avatar:u.avatar,coins:u.coins||0,frames:u.frames||[],frame:u.frame||'',stats:u.stats||{games:0,wins:0},lastSign:u.lastSign||'',gameStats:x.gameStats||{},items:x.items||[],shields:x.shields||0,signDays:x.signDays,favorites:x.favorites,recent:x.recent,history:x.history,season:x.season,rating:x.rated,rank:rank(x.rated)};}
 function rank(n){return n>=1600?'S':n>=1400?'A':n>=1200?'B':'C';}
 function publicUser(u){return {id:u.id,nickname:u.nickname,avatar:u.avatar,frame:u.frame||'',rating:extra(u).rated};}
 function byId(id){return Object.values(ctx.users).find(u=>u.id===id);}
 function currentRoom(u){for(const r of rooms.values())if(r.members.some(m=>m.id===u.id))return r;return null;}
 function presence(u){const at=live.get(u.id);const r=currentRoom(u);return r?{status:!at||now()-at.at>25000?'离线':r.engine?'游戏中':'在线',game:r.engine?GAMES[r.game].name:'',room:r.visibility==='public'?r.id:null}:ctx.legacyPresence?.(u)||{status:!at||now()-at.at>25000?'离线':'在线',game:'',room:null};}
 function listRoom(r){return {id:r.id,game:r.game,name:GAMES[r.game].name,mode:r.ai?'单机 AI':'好友联机',count:r.members.length,max:GAMES[r.game].max,host:r.members[0]?.nickname||'',visibility:r.visibility,ai:!!r.ai,state:r.engine&&!r.engine.over?'playing':'waiting',locked:r.visibility==='private'};}
 function message(u,ev){const l=live.get(u.id);if(l?.ws?.readyState===1)l.ws.send(JSON.stringify({t:'platform',...ev}));}
 function broadcast(r){for(const m of r.members){const u=byId(m.id);if(u)message(u,{event:'room',room:roomView(r,u.id)});}}
 function scheduleAI(r){
  const e=r.engine;
  if(!e||e.over||!r.ai||e.turn<e.humans)return;
  if(r.aiTimer)clearTimeout(r.aiTimer);
  r.aiTimer=setTimeout(()=>{
    r.aiTimer=null;
    if(!rooms.has(r.id)||r.engine!==e||e.over||!r.ai||e.turn<e.humans)return;
    let moved=false;
    try{moved=aiStep(e);}catch(err){console.error('[AI] 走子异常',err.message);e.over=true;e.winner=0;e.reason='本局结束';moved=true;}
    if(moved){settle(r);r.revision++;broadcast(r);scheduleAI(r);}
  }, (e.kind === 'landlord' || e.kind === 'party') ? 650 + Math.random() * 850 : 360 + Math.random() * 420);
 }
 function startRoom(r){
  if(!r||r.engine&&!r.engine.over)return false;
  if(r.game==='fish'&&(r.members.length<2||[...rooms.values()].filter(x=>x.game==='fish'&&x.engine&&!x.engine.over).length>=3))return false;
  r.engine=createEngine(r.game==='fish'?'fishmp':r.game,r.members.length,r.ai,{ratio:r.ratio});
  r.matchId=uid();r.settled=false;broadcast(r);scheduleAI(r);return true;
 }
 function roomView(r,id){return {...listRoom(r),code:r.code,invite:r.invite,members:r.members,engine:r.engine?publicEngine(r.engine,r.members.findIndex(m=>m.id===id)):null,revision:r.revision||0};}
 function seasonCheck(u){const x=extra(u);if(x.season===season())return;db.seasonArchive.push({id:u.id,season:x.season,rating:x.rated});const frame=rank(x.rated);u.frames=[...new Set([...(u.frames||[]),frame])];x.rated=1000;x.season=season();}
 function award(u,result){const x=extra(u);if(x.history.some(h=>h.id===result.id))return;seasonCheck(u);u.coins=Math.max(0,(u.coins||0)+result.coin);u.stats=u.stats||{games:0,wins:0};u.stats.games++;if(result.win)u.stats.wins++;x.rated=Math.max(0,x.rated+(result.rated?(result.win?25:-10):0));x.gameStats=x.gameStats||{};const gs=x.gameStats[result.game]||={games:0,wins:0,best:999};gs.games++;if(result.win){gs.wins++;x.firstWin=true;}if(result.rank>0)gs.best=Math.min(gs.best,result.rank);x.gameStats[result.game]=gs;x.history.unshift({...result,time:now()});x.history=x.history.slice(0,100);ctx.saveUsers();write();message(u,{event:'profile',profile:view(u)});}
 function settle(r){if(!r.engine.over||r.settled)return;r.settled=true;for(let i=0;i<r.members.length;i++){const m=r.members[i],u=byId(m.id);if(!u)continue;const win=r.engine.winner===i||r.engine.winner==='all'||r.engine.winningTeam?.includes(i);const draw=r.engine.winner==='draw';award(u,{id:r.matchId,game:r.game,win,rank:draw?0:win?1:2,coin:draw?5:win?20:5,rated:!r.ai&&r.game!=='party'&&r.game!=='ledger'&&r.game!=='fish'});}}
 function notify(f){let hook=process.env.FEEDBACK_WEBHOOK;try{if(!hook)hook=fs.readFileSync('/etc/shengqima/feedback-webhook','utf8').trim();}catch{}if(!hook){f.delivery='未配置';return;}
  let u;try{u=new URL(hook);if(u.protocol!=='https:'||u.hostname!=='qyapi.weixin.qq.com')return;}catch{return;}
  f.delivery='发送中';const body=JSON.stringify({msgtype:'text',text:{content:`千城反馈 ${f.id}\n类型：${f.type}\n用户：${f.user}\n时间：${new Date(f.time).toISOString()}\n${f.text.slice(0,1600)}`}});
  const request=https.request(u,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:8000},res=>{let s='';res.on('data',c=>{if(s.length<10000)s+=c;});res.on('end',()=>{try{f.delivery=JSON.parse(s).errcode===0?'已送达':'待重试';}catch{f.delivery='待重试';}write();});});request.on('timeout',()=>request.destroy());request.on('error',()=>{f.delivery='待重试';write();});request.end(body);
 }
 function api(req,j){
  const url=new URL(req.url,'http://local'),p=url.pathname;
  if(!p.startsWith('/api/platform/'))return;
  try{
   assert(rate(req,p,p.endsWith('/login')||p.endsWith('/register')?12:p.endsWith('/guest')?30:p.endsWith('/room/action')?1800:180),'操作太频繁，请稍后重试');
   const token=String(j.token||url.searchParams.get('token')||req.headers.authorization?.replace(/^Bearer /,'')||'');
   if(p==='/api/platform/guest'){
    assert(/^[a-f0-9]{32}$/.test(String(j.guestId||'')),'游客标识无效');let u=Object.values(ctx.users).find(u=>u.guest&&u.guestKey===j.guestId);
    if(!u){const id='QC'+crypto.randomBytes(5).toString('hex').toUpperCase();u={id,guest:true,guestKey:j.guestId,nickname:String(j.nickname||'游客').slice(0,16),avatar:String(j.avatar||'🙂').slice(0,8),coins:200,frames:[],frame:'',stats:{games:0,wins:0},created:now()};const old=j.legacy||{};if(Number.isFinite(+old.coins))u.coins=Math.max(0,Math.min(10000000,Math.floor(+old.coins)));u.frames=Array.isArray(old.frames)?old.frames.filter(v=>['S','A','B','C'].includes(v)):[];u.frame=u.frames.includes(old.frame)?old.frame:'';u.lastSign=String(old.lastSign||'').slice(0,10);if(old.stats){u.stats.games=Math.max(0,Math.min(1000000,Math.floor(+old.stats.games)||0));u.stats.wins=Math.max(0,Math.min(u.stats.games,Math.floor(+old.stats.wins)||0));}ctx.users[id]=u;const x=extra(u);x.favorites=Array.isArray(old.favorites)?old.favorites.filter(v=>Object.hasOwn(GAMES,v)):[];}return {ok:true,token:issue(u),profile:{...view(u),guest:true}};
   }
   if(p==='/api/platform/register'){
    const pass=String(j.password||''),name=String(j.nickname||'').trim();assert(pass.length>=8&&pass.length<=100,'密码需 8–100 位');assert(name&&name.length<=16,'昵称需 1–16 个字符');
    const guest=String(j.guestId||'');assert(/^[a-f0-9]{32}$/.test(guest),'游客标识无效');assert(!Object.values(ctx.users).some(u=>u.migratedGuest===guest),'该游客数据已经迁移，请登录原账号');
    if(ctx.regQuota)assert(ctx.regQuota.left()>0,'今日注册名额已满（每天 30 个），明天再来吧');
    const id='QC'+crypto.randomBytes(5).toString('hex').toUpperCase(),salt=crypto.randomBytes(16).toString('hex');
    const current=lookup(token);const old=current?.guest?{...current,favorites:extra(current).favorites}:j.legacy||{};const num=(v,max)=>Number.isFinite(+v)?Math.max(0,Math.min(max,Math.floor(+v))):0;
    const u={id,nickname:name,avatar:String(j.avatar||'🙂').slice(0,8),coins:num(old.coins,10000000),frames:(old.frames||[]).filter(v=>['S','A','B','C'].includes(v)),frame:'',stats:{games:num(old.stats?.games,1000000),wins:num(old.stats?.wins,1000000)},lastSign:/^\d{4}-\d{2}-\d{2}$/.test(old.lastSign)?old.lastSign:'',created:now(),credential:{salt,hash:crypto.scryptSync(pass,salt,32).toString('hex')},migratedGuest:guest};
    u.stats.wins=Math.min(u.stats.wins,u.stats.games);if(u.frames.includes(old.frame))u.frame=old.frame;if(current?.guest){u.id=current.id;ctx.users[current.id]=u;}else ctx.users[id]=u;const x=extra(u);x.favorites=Array.isArray(old.favorites)?old.favorites.filter(v=>Object.hasOwn(GAMES,v)):[];ctx.regQuota?.consume();write();return {ok:true,token:issue(u),profile:view(u)};
   }
   if(p==='/api/platform/login'){
    const account=String(j.account||'').trim(),pass=String(j.password||'');const u=ctx.users[account]||byId(account.toUpperCase());assert(u,'ID 或密码不正确');let correct=false;
    if(u.credential){const h=crypto.scryptSync(pass,u.credential.salt,32);correct=crypto.timingSafeEqual(h,Buffer.from(u.credential.hash,'hex'));}else correct=u.hash===ctx.hashPwd(u.salt,pass);
    assert(correct,'ID 或密码不正确');if(!u.credential){const salt=crypto.randomBytes(16).toString('hex');u.credential={salt,hash:crypto.scryptSync(pass,salt,32).toString('hex')};}return {ok:true,token:issue(u),profile:view(u)};
   }
   if(p==='/api/platform/rooms')return {ok:true,rooms:[...rooms.values()].map(listRoom),legacy:ctx.legacyRooms()};
   const u=actor(token),x=extra(u);seasonCheck(u);
   if(p==='/api/platform/me')return {ok:true,profile:{...view(u),guest:!!u.guest},rtc:{configured:false,reason:'语音需要 HTTPS 与 RTC 服务配置'}};
   if(p==='/api/platform/logout'){u.sessions=(u.sessions||[]).filter(s=>s.hash!==digest(token));if(u.token===token)u.token='';live.delete(u.id);ctx.saveUsers();return {ok:true};}
   if(p==='/api/platform/profile'){if(j.nickname!==undefined){assert(String(j.nickname).trim().length>0,'昵称不能为空');u.nickname=String(j.nickname).trim().slice(0,16);}if(j.avatar)u.avatar=String(j.avatar).slice(0,8);if(j.favorites)x.favorites=[...new Set(j.favorites.filter(v=>Object.hasOwn(GAMES,v)))];if(j.frame!==undefined){assert(!j.frame||(u.frames||[]).includes(j.frame),'尚未拥有该头像框');u.frame=j.frame;}ctx.saveUsers();write();return {ok:true,profile:view(u)};}
   if(p==='/api/platform/password'){const pass=String(j.password||'');assert(pass.length>=8&&pass.length<=100,'密码需 8–100 位');const salt=crypto.randomBytes(16).toString('hex');const old=String(j.oldPassword||'');assert(u.credential?crypto.timingSafeEqual(crypto.scryptSync(old,u.credential.salt,32),Buffer.from(u.credential.hash,'hex')):u.hash===ctx.hashPwd(u.salt,old),'当前密码不正确');u.credential={salt,hash:crypto.scryptSync(pass,salt,32).toString('hex')};u.sessions=[];u.token='';return {ok:true,token:issue(u)};}
   if(p==='/api/platform/heartbeat'){live.set(u.id,{...(live.get(u.id)||{}),at:now()});return {ok:true};}
   if(p==='/api/platform/friends')return {ok:true,friends:x.friends.map(byId).filter(Boolean).map(f=>({...publicUser(f),...presence(f)})),requests:x.requests.map(byId).filter(Boolean).map(publicUser),invites:(x.invites||[]).filter(v=>v.expires>now()&&(v.legacy||rooms.has(v.room)))};
   if(p==='/api/platform/search'){const f=byId(String(j.id||''));return {ok:true,user:f?publicUser(f):null};}
   if(p==='/api/platform/friend/request'){const f=byId(String(j.id||''));assert(f&&f.id!==u.id,'用户不存在或是自己');assert(!x.friends.includes(f.id),'已经是好友');const y=extra(f);if(!y.requests.includes(u.id))y.requests.push(u.id);write();message(f,{event:'friends'});return {ok:true};}
   if(p==='/api/platform/friend/accept'){const f=byId(String(j.id||''));assert(f&&x.requests.includes(f.id),'申请不存在');x.requests=x.requests.filter(id=>id!==f.id);if(j.accept!==false){x.friends=[...new Set([...x.friends,f.id])];const y=extra(f);y.friends=[...new Set([...y.friends,u.id])];}write();return {ok:true};}
   if(p==='/api/platform/friend/invite'){const f=byId(String(j.id||'')),r=currentRoom(u)||ctx.legacyInvite?.(token);assert(f&&x.friends.includes(f.id)&&r,'请选择好友并先创建房间');const y=extra(f);y.invites=[{room:r.id,invite:r.invite,code:r.legacy?r.code:undefined,legacy:r.legacy,from:u.nickname,game:r.game,expires:now()+300000},...(y.invites||[])].slice(0,20);write();message(f,{event:'invite'});return {ok:true};}
   if(p==='/api/platform/legacy/invite'){const r=ctx.legacyInvite?.(token);assert(r,'你还没有进入游戏房间');return {ok:true,...r};}
   if(p==='/api/platform/room/resolve'){const r=ctx.legacyResolve?.(String(j.code||''));assert(r,'房间不存在');return {ok:true,...r};}
   if(p==='/api/platform/room/create'){
    assert(Object.hasOwn(GAMES,j.game),'不支持的游戏');assert(['public','private'].includes(j.visibility),'请选择公开或私密');assert(!currentRoom(u),'请先退出当前房间');assert(rooms.size<30,'房间已满，请稍后');
    const id=uid();let code;do{code=String(crypto.randomInt(100000,1000000));}while([...rooms.values()].some(r=>r.code===code));
    const r={id,code,invite:uid(),game:j.game,visibility:j.visibility,members:[{...publicUser(u),ready:true}],created:now(),ai:!!j.ai,engine:null,revision:0,ratio:Math.max(.35,Math.min(2.6,Number(j.ratio)||.56))};rooms.set(id,r);if(r.game==='ledger'){r.ledger={entries:[],revision:0,members:r.members.slice(),owner:u.id};db.ledgers[id]={...r.ledger,created:r.created};write();}return {ok:true,room:roomView(r,u.id)};
   }
   if(p==='/api/platform/room/join'){
    const r=rooms.get(String(j.id||''))||[...rooms.values()].find(r=>r.code===String(j.code||''));assert(r,'房间不存在');const own=currentRoom(u);assert(!own||own.id===r.id,'请先退出当前房间');if(r.members.some(m=>m.id===u.id))return {ok:true,room:roomView(r,u.id)};
    assert(!(r.engine&&!r.engine.over),'对局已经开始');assert(r.members.length<GAMES[r.game].max,'房间已满');assert(r.visibility==='public'||j.invite===r.invite||j.code===r.code,'私密房需要房间码或有效邀请');r.members.push({...publicUser(u),ready:true});if(r.ledger&&!r.ledger.members.some(m=>m.id===u.id))r.ledger.members.push(publicUser(u));r.revision++;broadcast(r);return {ok:true,room:roomView(r,u.id)};
   }
   if(p==='/api/platform/room/current'){const r=currentRoom(u);return {ok:true,room:r?roomView(r,u.id):null};}
   if(p==='/api/platform/room/leave'){const r=currentRoom(u);if(r){
    if(r.engine&&!r.engine.over&&r.engine.kind==='fishmp'){
     const si=r.members.findIndex(m=>m.id===u.id);const p=r.engine.players[si];
     if(p&&!p.dead){p.dead=true;p.lives=0;}
     if(r.engine.players.every(x=>x.dead)){
      r.engine.over=true;let best=0,bs=-1,ts=0;
      r.engine.players.forEach((x,si2)=>{ts+=x.score;if(x.score>bs){bs=x.score;best=si2;}});
      r.engine.winner=ts>0?best:'draw';r.engine.reason='有玩家退出，按当前得分结算';
     }
     r.settled=true;settle(r);broadcast(r);
    } else if(r.engine&&!r.engine.over&&r.game!=='party'&&r.game!=='ledger'){r.engine.over=true;r.engine.winner='draw';r.engine.reason='成员退出，本局不计排名';r.settled=true;}
    r.members=r.members.filter(m=>m.id!==u.id);if(!r.members.length)rooms.delete(r.id);else broadcast(r);
   }return {ok:true};}
   if(p==='/api/platform/room/start'){
    const r=currentRoom(u);assert(r,'请先进入房间');
    /* 私密房是熟人局，房主不在时任何成员都能开；公开房必须房主控制 */
    assert(r.members[0].id===u.id||r.visibility==='private','公开房只有房主可以开始');
    assert(!r.engine||r.engine.over,'对局已经开始');assert(!['cat','qq'].includes(r.game),'原有游戏请使用其专属开局入口');
    if(r.game==='fish'){assert(r.members.length>=2,'联机竞速至少 2 人开局');assert([...rooms.values()].filter(x=>x.game==='fish'&&x.engine&&!x.engine.over).length<3,'实时海域已满，请稍后再试');}
    else assert(r.game==='party'||r.game==='ledger'||r.ai||r.members.length>=GAMES[r.game].max,'等待其他玩家加入，或使用单机 AI');
    startRoom(r);
    return {ok:true,room:roomView(r,u.id)};
   }
   if(p==='/api/platform/room/action'){
    const r=currentRoom(u);assert(r,'请先进入房间');assert(r.engine,'请先开始');actionEngine(r.engine,r.members.findIndex(m=>m.id===u.id),j.action||{},r.members[0].id===u.id);settle(r);r.revision++;broadcast(r);scheduleAI(r);return {ok:true,room:roomView(r,u.id)};
   }
   if(p==='/api/platform/ledger'){
    const r=currentRoom(u);assert(r?.game==='ledger','请进入账本');if(j.from){assert(j.revision===r.ledger.revision,'账本已更新，请刷新后重试');assert(r.ledger.members.some(m=>m.id===j.from)&&r.ledger.members.some(m=>m.id===j.to)&&j.from!==j.to,'请选择两名不同成员');assert(r.ledger.owner===u.id||j.from===u.id||j.to===u.id,'只能记录自己的账目');const cents=Math.round(Number(j.amount)*100);assert(Number.isSafeInteger(cents)&&cents>0&&cents<=100000000,'金额需大于 0 且不超过 100 万');assert(typeof j.requestId==='string'&&j.requestId.length>=8,'缺少流水标识');if(!r.ledger.entries.some(e=>e.requestId===j.requestId)){r.ledger.entries.push({id:uid(),requestId:j.requestId,from:j.from,to:j.to,cents,by:u.id,note:String(j.note||'').slice(0,100),time:now()});r.ledger.revision++;}}
    if(j.undo){const e=r.ledger.entries.find(e=>e.id===j.undo);assert(e&&(e.by===u.id||r.ledger.owner===u.id),'无权撤销');e.void=true;r.ledger.revision++;}
    db.ledgers[r.id]={...r.ledger,created:r.created};write();const balances={};for(const m of r.ledger.members)balances[m.id]=0;for(const e of r.ledger.entries)if(!e.void){balances[e.from]-=e.cents;balances[e.to]+=e.cents;}const pos=Object.entries(balances).filter(x=>x[1]>0),neg=Object.entries(balances).filter(x=>x[1]<0).map(([id,n])=>[id,-n]);const transfers=[];let a=0,b=0;while(a<neg.length&&b<pos.length){const c=Math.min(neg[a][1],pos[b][1]);transfers.push({from:neg[a][0],to:pos[b][0],cents:c});neg[a][1]-=c;pos[b][1]-=c;if(!neg[a][1])a++;if(!pos[b][1])b++;}return {ok:true,ledger:r.ledger,balances,transfers};
   }
   if(p==='/api/platform/ledger/open'){const l=db.ledgers[String(j.id||'')];assert(l&&l.members.some(m=>m.id===u.id),'账本不存在或无权访问');assert(!currentRoom(u),'请先退出当前房间');let r=rooms.get(j.id);if(!r){r={id:j.id,code:String(crypto.randomInt(100000,1000000)),invite:uid(),game:'ledger',visibility:'private',members:[],created:now(),ledger:{...l},engine:null,revision:0};rooms.set(j.id,r);}if(!r.members.some(m=>m.id===u.id))r.members.push(publicUser(u));return {ok:true,room:roomView(r,u.id)};}
   if(p==='/api/platform/ledgers')return {ok:true,ledgers:Object.entries(db.ledgers).filter(([,l])=>l.members.some(m=>m.id===u.id)).map(([id,l])=>({id,...l}))};
   if(p==='/api/platform/tasks'){
    const todays=x.history.filter(h=>new Date(h.time+8*3600000).toISOString().slice(0,10)===day());const items=[{id:day()+':sign',name:'今日签到',done:u.lastSign===day(),reward:10},{id:day()+':play3',name:'完成 3 局',done:todays.length>=3,reward:30},{id:'achievement:firstwin',name:'首胜徽章',done:!!x.firstWin||x.history.some(h=>h.win),reward:50},{id:'achievement:ten',name:'十局玩家',done:(u.stats?.games||0)>=10,reward:100}];
    if(j.claim){const task=items.find(t=>t.id===j.claim);assert(task?.done,'任务尚未完成');assert(!x.claims.includes(task.id),'已经领取');x.claims.push(task.id);u.coins=(u.coins||0)+task.reward;ctx.saveUsers();write();}return {ok:true,tasks:items.map(t=>({...t,claimed:x.claims.includes(t.id)})),profile:view(u)};
   }
   if(p==='/api/platform/solo/result'){
    assert(rate(req,'solo-result',20),'上报太频繁，请稍后再试');
    const game=String(j.game||'');assert(SOLO_GAMES[game],'不支持的游戏');
    const score=Math.max(0,Math.min(999999,Math.floor(Number(j.score)||0)));
    const time=Math.max(0,Math.min(7200,Math.floor(Number(j.time)||0)));
    const coinsEaten=Math.max(0,Math.min(20,Math.floor(Number(j.coinsEaten)||0)));
    assert(typeof j.win==='boolean','结果无效');
    const mid=String(j.matchId||'');assert(/^[a-f0-9]{8,40}$/.test(mid),'对局标识无效');
    const xb=extra(u);const best=xb.soloBest=xb.soloBest||{};const b=best[game]=best[game]||{};
    let coin,record=false;
    /* ---- 斗地主单机（页面版）：按「单局积分」记最高分，金币跟胜负与炸弹数挂钩 ---- */
    if(game==='landlord'){
      const bombs=Math.max(0,Math.min(12,Math.floor(Number(j.bombs)||0)));
      coin=(j.win?20:5)+Math.min(30,bombs*5);
      if(score>(b.score||0)){b.score=score;b.scoreAt=now();record=true;}
      write();
      award(u,{id:mid,game,win:!!j.win,rank:j.win?1:2,coin,rated:false,score,mode:'table',time,coinsEaten:0});
      return {ok:true,record,best:b.score||0,coin,profile:view(u)};
    }
    /* ---- 消消乐：按「最高分 + 最高关卡」双记录，金币 = 基础 + 分数 + 关卡 ---- */
    if(game==='match3'){
      const level=Math.max(1,Math.min(300,Math.floor(Number(j.level)||1)));
      const combo=Math.max(0,Math.min(200,Math.floor(Number(j.combo)||0)));
      coin=(j.win?20:5)+Math.min(30,Math.floor(score/250))+Math.min(15,level*2)+Math.min(10,combo);
      if(score>(b.score||0)){b.score=score;b.scoreAt=now();record=true;}
      if(level>(b.level||0)){b.level=level;record=true;}
      write();
      award(u,{id:mid,game,win:!!j.win,rank:j.win?1:2,coin,rated:false,score,mode:'level',time,level,coinsEaten:0});
      return {ok:true,record,best:b.score||0,bestLevel:b.level||0,coin,profile:view(u)};
    }
    const mode=['evolution','endless'].includes(j.mode)?j.mode:'evolution';
    if(mode==='evolution'){
      coin=(j.win?20:5)+coinsEaten*5;
      if(j.win&&time>=30&&(!b.speed||time<b.speed)){b.speed=time;b.speedAt=now();record=true;}
    }else{
      coin=5+Math.min(25,Math.floor(score/100))+coinsEaten*5;
      if(score>(b.score||0)){b.score=score;b.scoreAt=now();record=true;}
    }
    write();
    award(u,{id:mid,game,win:!!j.win,rank:j.win?1:2,coin,rated:false,score,mode,time,coinsEaten});
    return {ok:true,record,profile:view(u)};
   }
   if(p==='/api/platform/shield/buy'){
    const n=Math.max(1,Math.min(10,Math.floor(Number(j.count)||1)));
    const cost=n*50;assert((u.coins||0)>=cost,'金币不足（每面护盾 50 金币）');
    u.coins-=cost;const xs=extra(u);xs.shields=(xs.shields||0)+n;ctx.saveUsers();write();
    return {ok:true,shields:xs.shields,coins:u.coins,profile:view(u)};
   }
   if(p==='/api/platform/shield/use'){
    const mid=String(j.matchId||'');assert(/^[a-f0-9]{8,40}$/.test(mid),'对局标识无效');
    assert(!usedShields.has(mid),'本局已使用过护盾');
    const xs=extra(u);assert((xs.shields||0)>0,'护盾库存不足，请先到道具页兑换');
    xs.shields--;usedShields.add(mid);if(usedShields.size>20000)usedShields.clear();
    ctx.saveUsers();write();
    return {ok:true,shields:xs.shields,profile:view(u)};
   }
   if(p==='/api/platform/revive'){
    const mid=String(j.matchId||'');assert(/^[a-f0-9]{8,40}$/.test(mid),'对局标识无效');
    assert(!revivedMids.has(mid),'本局已经复活过');
    assert((u.coins||0)>=50,'金币不足（复活需要 50 金币）');
    u.coins-=50;revivedMids.add(mid);if(revivedMids.size>20000)revivedMids.clear();
    ctx.saveUsers();write();
    return {ok:true,coins:u.coins,profile:view(u)};
   }
   if(p==='/api/platform/solo/rank'){
    const game=String(j.game||'');assert(SOLO_GAMES[game],'不支持的游戏');
    const fmt=u=>({id:u.id,nickname:u.nickname,avatar:u.avatar,frame:u.frame||''});
    const speed=[],scoreL=[];
    for(const x of Object.values(ctx.users)){const b=(extra(x).soloBest||{})[game];if(!b)continue;
      if(b.speed)speed.push({...fmt(x),time:b.speed});
      if(b.score)scoreL.push({...fmt(x),score:b.score});}
    speed.sort((a,b)=>a.time-b.time);scoreL.sort((a,b)=>b.score-a.score);
    const mine=(extra(u).soloBest||{})[game]||{};
    return {ok:true,speed:speed.slice(0,10),score:scoreL.slice(0,10),me:{speed:mine.speed||0,score:mine.score||0}};
   }
   if(p==='/api/platform/leaderboard')return {ok:true,season:season(),top:Object.values(ctx.users).map(u=>{seasonCheck(u);return {...publicUser(u),rank:rank(extra(u).rated)};}).sort((a,b)=>b.rating-a.rating).slice(0,50)};
   if(p==='/api/platform/feedback'){if(j.text){assert(rate(req,'feedback-submit',3),'反馈提交太频繁');assert(String(j.text).trim().length>=5,'请至少填写 5 个字');const f={id:uid(),user:u.id,type:j.type==='bug'?'问题 Bug':'功能建议',text:String(j.text).trim().slice(0,3000),contact:String(j.contact||'').slice(0,200),time:now(),status:'待处理',reply:'',delivery:'待发送'};db.feedback.push(f);write();notify(f);}return {ok:true,feedback:db.feedback.filter(f=>f.user===u.id)};}
   if(p==='/api/platform/shop'){const items=[{id:'fish-coral',name:'珊瑚鱼皮肤',game:'fish',price:200},{id:'fish-bubbles',name:'气泡拖尾',game:'fish',price:150},{id:'qq-mint',name:'薄荷球皮肤',game:'qq',price:200},{id:'name-gold',name:'金色昵称',game:'all',price:100}];if(j.buy){const item=items.find(i=>i.id===j.buy);assert(item,'商品不存在');x.items=x.items||[];assert(!x.items.includes(item.id),'已经拥有');assert(u.coins>=item.price,'金币不足');u.coins-=item.price;x.items.push(item.id);ctx.saveUsers();write();}return {ok:true,items,owned:x.items||[],profile:view(u)};}
   return {ok:false,msg:'接口不存在'};
  }catch(e){return {ok:false,msg:e.message};}
 }
 function socket(conn,m){if(m.t==='platformAuth'){const u=lookup(m.token);if(u){conn.platformUser=u.id;conn.token=m.token;live.set(u.id,{ws:conn.ws,at:now()});conn.ws.send(JSON.stringify({t:'platform',event:'authenticated',id:u.id}));}return true;}
  if(m.t==='platformInput'){const u=lookup(conn.token);if(u&&(!conn.lastInputAt||now()-conn.lastInputAt>=40)){conn.lastInputAt=now();const r=currentRoom(u);if(r?.engine&&r.engine.kind==='fishmp'&&!r.engine.over){const si=r.members.findIndex(mm=>mm.id===u.id);if(si>=0)try{actionEngine(r.engine,si,{x:m.x,y:m.y});}catch{}}}return true;}
  return false;}
 function admin(req,j){if(req.url==='/api/admin/feedback'){if(j.id){const f=db.feedback.find(f=>f.id===j.id);if(f){f.reply=String(j.reply||'').slice(0,3000);f.status=['待处理','已回复','已关闭'].includes(j.status)?j.status:'已回复';write();}}return {ok:true,feedback:db.feedback};}}
 function serve(req,res){const pathname=new URL(req.url,'http://local').pathname;if(/^\/platform\/assets\/[a-z0-9-]+\.webp$/.test(pathname)){const f=path.join(__dirname,'assets',path.basename(pathname));if(!fs.existsSync(f)){res.writeHead(404);res.end();return true;}res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public,max-age=86400'});fs.createReadStream(f).pipe(res);return true;}if(pathname.startsWith('/platform/')){const name=pathname.slice(10);if(!['client.js','admin.js','theme.css','sfx.js','match3.js','party-bank.js','dizhu.html','party-q.html'].includes(name)){res.writeHead(404);res.end();return true;}const fp=path.join(__dirname,name);
   /* 文件缺失必须 404 而不是抛异常——readFileSync 抛错会直接把整个进程带走 */
   if(!fs.existsSync(fp)){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('not found');return true;}
   let buf;try{buf=fs.readFileSync(fp);}catch(e){res.writeHead(500);res.end('read error');return true;}
   res.writeHead(200,{'Content-Type':name.endsWith('.js')?'application/javascript; charset=utf-8':name.endsWith('.html')?'text/html; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-cache'});res.end(buf);return true;}
  if(pathname==='/invite-qr'){const params=new URL(req.url,'http://local').searchParams;const q=params.get('room');const callerToken=params.get('token');const r=params.has('legacy')?ctx.legacyInvite?.(callerToken):rooms.get(q);if(!r){res.writeHead(404);res.end('房间不存在');return true;}const caller=lookup(new URL(req.url,'http://local').searchParams.get('token'));if(!r.legacy&&r.visibility==='private'&&!r.members.some(m=>m.id===caller?.id)){res.writeHead(403);res.end('需要房间成员身份');return true;}const base=process.env.PUBLIC_ORIGIN||'http://'+req.headers.host;const link=r.legacy?base+'/?legacy='+r.game+'&code='+r.code:base+'/?join='+r.id+'&invite='+r.invite;QR.toString(link,{type:'svg',margin:2,errorCorrectionLevel:'M'}).then(svg=>{res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});res.end(svg);}).catch(()=>{res.writeHead(500);res.end();});return true;}return false;
 }
 function legacyResult(token,result){const u=lookup(token);if(u)award(u,result);}
 function legacyApi(req,j){const p=req.url.split('?')[0];if(p==='/api/sign'){const u=lookup(j.token);if(!u)return {ok:false,msg:'请先登录'};const already=u.lastSign===day()||u.lastSign===day().replace(/-0/g,'-');if(!already){u.lastSign=day();u.coins=(u.coins||0)+50;extra(u).signDays++;ctx.saveUsers();write();}return {ok:true,already,coins:u.coins,lastSign:u.lastSign};}if(p==='/api/gameover'){const u=lookup(j.token);return u?{ok:true,coins:u.coins,stats:u.stats,practice:true}:{ok:false,msg:'请先登录'};}return undefined;}
 setInterval(()=>{const t=now();for(const r of rooms.values()){if(r.game==='fish'&&r.engine&&r.engine.kind==='fishmp'&&!r.engine.over){const dt=Math.min(.12,(t-(r.lastTick||t-66))/1000);r.lastTick=t;tickEngine(r.engine,dt);settle(r);if(t-(r.lastBroadcast||0)>=60){r.lastBroadcast=t;r.revision=(r.revision||0)+1;broadcast(r);}}}},66).unref();
 setInterval(()=>{for(const [id,l]of live)if(l.ws?.readyState!==1&&now()-l.at>30000)live.delete(id);for(const r of rooms.values())if(now()-r.created>8*3600000||now()-r.created>120000&&r.members.every(m=>!live.has(m.id)))rooms.delete(r.id);},30000).unref();
 setInterval(()=>{for(const [key,a] of limits)if(a.every(x=>x<now()-60000))limits.delete(key);},60000).unref();
 return {api,socket,serve,lookup,admin,legacyResult,legacyApi,rooms,GAMES};
};
