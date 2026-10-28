'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { PetData } = require('./data-service');

const APP_DIR = path.join(__dirname, '..');
const CONFIG_DIR = path.join(APP_DIR, 'data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LOG_FILE = path.join(CONFIG_DIR, 'pet.log');
const SHOT_DIR = path.join(APP_DIR, 'shots');
const WIN_W = 620;
const WIN_H = 840;
const SET_W = 480;
const SET_H = 700;

const DEFAULT_CFG = {
  scale: 1,
  alwaysOnTop: true,
  sound: true,
  voice: false,
  watchQQ: false,
  watchGroup: false,
  tokenGoalM: 4,
  ownerQQ: '',
  groupId: '',
  bridgeDir: '',
  moodStatePath: path.join(os.homedir(), '.dsh', 'feiyu-mood', 'state.json'),
  sessionCacheDir: path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions'),
  x: null,
  y: null
};

const argv = process.argv.slice(1);
const argValue = (name, fallback = '') => {
  const hit = argv.find(a => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return fallback;
  const i = hit.indexOf('=');
  return i >= 0 ? hit.slice(i + 1) : '1';
};
const DEV = argv.includes('--dev');
const PREVIEW = argValue('preview', '');
const SHOT = argValue('screenshot', '');
const SHOT_DELAY = Number(argValue('shot-delay', '3200'));

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

function log(...args) {
  try {
    const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ')}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    const st = fs.statSync(LOG_FILE);
    if (st.size > 512 * 1024) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    }
  } catch { /* ignore */ }
  if (DEV) console.log(...args);
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''));
    return { ...DEFAULT_CFG, ...raw };
  } catch {
    return { ...DEFAULT_CFG };
  }
}

let cfg = loadConfig();
let win = null;
let tray = null;
let data = null;
let dataTimer = null;
let isQuitting = false;
let dragTimer = null;
let dragOffset = { x: 0, y: 0 };
let forceInteractive = false;
let hitmap = { full: false, rects: [] };
let petRel = null;
let dragPetRel = null;
let settingsPrevBounds = null;
let mouseIgnored = null;

function saveConfig() {
  try {
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) { log('saveConfig failed', String(e)); }
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function workArea() {
  try {
    const d = screen.getPrimaryDisplay();
    return d.workArea || d.bounds;
  } catch {
    return { x: 0, y: 0, width: 1920, height: 1080 };
  }
}

function defaultPos() {
  const wa = workArea();
  return { x: wa.x + wa.width - WIN_W - 24, y: wa.y + wa.height - WIN_H - 16 };
}

function normRect(r) {
  if (!r || typeof r !== 'object') return null;
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  if (![x, y, w, h].every(Number.isFinite) || w < 4 || h < 4) return null;
  return { x, y, w, h };
}

/** Clamp the window so the pet image (not the whole transparent window) stays on screen. */
function clampPetWindow(wx, wy, rel) {
  if (!rel) return { x: wx, y: wy };
  const wa = workArea();
  const m = 4;
  // 拖动碰撞体比整张立绘小一圈，避免透明边/衣摆把人物挡在屏幕中间。
  const cw = rel.w * 0.68, ch = rel.h * 0.72;
  const cx = rel.x + (rel.w - cw) / 2;
  const cy = rel.y + (rel.h - ch) * 0.35;
  const minX = wa.x + m - cx;
  const maxX = wa.x + wa.width - m - cx - cw;
  const minY = wa.y + m - cy;
  const maxY = wa.y + wa.height - m - cy - ch;
  return {
    x: clamp(wx, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(wy, Math.min(minY, maxY), Math.max(minY, maxY))
  };
}

function placeByPet() {
  if (!win || SHOT || dragTimer || settingsPrevBounds || !petRel) return;
  if (cfg.petX == null || cfg.petY == null) return;
  const wa = workArea();
  const cx = clamp(Number(cfg.petX), wa.x + petRel.w / 2 + 4, wa.x + wa.width - petRel.w / 2 - 4);
  const cy = clamp(Number(cfg.petY), wa.y + petRel.h / 2 + 4, wa.y + wa.height - petRel.h / 2 - 4);
  const wx = cx - (petRel.x + petRel.w / 2);
  const wy = cy - (petRel.y + petRel.h / 2);
  win.setPosition(Math.round(wx), Math.round(wy), false);
}

function placeWindow() {
  if (!win) return;
  const wa = workArea();
  let x = Number.isFinite(cfg.x) ? cfg.x : defaultPos().x;
  let y = Number.isFinite(cfg.y) ? cfg.y : defaultPos().y;
  if (SHOT) { x = 80; y = 60; }
  x = clamp(x, wa.x - 40, wa.x + wa.width - WIN_W + 40);
  y = clamp(y, wa.y - 40, wa.y + wa.height - WIN_H + 40);
  win.setPosition(Math.round(x), Math.round(y), false);
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    backgroundColor: '#00000000',
    title: '饭饭 · 大肥鱼桌宠',
    icon: path.join(APP_DIR, 'assets', 'icons', 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.setAlwaysOnTop(!!cfg.alwaysOnTop, 'screen-saver');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { }
  win.setMenuBarVisibility(false);

  const query = PREVIEW ? { preview: PREVIEW } : {};
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query });

  win.once('ready-to-show', () => {
    placeWindow();
    win.showInactive();
    win.setIgnoreMouseEvents(true, { forward: true });
    log('window ready', { preview: PREVIEW, shot: SHOT, cfg });
    if (SHOT) {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          const file = path.isAbsolute(SHOT) ? SHOT : path.join(SHOT_DIR, SHOT + '.png');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, img.toPNG());
          log('screenshot saved', file);
        } catch (e) { log('screenshot failed', String(e)); }
        setTimeout(() => { isQuitting = true; app.quit(); }, 300);
      }, Math.max(1500, SHOT_DELAY));
    }
  });

  win.webContents.on('render-process-gone', (e, details) => {
    log('renderer gone', details);
    if (!isQuitting) setTimeout(() => { try { win.reload(); } catch { } }, 800);
  });
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (DEV || level >= 2) log('renderer console', level, message, line, sourceId);
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      updateTrayMenu();
    }
  });

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(channel, payload); } catch { }
  }
}

function startData() {
  data = new PetData({
    ownerQQ: cfg.ownerQQ,
    groupId: cfg.groupId,
    watchQQ: cfg.watchQQ,
    watchGroup: cfg.watchGroup,
    tokenGoalM: cfg.tokenGoalM,
    bridgeDir: cfg.bridgeDir,
    moodStatePath: cfg.moodStatePath,
    sessionCacheDir: cfg.sessionCacheDir
  });
  const tick = () => {
    try {
      const snap = data.poll();
      send('pet:data', snap);
    } catch (e) {
      log('data poll failed', String(e && e.stack || e));
    }
  };
  tick();
  dataTimer = setInterval(tick, 1200);
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = !!(win && win.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '藏起来' : '叫出来', click: () => toggleWindow() },
    { type: 'separator' },
    { label: '摸摸头', click: () => { showWindow(); send('ui:action', 'pat'); } },
    { label: '喂白饭', click: () => { showWindow(); send('ui:action', 'feed'); } },
    { label: '打开设置', click: () => { showWindow(); send('ui:action', 'settings'); } },
    { type: 'separator' },
    {
      label: '总在最前', type: 'checkbox', checked: !!cfg.alwaysOnTop,
      click: (item) => setConfig({ alwaysOnTop: !!item.checked })
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  try {
    const iconPath = path.join(APP_DIR, 'assets', 'icons', 'tray.png');
    let img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) img = nativeImage.createEmpty();
    tray = new Tray(img.resize({ width: 20, height: 20 }));
    tray.setToolTip('饭饭 · 大肥鱼桌宠');
    tray.on('click', () => toggleWindow());
    tray.on('double-click', () => { showWindow(); send('ui:action', 'pat'); });
    updateTrayMenu();
  } catch (e) { log('tray failed', String(e)); }
}

function showWindow() {
  if (!win) return;
  win.showInactive();
  win.setAlwaysOnTop(!!cfg.alwaysOnTop, 'screen-saver');
  if (cfg.alwaysOnTop) { try { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } catch { } }
  updateTrayMenu();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) { win.hide(); }
  else { showWindow(); }
  updateTrayMenu();
}

function setConfig(patch) {
  if (!patch || typeof patch !== 'object') return cfg;
  if (patch.scale != null) patch.scale = clamp(Number(patch.scale) || 1, 0.3, 1.15);
  if (patch.tokenGoalM != null) patch.tokenGoalM = clamp(Number(patch.tokenGoalM) || 4, 0.5, 30);
  if (patch.ownerQQ != null) patch.ownerQQ = String(patch.ownerQQ).replace(/\D/g, '').slice(0, 12);
  if (patch.groupId != null) patch.groupId = String(patch.groupId).replace(/\D/g, '').slice(0, 12);
  Object.assign(cfg, patch);
  if (patch.alwaysOnTop != null && win) win.setAlwaysOnTop(!!cfg.alwaysOnTop, 'screen-saver');
  if (data) data.setConfig({
    ownerQQ: cfg.ownerQQ, groupId: cfg.groupId, watchQQ: cfg.watchQQ,
    watchGroup: cfg.watchGroup, tokenGoalM: cfg.tokenGoalM,
    bridgeDir: cfg.bridgeDir, moodStatePath: cfg.moodStatePath,
    sessionCacheDir: cfg.sessionCacheDir
  });
  saveConfig();
  updateTrayMenu();
  send('pet:config', cfg);
  return cfg;
}

/* ---------------- IPC ---------------- */
ipcMain.handle('pet:ready', () => {
  return { config: cfg, preview: PREVIEW, version: app.getVersion(), platform: process.platform };
});
ipcMain.handle('pet:get-data', () => (data ? data.poll() : null));
ipcMain.handle('pet:get-config', () => cfg);
ipcMain.handle('pet:set-config', (e, patch) => setConfig(patch || {}));
ipcMain.handle('pet:reset-config', () => {
  cfg = { ...DEFAULT_CFG };
  saveConfig();
  send('pet:config', cfg);
  return cfg;
});

ipcMain.on('pet:set-ignore', (e, flag) => {
  if (!win) return;
  forceInteractive = !flag;
  try { win.setIgnoreMouseEvents(!!flag, { forward: true }); mouseIgnored = !!flag; } catch { }
});
ipcMain.on('pet:hitmap', (e, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const rects = Array.isArray(payload.rects) ? payload.rects.slice(0, 30).map(r => ({
    x: Number(r.x) || 0, y: Number(r.y) || 0, w: Number(r.w) || 0, h: Number(r.h) || 0
  })) : [];
  hitmap = { full: !!payload.full, rects };
});

ipcMain.on('pet:drag-start', (e, rel) => {
  if (!win) return;
  dragPetRel = normRect(rel) || petRel;
  const cur = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffset = { x: cur.x - wx, y: cur.y - wy };
  if (dragTimer) clearInterval(dragTimer);
  const dragStartedAt = Date.now();
  dragTimer = setInterval(() => {
    try {
      if (Date.now() - dragStartedAt > 10000) {
        clearInterval(dragTimer); dragTimer = null; return;
      }
      const p = screen.getCursorScreenPoint();
      const b = clampPetWindow(p.x - dragOffset.x, p.y - dragOffset.y, dragPetRel || petRel);
      const nx = Math.round(b.x), ny = Math.round(b.y);
      const [ox, oy] = win.getPosition();
      if (nx !== ox || ny !== oy) win.setPosition(nx, ny, false);
    } catch { }
  }, 16);
  win.setIgnoreMouseEvents(false);
});

ipcMain.on('pet:drag-end', () => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  if (!win) return;
  const [x, y] = win.getPosition();
  cfg.x = x; cfg.y = y;
  const rel = dragPetRel || petRel;
  if (rel) { cfg.petX = x + rel.x + rel.w / 2; cfg.petY = y + rel.y + rel.h / 2; }
  saveConfig();
  send('pet:config', cfg);
  // leave the renderer in charge of click-through from here
});

ipcMain.on('pet:pet-rect', (e, rect) => {
  petRel = normRect(rect) || petRel;
  if (!dragTimer) placeByPet();
});

ipcMain.on('pet:settings-open', () => {
  if (!win || settingsPrevBounds) return;
  const b = win.getBounds();
  settingsPrevBounds = b;
  const wa = workArea();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  let x = Math.round(cx - SET_W / 2), y = Math.round(cy - SET_H / 2);
  x = clamp(x, wa.x, wa.x + wa.width - SET_W);
  y = clamp(y, wa.y, wa.y + wa.height - SET_H);
  win.setBounds({ x, y, width: SET_W, height: SET_H }, false);
  try { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } catch { }
});

ipcMain.on('pet:settings-close', () => {
  if (!win || !settingsPrevBounds) return;
  const b = settingsPrevBounds;
  settingsPrevBounds = null;
  win.setBounds(b, false);
});

ipcMain.on('pet:flash', () => {
  if (!win) return;
  win.setOpacity(0.92);
  setTimeout(() => { try { win.setOpacity(1); } catch { } }, 80);
});

ipcMain.handle('pet:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return '';
  return r.filePaths[0];
});

ipcMain.handle('pet:open-data-dir', async () => {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // 不经过 ShellExecute：直接起 explorer.exe，绕开桌宠进程的 UI/任务限制。
    const child = spawn('explorer.exe', [CONFIG_DIR], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (error) => log('explorer spawn error', String(error)));
    child.unref();
    log('opened data dir via explorer.exe', CONFIG_DIR);
    return { ok: true, path: CONFIG_DIR };
  } catch (error) {
    log('open data dir failed', String(error));
    try { shell.showItemInFolder(CONFIG_FILE); } catch { }
    return { ok: false, error: String(error?.message || error), path: CONFIG_DIR };
  }
});

ipcMain.handle('pet:open-path', async (e, p) => {
  if (typeof p !== 'string' || !p) return false;
  try {
    await shell.openPath(p);
    return true;
  } catch { return false; }
});

ipcMain.on('pet:hide', () => { if (win) win.hide(); updateTrayMenu(); });
ipcMain.on('pet:show', () => showWindow());
ipcMain.on('pet:reset-pos', () => {
  cfg.x = null; cfg.y = null; cfg.petX = null; cfg.petY = null; petRel = null;
  placeWindow(); saveConfig(); send('pet:config', cfg);
});
ipcMain.on('pet:quit', () => { isQuitting = true; app.quit(); });
ipcMain.on('pet:log', (e, ...args) => log('[renderer]', ...args));

function startCursorPoller() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (dragTimer) {
      if (mouseIgnored !== false) { try { win.setIgnoreMouseEvents(false); } catch { } mouseIgnored = false; }
      return;
    }
    if (forceInteractive) return;
    let inside = !!hitmap.full;
    if (!inside) {
      try {
        const p = screen.getCursorScreenPoint();
        const [wx, wy] = win.getPosition();
        inside = hitmap.rects.some(r => r.w > 1 && r.h > 1 &&
          p.x >= wx + r.x - 3 && p.x <= wx + r.x + r.w + 3 &&
          p.y >= wy + r.y - 3 && p.y <= wy + r.y + r.h + 3);
      } catch { inside = false; }
    }
    const ignore = !inside;
    if (ignore !== mouseIgnored) {
      try { win.setIgnoreMouseEvents(ignore, { forward: true }); mouseIgnored = ignore; } catch { }
    }
  }, 55);
}

/* ---------------- app ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showWindow(); });
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.whenReady().then(() => {
    app.setAppUserModelId('com.feiyu.pet');
    createWindow();
    startData();
    if (!SHOT) createTray();
    startCursorPoller();
    setInterval(() => {
      if (dragTimer) return;
      if (cfg.alwaysOnTop && win && !win.isDestroyed() && win.isVisible()) {
        try { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } catch { }
      }
    }, 8000);
    log('app started', { version: app.getVersion(), electron: process.versions.electron, preview: PREVIEW });
  });
}

app.on('window-all-closed', (e) => { /* stay in tray */ });
app.on('before-quit', () => {
  isQuitting = true;
  if (dataTimer) clearInterval(dataTimer);
  if (dragTimer) clearInterval(dragTimer);
  saveConfig();
});
process.on('uncaughtException', (e) => log('uncaughtException', String(e && e.stack || e)));
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e)));
