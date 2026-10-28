'use strict';
/**
 * 饭饭桌宠 · 本地数据服务
 * 只读本地文件 / 本机 QQ 桥接口，不联网。
 *  - token: DSH 会话投影 + QQ 桥 token 账本
 *  - mood : dsh-feiyu-mood 的 state.json
 *  - qq   : qq-bridge 的 social-v2.json 与 /api/status
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const TIERS = [
  { id: 0, name: '幼鲸', min: 0.00, note: '饿饿的，小小一只' },
  { id: 1, name: '日常', min: 0.12, note: '吃饱一点点了' },
  { id: 2, name: '饱食', min: 0.45, note: '圆滚滚，嗝' },
  { id: 3, name: '鲸王', min: 0.85, note: '满身金币的大肥鱼' }
];

function readJson(file, fallback = null) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function statSafe(file) {
  try { return fs.statSync(file); } catch { return null; }
}

function todayStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function totalOf(b = {}) {
  return (Number(b.cacheMiss) || 0) + (Number(b.cacheHit) || 0) +
    (Number(b.cacheWrite) || 0) + (Number(b.output) || 0) + (Number(b.reasoning) || 0);
}
function freshOf(b = {}) {
  return (Number(b.cacheMiss) || 0) + (Number(b.cacheWrite) || 0) +
    (Number(b.output) || 0) + (Number(b.reasoning) || 0);
}

class PetData {
  constructor(opts = {}) {
    const home = os.homedir();
    this.cfg = Object.assign({
      ownerQQ: '',
      groupId: '',
      watchQQ: true,
      watchGroup: false,
      tokenGoalM: 4,
      bridgeDir: 'D:\\大肥鱼\\qq-bridge',
      moodStatePath: path.join(home, '.dsh', 'feiyu-mood', 'state.json'),
      sessionCacheDir: path.join(home, '.dsh', 'storages', 'session_projcache', 'sessions')
    }, opts);
    this.bridge = null;
    this.bridgeAt = 0;
    this.bridgeBusy = false;

    this.ledgerCache = null;
    this.projCache = null;
    this.socialCache = null;
    this.moodCache = null;

    this.qqInit = false;
    this.qqLastSig = '';
    this.qqLastTime = 0;

    this.moodInit = false;
    this.lastMood = null;
    this.tokenInit = false;
    this.lastFresh = 0;
    this.tierInit = false;
    this.lastTier = null;
  }

  setConfig(patch = {}) {
    Object.assign(this.cfg, patch);
  }

  /* ---------------- token ---------------- */
  readLedger(now) {
    const file = path.join(this.cfg.bridgeDir, 'state', 'token-usage.jsonl');
    const st = statSafe(file);
    if (!st) return { fresh: 0, total: 0, sids: {}, records: 0, lastAt: 0, fileOk: false };
    if (this.ledgerCache && this.ledgerCache.mtimeMs === st.mtimeMs && this.ledgerCache.size === st.size) {
      return this.ledgerCache.data;
    }
    const start = todayStart(now);
    let fresh = 0, total = 0, records = 0, lastAt = 0;
    const sids = {};
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* ignore */ }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!row || !row.t || !row.b) continue;
      const t = Number(row.t);
      if (!(t >= start)) continue;
      fresh += freshOf(row.b);
      total += totalOf(row.b);
      records++;
      if (t > lastAt) lastAt = t;
      if (row.sid) sids[row.sid] = 1;
    }
    const data = { fresh, total, sids, records, lastAt, fileOk: true };
    this.ledgerCache = { mtimeMs: st.mtimeMs, size: st.size, data };
    return data;
  }

  readActiveSession(now) {
    const dir = this.cfg.sessionCacheDir;
    let entries = [];
    try {
      entries = fs.readdirSync(dir)
        .filter(n => n.endsWith('.json'))
        .map(n => {
          const p = path.join(dir, n);
          const st = statSafe(p);
          return st ? { p, n, mtimeMs: st.mtimeMs, size: st.size } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return { fresh: 0, total: 0, sessionId: '', counted: false, ok: false, at: 0 };
    }
    if (!entries.length) return { fresh: 0, total: 0, sessionId: '', counted: false, ok: false, at: 0 };
    const top = entries[0];
    const isToday = new Date(top.mtimeMs).toDateString() === new Date(now).toDateString();
    if (!isToday) return { fresh: 0, total: 0, sessionId: '', counted: false, ok: false, at: 0 };
    if (this.projCache && this.projCache.p === top.p && this.projCache.mtimeMs === top.mtimeMs) {
      return this.projCache.data;
    }
    const doc = readJson(top.p);
    const totals = doc?.record?.rows?.tokenUsage?.val?.totals || null;
    const context = doc?.record?.rows?.contextPressure?.val || null;
    const sessionId = top.n.replace(/\.json$/, '');
    const data = {
      fresh: totals ? (Number(totals.uncachedInputTokens) || 0) + (Number(totals.cacheWriteTokens) || 0) + (Number(totals.outputTokens) || 0) : 0,
      total: totals ? (Number(totals.uncachedInputTokens) || 0) + (Number(totals.cacheWriteTokens) || 0) + (Number(totals.cacheReadTokens) || 0) + (Number(totals.outputTokens) || 0) : 0,
      sessionId,
      title: doc?.record?.rows?.title?.val || '',
      contextSurface: context?.surfaceTokens || 0,
      contextWindow: context?.contextWindow || 0,
      ok: !!totals,
      at: top.mtimeMs
    };
    this.projCache = { p: top.p, mtimeMs: top.mtimeMs, data };
    return data;
  }

  readTokens(now) {
    const ledger = this.readLedger(now);
    const active = this.readActiveSession(now);
    // 如果最近活跃的会话本身就是 QQ 桥的会话，账本已经记过，不要重复算
    const counted = !!(active.sessionId && ledger.sids[active.sessionId]);
    const dshFresh = counted ? 0 : active.fresh;
    const dshTotal = counted ? 0 : active.total;
    const fresh = ledger.fresh + dshFresh;
    const total = ledger.total + dshTotal;
    const goal = Math.max(0.2, Number(this.cfg.tokenGoalM) || 4) * 1e6;
    const pct = Math.max(0, fresh / goal);
    let tier = TIERS[0];
    for (const t of TIERS) if (pct >= t.min) tier = t;
    return {
      fresh, qqFresh: ledger.fresh, dshFresh, total, goal, pct: Math.min(9.99, pct),
      tier: tier.id, tierName: tier.name, tierNote: tier.note,
      records: ledger.records, lastAt: ledger.lastAt,
      activeSession: active.sessionId, activeTitle: active.title,
      activeCounted: counted, activeOk: active.ok,
      sourceOk: ledger.fileOk || active.ok,
      contextSurface: active.contextSurface, contextWindow: active.contextWindow,
      at: now
    };
  }

  /* ---------------- mood ---------------- */
  readMood(now) {
    const file = this.cfg.moodStatePath;
    const st = statSafe(file);
    if (!st) return { value: 70, dims: {}, updatedAt: 0, sourceOk: false };
    if (this.moodCache && this.moodCache.mtimeMs === st.mtimeMs) return this.moodCache.data;
    const doc = readJson(file);
    let state = null;
    if (doc?.moods) {
      const key = doc.lastActive && doc.moods[doc.lastActive] ? doc.lastActive : Object.keys(doc.moods)[0];
      state = key ? doc.moods[key] : null;
    } else if (doc && typeof doc.mood === 'number') {
      state = doc;
    }
    const value = Math.max(0, Math.min(100, Math.round(Number(state?.mood ?? 70))));
    const data = {
      value, dims: state?.dims || {}, updatedAt: Number(state?.updatedAt || 0),
      reason: state?.lastReason || '', sourceOk: !!state
    };
    this.moodCache = { mtimeMs: st.mtimeMs, data };
    return data;
  }

  /* ---------------- QQ ---------------- */
  readSocial(now) {
    const file = path.join(this.cfg.bridgeDir, 'state', 'social-v2.json');
    const st = statSafe(file);
    if (!st) return { ok: false, ageMs: Infinity, data: null };
    if (this.socialCache && this.socialCache.mtimeMs === st.mtimeMs) {
      return { ok: true, ageMs: now - st.mtimeMs, data: this.socialCache.data };
    }
    const data = readJson(file);
    if (!data) return { ok: false, ageMs: now - st.mtimeMs, data: null };
    this.socialCache = { mtimeMs: st.mtimeMs, data };
    return { ok: true, ageMs: now - st.mtimeMs, data };
  }

  readQQ(now) {
    const social = this.readSocial(now);
    const out = {
      ok: social.ok, ageMs: social.ageMs, online: this.bridge?.online ?? null,
      botName: this.bridge?.botName || '饭饭', mode: this.bridge?.mode || '',
      ownerQQ: this.cfg.ownerQQ, lastIncomingAt: 0, lastText: '', lastSender: '',
      unread: 0, events: []
    };
    if (!social.ok || !social.data) return out;
    const conv = social.data.conversations?.[`private:${this.cfg.ownerQQ}`];
    const msgs = Array.isArray(conv?.recentMessages) ? conv.recentMessages : [];
    out.lastIncomingAt = Number(conv?.lastIncomingAt || 0);
    out.unread = Array.isArray(conv?.unread) ? conv.unread.length : 0;
    const lastAll = msgs[msgs.length - 1];
    if (lastAll) {
      out.lastText = lastAll.text || ''; out.lastSender = lastAll.isSelf ? '我' : '师父';
    }
    const newMsgs = this.newMessages(msgs);
    for (const m of newMsgs) {
      const kind = m.kind === 'poke' ? 'poke' : (m.isSelf ? 'out' : 'in');
      let sender = m.sender || (m.isSelf ? '我' : '师父');
      if (m.isOwner && !m.isSelf) sender = '师父';
      if (m.userId === this.cfg.ownerQQ && !m.isSelf) sender = '师父';
      out.events.push({
        type: 'qq-' + kind, text: String(m.text || m.plain || ''), sender,
        at: Number(m.time || 0), messageId: m.messageId || '', kind: m.kind || '',
        hasMedia: !!m.hasMedia
      });
    }
    if (newMsgs.length) {
      const last = newMsgs[newMsgs.length - 1];
      out.lastText = last.text || ''; out.lastSender = last.isSelf ? '我' : '师父';
    }
    // 群聊：只在开启且被叫到时提醒
    if (this.cfg.watchGroup && this.cfg.groupId) {
      const g = social.data.conversations?.[`group:${this.cfg.groupId}`];
      const gmsgs = Array.isArray(g?.recentMessages) ? g.recentMessages : [];
      if (gmsgs.length) {
        const newG = this.newMessages(gmsgs, 'group');
        for (const m of newG) {
          if (m.isSelf) continue;
          const text = String(m.text || '');
          const called = m.kind === 'poke' || /@[^\s]*饭饭|@[^\s]*大肥鱼|饭饭|大肥鱼|DeepSeek|deepseek|白饭|token/i.test(text);
          if (!called) continue;
          out.events.push({
            type: 'qq-group', text, sender: m.sender || '群友',
            at: Number(m.time || 0), messageId: m.messageId || '', kind: m.kind || ''
          });
        }
      }
    }
    return out;
  }

  sigOf(m) {
    if (!m) return '';
    return [m.time || 0, m.messageId || '', m.seq ?? '', m.isSelf ? 1 : 0, String(m.text || '').slice(0, 24)].join('|');
  }

  newMessages(msgs, bucket = 'private') {
    if (!Array.isArray(msgs) || !msgs.length) return [];
    const key = bucket === 'group' ? 'group' : 'private';
    if (!this['seen_' + key]) {
      const lastNow = msgs[msgs.length - 1];
      this['seen_' + key] = { sig: this.sigOf(lastNow), time: Number(lastNow?.time || 0) };
      return [];
    }
    const seen = this['seen_' + key];
    let start = -1;
    if (seen.sig) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (this.sigOf(msgs[i]) === seen.sig) { start = i; break; }
      }
    }
    let out;
    if (start >= 0) out = msgs.slice(start + 1);
    else out = msgs.filter(m => Number(m.time || 0) > seen.time);
    const last = msgs[msgs.length - 1];
    seen.sig = this.sigOf(last);
    seen.time = Number(last?.time || seen.time);
    return out;
  }

  refreshBridge() {
    const now = Date.now();
    if (now - this.bridgeAt < 15000 || this.bridgeBusy) return;
    this.bridgeBusy = true;
    const cfgFile = path.join(this.cfg.bridgeDir, 'config.json');
    const cfg = readJson(cfgFile) || {};
    const port = Number(cfg.consolePort) || 3100;
    const token = String(cfg.consoleToken || '');
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/status', method: 'GET',
      headers: token ? { 'x-console-token': token } : {},
      timeout: 1600
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => {
        this.bridgeBusy = false;
        this.bridgeAt = Date.now();
        if (res.statusCode !== 200) { this.bridge = { online: false, error: 'HTTP ' + res.statusCode }; return; }
        try {
          const j = JSON.parse(body);
          const sl = j.snowluma || {};
          this.bridge = {
            online: !!(sl.connected && sl.accountOnline && sl.good !== false),
            connected: !!sl.connected, accountOnline: !!sl.accountOnline,
            good: sl.good !== false, botName: j.role || '饭饭', mode: j.mode || '',
            roleMode: j.roleMode || '', paused: !!j.socialV2Paused,
            lastPacketAgoMs: sl.lastPacketAgoMs ?? null, hint: sl.hint || ''
          };
        } catch { this.bridge = { online: false, error: 'bad json' }; }
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch {} this.bridgeBusy = false; this.bridgeAt = Date.now(); this.bridge = { online: false, error: 'timeout' }; });
    req.on('error', () => {
      this.bridgeBusy = false; this.bridgeAt = Date.now();
      this.bridge = { online: false, error: 'unreachable' };
    });
    req.end();
  }

  /* ---------------- snapshot ---------------- */
  poll() {
    this.refreshBridge();
    const now = Date.now();
    const tokens = this.readTokens(now);
    const mood = this.readMood(now);
    const qq = this.readQQ(now);
    const events = [...qq.events];

    if (!this.moodInit) { this.moodInit = true; this.lastMood = mood.value; }
    else if (Math.abs(mood.value - this.lastMood) >= 3) {
      events.push({ type: 'mood', value: mood.value, prev: this.lastMood });
      this.lastMood = mood.value;
    }

    if (!this.tokenInit) { this.tokenInit = true; this.lastFresh = tokens.fresh; }
    else if (tokens.fresh - this.lastFresh >= 600) {
      events.push({ type: 'token-up', delta: tokens.fresh - this.lastFresh, fresh: tokens.fresh, total: tokens.total });
      this.lastFresh = tokens.fresh;
    }

    if (!this.tierInit) { this.tierInit = true; this.lastTier = tokens.tier; }
    else if (tokens.tier !== this.lastTier) {
      events.push({ type: 'tier', tier: tokens.tier, name: tokens.tierName, prev: this.lastTier });
      this.lastTier = tokens.tier;
    }

    return {
      now, tokens, mood, qq: { ...qq, events: undefined },
      bridge: this.bridge,
      events,
      cfg: {
        ownerQQ: this.cfg.ownerQQ, groupId: this.cfg.groupId,
        watchQQ: this.cfg.watchQQ, watchGroup: this.cfg.watchGroup,
        tokenGoalM: this.cfg.tokenGoalM
      }
    };
  }
}

module.exports = { PetData, TIERS, todayStart, freshOf, totalOf };
