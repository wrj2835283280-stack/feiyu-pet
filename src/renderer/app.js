'use strict';
/* 饭饭 · 大肥鱼桌宠  renderer */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const BOND_KEY = 'feiyu.bond.v1';
const TIER_NAMES = ['饿了', '日常', '吃饱了', '鲸王'];
const TIER_HINTS = {
  0: 'token 不够，饿得端碗了…',
  1: '日常形态，摇摇尾巴。',
  2: '吃饱了，肚子圆滚滚。',
  3: '金币也是饭，鲸王形态。'
};
const SPRITE = {
  hungry: '../../assets/sprites/hungry.png',
  daily: '../../assets/sprites/daily.png',
  full: '../../assets/sprites/full.png',
  token: '../../assets/sprites/token.png',
  neutral: '../../assets/sprites/neutral.png',
  coins: '../../assets/sprites/coins.png',
  sad: '../../assets/sprites/sad.png'
};
const STICKER = (n) => `../../assets/stickers/cut/${n}.png`;
const CARD = (n) => `../../assets/cards/${String(n).endsWith('.jpg') ? n : n + '.jpg'}`;

const S = {
  cfg: null,
  data: null,
  preview: '',
  previewDone: false,
  demoLock: false,
  greeted: false,
  tier: 1,
  forceTier: null,
  form: '',
  baseMood: 70,
  localMood: 0,
  mood: 70,
  bond: 60,
  lastFresh: null,
  lowBondWarnAt: 0,
  lastBaseMood: null,
  qqOnline: null,
  bubbleShowing: false,
  bubbleQueue: [],
  bubbleTimer: null,
  typeTimer: null,
  bubbleKind: '',
  emoteTimer: null,
  cardTimer: null,
  cardOpen: false,
  stickersEnabled: false,
  settingsOpen: false,
  menuOpen: false,
  statsOpen: false,
  dragging: false,
  pointer: null,
  moved: false,
  lastTap: 0,
  tapTimer: null,
  lastInteraction: Date.now(),
  readyAt: 0,
  patCount: 0,
  patAt: 0,
  lastTokenSay: 0,
  lastIdleSay: 0,
  lastMoodSay: 0,
  lastQQText: '',
  lastQQAt: 0,
  seenMediaAt: 0,
  audio: null,
  ignore: true,
  mouse: { x: -1, y: -1 },
  raf: null,
  fx: [],
  fxW: 0,
  fxH: 0,
  fxDpr: 1,
  lastFrame: 0,
  ambientAt: 0,
  sleepCardShown: false,
  soundPreview: false,
  instant: false
};

const els = {};
function cacheEls() {
  [
    'app', 'pet-stage', 'pet-img', 'pet-img-b', 'pet-look', 'pet-bob', 'pet-react',
    'blush', 'bowl-prop', 'crown', 'pet-name', 'bubble', 'bubble-avatar', 'bubble-name',
    'bubble-badge', 'bubble-time', 'bubble-text', 'bubble-close', 'emote-card', 'emote-img',
    'stats', 'stat-qq', 'stat-dsh', 'stat-total', 'stat-cache', 'stat-mood', 'stat-qqtime',
    'hud', 'hud-token', 'hud-goal', 'hud-fill', 'hud-tier', 'mood-face', 'mood-num', 'hud-gear', 'hud-bond', 'hud-bond-num',
    'stat-joy', 'stat-bond',
    'status-chip', 'status-text', 'menu', 'pin-mark', 'auto-mark', 'settings', 'set-close',
    'set-scale', 'scale-val', 'set-pin', 'set-sound', 'set-voice', 'set-token', 'set-goal',
    'set-token-fill', 'set-goal-range', 'goal-val', 'set-watchqq', 'set-watchgroup',
    'path-bridge', 'path-mood', 'btn-reset-pos', 'btn-open-data', 'btn-open-bridge', 'btn-quit',
    'version-line', 'card-layer', 'big-card-img', 'big-card-caption', 'toast', 'debug',
    'fx', 'fx-wrap', 'aura', 'rays'
  ].forEach(id => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id); });
  els.statQQ = $('stat-qq');
  els.statQQTime = $('stat-qqtime');
}

async function init() {
  cacheEls();
  loadBond();
  if (!window.petAPI) {
    document.body.textContent = '桌宠启动失败：preload 没加载。';
    return;
  }
  const boot = await window.petAPI.ready();
  S.cfg = boot.config || {};
  S.preview = boot.preview || '';
  S.readyAt = Date.now() + 1600;
  S.version = boot.version || '1.0.0';
  window.petAPI.log('renderer init', { preview: S.preview, cfg: S.cfg });
  applyConfig(S.cfg, true);
  bindUI();
  window.petAPI.onData(onData);
  window.petAPI.onConfig((c) => applyConfig(c, false));
  window.petAPI.onAction((act) => {
    if (act === 'pat') doPat();
    else if (act === 'feed') doFeed();
    else if (act === 'settings') openSettings();
  });
  initFX();
  updateMoodFace(70);
  setForm('daily', true);
  scheduleBlink(3200);
  scheduleTokenBeg(22000);
  applyTier(1, { silent: true });
  if (!S.cfg.watchQQ) els.statusChip.classList.add('hidden');
  setBubbleName('饭饭', '');
  setTimeout(() => {
    if (!S.data) say('数据还在路上…先摸摸我也可以。', { duration: 5000 });
  }, 2800);
  setInterval(tickMoodDecay, 60000);
  setInterval(tickBond, 60000);
  setInterval(tickIdle, 20000);
  setInterval(tickAmbient, 2600);
  setInterval(pushHitmap, 260);
  setTimeout(pushHitmap, 100);
  els.petImg.addEventListener('load', reportPetRect);
  els.petImg.src = SPRITE.daily;
  requestAnimationFrame(reportPetRect);
}

/* ============================ config / ui ============================ */
function applyScaleLayout(scale) {
  const s = clamp(Number(scale) || 1, 0.3, 1.15);
  const hudW = Math.max(96, Math.round(322 * s));
  const hudH = Math.max(24, Math.round(46 * s));
  const font = Math.max(7, +(15 * s).toFixed(1));
  els.app.style.setProperty('--hud-w', hudW + 'px');
  els.app.style.setProperty('--hud-h', hudH + 'px');
  els.app.style.setProperty('--hud-font', font + 'px');
  els.app.style.setProperty('--emote-scale', String(Math.max(0.38, Math.min(1, s * 0.88))));
  els.app.style.setProperty('--bubble-scale', String(Math.max(0.55, Math.min(1, s))));
  els.app.dataset.size = s < 0.4 ? 'tiny' : s < 0.82 ? 'small' : 'normal';
  setTimeout(() => { reportPetRect(); positionEmoteCard(); }, 120);
}

function applyConfig(c, first) {
  if (!c) return;
  S.cfg = { ...(S.cfg || {}), ...c };
  els.app.style.setProperty('--pet-scale', String(S.cfg.scale || 1));
  applyScaleLayout(S.cfg.scale || 1);
  if (els.setScale) {
    els.setScale.value = String(Math.round((S.cfg.scale || 1) * 100));
    els.scaleVal.textContent = Math.round((S.cfg.scale || 1) * 100) + '%';
  }
  if (els.setPin) els.setPin.checked = !!S.cfg.alwaysOnTop;
  if (els.setSound) els.setSound.checked = !!S.cfg.sound;
  if (els.setVoice) els.setVoice.checked = !!S.cfg.voice;
  if (els.setWatchqq) els.setWatchqq.checked = !!S.cfg.watchQQ;
  if (els.setWatchgroup) els.setWatchgroup.checked = !!S.cfg.watchGroup;
  if (els.setGoalRange) {
    els.setGoalRange.value = String(S.cfg.tokenGoalM || 4);
    els.goalVal.textContent = (Number(S.cfg.tokenGoalM) || 4).toFixed(1) + 'M';
  }
  if (els.pathBridge) els.pathBridge.textContent = S.cfg.bridgeDir || '--';
  if (els.pathMood) els.pathMood.textContent = S.cfg.moodStatePath || '--';
  if (els.versionLine) els.versionLine.textContent = `饭饭 v${S.version || '1.0.0'} · 本地运行，不联网`;
  els.statusChip.classList.toggle('hidden', !S.cfg.watchQQ);
  updatePinMarks();
  updateHudFromConfig();
  if (first) {
    els.petImg.src = SPRITE.daily;
  }
}

function updateHudFromConfig() {
  if (!S.data) return;
  renderHud();
}

function updatePinMarks() {
  if (els.pinMark) els.pinMark.style.opacity = S.cfg.alwaysOnTop ? '1' : '0';
}

function queueSave(patch) {
  Object.assign(S.cfg, patch);
  S.pendingPatch = { ...(S.pendingPatch || {}), ...patch };
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(async () => {
    const payload = S.pendingPatch;
    S.pendingPatch = null;
    try {
      const next = await window.petAPI.setConfig(payload || patch);
      if (next) S.cfg = { ...S.cfg, ...next };
    } catch (e) { window.petAPI.log('save cfg failed', String(e)); }
  }, 260);
}

function bindUI() {
  els.petStage.addEventListener('pointerdown', onPetPointerDown);
  els.petStage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });
  els.bubbleClose.addEventListener('click', (e) => { e.stopPropagation(); hideBubble(true); });
  els.bubble.addEventListener('click', () => hideBubble(true));
  els.emoteCard.addEventListener('click', hideEmote);
  els.hud.addEventListener('click', (e) => {
    if (e.target.closest('#hud-gear')) return;
    toggleStats();
  });
  els.hudGear.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  els.statusChip.addEventListener('click', () => openSettings());
  els.setClose.addEventListener('click', closeSettings);
  els.settings.addEventListener('mousedown', (e) => { if (e.target === els.settings) closeSettings(); });
  els.menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    menuAction(btn.dataset.act);
  });
  els.setScale.addEventListener('input', () => {
    const v = Number(els.setScale.value) / 100;
    els.scaleVal.textContent = Math.round(v * 100) + '%';
    els.app.style.setProperty('--pet-scale', String(v));
    applyScaleLayout(v);
    queueSave({ scale: v });
  });
  els.setGoalRange.addEventListener('input', () => {
    const v = Number(els.setGoalRange.value);
    els.goalVal.textContent = v.toFixed(1) + 'M';
    if (S.data) renderHud();
    queueSave({ tokenGoalM: v });
  });
  [
    ['setPin', 'alwaysOnTop'], ['setSound', 'sound'], ['setVoice', 'voice'],
    ['setWatchqq', 'watchQQ'], ['setWatchgroup', 'watchGroup']
  ].forEach(([id, key]) => {
    els[id].addEventListener('change', () => {
      const val = els[id].checked;
      queueSave({ [key]: val });
      if (key === 'watchQQ') els.statusChip.classList.toggle('hidden', !val);
      if (key === 'voice' && val) testVoice();
    });
  });
  $$('#settings .preview-row button').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preview;
      closeSettings();
      setTimeout(() => previewForm(p), 180);
    });
  });
  els.btnResetPos.addEventListener('click', () => {
    window.petAPI.resetPos();
    toast('回到右下角啦');
  });
  els.btnOpenData.addEventListener('click', async () => {
    const r = await window.petAPI.openDataDir();
    if (r && r.ok) toast(r.fallback ? '已打开数据目录（备用方式）' : '已打开数据目录');
    else toast('数据目录打不开：' + (r?.error || '未知错误'));
  });
  els.btnOpenBridge.addEventListener('click', async () => {
    const ok = await window.petAPI.openPath(S.cfg?.bridgeDir || '');
    if (!ok) toast('QQ 桥接目录打不开');
  });
  els.btnQuit.addEventListener('click', () => window.petAPI.quit());
  els.cardLayer.addEventListener('click', hideBigCard);
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('pointerup', (e) => { if (S.pointer) onPetPointerUp(e); });
  window.addEventListener('pointercancel', (e) => { if (S.pointer) onPetPointerUp(e); });
  document.addEventListener('mousedown', (e) => {
    if (S.menuOpen && !e.target.closest('#menu') && !e.target.closest('#pet-stage')) closeMenu();
    if (S.statsOpen && !e.target.closest('#stats') && !e.target.closest('#hud')) closeStats();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.settingsOpen) closeSettings();
      else if (S.menuOpen) closeMenu();
      else if (S.cardOpen) hideBigCard();
      else if (S.statsOpen) closeStats();
      else hideBubble(true);
    }
  });
}

/* ============================ input / drag ============================ */
function onPetPointerDown(e) {
  if (e.button !== 0) return;
  if (Date.now() < (S.readyAt || 0)) return;
  if (e.target.closest('button')) return;
  ensureAudio();
  S.pointer = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId };
  S.moved = false;
  S.dragging = false;
  S.lastInteraction = Date.now();
  try { els.petStage.setPointerCapture(e.pointerId); } catch { }
  els.petStage.addEventListener('pointermove', onPetPointerMove);
  els.petStage.addEventListener('pointerup', onPetPointerUp, { once: true });
  els.petStage.addEventListener('pointercancel', onPetPointerUp, { once: true });
}

function onPetPointerMove(e) {
  if (!S.pointer) return;
  const dx = e.clientX - S.pointer.sx;
  const dy = e.clientY - S.pointer.sy;
  if (!S.dragging && Math.hypot(dx, dy) > 5) {
    S.dragging = true;
    S.moved = true;
    els.petStage.classList.add('dragging');
    els.app.classList.add('dragging');
    hideBubble(true);
    hideEmote();
    S.fx.length = 0;
    const pr = els.petImg.getBoundingClientRect();
    window.petAPI.dragStart({ x: pr.left, y: pr.top, w: pr.width, h: pr.height });
  }
}

function onPetPointerUp(e) {
  const p = S.pointer;
  S.pointer = null;
  els.petStage.removeEventListener('pointermove', onPetPointerMove);
  if (!p) return;
  if (S.dragging) {
    S.dragging = false;
    els.petStage.classList.remove('dragging');
    els.app.classList.remove('dragging');
    window.petAPI.dragEnd();
    setTimeout(pushHitmap, 120);
    bumpMood(1);
    say(pick(['放我下来啦——', '要带我去哪儿？', '轻点轻点，要捏扁了。']), { duration: 4200 });
    spawnBurst('spark', 5, petPoint(0.5, 0.4));
    return;
  }
  // tap / double tap
  const now = Date.now();
  if (now - S.lastTap < 320) {
    clearTimeout(S.tapTimer);
    S.tapTimer = null;
    S.lastTap = 0;
    doFeed();
  } else {
    S.lastTap = now;
    S.tapTimer = setTimeout(() => {
      S.tapTimer = null;
      S.lastTap = 0;
      doPat();
    }, 260);
  }
}

function onMouseMove(e) {
  S.mouse = { x: e.clientX, y: e.clientY };
  if (S.settingsOpen || S.menuOpen || S.cardOpen || S.statsOpen) return;
  // look towards cursor
  if (!S.dragging) {
    const dx = clamp((e.clientX - 310) / 70, -5, 5);
    els.petLook.style.setProperty('--look-x', dx.toFixed(1) + 'px');
  }
}

function collectHitmap() {
  const full = !!(S.settingsOpen || S.menuOpen || S.cardOpen || S.statsOpen);
  const rects = [];
  if (!full) {
    for (const id of ['pet-react', 'bubble', 'emote-card', 'hud', 'status-chip']) {
      const el = $(id);
      if (!el || el.classList.contains('hidden')) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
  }
  return { full, rects };
}

function pushHitmap() {
  try { window.petAPI.setHitmap(collectHitmap()); } catch { }
}

function updateHitTest() { pushHitmap(); }

/* ============================ data ============================ */
function onData(snap) {
  if (!snap) return;
  const first = !S.data;
  const fresh = Number(snap.tokens?.fresh) || 0;
  if (S.lastFresh == null) S.lastFresh = fresh;
  else if (fresh > S.lastFresh + 1) {
    const delta = fresh - S.lastFresh;
    S.lastFresh = fresh;
    touchBond(Math.min(8, 0.6 + Math.log10(delta + 1) * 1.2), { silent: true });
  } else {
    S.lastFresh = fresh;
  }
  S.data = snap;
  S.qqOnline = snap.qq?.online ?? null;
  const locked = !!S.demoLock;

  if (!locked) {
    const prevBase = S.lastBaseMood;
    S.tier = snap.tokens?.tier ?? 1;
    S.baseMood = snap.mood?.value ?? 70;
    S.lastBaseMood = S.baseMood;
    if (first) {
      recomputeMood(true);
      applyTier(S.tier, { silent: true });
      renderHud();
      renderQQStatus();
      if (!S.preview) setTimeout(greetOnce, 900);
    } else {
      if (prevBase != null && Math.abs(S.baseMood - prevBase) >= 5 && Date.now() - S.lastMoodSay > 30000) {
        S.lastMoodSay = Date.now();
        const d = S.baseMood - prevBase;
        setTimeout(() => {
          say(d > 0 ? `师父，我心情好一点了（${S.baseMood}）。` : `师父…我有点低落（${S.baseMood}）。`,
            { duration: 5200 });
        }, 800);
      }
      recomputeMood(false);
      applyTier(S.tier, { silent: false });
    }
  }
  renderHud();
  renderQQStatus();
  if (!S.previewDone && S.preview) {
    S.previewDone = true;
    setTimeout(applyPreview, 300);
  }
  const evs = (snap.events || []).filter(ev => S.cfg?.watchQQ || !String(ev?.type || '').startsWith('qq'));
  processEvents(evs);
  if (S.settingsOpen) syncSettingsStats();
}

function renderHud() {
  if (!S.data) return;
  const t = S.data.tokens;
  const goalM = Number(S.cfg?.tokenGoalM) || 4;
  const pct = clamp((t.fresh || 0) / (goalM * 1e6), 0, 1);
  els.hudToken.textContent = formatTokens(t.fresh || 0);
  els.hudGoal.textContent = '/ ' + goalM.toFixed(1) + 'M';
  els.hudFill.style.width = (pct * 100).toFixed(1) + '%';
  const tier = S.forceTier != null ? S.forceTier : t.tier;
  els.hudTier.textContent = TIER_NAMES[tier] || '日常';
  els.hudTier.title = TIER_HINTS[tier] || '';
  els.hud.title = `今日 ${formatTokens(t.fresh || 0)} token（QQ ${formatTokens(t.qqFresh || 0)} + 本场 ${formatTokens(t.dshFresh || 0)}）\n含缓存总量 ${formatTokens(t.total || 0)}\n开心值 ${S.mood} · 互动值 ${Math.round(S.bond)}`;
  const mood = S.mood;
  els.moodNum.textContent = String(mood);
  els.moodNum.title = '开心值';
  if (els.hudBondNum) els.hudBondNum.textContent = String(Math.round(S.bond));
  if (els.statJoy) els.statJoy.textContent = String(mood);
  if (els.statBond) els.statBond.textContent = String(Math.round(S.bond));
  updateMoodFace(mood);
  // settings panel
  if (els.setToken) {
    els.setToken.textContent = formatTokens(t.fresh || 0);
    els.setGoal.textContent = goalM.toFixed(1) + 'M';
    els.setTokenFill.style.width = (pct * 100).toFixed(1) + '%';
  }
  syncSettingsStats();
}

function syncSettingsStats() {
  if (!S.data || !els.stats) return;
  const t = S.data.tokens;
  els.statQQ.textContent = formatTokens(t.qqFresh || 0);
  els.statDsh.textContent = formatTokens(t.dshFresh || 0);
  els.statTotal.textContent = formatTokens(t.fresh || 0);
  els.statCache.textContent = formatTokens(t.total || 0);
  els.statJoy.textContent = String(S.mood);
  els.statBond.textContent = String(Math.round(S.bond));
  els.statMood.textContent = String(S.data.mood?.value ?? '--');
  const at = S.data.qq?.lastIncomingAt;
  els.statQQTime.textContent = at ? new Date(at).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '还没有';
}

function renderQQStatus() {
  if (!S.cfg?.watchQQ) { els.statusChip.classList.add('hidden'); return; }
  els.statusChip.classList.remove('hidden');
  const q = S.data?.qq || {};
  let state = 'loading', text = 'QQ 连接中';
  if (q.online === true) {
    if (q.ageMs > 180000) { state = 'idle'; text = 'QQ 安静'; }
    else { state = 'online'; text = 'QQ 在线'; }
  } else if (q.online === false) {
    state = 'offline'; text = 'QQ 离线';
  } else if (q.ok) {
    state = 'loading'; text = 'QQ 连接中';
  }
  els.statusChip.dataset.state = state;
  els.statusText.textContent = text;
  els.statusChip.title = `私聊 ${S.cfg.ownerQQ}；${q.online === true ? 'SnowLuma 已连接' : 'SnowLuma 未连接'}`;
}

function formatTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

/* ============================ mood / tier ============================ */
function loadBond() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(BOND_KEY) || 'null'); } catch { }
  const now = Date.now();
  let bond = Number(saved?.bond);
  if (!Number.isFinite(bond)) bond = 60;
  const last = Number(saved?.last);
  if (Number.isFinite(last) && last > 0 && last <= now) {
    const offlineHours = (now - last) / 3600000;
    bond -= Math.min(30, offlineHours * 2);
  }
  S.bond = clamp(bond, 0, 100);
  S.lastInteraction = now;
  saveBond();
}

function saveBond() {
  try { localStorage.setItem(BOND_KEY, JSON.stringify({ bond: S.bond, last: S.lastInteraction || Date.now() })); } catch { }
}

function touchBond(delta, { silent = false } = {}) {
  const prev = S.bond;
  S.bond = clamp(S.bond + delta, 0, 100);
  S.lastInteraction = Date.now();
  saveBond();
  recomputeMood(false);
  renderHud();
  if (prev < 30 && S.bond >= 30) {
    S.lowBondWarnAt = 0;
    if (!silent) say('互动值回来了…我开心一点了。', { duration: 3600 });
  }
}

function tickBond() {
  const idleMin = (Date.now() - S.lastInteraction) / 60000;
  if (idleMin >= 5 && S.bond > 0) {
    S.bond = clamp(S.bond - Math.min(1.2, 0.1 + idleMin / 300), 0, 100);
    saveBond();
    recomputeMood(false);
    renderHud();
  }
  if (S.bond >= 35) S.lowBondWarnAt = 0;
  if (S.bond < 30 && !S.settingsOpen && !S.dragging && Date.now() - S.lowBondWarnAt > 480000) {
    S.lowBondWarnAt = Date.now();
    say(pick(['哼…互动值好低，今天都不陪我。', '师父…再不理我，我要不开心了。', '互动值掉下去了…摸摸我嘛。']), { duration: 5200 });
    spawnBurst('rain', 10, petPoint(0.5, 0.45));
    react('tilt');
  }
}

function recomputeMood(first) {
  const prev = S.mood;
  const bondPenalty = S.bond < 30 ? (30 - S.bond) * 1.45 : 0;
  const bondBonus = S.bond >= 70 ? 4 : 0;
  S.mood = clamp(Math.round(S.baseMood + S.localMood - bondPenalty + bondBonus), 0, 100);
  els.app.dataset.mood = S.mood >= 82 ? 'happy' : S.mood >= 40 ? 'calm' : S.mood >= 28 ? 'low' : 'sad';
  updateMoodFace(S.mood);
  els.moodNum.textContent = String(S.mood);
  if (prev !== S.mood) renderHud();
}

function visualForm(forceTier = null) {
  const tier = forceTier != null ? forceTier : (S.forceTier != null ? S.forceTier : S.tier);
  if (tier <= 0) return 'hungry';
  if (tier === 1) return 'daily';
  if (tier === 2) return 'full';
  return 'full';
}

function setForm(form, silent) {
  if (!form || !SPRITE[form]) form = 'daily';
  const changed = S.form !== form;
  S.form = form;
  els.app.dataset.form = form;
  const src = SPRITE[form] || SPRITE.daily;
  if (els.petImg.getAttribute('src') !== src) els.petImg.src = src;
  els.bowlProp.classList.add('hidden');
  els.crown.classList.add('hidden');
  setTimeout(() => { reportPetRect(); positionEmoteCard(); }, 140);
  if (changed && !silent) {
    els.petReact.classList.remove('formpop');
    void els.petReact.offsetWidth;
    els.petReact.classList.add('formpop');
  }
}

function applyTier(tier, { silent = false, celebrate = false, forceCelebrate = false } = {}) {
  if (tier == null) return;
  const prev = S.tier;
  S.tier = tier;
  const shown = S.forceTier != null ? S.forceTier : tier;
  els.app.dataset.tier = String(shown);
  els.hudTier.textContent = TIER_NAMES[shown] || '日常';
  els.hudTier.title = TIER_HINTS[shown] || '';
  setForm(visualForm(shown), silent);
  if (!silent && (celebrate || forceCelebrate) && (prev !== tier || forceCelebrate)) {
    spawnBurst('spark', 18, petPoint(0.5, 0.35));
    if (tier >= 3) {
      spawnBurst('coin', 14, petPoint(0.5, 0.35));
      setTimeout(() => showEmote('full'), 700);
    } else if (tier === 2) {
      spawnBurst('rice', 12, petPoint(0.5, 0.6));
    }
    say(`吃到 ${formatTokens(S.data?.tokens?.fresh || 0)} token，我变成【${TIER_NAMES[tier]}】啦！`, {
      duration: 6500, speak: true
    });
    sfx('tier');
    bumpMood(2);
  }
  updatePinMarks();
}

function tickMoodDecay() {
  if (S.localMood !== 0) {
    S.localMood *= 0.94;
    if (Math.abs(S.localMood) < 0.5) S.localMood = 0;
    recomputeMood(false);
    renderHud();
  }
  // very slow baseline drift toward 65 if the file is stale
  if (S.data?.mood && !S.data.mood.updatedAt) {
    if (S.baseMood > 66) S.baseMood -= 1;
    else if (S.baseMood < 64) S.baseMood += 1;
    recomputeMood(false);
  }
}

function bumpMood(delta) {
  S.localMood = clamp(S.localMood + delta, -55, 45);
  recomputeMood(false);
  renderHud();
}

function updateMoodFace(v) {
  if (!els.moodFace) return;
  const color = v >= 85 ? '#5fe0a5' : v >= 65 ? '#7fc8ff' : v >= 45 ? '#ffd15c' : v >= 30 ? '#ffa06b' : '#ff8fa3';
  const mouth = v >= 82
    ? '<path d="M7 13.6c1.6 2.4 6.4 2.4 8 0" stroke="' + color + '" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
    : v >= 55
      ? '<path d="M7.6 14.4c1.3 1.1 4.5 1.1 5.8 0" stroke="' + color + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
      : v >= 34
        ? '<path d="M8 15h6" stroke="' + color + '" stroke-width="1.4" stroke-linecap="round"/>'
        : '<path d="M7.4 15.6c1.6-1.9 5.4-1.9 7 0" stroke="' + color + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>';
  const eyes = v < 34
    ? '<path d="M7 9.2l2.4 1.6M15.6 9.2L13.2 10.8" stroke="' + color + '" stroke-width="1.3" stroke-linecap="round"/>'
    : '<circle cx="8" cy="9.4" r="1.3" fill="' + color + '"/><circle cx="14.6" cy="9.4" r="1.3" fill="' + color + '"/>';
  els.moodFace.innerHTML = `<svg viewBox="0 0 22 22" width="22" height="22">
    <circle cx="11" cy="11" r="9.2" fill="rgba(255,255,255,.08)" stroke="rgba(160,215,255,.45)" stroke-width="1"/>
    ${eyes}${mouth}
  </svg>`;
}

/* ============================ events ============================ */
function processEvents(events) {
  for (const ev of events) {
    if (!ev) continue;
    if (S.demoLock) continue;
    if (ev.type === 'qq-in') handleQQIn(ev);
    else if (ev.type === 'qq-out') handleQQOut(ev);
    else if (ev.type === 'qq-poke') handleQQPoke(ev);
    else if (ev.type === 'qq-group') handleQQGroup(ev);
    else if (ev.type === 'token-up') handleTokenUp(ev);
    else if (ev.type === 'mood') { /* handled in onData */ }
    else if (ev.type === 'tier') applyTier(ev.tier, { celebrate: true, forceCelebrate: true });
  }
}

function handleTokenUp(ev) {
  if (!ev.delta || ev.delta < 400) return;
  const n = clamp(Math.round(ev.delta / 900), 1, 7);
  spawnBurst('rice', n, petPoint(rand(0.35, 0.65), rand(0.55, 0.75)));
  if (Date.now() - S.lastTokenSay > 55000 && ev.delta > 15000 && S.tier >= 1) {
    S.lastTokenSay = Date.now();
    if (!S.bubbleShowing) {
      say(pick([
        '又吃到 token 了，嗝。',
        '师父多聊一点，我就能多吃两口。',
        '白饭在锅里咕噜咕噜。',
        '这一口是缓存回锅饭，不算数。'
      ]), { duration: 4600 });
    }
  }
}

function handleQQIn(ev) {
  const text = cleanQQ(ev.text);
  if (!text) return;
  if (text === '[图片]' || text === '[表情]') {
    if (Date.now() - S.seenMediaAt < 3500) return;
    S.seenMediaAt = Date.now();
  }
  if (text === S.lastQQText && Date.now() - S.lastQQAt < 2500) return;
  S.lastQQText = text; S.lastQQAt = Date.now();
  sfx('qq');
  bumpMood(3);
  showBlush(1900);
  react('jump');
  spawnBurst('heart', 4, petPoint(0.5, 0.35));
  if (text === '[图片]' || text === '[表情]') {
    say('师父发来一张图！我看看…（歪头）', { kind: 'qq-in', sender: '师父', badge: 'QQ', duration: 5200, speak: false, preempt: true });
    return;
  }
  const line = text.length > 80 ? text.slice(0, 80) + '…' : text;
  say(line, { kind: 'qq-in', sender: ev.sender || '师父', badge: 'QQ', duration: Math.min(11000, 5200 + line.length * 65), speak: true, preempt: true });
  if (/白饭|吃饭|吃啥|吃什|投喂|token|饿了|喂/i.test(text)) {
    setTimeout(() => {
      spawnBurst('rice', 14, petPoint(0.5, 0.62));
      say(pick(['白饭！我最喜欢白饭了。', '啊呜——师父最好了！', '有白饭？那我可不客气了。']), { duration: 4800, speak: true });
      showEmote('rice');
      bumpMood(4);
    }, 1300);
  } else if (/想你|喜欢|可爱|乖|抱|亲|摸摸/i.test(text)) {
    setTimeout(() => {
      spawnBurst('heart', 12, petPoint(0.5, 0.34));
      showBlush(2600);
      showEmote('full');
      bumpMood(5);
      react('happy');
      say('唔…师父突然这么说，我会害羞的。', { duration: 5200, speak: true });
    }, 1400);
  } else if (/生气|滚|笨蛋|讨厌|不理|烦/i.test(text)) {
    bumpMood(-8);
    setTimeout(() => { showEmote('tsk'); react('shake'); }, 900);
  } else if (/在吗|在不在|你好|hi|hello|早上好|晚上好/i.test(text)) {
    setTimeout(() => { showEmote('full'); }, 700);
  }
}

function handleQQOut(ev) {
  const text = cleanQQ(ev.text);
  if (!text) return;
  if (text === S.lastQQText && Date.now() - S.lastQQAt < 2500) return;
  S.lastQQText = text; S.lastQQAt = Date.now();
  touchBond(1);
  bumpMood(1);
  const line = text.length > 90 ? text.slice(0, 90) + '…' : text;
  say(line, { kind: 'qq-out', sender: '我', badge: 'QQ', duration: Math.min(10000, 4800 + line.length * 50), speak: false, preempt: true });
}

function handleQQPoke(ev) {
  touchBond(1);
  bumpMood(-4);
  react('headshake');
  blink(320);
  spawnBurst('anger', 1, petPoint(0.6, 0.26));
  sfx('angry');
  say(pick(['别戳啦！', '再戳要咬你了。', '唔…干嘛戳我。']), { duration: 3600, preempt: true });
  showEmote('angry');
}

function handleQQGroup(ev) {
  const text = cleanQQ(ev.text);
  if (!text) return;
  touchBond(1);
  bumpMood(1);
  sfx('qq');
  const line = text.length > 60 ? text.slice(0, 60) + '…' : text;
  say(line, { kind: 'qq-in', sender: ev.sender || '群友', badge: '群', duration: 5600, preempt: true });
  if (/饭饭|大肥鱼|白饭/i.test(text)) showEmote('full');
}

/* ============================ interactions ============================ */
function doPat() {
  S.lastInteraction = Date.now();
  touchBond(2);
  S.patCount = (Date.now() - S.patAt < 12000) ? S.patCount + 1 : 1;
  S.patAt = Date.now();
  react('pat');
  bumpMood(3);
  showBlush(1800);
  spawnBurst('heart', 4, petPoint(0.5, 0.33));
  sfx('pat');
  const lines = [
    '唔…再摸一下也可以。', '师父手好暖。', '头发要乱啦。', '再摸要收费了哦。',
    '嘿嘿…被摸头了。', '咕噜咕噜…舒服。'
  ];
  say(pick(lines), { duration: 4300 });
  if (S.patCount >= 5) {
    S.patCount = 0;
    react('happy');
    showEmote('full');
    bumpMood(4);
    say('好啦好啦——再摸就要变成一滩鱼了。', { duration: 5200, speak: true });
    spawnBurst('heart', 12, petPoint(0.5, 0.35));
    return;
  }
  if (Math.random() < 0.32) setTimeout(() => showEmote('full'), 450);
}

function doFeed() {
  S.lastInteraction = Date.now();
  touchBond(3);
  react('feed');
  bumpMood(6);
  showBlush(2400);
  sfx('feed');
  spawnBurst('rice', 16, petPoint(0.5, 0.62));
  say(pick(['啊呜——', '白饭！白饭！', '再来一碗！', '唔…好香。']), { duration: 3800 });
  setTimeout(() => {
    showEmote('rice');
    say(pick(['嗝…吃饱饱。', '白饭最好了。', '摸摸肚子，圆了。']), { duration: 4600 });
    spawnBurst('steam', 5, petPoint(0.45, 0.72));
  }, 1300);
}

function doTalk() {
  S.lastInteraction = Date.now();
  touchBond(1);
  const t = S.data?.tokens || {};
  const tier = S.forceTier != null ? S.forceTier : (t.tier ?? 1);
  const pool = [
    ...(tier === 0 ? ['饿…token 不够，饭饭变小了。', '师父，给点白饭吧…', '我现在只有小小一只。'] : []),
    ...(tier === 1 ? ['今天也要好好吃白饭。', '师父在忙什么呀？', '鱼缸里的水是温的。'] : []),
    ...(tier === 2 ? ['嗝…吃得好饱。', '肚子圆圆的，不能怪我。', '再吃一口就一口。'] : []),
    ...(tier === 3 ? ['我有好多 token！分你一点？', '金币也是饭的一种。', '鲸王今天也很富有。'] : []),
    '摸鱼是正经事。', '水里有星星。', '咕噜咕噜…', '不要一直盯着屏幕，看看我。',
    '师父，你今天的白饭够吗？', '我可以在这里陪你很久。'
  ];
  say(pick(pool), { duration: 5200 });
  if (Math.random() < 0.4) showEmote(pick(['full', 'rice', 'milk']));
}

function doPoke() {
  S.lastInteraction = Date.now();
  touchBond(1);
  bumpMood(-4);
  react('headshake');
  blink(320);
  spawnBurst('anger', 1, petPoint(0.58, 0.26));
  sfx('angry');
  showEmote(pick(['tsk', 'angry']));
  say(pick(['别戳啦！', '再戳要咬你了。', '唔…干嘛戳我。', '呀——戳漏气了！']), { duration: 3600, speak: true });
}

function doDrink() {
  S.lastInteraction = Date.now();
  touchBond(3);
  bumpMood(4);
  react('happy');
  showBlush(2200);
  showEmote('milk');
  spawnBurst('note', 6, petPoint(0.5, 0.4));
  say(pick(['奶茶…甜甜的。', '第一口给师父，第二口给我。', '咕噜咕噜…珍珠好嚼。']), { duration: 5000, speak: true });
}

function doPraise() {
  S.lastInteraction = Date.now();
  touchBond(5);
  bumpMood(7);
  react('nod');
  showBlush(2600);
  showEmote('full');
  spawnBurst('heart', 12, petPoint(0.5, 0.35));
  sfx('tier');
  say(pick(['嘿嘿…师父嘴真甜。', '再夸一句，我尾巴都要摇断了。', '被夸了，今天能多吃一碗。']), { duration: 5200, speak: true });
}

function doSleep() {
  S.lastInteraction = Date.now();
  touchBond(1);
  showEmote('zero');
  react('tilt');
  blink(220);
  const prevForm = S.form;
  setForm('full', true);
  clearTimeout(S.sleepFormTimer);
  S.sleepFormTimer = setTimeout(() => { if (S.form === 'full') setForm(prevForm || visualForm(), true); }, 2600);
  spawnBurst('zzz', 10, petPoint(0.62, 0.2));
  bumpMood(-1);
  els.petStage.classList.add('sleepy');
  clearTimeout(S.sleepTimer);
  S.sleepTimer = setTimeout(() => els.petStage.classList.remove('sleepy'), 12000);
  say(pick(['困了…眯一会儿。', '呼…呼…', '别吵，我在梦里吃白饭。']), { duration: 5600 });
}

function react(name) {
  if (!els.petReact) return;
  els.petReact.classList.remove('pat', 'feed', 'jump', 'shake', 'happy', 'sadslump', 'headshake', 'nod', 'tilt');
  void els.petReact.offsetWidth;
  els.petReact.classList.add(name);
  const dur = name === 'feed' ? 2300 : name === 'happy' ? 1450 : name === 'jump' ? 730 : name === 'headshake' ? 720 : name === 'nod' ? 750 : name === 'tilt' ? 850 : 700;
  setTimeout(() => els.petReact.classList.remove(name), dur);
}

function reportPetRect() {
  try {
    const r = els.petImg.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) window.petAPI.petRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  } catch { }
}

function positionEmoteCard() {
  if (!els.emoteCard || els.emoteCard.classList.contains('hidden')) return;
  const aw = els.app.clientWidth || 620;
  const ah = els.app.clientHeight || 840;
  const r = els.petImg.getBoundingClientRect();
  const c = els.emoteCard.getBoundingClientRect();
  if (r.width < 2 || c.width < 2) return;
  let left = r.left - c.width * 0.55;
  left = clamp(left, 8, aw - c.width - 8);
  let bottom = ah - r.bottom + 6;
  bottom = clamp(bottom, 54, 150);
  els.emoteCard.style.left = left + 'px';
  els.emoteCard.style.bottom = bottom + 'px';
}

function blink(ms = 180) {
  if (!els.petImg || S.settingsOpen) return;
  els.petImg.classList.remove('blink');
  void els.petImg.offsetWidth;
  els.petImg.classList.add('blink');
  clearTimeout(S.blinkTimer);
  S.blinkTimer = setTimeout(() => els.petImg.classList.remove('blink'), ms);
}

function scheduleBlink(delay) {
  clearTimeout(S.blinkNext);
  S.blinkNext = setTimeout(() => {
    if (!S.dragging && !S.settingsOpen && !S.menuOpen && !S.demoLock) {
      blink(170);
      if (Math.random() < 0.18) setTimeout(() => blink(150), 260);
    }
    scheduleBlink(3000 + Math.random() * 4200);
  }, delay || (2400 + Math.random() * 2800));
}

function scheduleTokenBeg(delay) {
  clearTimeout(S.tokenBegNext);
  S.tokenBegNext = setTimeout(() => {
    if (!S.dragging && !S.settingsOpen && !S.menuOpen && !S.demoLock && S.form !== 'token' && !els.petStage.classList.contains('sleepy')) {
      const back = visualForm();
      setForm('token', true);
      say(pick(['师父，求 token…', '再给一点 token 嘛…', '碗空了，金币也快没了…']), { duration: 3800, speak: true });
      spawnBurst('coin', 8, petPoint(0.5, 0.62));
      clearTimeout(S.tokenBegBack);
      S.tokenBegBack = setTimeout(() => { if (S.form === 'token') setForm(back, true); }, 3900);
    }
    scheduleTokenBeg(34000 + Math.random() * 36000);
  }, delay || (34000 + Math.random() * 36000));
}

function closeEyes(ms = 600) {
  blink(ms);
}

function showBlush(ms) {
  els.blush.classList.add('on');
  clearTimeout(S.blushTimer);
  S.blushTimer = setTimeout(() => els.blush.classList.remove('on'), ms || 1800);
}

/* ============================ bubble ============================ */
function cleanQQ(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\u200b-\u200f]/g, '')
    .replace(/^\s+|\s+$/g, '');
}

function setBubbleName(name, badge) {
  els.bubbleName.textContent = name;
  if (badge) { els.bubbleBadge.textContent = badge; els.bubbleBadge.classList.remove('hidden'); }
  else els.bubbleBadge.classList.add('hidden');
}

function say(text, opts = {}) {
  text = cleanQQ(text);
  if (!text) return;
  if (S.bubbleQueue.length > 5) S.bubbleQueue.shift();
  S.bubbleQueue.push({ text, opts });
  if (opts.preempt) {
    if (S.bubbleShowing) {
      clearTimeout(S.bubbleTimer);
      clearInterval(S.typeTimer);
      S.bubbleShowing = false;
      els.bubble.classList.remove('show');
    }
    S.bubbleQueue = [S.bubbleQueue.pop()];
  }
  if (!S.bubbleShowing) nextBubble();
}

function nextBubble() {
  if (S.bubbleShowing) return;
  const item = S.bubbleQueue.shift();
  if (!item) return;
  const { text, opts } = item;
  S.bubbleShowing = true;
  S.bubbleKind = opts.kind || '';
  els.bubble.classList.remove('qq-in', 'qq-out', 'hidden');
  if (opts.kind === 'qq-in') els.bubble.classList.add('qq-in');
  if (opts.kind === 'qq-out') els.bubble.classList.add('qq-out');
  setBubbleName(opts.sender || (opts.kind === 'qq-out' ? '我' : '饭饭'), opts.badge || (opts.kind?.startsWith('qq') ? 'QQ' : ''));
  els.bubbleTime.textContent = opts.at ? new Date(opts.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  els.bubbleText.textContent = '';
  els.bubble.classList.add('show');
  const chars = Array.from(text);
  const instant = S.instant || opts.instant || chars.length > 120;
  if (instant) {
    els.bubbleText.textContent = text;
  } else {
    let i = 0;
    clearInterval(S.typeTimer);
    S.typeTimer = setInterval(() => {
      i++;
      els.bubbleText.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) {
        clearInterval(S.typeTimer);
        S.typeTimer = null;
      }
    }, 24);
  }
  const duration = opts.duration || Math.min(12000, 4800 + chars.length * 62);
  clearTimeout(S.bubbleTimer);
  S.bubbleTimer = setTimeout(() => hideBubble(false), duration);
  if (opts.speak && S.cfg?.voice) speak(text);
  S.lastInteraction = Date.now();
}

function hideBubble(immediate) {
  clearTimeout(S.bubbleTimer);
  clearInterval(S.typeTimer);
  S.typeTimer = null;
  if (!S.bubbleShowing) {
    if (!immediate && S.bubbleQueue.length) setTimeout(nextBubble, 150);
    return;
  }
  S.bubbleShowing = false;
  els.bubble.classList.remove('show');
  setTimeout(() => {
    if (!S.bubbleShowing) {
      els.bubble.classList.add('hidden');
      els.bubbleText.textContent = '';
    }
  }, 240);
  if (!immediate) setTimeout(() => nextBubble(), 320);
  else setTimeout(() => nextBubble(), 120);
}

/* ============================ emote / card / stats / menu ============================ */
function showEmote(name, ms = 4000) {
  if (!name || !S.stickersEnabled) return;
  els.emoteImg.src = STICKER(name);
  els.emoteCard.classList.remove('hidden');
  els.emoteCard.style.animation = 'none';
  void els.emoteCard.offsetWidth;
  els.emoteCard.style.animation = '';
  requestAnimationFrame(positionEmoteCard);
  setTimeout(positionEmoteCard, 260);
  clearTimeout(S.emoteTimer);
  S.emoteTimer = setTimeout(hideEmote, ms);
}

function hideEmote() {
  clearTimeout(S.emoteTimer);
  els.emoteCard.classList.add('hidden');
}

function showBigCard(srcName, caption, ms = 2600) {
  els.bigCardImg.src = CARD(srcName);
  els.bigCardCaption.textContent = caption || '';
  els.cardLayer.classList.remove('hidden');
  S.cardOpen = true;
  pushHitmap();
  clearTimeout(S.cardTimer);
  S.cardTimer = setTimeout(hideBigCard, ms);
  sfx('card');
}

function hideBigCard() {
  clearTimeout(S.cardTimer);
  els.cardLayer.classList.add('hidden');
  S.cardOpen = false;
  pushHitmap();
}

function toggleStats() {
  if (S.statsOpen) closeStats(); else openStats();
}
function openStats() {
  syncSettingsStats();
  els.stats.classList.remove('hidden');
  S.statsOpen = true;
  pushHitmap();
}
function closeStats() {
  els.stats.classList.add('hidden');
  S.statsOpen = false;
  pushHitmap();
}

function openMenu(x, y) {
  closeStats();
  els.menu.classList.remove('hidden');
  S.menuOpen = true;
  pushHitmap();
  const w = 178, h = 392;
  const left = clamp(x, 8, 620 - w - 8);
  const top = clamp(y, 8, 840 - h - 8);
  els.menu.style.left = left + 'px';
  els.menu.style.top = top + 'px';
  updatePinMarks();
}
function closeMenu() {
  els.menu.classList.add('hidden');
  S.menuOpen = false;
  pushHitmap();
}
function menuAction(act) {
  closeMenu();
  if (act === 'pat') doPat();
  else if (act === 'feed') doFeed();
  else if (act === 'poke') doPoke();
  else if (act === 'drink') doDrink();
  else if (act === 'praise') doPraise();
  else if (act === 'sleep') doSleep();
  else if (act === 'talk') doTalk();
  else if (act === 'settings') openSettings();
  else if (act === 'pin') { const next = !S.cfg.alwaysOnTop; queueSave({ alwaysOnTop: next }); updatePinMarks(); toast(next ? '已置顶' : '已取消置顶'); }
  else if (act === 'hide') window.petAPI.hide();
  else if (act === 'quit') window.petAPI.quit();
}

/* ============================ settings ============================ */
function openSettings() {
  syncSettingsPanel();
  els.stats.classList.add('hidden'); S.statsOpen = false;
  els.settings.classList.remove('hidden');
  S.settingsOpen = true;
  window.petAPI.settingsOpen();
  pushHitmap();
  closeMenu();
}
function closeSettings() {
  els.settings.classList.add('hidden');
  S.settingsOpen = false;
  window.petAPI.settingsClose();
  pushHitmap();
}
function syncSettingsPanel() {
  if (!S.cfg) return;
  els.setScale.value = String(Math.round((S.cfg.scale || 1) * 100));
  els.scaleVal.textContent = Math.round((S.cfg.scale || 1) * 100) + '%';
  els.setPin.checked = !!S.cfg.alwaysOnTop;
  els.setSound.checked = !!S.cfg.sound;
  els.setVoice.checked = !!S.cfg.voice;
  els.setWatchqq.checked = !!S.cfg.watchQQ;
  els.setWatchgroup.checked = !!S.cfg.watchGroup;
  els.setGoalRange.value = String(S.cfg.tokenGoalM || 4);
  els.goalVal.textContent = (Number(S.cfg.tokenGoalM) || 4).toFixed(1) + 'M';
  els.pathBridge.textContent = S.cfg.bridgeDir || '--';
  els.pathMood.textContent = S.cfg.moodStatePath || '--';
  syncSettingsStats();
}

/* ============================ preview / greeting / idle ============================ */
function greetOnce() {
  if (S.greeted || !S.data) return;
  S.greeted = true;
  greet();
}

function greet() {
  if (!S.data) return;
  const h = new Date().getHours();
  const time = h < 5 ? '夜深了，师父还不睡吗？' : h < 9 ? '早上好，今天也要好好吃白饭。'
    : h < 12 ? '上午好，先伸个懒腰吧。' : h < 14 ? '中午啦，别饿着肚子。'
      : h < 18 ? '下午好，摸鱼也要有节奏。' : h < 23 ? '晚上好，今天辛苦啦。' : '夜深了，早点休息吧。';
  const tier = S.tier;
  const extra = tier === 0 ? '…不过我今天 token 不太够，小小一只。' : tier >= 2 ? '我已经吃了好多 token 啦。' : '';
  say(time + extra, { duration: 7200, speak: false });
  setTimeout(() => showEmote('full'), 900);
}

function previewForm(p, persist = false) {
  S.instant = true;
  S.demoLock = true;
  clearTimeout(S.previewTimer);
  if (!persist) {
    S.previewTimer = setTimeout(() => {
      S.demoLock = false;
      S.forceTier = null;
      applyTier(S.tier, { silent: false });
      recomputeMood(false);
    }, 30000);
  }
  if (p === 'token') {
    S.forceTier = 1; S.baseMood = 74; S.localMood = 0;
    applyTier(1, { silent: true }); recomputeMood(false);
    setForm('token', true);
    setTimeout(() => { say('师父，求 token…金币也收。', { duration: 5200 }); spawnBurst('coin', 10, petPoint(0.5, 0.62)); }, 600);
    setTimeout(() => { if (S.form === 'token') setForm(visualForm(), true); }, 5600);
    return;
  }
  if (p === 'blink') {
    S.forceTier = 1; S.baseMood = 74; S.localMood = 0;
    applyTier(1, { silent: true }); recomputeMood(false);
    setTimeout(() => { say('眨眨眼，看看你。', { duration: 6000 }); blink(7000); }, 1500);
    return;
  }
  if (p === 'baby' || p === 'daily' || p === 'full' || p === 'queen') {
    const map = { baby: 0, daily: 1, full: 2, queen: 3 };
    S.forceTier = map[p];
    S.baseMood = p === 'baby' ? 58 : p === 'queen' ? 88 : p === 'full' ? 80 : 74;
    S.localMood = p === 'queen' ? 6 : 0;
    S.tier = S.forceTier;
    applyTier(S.forceTier, { silent: false, celebrate: false });
    recomputeMood(false);
    els.app.dataset.tier = String(S.forceTier);
    els.hudTier.textContent = TIER_NAMES[S.forceTier];
    const lines = {
      baby: '饿…token 不够，变小了。师父给点白饭吧。',
      daily: '今天也要好好吃白饭。',
      full: '嗝…吃得好饱，肚子圆圆的。',
      queen: '师父你看，我变成鲸王啦！金币也是饭的一种。'
    };
    setTimeout(() => {
      say(lines[p], { duration: 9000 });
      showEmote(p === 'baby' ? 'beg' : p === 'full' ? 'rice' : 'full');
      if (p === 'queen') { spawnBurst('coin', 18, petPoint(0.5, 0.35)); spawnBurst('spark', 18, petPoint(0.5, 0.4)); }
      if (p === 'full') spawnBurst('rice', 16, petPoint(0.5, 0.62));
      if (p === 'baby') spawnBurst('bubble', 10, petPoint(0.5, 0.5));
    }, 450);
  } else if (p === 'qq') {
    S.forceTier = 1;
    S.baseMood = 78; S.localMood = 2;
    applyTier(1, { silent: true });
    recomputeMood(false);
    setTimeout(() => handleQQIn({ text: '饭饭在吗？今天吃白饭了吗？', sender: '师父', at: Date.now() }), 600);
    setTimeout(() => handleQQOut({ text: '在的在的，刚扒了两碗。', at: Date.now() }), 3200);
  } else if (p === 'feed') {
    S.forceTier = 2; S.baseMood = 82; S.localMood = 2;
    applyTier(2, { silent: true });
    recomputeMood(false);
    setTimeout(() => { spawnBurst('rice', 14, petPoint(0.5, 0.6)); showEmote('rice'); say('啊呜——白饭！', { duration: 7000 }); react('feed'); }, 500);
  } else if (p === 'sad') {
    S.forceTier = 1; S.baseMood = 26; S.localMood = 0;
    applyTier(1, { silent: true });
    recomputeMood(false);
    setTimeout(() => { say('有点没力气…师父是不是不想理我。', { duration: 9000 }); showEmote('cry'); spawnBurst('rain', 20, petPoint(0.5, 0.2)); }, 500);
  } else if (p === 'settings') {
    setTimeout(openSettings, 500);
  } else if (p === 'menu') {
    setTimeout(() => openMenu(160, 280), 500);
  } else if (p === 'dance') {
    S.baseMood = 92; S.localMood = 5;
    recomputeMood(false);
    setTimeout(() => { react('happy'); showEmote('full'); spawnBurst('heart', 16, petPoint(0.5, 0.35)); }, 500);
  }
}

function applyPreview() {
  if (!S.preview) return;
  S.instant = true;
  S.demoLock = true;
  previewForm(S.preview, true);
}

function tickIdle() {
  const idle = Date.now() - S.lastInteraction;
  if (S.settingsOpen || S.menuOpen || S.cardOpen || S.bubbleShowing || S.dragging) return;
  if (idle > 12 * 60000 && !S.sleepCardShown) {
    S.sleepCardShown = true;
    doSleep();
    return;
  }
  if (idle > 5 * 60000 && Math.random() < 0.5) {
    say(pick(['师父…你还在吗？', '鱼缸里只有我自己的泡泡。', '有点无聊，想被摸头。']), { duration: 5200 });
    showEmote('cry');
    bumpMood(-2);
    return;
  }
  if (idle > 45 * 1000 && Math.random() < 0.32) {
    S.lastIdleSay = Date.now();
    if (Math.random() < 0.5) say(pick([
      '咕噜咕噜…', '水里有星星。', '摸鱼是正经事。', '今天也一起吃饭吧。',
      '师父，白饭在锅里。', '我盯着你很久了哦。', '尾巴有点酸。'
    ]), { duration: 4400 });
    else if (Math.random() < 0.55) showEmote(pick(['full', 'milk', 'zero', 'where', 'cold', 'huh', 'cry']));
    else if (Math.random() < 0.35) react(pick(['nod', 'tilt', 'headshake']));
    else react('jump');
  }
}

function tickAmbient() {
  if (!S.data) return;
  const tier = S.forceTier != null ? S.forceTier : S.tier;
  if (tier >= 3) spawnBurst('coin', 1, petPoint(0.5, rand(0.2, 0.7)));
  else if (tier === 2) spawnBurst('steam', 1, petPoint(0.45, 0.72));
  else if (Date.now() - S.lastInteraction > 120000) spawnBurst('zzz', 1, petPoint(0.7, 0.2));
  else if (Math.random() < 0.25) spawnBurst('bubble', 1, petPoint(rand(0.2, 0.8), rand(0.4, 0.8)));
}

/* ============================ audio / voice ============================ */
function ensureAudio() {
  if (!S.cfg?.sound && !S.cfg?.voice) return;
  try {
    if (!S.audio) S.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (S.audio.state === 'suspended') S.audio.resume();
  } catch { }
}

function tone(freq, dur = 0.12, type = 'sine', vol = 0.05, delay = 0) {
  if (!S.cfg?.sound || S.soundPreview) return;
  try {
    ensureAudio();
    if (!S.audio) return;
    const t0 = S.audio.currentTime + delay;
    const o = S.audio.createOscillator();
    const g = S.audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(S.audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  } catch { }
}

function sfx(name) {
  if (!S.cfg?.sound) return;
  if (name === 'pat') { tone(680, 0.09, 'sine', 0.045); tone(920, 0.1, 'sine', 0.035, 0.07); }
  else if (name === 'feed') { tone(170, 0.09, 'square', 0.035); tone(150, 0.09, 'square', 0.03, 0.13); }
  else if (name === 'qq') { tone(880, 0.1, 'sine', 0.04); tone(1174, 0.13, 'sine', 0.035, 0.09); }
  else if (name === 'tier') { tone(523, 0.1, 'triangle', 0.04); tone(659, 0.1, 'triangle', 0.04, 0.09); tone(784, 0.16, 'triangle', 0.045, 0.18); }
  else if (name === 'angry') { tone(210, 0.14, 'sawtooth', 0.03); tone(160, 0.18, 'sawtooth', 0.025, 0.1); }
  else if (name === 'card') { tone(1046, 0.08, 'sine', 0.03); tone(1318, 0.12, 'sine', 0.025, 0.06); }
  else if (name === 'toast') { tone(740, 0.06, 'sine', 0.02); }
}

function stripForSpeech(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '链接')
    .replace(/[*_`#>]/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

function speak(text) {
  if (!S.cfg?.voice) return;
  try {
    const clean = stripForSpeech(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'zh-CN'; u.rate = 1.14; u.pitch = 1.34; u.volume = 0.7;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { }
}

function testVoice() {
  if (!S.cfg?.voice) return;
  setTimeout(() => speak('饭饭来啦，今天也要一起吃白饭哦。'), 200);
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  els.toast.classList.add('show');
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => els.toast.classList.add('hidden'), 260);
  }, 1800);
  sfx('toast');
}

/* ============================ particles ============================ */
function initFX() {
  const cv = els.fx;
  const resize = () => {
    const r = els.app.getBoundingClientRect();
    S.fxW = r.width; S.fxH = r.height;
    S.fxDpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(S.fxW * S.fxDpr);
    cv.height = Math.round(S.fxH * S.fxDpr);
    cv.style.width = S.fxW + 'px';
    cv.style.height = S.fxH + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(S.fxDpr, 0, 0, S.fxDpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  S.lastFrame = performance.now();
  requestAnimationFrame(loopFX);
}

function petPoint(fx = 0.5, fy = 0.5) {
  const r = els.petImg.getBoundingClientRect();
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}

function spawnBurst(type, n, origin) {
  if (!origin) origin = petPoint(0.5, 0.5);
  for (let i = 0; i < n; i++) addParticle(type, origin.x, origin.y);
}

function addParticle(type, x, y) {
  const p = {
    type, x: x + rand(-12, 12), y: y + rand(-8, 8), vx: 0, vy: 0,
    life: 1, maxLife: 1, size: 5, rot: rand(-Math.PI, Math.PI), vr: rand(-3, 3),
    sway: rand(0, Math.PI * 2), swaySpeed: rand(1.2, 2.6)
  };
  if (type === 'rice') {
    p.vx = rand(-70, 70); p.vy = rand(-140, -60); p.size = rand(3.5, 6.5);
    p.maxLife = rand(0.9, 1.8); p.life = p.maxLife;
  } else if (type === 'heart') {
    p.vx = rand(-26, 26); p.vy = rand(-70, -42); p.size = rand(8, 14);
    p.maxLife = rand(1.1, 1.8); p.life = p.maxLife;
  } else if (type === 'bubble') {
    p.vx = rand(-12, 12); p.vy = rand(-40, -20); p.size = rand(4, 12);
    p.maxLife = rand(1.4, 2.4); p.life = p.maxLife;
  } else if (type === 'spark') {
    p.vx = rand(-90, 90); p.vy = rand(-100, -20); p.size = rand(4, 9);
    p.maxLife = rand(0.6, 1.2); p.life = p.maxLife;
  } else if (type === 'coin') {
    p.vx = rand(-60, 60); p.vy = rand(-120, -50); p.size = rand(6, 11);
    p.maxLife = rand(1.2, 2.1); p.life = p.maxLife;
  } else if (type === 'steam') {
    p.vx = rand(-8, 8); p.vy = rand(-30, -16); p.size = rand(8, 16);
    p.maxLife = rand(1.4, 2.4); p.life = p.maxLife;
  } else if (type === 'zzz') {
    p.vx = rand(-8, 8); p.vy = rand(-24, -14); p.size = rand(8, 14);
    p.maxLife = rand(1.6, 2.6); p.life = p.maxLife;
  } else if (type === 'anger') {
    p.vx = 0; p.vy = -10; p.size = rand(10, 14);
    p.maxLife = 0.9; p.life = p.maxLife;
  } else if (type === 'sweat') {
    p.vx = rand(-14, 14); p.vy = rand(20, 45); p.size = rand(4, 7);
    p.maxLife = 1.1; p.life = p.maxLife;
  } else if (type === 'rain') {
    p.vx = rand(-20, 20); p.vy = rand(160, 260); p.size = rand(5, 10);
    p.maxLife = rand(0.8, 1.4); p.life = p.maxLife;
  } else if (type === 'note') {
    p.vx = rand(-18, 18); p.vy = rand(-56, -30); p.size = rand(9, 14);
    p.maxLife = rand(1.2, 2); p.life = p.maxLife;
  }
  S.fx.push(p);
  if (S.fx.length > 160) S.fx.splice(0, S.fx.length - 160);
}

function updateParticle(p, dt) {
  p.life -= dt;
  p.sway += p.swaySpeed * dt;
  p.x += (p.vx + Math.sin(p.sway) * 12) * dt;
  p.y += p.vy * dt;
  p.rot += p.vr * dt;
  if (p.type === 'rice') p.vy += 250 * dt;
  else if (p.type === 'coin') p.vy += 90 * dt;
  else if (p.type === 'spark') { p.vx *= 0.97; p.vy += 40 * dt; }
  else if (p.type === 'heart') p.vy += 5 * dt;
  else if (p.type === 'anger') p.vy += 20 * dt;
  else if (p.type === 'sweat') p.vy += 80 * dt;
  else if (p.type === 'rain') p.vy += 40 * dt;
}

function drawParticle(ctx, p) {
  const a = clamp(p.life / p.maxLife, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  if (p.type === 'rice') {
    ctx.fillStyle = '#fffdf4';
    ctx.strokeStyle = 'rgba(160,200,225,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.ellipse(-p.size * 0.25, -p.size * 0.15, p.size * 0.35, p.size * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  } else if (p.type === 'heart') {
    const s = p.size / 10;
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,140,175,.92)';
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.bezierCurveTo(-8, -4, -5, -10, 0, -5);
    ctx.bezierCurveTo(5, -10, 8, -4, 0, 3);
    ctx.fill();
  } else if (p.type === 'bubble') {
    ctx.strokeStyle = 'rgba(200,240,255,.75)';
    ctx.fillStyle = 'rgba(210,245,255,.12)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.arc(-p.size * 0.3, -p.size * 0.35, p.size * 0.18, 0, Math.PI * 2); ctx.fill();
  } else if (p.type === 'spark') {
    drawStar(ctx, p.size, p.size * 0.28, 4);
    ctx.fillStyle = 'rgba(255,232,140,.95)';
    ctx.fill();
  } else if (p.type === 'coin') {
    ctx.fillStyle = '#ffd15c';
    ctx.strokeStyle = '#c98a14';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9b650d';
    ctx.font = `700 ${Math.max(7, p.size)}px "Microsoft YaHei UI"`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('¥', 0, 0.5);
  } else if (p.type === 'steam') {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
  } else if (p.type === 'zzz') {
    ctx.fillStyle = 'rgba(160,205,240,.9)';
    ctx.font = `700 ${p.size + 4}px "Microsoft YaHei UI"`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('z', 0, 0);
  } else if (p.type === 'anger') {
    ctx.strokeStyle = 'rgba(255,100,120,.95)';
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const ang = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 3, Math.sin(ang) * 3);
      ctx.lineTo(Math.cos(ang) * p.size, Math.sin(ang) * p.size);
      ctx.stroke();
    }
  } else if (p.type === 'sweat') {
    ctx.fillStyle = 'rgba(140,200,255,.85)';
    ctx.beginPath();
    ctx.moveTo(0, -p.size);
    ctx.bezierCurveTo(p.size, 0, p.size * 0.6, p.size, 0, p.size);
    ctx.bezierCurveTo(-p.size * 0.6, p.size, -p.size, 0, 0, -p.size);
    ctx.fill();
  } else if (p.type === 'rain') {
    ctx.strokeStyle = 'rgba(140,180,255,.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(0, p.size); ctx.stroke();
  } else if (p.type === 'note') {
    ctx.fillStyle = 'rgba(140,200,255,.9)';
    ctx.font = `600 ${p.size + 6}px "Microsoft YaHei UI"`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('♪', 0, 0);
  }
  ctx.restore();
}

function drawStar(ctx, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function loopFX(t) {
  const ctx = els.fx.getContext('2d');
  const dt = Math.min(0.034, Math.max(0.001, (t - S.lastFrame) / 1000));
  S.lastFrame = t;
  ctx.clearRect(0, 0, S.fxW, S.fxH);
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const p = S.fx[i];
    updateParticle(p, dt);
    if (p.life <= 0) { S.fx.splice(i, 1); continue; }
    drawParticle(ctx, p);
  }
  requestAnimationFrame(loopFX);
}

/* ============================ boot ============================ */
window.addEventListener('error', (e) => {
  try { window.petAPI?.log('renderer error', e.message, e.filename, e.lineno); } catch { }
});
window.addEventListener('unhandledrejection', (e) => {
  try { window.petAPI?.log('renderer rejection', String(e.reason)); } catch { }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

