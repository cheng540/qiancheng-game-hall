/* 千城游戏厅 · 音效引擎 v1
   自研微型合成器：全部音效由 WebAudio 实时合成，零音频素材、零外部依赖。
   设计要点（踩过的坑都在这）：
   1. AudioContext 必须在用户手势里创建/恢复，否则 iOS 微信里永远 suspended；
   2. 主增益串 DynamicsCompressor，多层音叠加不爆音；
   3. 首次解锁播 1 帧静音 buffer，部分浏览器只 resume() 不出声；
   4. 静音状态存 localStorage，键 qc_sfx，'0' 为静音。 */
(() => {
  'use strict';
  if (window.QCSFX) return;

  const KEY = 'qc_sfx';
  const read = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
  let enabled = read();
  let ctx = null, master = null, comp = null, noiseBuf = null, unlocked = false;

  function build() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return null; } }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 8;
    comp.attack.value = .003; comp.release.value = .22;
    master = ctx.createGain();
    master.gain.value = .5;
    master.connect(comp); comp.connect(ctx.destination);
    // 白噪声缓冲（打击/翻牌/洗牌用）
    const n = Math.floor(ctx.sampleRate * .5);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    const c = build();
    if (!c) return false;
    if (c.state === 'suspended') { try { c.resume(); } catch { } }
    if (!unlocked) {
      try {
        const b = c.createBuffer(1, 1, c.sampleRate);
        const s = c.createBufferSource(); s.buffer = b;
        s.connect(c.destination); s.start(0);
        unlocked = true;
      } catch { }
    }
    return c.state === 'running';
  }

  /* 单个振荡音：freq 起始频率，to 目标频率（滑音），dur 时长，type 波形，gain 音量，at 延迟 */
  function tone(freq, dur, { type = 'sine', gain = .2, to = 0, at = 0, cutoff = 0 } = {}) {
    const c = ctx; if (!c) return;
    const t0 = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(.012, dur * .3));
    g.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
    let node = o;
    if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
    node.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + .02);
  }

  function noise(dur, { gain = .2, at = 0, hp = 0, lp = 0, q = 1 } = {}) {
    const c = ctx; if (!c || !noiseBuf) return;
    const t0 = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 1;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
    let node = s;
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; f.Q.value = q; node.connect(f); node = f; }
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = q; node.connect(f); node = f; }
    node.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + .02);
  }

  const N = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568 };

  const LIB = {
    /* 交互 */
    tap:      () => tone(620, .05, { type: 'triangle', gain: .13, to: 720 }),
    click:    () => { tone(880, .05, { type: 'square', gain: .06 }); tone(1320, .04, { type: 'sine', gain: .05, at: .02 }); },
    back:     () => tone(520, .12, { type: 'triangle', gain: .12, to: 320 }),
    error:    () => { tone(150, .16, { type: 'square', gain: .1, to: 110 }); noise(.08, { gain: .05, lp: 900 }); },
    notif:    () => { tone(N.E5, .1, { type: 'sine', gain: .13 }); tone(N.A5, .14, { type: 'sine', gain: .11, at: .1 }); },
    toggle:   () => tone(1000, .04, { type: 'sine', gain: .1, to: 1300 }),

    /* 金币/奖励 */
    coin:     () => { tone(N.C6, .07, { type: 'square', gain: .09 }); tone(N.G6, .12, { type: 'square', gain: .08, at: .06 }); },
    coinBig:  () => { [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, .12, { type: 'triangle', gain: .1, at: i * .055 })); },
    levelup:  () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, .18, { type: 'triangle', gain: .12, at: i * .075 })); noise(.2, { gain: .04, hp: 3000, at: .28 }); },
    reward:   () => { tone(N.A4, .1, { type: 'sine', gain: .12 }); tone(N.C5, .1, { type: 'sine', gain: .12, at: .08 }); tone(N.E5, .22, { type: 'sine', gain: .12, at: .16 }); },

    /* 胜负 */
    win:      () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, .3, { type: 'triangle', gain: .14, at: i * .1 })); [N.C6, N.E6, N.G6].forEach((f, i) => tone(f, .45, { type: 'sine', gain: .07, at: .4 + i * .01 })); },
    lose:     () => { [N.G4, N.E4, N.D4, N.C4].forEach((f, i) => tone(f, .28, { type: 'triangle', gain: .12, at: i * .13 })); },
    draw:     () => { tone(N.E4, .18, { type: 'sine', gain: .1 }); tone(N.C4, .24, { type: 'sine', gain: .1, at: .14 }); },

    /* 棋牌 */
    deal:     () => { for (let i = 0; i < 5; i++) noise(.05, { gain: .09, hp: 1800, at: i * .045 }); },
    flip:     () => { noise(.04, { gain: .1, hp: 2400 }); tone(1200, .04, { type: 'sine', gain: .05, to: 1800 }); },
    place:    () => { tone(220, .07, { type: 'sine', gain: .14, to: 170 }); noise(.04, { gain: .06, lp: 1600 }); },
    select:   () => tone(760, .04, { type: 'sine', gain: .09 }),
    push:     () => tone(560, .05, { type: 'square', gain: .07, to: 480 }),

    /* 消消乐 */
    match:    (n = 0) => {
      const f = N.C5 * Math.pow(2, Math.min(12, n) / 12);
      tone(f, .12, { type: 'triangle', gain: .13, to: f * 1.5 });
      tone(f * 2, .1, { type: 'sine', gain: .06, at: .02 });
    },
    special:  () => { tone(180, .3, { type: 'sawtooth', gain: .08, to: 900 }); noise(.28, { gain: .09, hp: 900 }); },
    cascade:  (n = 1) => { tone(N.G5 * Math.pow(2, Math.min(10, n) / 12), .16, { type: 'sine', gain: .1, to: N.C6 }); },

    /* 聚会 */
    dice:     () => { for (let i = 0; i < 6; i++) noise(.05, { gain: .08, hp: 900 + i * 260, at: i * .05 }); },
    spin:     () => { tone(300, .5, { type: 'sawtooth', gain: .05, to: 1200, cutoff: 2400 }); noise(.5, { gain: .04, hp: 1200 }); },
    reveal:   () => { noise(.12, { gain: .07, hp: 2000 }); tone(N.E5, .2, { type: 'sine', gain: .12, at: .08 }); },
    heart:    () => tone(N.C5, .12, { type: 'sine', gain: .1, to: N.E5 }),
    eat:      () => { tone(420, .07, { type: 'sine', gain: .1, to: 720 }); noise(.03, { gain: .05, hp: 2500 }); },
    hurt:     () => { tone(320, .18, { type: 'sawtooth', gain: .1, to: 120 }); noise(.14, { gain: .07, lp: 1200 }); },
    splash:   () => noise(.18, { gain: .08, hp: 600, lp: 4000 }),

    /* ---- 牌桌（斗地主）：洗牌 / 发牌 / 出牌 / 不出 / 炸弹 / 王炸 ---- */
    shuffle:  () => { for (let i = 0; i < 9; i++) noise(.055, { gain: .055 + Math.random() * .03, hp: 1500 + Math.random() * 2200, at: i * .052 }); },
    cardDeal: () => { for (let i = 0; i < 4; i++) noise(.045, { gain: .05, hp: 2200, lp: 7000, at: i * .055 }); },
    cardFlip: () => { noise(.04, { gain: .075, hp: 2600, lp: 9000 }); tone(1400, .035, { type: 'sine', gain: .035, to: 2100 }); },
    cardPlay: () => { noise(.09, { gain: .11, hp: 700, lp: 5200, q: 1.2 }); tone(260, .09, { type: 'triangle', gain: .1, to: 180 }); },
    cardPass: () => { tone(300, .09, { type: 'sine', gain: .08, to: 210 }); tone(240, .11, { type: 'sine', gain: .06, to: 180, at: .1 }); },
    bid:      (n = 1) => { tone(360 + n * 120, .12, { type: 'triangle', gain: .13, to: 300 + n * 120 }); },
    bomb:     () => { tone(120, .5, { type: 'sine', gain: .26, to: 40 }); noise(.45, { gain: .16, lp: 1400, q: .6 }); tone(300, .3, { type: 'sawtooth', gain: .08, to: 70, cutoff: 900 }); },
    rocket:   () => { tone(180, .35, { type: 'sawtooth', gain: .09, to: 1600, cutoff: 3000 }); tone(110, .7, { type: 'sine', gain: .26, to: 34, at: .3 }); noise(.6, { gain: .14, lp: 1600, at: .28 }); },
    crown:    () => { [523, 622, 784, 1046].forEach((f, i) => tone(f, .2, { type: 'triangle', gain: .12, at: i * .08 })); noise(.16, { gain: .05, hp: 3200, at: .3 }); },
    cardWin:  () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i > 2 ? .32 : .14, { type: 'triangle', gain: .15, at: i * .11 })); },
    cardLose: () => { [392, 330, 262, 196].forEach((f, i) => tone(f, .3, { type: 'triangle', gain: .12, at: i * .15 })); },

    /* ---- 消消乐专属 ---- */
    m3Swap:   () => { noise(.06, { gain: .05, hp: 1200, lp: 6000 }); tone(680, .06, { type: 'sine', gain: .05, to: 980 }); },
    m3Invalid:() => { tone(180, .12, { type: 'square', gain: .07, to: 130 }); },
    m3Star:   () => { [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, .22, { type: 'sine', gain: .1, at: i * .07 })); },
    m3Drop:   () => { tone(240, .06, { type: 'sine', gain: .06, to: 180 }); }
  };

  const cache = Object.create(null);

  function play(name, arg) {
    if (!enabled) return;
    if (!ctx) return;              // 未解锁前静默（首次手势会解锁）
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch { } }
    const fn = LIB[name] || LIB.tap;
    try { fn(arg); } catch { }
  }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { }
    if (enabled) unlock();
    return enabled;
  }

  /* 首次任意手势解锁：捕获阶段，保证早于业务逻辑 */
  const gesture = () => { if (unlock()) { window.removeEventListener('pointerdown', gesture, true); window.removeEventListener('touchstart', gesture, true); window.removeEventListener('keydown', gesture, true); } };
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('touchstart', gesture, true);
  window.addEventListener('keydown', gesture, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) unlock(); });

  window.QCSFX = {
    play,
    unlock,
    get enabled() { return enabled; },
    set enabled(v) { setEnabled(v); },
    toggle() { return setEnabled(!enabled); },
    get ready() { return !!(ctx && ctx.state === 'running'); }
  };

  /* 全局兜底：任何 .qc-btn / [data-tool] / [data-tab] / [data-section] 点击自动出音
     业务代码可以用 data-sfx="名称" 指定，或 data-sfx="none" 关掉 */
  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-sfx], .qc-btn, .qc-tooltab, [data-tool], [data-tab], [data-section], .qc-arcadeCard, .qc-tile');
    if (!el) return;
    const v = el.getAttribute('data-sfx');
    if (v === 'none') return;
    play(v || 'tap');
  }, true);
})();
