'use strict';
const crypto=require('crypto');
const rnd=(a,b)=>a+Math.random()*(b-a),ri=(a,b)=>crypto.randomInt(a,b),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
function createEngine(kind,n=1,ai=false,opts={}){
 const e={kind,over:false,winner:null,turn:0,moves:0,log:[],humans:n,ai,created:Date.now(),version:0};
 if(kind==='gomoku'){e.board=Array(225).fill(0);}
 if(kind==='xiangqi'){e.board=Array(90).fill(null);const row=['r','n','b','a','k','a','b','n','r'];for(let x=0;x<9;x++){e.board[x]={s:1,t:row[x]};e.board[81+x]={s:0,t:row[x]};}for(const x of[1,7]){e.board[18+x]={s:1,t:'c'};e.board[63+x]={s:0,t:'c'};}for(const x of[0,2,4,6,8]){e.board[27+x]={s:1,t:'p'};e.board[54+x]={s:0,t:'p'};}}
 if(kind==='jungle'){e.board=Array(63).fill(null);const a=[[0,0,7],[6,0,6],[1,1,3],[5,1,2],[0,2,1],[2,2,5],[4,2,4],[6,2,8]];for(const[x,y,r]of a){e.board[y*7+x]={s:1,r};e.board[(8-y)*7+(6-x)]={s:0,r};}}
 if(kind==='landlord'){deal(e);}
 if(kind==='party'){e.dice=[];e.wheel=[];e.choice='';e.question='';e.flight={planes:Array.from({length:4},()=>[-1,-1,-1,-1]),current:0,last:0,pending:false,winner:null};}
 if(kind==='ledger')e.note='多人共同记账';
 if(kind==='fishmp'){e.W=480;e.H=800;e.time=0;e.spawnT=0;e.players=Array.from({length:n},(_,i)=>({x:Math.round(e.W*(n>1?(.28+.44*i/(n-1)):.5)),y:Math.round(e.H*.5),size:16,stage:0,eaten:0,lives:3,score:0,dead:false,inv:0,dir:1,ix:0,iy:0,vx:0,vy:0}));e.uid=1;e.fishes=Array.from({length:10},()=>fishMP_NPC(e));}
 return e;
}
/* ---- 大鱼吃小鱼 联机（fishmp）：服务端权威仿真 ---- */
const FISH_STAGE_SIZE=[16,18,20,24,27,30,34,38,42,46,51,56,60,66,72,80,92,104];
const FISH_STAGE_NEED=[5,6,7,7,8,9,9,10,11,10,11,12,12,13,14,14,15,16];
const FISH_MP_SPECIES=[{type:'minnow',min:10,max:18,w:4},{type:'clown',min:13,max:28,w:1},{type:'yellow',min:22,max:38},{type:'jelly',min:20,max:42},{type:'puffer',min:32,max:52},{type:'grouper',min:46,max:72},{type:'shark',min:65,max:130}];
/* 生成一条 NPC 鱼。
   v2：原来是从 7 个物种里均匀抽一个（每条鱼都固定 1/7 概率是鲨鱼），
   结果玩家初始 16 号尺寸时，只有 minnow 里不到一半能吃得动 —— 看着满屏鱼，实际吃不到。
   现在改成按「最小的存活玩家」自适应：
     - 62% 生成明显比玩家小的鱼（一定吃得掉）
     - 22% 略大、16% 明显大，用来制造压力
     - 同屏「明显比玩家大」的危险鱼有上限，超了就强制生成小鱼，避免无路可躲
   多人房里取最小玩家当参照，保证落后的那个人也有鱼吃。 */
function fishMP_NPC(e){
 const alive=(e.players||[]).filter(p=>!p.dead);
 const ref=alive.length?Math.min(...alive.map(p=>p.size)):16;
 let lo,hi;
 const danger=(e.fishes||[]).reduce((n,f)=>n+(f.size>ref*1.12?1:0),0);
 const cap=3+(e.players?e.players.length:1);          /* 2 人 → 5，4 人 → 7 */
 /* 屏幕上「最弱者吃得掉」的鱼太少时，本条强制补小鱼：
   多人房里大玩家会把小鱼抢光（它体型大、吃的范围也大），落后那个人就彻底没食吃 */
 const weakEdible=(e.fishes||[]).reduce((n,f)=>n+(f.size<ref*.9?1:0),0);
 const r=Math.random();
 if(danger>=cap||weakEdible<2){lo=ref*.30;hi=ref*.80;}  /* 强制补小鱼 */
 else if(r<.75){lo=ref*.32;hi=ref*.85;}                 /* 75% 吃得动的小鱼 */
 else if(r<.91){lo=ref*1.15;hi=ref*1.50;}               /* 16% 略大 */
 else{lo=ref*1.60;hi=ref*2.30;}                         /* 9% 大鱼 */
 lo=Math.max(11,lo);                                     /* 再小就看不见了 */
 /* 挑和区间有交集的物种；都没交集就取尺寸最接近的那个 */
 let cands=FISH_MP_SPECIES.filter(s2=>s2.max>=lo&&s2.min<=hi);
 /* 水母横向速度只有一半、存活时间是别的鱼两倍，混进来会把同屏小鱼全挤掉。
    让它只做「偶尔出现的点缀」：5% 才轮到它，其余情况从候选里排除 */
 if(Math.random()>=.05){
  const noJelly=cands.filter(s2=>s2.type!=='jelly');
  if(noJelly.length)cands=noJelly;
 }
 /* 按权重抽物种：小鱼苗 w=4、小丑鱼 w=1，其余 1 —— 同屏以浅蓝为主，橙色做点缀 */
 let sp;
 if(cands.length){
  const total=cands.reduce((a,b)=>a+(b.w||1),0);let rr=Math.random()*total;
  sp=cands.find(s2=>{rr-=(s2.w||1);return rr<=0;})||cands[cands.length-1];
 }else{
  sp=FISH_MP_SPECIES.reduce((a,b)=>Math.abs((b.min+b.max)/2-(lo+hi)/2)<Math.abs((a.min+a.max)/2-(lo+hi)/2)?b:a);
 }
 const a=Math.max(sp.min,lo),b=Math.min(sp.max,hi);
 const size=clamp(rnd(Math.min(a,b),Math.max(a,b)),sp.min,sp.max),fromLeft=Math.random()<.5,isJelly=sp.type==='jelly';
 /* 游速下调：原来小鱼 130px/s，4 秒就穿屏消失了，同屏根本攒不起来。
   现在统一压到 92 以内，鱼在屏上待得久、看得清，也更容易吃到（难度主要来自体型不是手速）。 */
 const speed=isJelly?rnd(16,26):clamp(105-size,28,85)*rnd(.72,1);
 const f={id:e.uid++,x:fromLeft?-size*1.6:e.W+size*1.6,y:rnd(e.H*.08,e.H*.92),vx:(fromLeft?1:-1)*speed,vy:0,size,type:sp.type,dir:fromLeft?1:-1,phase:rnd(0,6.28),t:0,bobAmp:isJelly?0:rnd(6,18),bobFreq:rnd(.8,1.8),baseY:0,jellyDir:Math.random()<.5?1:-1,jellyV:rnd(18,32)};
 f.baseY=f.y;return f;
}
function fishMPTick(e,dt){
 e.time+=dt;
 for(const p of e.players){
  if(p.dead)continue;
  if(p.inv>0)p.inv-=dt;
  const l=Math.hypot(p.ix,p.iy),ms=320-Math.min(p.stage,17)*6;
  if(l>.05){p.vx=p.ix/l*ms;p.vy=p.iy/l*ms;}else{p.vx*=Math.pow(.0025,dt);p.vy*=Math.pow(.0025,dt);}
  p.x=clamp(p.x+p.vx*dt,p.size*.6,e.W-p.size*.6);
  p.y=clamp(p.y+p.vy*dt,p.size*.6+34,e.H-p.size*.6);
  if(Math.abs(p.vx)>12)p.dir=p.vx>0?1:-1;
  p.size+=(FISH_STAGE_SIZE[Math.min(p.stage,17)]-p.size)*Math.min(1,dt*3);
 }
 for(const f of e.fishes){
  f.t+=dt;f.phase+=dt*(4+40/f.size);
  if(f.type==='jelly'){f.x+=f.vx*dt*.5;f.y+=f.jellyDir*f.jellyV*dt;if(f.y<e.H*.1)f.jellyDir=1;if(f.y>e.H*.9)f.jellyDir=-1;}
  else{f.x+=f.vx*dt;f.y=f.baseY+Math.sin(f.t*f.bobFreq)*f.bobAmp;}
 }
 for(let i=e.fishes.length-1;i>=0;i--){const f=e.fishes[i];if((f.vx<0&&f.x<-f.size*2.2)||(f.vx>0&&f.x>e.W+f.size*2.2))e.fishes.splice(i,1);}
 /* 生成频率减半：间隔 .5~1.1s → 1.0~2.2s；同屏上限 18 → 12 同步收紧，免得一次性堆满 */
 e.spawnT-=dt;if(e.spawnT<=0&&e.fishes.length<16){e.fishes.push(fishMP_NPC(e));e.spawnT=rnd(1.0,2.0);}
 if(e.over)return;
 for(let i=e.fishes.length-1;i>=0;i--){
  const f=e.fishes[i];
  for(let s=0;s<e.players.length;s++){
   const p=e.players[s];if(p.dead)continue;
   if(Math.hypot(f.x-p.x,f.y-p.y)>(f.size+p.size)*.62)continue;
   if(f.size<p.size*.9){
    e.fishes.splice(i,1);
    p.score+=Math.max(1,Math.round(f.size/9));p.eaten++;
    const need=FISH_STAGE_NEED[Math.min(p.stage,17)];
    if(p.eaten>=need&&p.stage<17){
     p.stage++;p.eaten=0;
     if(p.stage>=17){e.over=true;e.winner=s;e.reason='率先进化为大白鲨Ⅲ！';}
    }
    break;
   }
   if(f.size>p.size*1.12&&p.inv<=0){
    p.lives--;p.inv=2.5;
    if(p.lives<=0){
     p.dead=true;p.x=e.W/2;p.y=e.H/2;
     if(e.players.every(x=>x.dead)){
      e.over=true;let best=0,bs=-1,ts=0;
      e.players.forEach((x,si)=>{ts+=x.score;if(x.score>bs){bs=x.score;best=si;}});
      e.winner=ts>0?best:'draw';e.reason='全部出局，按得分结算';
     }
    }
    break;
   }
  }
 }
}
function fishMPPublic(e){
 return {kind:e.kind,W:e.W,H:e.H,time:Math.round(e.time),over:e.over,winner:e.winner,reason:e.reason,
  players:e.players.map(p=>({x:Math.round(p.x),y:Math.round(p.y),size:Math.round(p.size),stage:p.stage,eaten:p.eaten,lives:p.lives,score:p.score,dead:p.dead,inv:p.inv>0,dir:p.dir})),
  fishes:e.fishes.map(f=>({id:f.id,x:Math.round(f.x),y:Math.round(f.y),size:Math.round(f.size),type:f.type,dir:f.dir}))};
}
function log(e,text){e.log.unshift(text);e.log=e.log.slice(0,30);e.version++;}
function win(e,seat,text){e.over=true;e.winner=seat;e.reason=text;log(e,text);}
function inRange(x,y,w,h){return x>=0&&x<w&&y>=0&&y<h;}
function gomoku(e,seat,a){const i=Number(a.index);check(Number.isInteger(i)&&i>=0&&i<225&&!e.board[i],'请选择空交叉点');e.board[i]=seat+1;e.moves++;const x=i%15,y=Math.floor(i/15);for(const[dx,dy]of[[1,0],[0,1],[1,1],[1,-1]]){let n=1;for(const sign of[-1,1])for(let k=1;k<5;k++){const xx=x+dx*k*sign,yy=y+dy*k*sign;if(!inRange(xx,yy,15,15)||e.board[yy*15+xx]!==seat+1)break;n++;}if(n>=5){win(e,seat,'五子连珠');return;}}if(e.moves===225)win(e,'draw','棋盘已满，和棋');else e.turn=1-seat;}
function between(board,from,to,w){const x=from%w,y=Math.floor(from/w),xx=to%w,yy=Math.floor(to/w);if(x!==xx&&y!==yy)return -1;const step=x===xx?(yy>y?w:-w):(xx>x?1:-1);let n=0;for(let i=from+step;i!==to;i+=step)if(board[i])n++;return n;}
function xqPseudo(board,from,to){const p=board[from],q=board[to];if(!p||q?.s===p.s||from===to)return false;const x=from%9,y=Math.floor(from/9),xx=to%9,yy=Math.floor(to/9),dx=xx-x,dy=yy-y,ax=Math.abs(dx),ay=Math.abs(dy);switch(p.t){
 case'r':return between(board,from,to,9)===0;
 case'c':return between(board,from,to,9)===(q?1:0);
 case'n':return ax*ay===2&&!board[ay===2?from+Math.sign(dy)*9:from+Math.sign(dx)];
 case'b':return ax===2&&ay===2&&(p.s===0?yy>=5:yy<=4)&&!board[from+Math.sign(dy)*9+Math.sign(dx)];
 case'a':return ax===1&&ay===1&&xx>=3&&xx<=5&&(p.s===0?yy>=7:yy<=2);
 case'k':return q?.t==='k'&&x===xx&&between(board,from,to,9)===0||(ax+ay===1&&xx>=3&&xx<=5&&(p.s===0?yy>=7:yy<=2));
 case'p':return dx===0&&dy===(p.s===0?-1:1)||dy===0&&ax===1&&(p.s===0?y<=4:y>=5);
 }return false;
}
function xqCheck(board,seat){const king=board.findIndex(p=>p?.s===seat&&p.t==='k');if(king<0)return true;return board.some((p,i)=>p&&p.s!==seat&&xqPseudo(board,i,king));}
function xqLegal(board,f,t,s){if(!Number.isInteger(f)||!Number.isInteger(t)||!inRange(f%9,Math.floor(f/9),9,10)||!inRange(t%9,Math.floor(t/9),9,10)||board[f]?.s!==s||!xqPseudo(board,f,t))return false;const b=board.slice();b[t]=b[f];b[f]=null;return !xqCheck(b,s);}
function xiangqi(e,seat,a){const f=Number(a.from),t=Number(a.to);check(xqLegal(e.board,f,t,seat),'走法不合法，或将帅处于被攻击状态');const taken=e.board[t];e.board[t]=e.board[f];e.board[f]=null;e.moves++;if(taken?.t==='k'){win(e,seat,'将帅被擒');return;}e.turn=1-seat;let any=false;for(let f=0;f<90&&!any;f++)if(e.board[f]?.s===e.turn)for(let t=0;t<90&&!any;t++)any=xqLegal(e.board,f,t,e.turn);if(!any)win(e,seat,'对方无合法走法');log(e,`${seat===0?'红':'黑'}方行棋${xqCheck(e.board,e.turn)?' · 将军':''}`);}
const water=i=>{const x=i%7,y=Math.floor(i/7);return y>=3&&y<=5&&[1,2,4,5].includes(x);};
const den=i=>i===3?1:i===59?0:null;
const trap=i=>[2,4,10].includes(i)?1:[58,60,52].includes(i)?0:null;
function jungleLegal(b,f,t,s){if(!Number.isInteger(f)||!Number.isInteger(t)||!inRange(f%7,Math.floor(f/7),7,9)||!inRange(t%7,Math.floor(t/7),7,9)||b[f]?.s!==s||b[t]?.s===s||den(t)===s)return false;const p=b[f],q=b[t],x=f%7,y=Math.floor(f/7),xx=t%7,yy=Math.floor(t/7),d=Math.abs(xx-x)+Math.abs(yy-y);if(d!==1){if(![6,7].includes(p.r)||x!==xx&&y!==yy||water(f)||water(t))return false;const step=x===xx?(yy>y?7:-7):(xx>x?1:-1);let crossed=false;for(let i=f+step;i!==t;i+=step){if(!water(i)||b[i])return false;crossed=true;}if(!crossed)return false;}
 if(water(t)&&p.r!==1)return false;if(!q)return true;if(p.r===1&&water(f)!==water(t))return false;const enemyRank=trap(t)===s?0:q.r;if(p.r===1&&enemyRank===8)return true;if(p.r===8&&enemyRank===1)return false;return p.r>=enemyRank;
}
function jungle(e,seat,a){const f=Number(a.from),t=Number(a.to);check(jungleLegal(e.board,f,t,seat),'该动物不能这样移动或吃子');e.board[t]=e.board[f];e.board[f]=null;e.moves++;if(den(t)!==null&&den(t)!==seat){win(e,seat,'进入对方兽穴');return;}e.turn=1-seat;if(!e.board.some(p=>p&&p.s===e.turn))win(e,seat,'对方已无棋子');}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=ri(0,i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
const cr=c=>c<52?3+Math.floor(c/4):c===52?16:17;
function deal(e){const deck=shuffle(Array.from({length:54},(_,i)=>i));e.hands=[deck.slice(0,17),deck.slice(17,34),deck.slice(34,51)];e.bottom=deck.slice(51);e.phase='bid';e.bids=[];e.bidHigh=0;e.landlord=-1;e.turn=0;e.last=null;e.passes=0;}
function classify(cards){const ranks=cards.map(cr).sort((a,b)=>a-b),n=ranks.length,count={};for(const r of ranks)count[r]=(count[r]||0)+1;const groups=Object.entries(count).map(([r,n])=>({r:+r,n}));const of=k=>groups.filter(g=>g.n===k).map(g=>g.r).sort((a,b)=>a-b);const seq=a=>a.length>0&&a.at(-1)<15&&a.every((r,i)=>i===0||r===a[i-1]+1);let type,high;
 if(n===2&&ranks[0]===16&&ranks[1]===17)return {type:'rocket',high:99,n};
 if(groups.length===1){type=['','single','pair','triple','bomb'][n];high=ranks[0];}
 else if(n===4&&of(3).length===1){type='triple-single';high=of(3)[0];}
 else if(n===5&&of(3).length===1&&of(2).length===1){type='triple-pair';high=of(3)[0];}
 else if(n>=5&&groups.length===n&&seq(ranks)){type='straight';high=ranks.at(-1);}
 else if(n>=6&&n%2===0&&of(2).length===n/2&&seq(of(2))){type='pair-straight';high=of(2).at(-1);}
 else if(n===6&&of(4).length===1){type='four-singles';high=of(4)[0];}
 else if(n===8&&of(4).length===1&&of(2).length===2){type='four-pairs';high=of(4)[0];}
 else {const triples=groups.filter(g=>g.n>=3&&g.r<15).map(g=>g.r).sort((a,b)=>a-b);for(let len=triples.length;len>=2&&!type;len--)for(let start=0;start+len<=triples.length&&!type;start++){const a=triples.slice(start,start+len);if(!seq(a))continue;const rest={...count};for(const r of a)rest[r]-=3;const nums=Object.values(rest).filter(Boolean);if(n===len*3){type='airplane';high=a.at(-1);}else if(n===len*4&&nums.reduce((a,b)=>a+b,0)===len){type='airplane-single';high=a.at(-1);}else if(n===len*5&&nums.length===len&&nums.every(v=>v===2)){type='airplane-pair';high=a.at(-1);}}}
 return type?{type,high,n}:null;
}
function beats(a,b){return a&&(!b||a.type==='rocket'||a.type==='bomb'&&b.type!=='bomb'&&b.type!=='rocket'||a.type===b.type&&a.n===b.n&&a.high>b.high);}
function landlord(e,seat,a){
 if(e.phase==='bid'){const bid=Number(a.bid);check(Number.isInteger(bid)&&bid>=0&&bid<=3&&(bid===0||bid>e.bidHigh),'叫分需高于当前叫分，或不叫');e.bids.push({seat,bid});if(bid>e.bidHigh){e.bidHigh=bid;e.landlord=seat;}if(bid===3||e.bids.length===3){if(e.landlord<0){deal(e);log(e,'三家不叫，重新发牌');return;}e.phase='play';e.turn=e.landlord;e.hands[e.landlord].push(...e.bottom);log(e,`${e.landlord+1}号成为地主`);}else e.turn=(seat+1)%3;return;}
 const cards=a.cards||[];check(Array.isArray(cards)&&new Set(cards).size===cards.length,'出牌无效');if(!cards.length){check(e.last&&e.last.seat!==seat,'首家必须出牌');e.passes++;if(e.passes===2){e.turn=e.last.seat;e.last=null;e.passes=0;return;}e.turn=(seat+1)%3;return;}
 check(cards.every(c=>e.hands[seat].includes(c)),'只能出自己的牌');const c=classify(cards);check(beats(c,e.last?.shape),'牌型错误或没有压过上家');e.hands[seat]=e.hands[seat].filter(v=>!cards.includes(v));e.last={seat,cards,shape:c};e.passes=0;log(e,`${seat+1}号出牌：${c.type}`);if(!e.hands[seat].length){win(e,seat,seat===e.landlord?'地主获胜':'农民获胜');e.winningTeam=seat===e.landlord?[seat]:[0,1,2].filter(i=>i!==e.landlord);return;}e.turn=(seat+1)%3;
}
/* ---- 斗地主 AI v2：手数评估 + 队友协防 + 关键牌控制 ----
   目标：不再"有牌就出最小的"，而是尽量把手牌减少到「一手能走完」；
   农民不压自己队友；对手剩牌很少时不惜用炸。 */
function llGen(hand){
 const g={};for(const c of hand)(g[cr(c)]??=[]).push(c);
 const ranks=Object.keys(g).map(Number).sort((a,b)=>a-b);
 const out=[];
 const push=cs=>{const s=classify(cs);if(s)out.push({cards:cs,shape:s});};
 for(const r of ranks){const cs=g[r];
  push([cs[0]]);
  if(cs.length>=2)push(cs.slice(0,2));
  if(cs.length>=3){push(cs.slice(0,3));
   for(const r2 of ranks)if(r2!==r){const d=g[r2];push([...cs.slice(0,3),d[0]]);if(d.length>=2)push([...cs.slice(0,3),...d.slice(0,2)]);}
  }
  if(cs.length>=4)push(cs.slice(0,4));
 }
 if(g[16]&&g[17])push([g[16][0],g[17][0]]);
 for(let len=5;len<=12;len++)for(let s=3;s+len-1<=14;s++){let ok=true;const cs=[];for(let r=s;r<s+len;r++){if(!g[r]){ok=false;break;}cs.push(g[r][0]);}if(ok)push(cs);}
 for(let len=3;len<=10;len++)for(let s=3;s+len-1<=14;s++){let ok=true;const cs=[];for(let r=s;r<s+len;r++){if(!g[r]||g[r].length<2){ok=false;break;}cs.push(g[r][0],g[r][1]);}if(ok)push(cs);}
 return out;
}
/* 估算手牌还要几手出完：贪心拆顺子，其余按组算 */
function llHands(cards){
 const cnt={};for(const c of cards){const r=cr(c);cnt[r]=(cnt[r]||0)+1;}
 let hands=0;
 for(let len=12;len>=5;len--)for(let s=3;s+len-1<=14;s++){
  let ok=true;for(let r=s;r<s+len;r++)if(!cnt[r]){ok=false;break;}
  if(ok){for(let r=s;r<s+len;r++){cnt[r]--;if(cnt[r]<=0)delete cnt[r];}hands++;}
 }
 for(const r in cnt)hands+=1;
 return Math.max(1,hands);
}
function llBid(hand){
 const g={};for(const c of hand)(g[cr(c)]??=[]).push(c);
 let s=0;
 if(g[16])s+=3;if(g[17])s+=4;
 if(g[15])s+=g[15].length*2;
 if(g[14])s+=g[14].length;
 for(const r in g)if(g[r].length>=4)s+=4;
 return s>=10?3:s>=7?2:s>=4?1:0;
}
function aiLandlord(e,seat){
 const hand=e.hands[seat];
 const isLord=seat===e.landlord;
 if(e.phase==='bid'){
  const want=llBid(hand);
  return {bid:want>e.bidHigh?want:0};
 }
 const valid=llGen(hand).filter(x=>beats(x.shape,e.last?.shape));
 /* 能一把走完就走完 */
 const finish=valid.find(x=>x.cards.length===hand.length);
 if(finish)return {cards:finish.cards};
 const isLead=!e.last||e.last.seat===seat;
 if(isLead){
  if(!valid.length)return {cards:[hand[0]]};
  let best=valid[0],bestScore=Infinity;
  for(const x of valid){
   const rem=hand.filter(c=>!x.cards.includes(c));
   const bombPenalty=(x.shape.type==='bomb'||x.shape.type==='rocket')?9:0;
   const sc=llHands(rem)*100-x.cards.length*3.5+(x.shape.high||0)*.5+bombPenalty;
   if(sc<bestScore){bestScore=sc;best=x;}
  }
  return {cards:best.cards};
 }
 if(!valid.length)return {cards:[]};
 /* 农民不给队友盖牌 */
 if(!isLord&&e.last.seat!==e.landlord)return {cards:[]};
 const opponents=isLord?[0,1,2].filter(i=>i!==seat):[e.landlord];
 const oppMin=Math.min(...opponents.map(i=>e.hands[i].length));
 const plain=valid.filter(x=>x.shape.type!=='bomb'&&x.shape.type!=='rocket');
 const pool=plain.length?plain:valid;
 pool.sort((a,b)=>(a.shape.high-b.shape.high)||(a.cards.length-b.cards.length));
 /* 对手快走完：有炸也必须上；否则用最便宜的牌型跟 */
 if(oppMin<=2&&!plain.length)return {cards:valid[0].cards};
 return {cards:pool[0].cards};
}

/* ---- 五子棋 AI v2：棋型评分 + 活四/冲四威胁 + 两步前瞻 ----
   单核服务器上必须够快：候选点限制在已有棋子周围 2 格，前瞻只看前 6 个候选。 */
const G_DIRS=[[1,0],[0,1],[1,1],[1,-1]];
function gScoreAt(b,i,who){
 const x=i%15,y=(i/15)|0;let s=0;
 for(const[dx,dy]of G_DIRS){
  let f=0,blocks=0;
  for(const sign of[1,-1]){
   for(let k=1;k<=4;k++){
    const xx=x+dx*k*sign,yy=y+dy*k*sign;
    if(xx<0||xx>=15||yy<0||yy>=15){blocks++;break;}
    const v=b[yy*15+xx];
    if(v===who){f++;continue;}
    if(v===0)break;
    blocks++;break;
   }
  }
  const n=f+1,open=2-blocks;
  if(n>=5)s+=2000000;
  else if(n===4)s+=open===2?160000:open===1?16000:0;
  else if(n===3)s+=open===2?6000:open===1?700:0;
  else if(n===2)s+=open===2?400:open===1?60:0;
  else s+=open===2?25:6;
 }
 return s;
}
function gCands(b){
 const set=new Set();
 for(let i=0;i<225;i++)if(b[i]){
  const x=i%15,y=(i/15)|0;
  for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
   const xx=x+dx,yy=y+dy;
   if(xx>=0&&xx<15&&yy>=0&&yy<15&&!b[yy*15+xx])set.add(yy*15+xx);
  }
 }
 if(!set.size)set.add(112);
 return [...set];
}
function aiGomoku(b,seat){
 const me=seat+1,opp=2-seat;
 const cands=gCands(b);
 const list=cands.map(i=>({i,atk:gScoreAt(b,i,me),def:gScoreAt(b,i,opp)}));
 const win=list.find(x=>x.atk>=2000000);if(win)return win.i;
 const block=list.find(x=>x.def>=2000000);if(block)return block.i;
 const four=list.find(x=>x.atk>=160000);if(four)return four.i;
 const b4=list.find(x=>x.def>=160000);if(b4)return b4.i;
 list.sort((a,b)=>(b.atk*1.03+b.def*.97)-(a.atk*1.03+a.def*.97));
 let best=list[0],bestVal=-Infinity;
 for(const c of list.slice(0,6)){
  const b2=b.slice();b2[c.i]=me;
  let oppBest=0;
  for(const d of gCands(b2)){const v=gScoreAt(b2,d,opp);if(v>oppBest)oppBest=v;}
  const val=c.atk*1.03+c.def*.92-oppBest*.88;
  if(val>bestVal){bestVal=val;best=c;}
 }
 return best.i;
}
function aiBoard(e){const seat=e.turn;if(e.kind==='gomoku')return {index:aiGomoku(e.board,seat)};
 let moves=[];const w=e.kind==='xiangqi'?90:63;for(let f=0;f<w;f++)for(let t=0;t<w;t++){const legal=e.kind==='xiangqi'?xqLegal(e.board,f,t,seat):jungleLegal(e.board,f,t,seat);if(legal){const captured=e.board[t];const v=e.kind==='xiangqi'?({k:10000,r:90,c:45,n:40,b:20,a:20,p:10}[captured?.t]||0):(captured?.r||0)*10;moves.push({from:f,to:t,value:v+rnd(0,8)});}}moves.sort((a,b)=>b.value-a.value);return moves[0];
}
function party(e,seat,a,host){check(host||a.kind==='dice','只有房主可以操作公共局面');if(a.kind==='dice'){const n=Number(a.n);check(Number.isInteger(n)&&n>=1&&n<=6,'骰子数量为 1–6');e.dice=Array.from({length:n},()=>ri(1,7));log(e,`${seat+1}号掷出 ${e.dice.join('、')}`);}if(a.kind==='wheel'){check(Array.isArray(a.options)&&a.options.length>=2&&a.options.length<=30,'转盘需要 2–30 个选项');e.wheel=a.options.map(v=>String(v).trim().slice(0,50));check(e.wheel.every(Boolean),'选项不能为空');e.choice=e.wheel[ri(0,e.wheel.length)];log(e,'转盘结果：'+e.choice);}if(a.kind==='truth'){const questions=a.questions?.length?a.questions:['最近让你开心的一件小事？','分享一个小时候的趣事。','夸一夸左边的朋友。','用三个词描述今天的自己。'];check(Array.isArray(questions)&&questions.length<=100,'题目格式不正确');e.question=String(questions[ri(0,questions.length)]).slice(0,200);log(e,'本轮题目：'+e.question);}if(a.kind==='flight-reset'){e.flight={planes:Array.from({length:4},()=>[-1,-1,-1,-1]),current:0,last:0,pending:false,winner:null};}
 if(a.kind==='flight'){const f=e.flight;check(f.winner===null,'本盘已结束，请新开一盘');check(!f.pending,'请先选择一架飞机');f.last=ri(1,7);f.pending=f.planes[f.current].some(p=>p<57&&(p>=0||f.last===6));log(e,`${f.current+1}号掷出 ${f.last}`);if(!f.pending)f.current=(f.current+1)%4;}
 if(a.kind==='flight-move'){const f=e.flight,i=f.current,k=Number(a.plane);check(f.pending&&Number.isInteger(k)&&k>=0&&k<4,'请先投骰并选择飞机');let p=f.planes[i][k];check(p<57&&(p>=0||f.last===6),'这架飞机暂时不能移动');let dest=p<0?0:p+f.last;if(dest>57)dest=114-dest;if(dest<50&&dest>0&&(dest+i*13)%4===i)dest=Math.min(50,dest+4);if(dest===16)dest=28;f.planes[i][k]=dest;if(dest<=51){const global=(dest+i*13)%52;for(let j=0;j<4;j++)if(j!==i)for(let n=0;n<4;n++)if(f.planes[j][n]>=0&&f.planes[j][n]<=51&&(f.planes[j][n]+j*13)%52===global)f.planes[j][n]=-1;}f.pending=false;if(f.planes[i].every(p=>p===57)){f.winner=i;log(e,`${i+1}号四架飞机全部归航，获胜！`);}else if(f.last!==6)f.current=(i+1)%4;}
}

function actionEngine(e,seat,a,host=false){check(!e.over,'本局已经结束');if(e.kind==='fishmp'){const p=e.players[seat];check(p,'玩家不存在');p.ix=clamp(Number(a.x)||0,-1,1);p.iy=clamp(Number(a.y)||0,-1,1);return;}if(e.kind==='party'){party(e,seat,a,host);return;}check(e.turn===seat,'请等待你的回合');const fn={gomoku,xiangqi,jungle,landlord}[e.kind];check(fn,'当前玩法没有这项操作');fn(e,seat,a);}
function tickEngine(e,dt){if(e.over)return;if(e.kind==='fishmp')fishMPTick(e,dt);}
function publicEngine(e,viewer=-1){if(e.kind==='fishmp')return fishMPPublic(e);if(e.kind==='landlord'){const {hands,bottom,...rest}=e;return {...rest,counts:hands.map(h=>h.length),hand:viewer>=0?hands[viewer].slice().sort((a,b)=>cr(a)-cr(b)):[],bottom:e.phase==='bid'?[]:bottom};}return e;}
function aiStep(e){if(!e||e.over||e.turn<e.humans)return false;const fn={gomoku,xiangqi,jungle,landlord}[e.kind];if(!fn)return false;const bot=e.kind==='landlord'?aiLandlord(e,e.turn):aiBoard(e);if(!bot){win(e,0,'对方无合法走法');return true;}fn(e,e.turn,bot);return true;}
module.exports={createEngine,actionEngine,tickEngine,publicEngine,aiStep,classify,beats,xqLegal,jungleLegal,cr};
