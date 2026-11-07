/* ===== APP ===== */
/* Android (Capacitor): NATIVE and the plugins are declared first; a plugin error must never break the whole app. */
const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
function capPlugin(name) {
  try {
    const cap = window.Capacitor;
    if (typeof cap.registerPlugin === 'function') return cap.registerPlugin(name);
    return (cap.Plugins && cap.Plugins[name]) || null;
  } catch (e) { return null; }
}
const Native = NATIVE ? { geo: capPlugin('OliveGeofence'), fs: capPlugin('Filesystem'), share: capPlugin('Share') } : null;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const todayKey = () => dateKey(new Date());
/* Dates: Vietnamese uses dd/mm/yyyy; English uses "10 Oct 2026" so the day and month can't be confused. */
const fmtDM = key => LANG === 'vi' ? key.slice(8) + '/' + key.slice(5, 7) : parseKey(key).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fmtDMY = key => LANG === 'vi' ? key.slice(8) + '/' + key.slice(5, 7) + '/' + key.slice(0, 4) : parseKey(key).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const monthInline = m => LANG === 'vi' ? monthName(m).toLowerCase() : monthName(m); // "tháng 10" inside a Vietnamese sentence
const round2 = n => Math.round(n * 100) / 100;

let settings = DEFAULT_SETTINGS();
const months = {};        // 'm-YYYY-MM' -> {days:{}}
let view = { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
let ready = false;

/* ---------- Language ---------- */
function cachedLang() { try { return localStorage.getItem('olive:lang'); } catch (e) { return null; } }
function applyLang() {
  document.documentElement.lang = LANG;
  document.title = T('app.title');
  applyStaticText();
  $('#setLang').value = LANG;
  $$('#wStd option').forEach(op => { if (op.value !== 'auto') op.textContent = T('set.std.n', { n: op.value }); });
}
function switchLang(l) {
  setLang(l);
  settings.lang = LANG;
  try { localStorage.setItem('olive:lang', LANG); } catch (e) {}
  applyLang();
  if (!ready) return;
  saveSettings();
  setStoreChip(); renderAll();
  if (!$('#view-settings').hidden) renderSettings();
  if (!$('#editModal').hidden && editKey) openEdit(editKey);
  if (NATIVE) startNativeGeofence();
  else if (gpsRt.lastInside != null) gpsTick(Date.now());
  else startGps();
}
setLang(cachedLang() || detectLang());
applyLang();
$('#langBtn').addEventListener('click', () => switchLang(LANG === 'vi' ? 'en' : 'vi'));
$('#setLang').addEventListener('change', e => switchLang(e.target.value));

/* ---------- Storage: private per user (claude.ai) or on this device ---------- */
const Store = {
  mode: 'pending', db: null, uid: null, chains: {}, timers: {},
  async init() {
    const host = window.claude && typeof window.claude.use === 'function';
    if (host) {
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        const uid = user ? await user.id() : null;
        if (db && uid) { this.db = db; this.uid = uid; this.mode = 'cloud'; return; }
      } catch (e) { /* fall back to local storage */ }
    }
    this.mode = 'local';
  },
  path(k) { return 'data/users/' + this.uid + '/' + k; },
  async get(k) {
    if (this.mode === 'cloud') {
      try { const s = await this.db.doc(this.path(k)).get(); return s.exists ? JSON.parse(JSON.stringify(s.data())) : null; }
      catch (e) { toast(T('store.readFail')); return null; }
    }
    try { const v = localStorage.getItem('olive:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  },
  save(k, getObj) {            // debounced 400 ms; writes to the same document are queued
    clearTimeout(this.timers[k]);
    this.timers[k] = setTimeout(() => {
      const obj = JSON.parse(JSON.stringify(getObj()));
      if (this.mode === 'cloud') {
        this.chains[k] = (this.chains[k] || Promise.resolve())
          .then(() => this.db.doc(this.path(k)).set(obj))
          .catch(err => {
            const c = err && err.code;
            if (c === 'invalid_argument') toast(T('store.noPermission'));
            else if (c === 'quota_exceeded') toast(T('store.full'));
            else toast(T('store.retry'));
          });
      } else {
        try { localStorage.setItem('olive:' + k, JSON.stringify(obj)); } catch (e) { toast(T('store.blocked')); }
      }
    }, 400);
  },
};

function saveSettings() { Store.save('settings', () => settings); }
function saveMonth(mk) { Store.save(mk, () => months[mk]); }

async function ensureMonth(y, m) {
  const mk = monthKey(y, m);
  if (!months[mk]) {
    const doc = await Store.get(mk);
    months[mk] = doc && doc.days ? doc : { days: {} };
  }
  return months[mk];
}
function recFor(key, create) {
  const [y, m] = key.split('-').map(Number);
  const mk = monthKey(y, m);
  if (!months[mk] && !create) return undefined; // month not loaded yet: don't create an empty one
  const mo = months[mk] || (months[mk] = { days: {} });
  if (!mo.days[key] && create) mo.days[key] = { events: [] };
  return mo.days[key];
}
function touch(key) { const [y, m] = key.split('-').map(Number); saveMonth(monthKey(y, m)); }
/* Log entries are stored as codes so they display in whichever language is active. */
function logEvent(rec, t, code, p) {
  const e = { t, code };
  if (p) e.p = p;
  (rec.events = rec.events || []).push(e);
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }

/* ---------- Tabs ---------- */
function showTab(name) {
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  ['today', 'month', 'pay', 'settings'].forEach(n => $('#view-' + n).hidden = n !== name);
  if (name === 'month' || name === 'pay') renderMonthViews();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- TODAY ---------- */
function renderToday() {
  const key = todayKey(), rec = recFor(key) || {}, now = new Date();
  $('#todayDate').textContent = now.toLocaleDateString(LOCALE(), LANG === 'vi'
    ? { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }
    : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const r = computeDay(key, rec, settings, { nowMin: now.getHours() * 60 + now.getMinutes() });
  const g = rec.gps || {};
  $('#inVal').textContent = r.inHM || '--:--';
  $('#outVal').textContent = r.outHM || '--:--';
  $('#slotIn').classList.toggle('set', !!r.inHM);
  $('#slotOut').classList.toggle('set', !!r.outHM);
  $('#inSrc').textContent = r.inSrc === 'manual' ? T('today.src.manual') + (g.in && g.in !== r.inHM ? ' · GPS ' + g.in : '') : r.inSrc === 'gps' ? T('today.src.gps') : T('today.none');
  $('#outSrc').textContent = r.provisionalOut ? T('today.leftProvisional', { t: fromMin(leaveFinalMin(r.outHM, settings)) }) : r.outSrc === 'manual' ? T('today.src.manual') + (g.out && g.out !== r.outHM ? ' · GPS ' + g.out : '') : r.outSrc === 'gps' ? T('today.src.gps') : T('today.none');
  $('#workedToday').textContent = fmtH(r.workedMin);
  const otTxt = r.ot150 ? `<span class="pill r150">OT 150%: ${fmtH(r.ot150)}</span>` : r.ot200 ? `<span class="pill r200">200%: ${fmtH(r.ot200)}</span>` : r.ot300 ? `<span class="pill r300">300%: ${fmtH(r.ot300)}</span>` : (r.dt.type !== 'weekday' ? `<span class="pill">${esc(dayLabel(r.dt))}</span>` : '');
  $('#otToday').innerHTML = otTxt;

  const st = $('#todayStatus');
  let cls = '', txt = T('today.status.none');
  if (r.provisionalOut) { cls = 'trip'; txt = T('today.status.left'); }
  else if (r.outHM) { cls = 'done'; txt = T('today.status.done'); }
  else if (g.status === 'trip' && !r.outHM) { cls = 'trip'; txt = T('today.status.trip'); }
  else if (r.inHM) { cls = 'in'; txt = T('today.status.in'); }
  st.className = 'pill ' + cls; st.textContent = txt;

  const Pt = policyOf(settings);
  $('#wfhTodayBox').hidden = !Pt.wfh || !r.dt.work; $('#wfhToday').checked = !!rec.wfh;
  if (r.wfh && (r.inHM || rec.wfh)) { txt += ' · WFH'; }
  st.textContent = txt;
  const act = $('#punchActions'), t = nowHM();
  if (!r.inHM) act.innerHTML = `<button class="btn primary" id="btnIn">${esc(T('today.btnIn', { t }))}</button>`;
  else if (r.provisionalOut) act.innerHTML = `<button class="btn primary" id="btnConfirmOut">${esc(T('today.btnConfirmOut', { t: r.outHM }))}</button><button class="btn" id="btnOut">${esc(T('today.btnOut', { t }))}</button>`;
  else if (!r.outHM) act.innerHTML = `<button class="btn primary" id="btnOut">${esc(T('today.btnOut', { t }))}</button>`;
  else act.innerHTML = `<button class="btn" id="btnOut">${esc(T('today.btnUpdate', { t }))}</button>`;
  const bi = $('#btnIn'), bo = $('#btnOut');
  if (bi) bi.onclick = () => punch('in');
  if (bo) bo.onclick = () => punch('out');
  const bc = $('#btnConfirmOut');
  if (bc) bc.onclick = confirmLeave;

  const tl = $('#timeline'), evs = (rec.events || []).slice().sort((a, b) => a.t < b.t ? -1 : 1);
  tl.innerHTML = evs.length ? evs.map(e => `<li><time>${esc(e.t)}</time><span>${esc(eventText(e))}</span></li>`).join('')
    : `<li style="display:block"><div class="empty small">${esc(T('today.emptyLog'))}</div></li>`;
  syncTodayToNative();
  const sg = (rec.signals || []).slice().sort((a, b) => a.t < b.t ? -1 : 1);
  $('#signals').hidden = !sg.length;
  $('#signalList').innerHTML = sg.map(s => `<li class="${s.rejected ? 'rej' : ''}"><time>${esc(s.t)}</time><span>${esc(signalText(s))}</span></li>`).join('');
}
$('#wfhToday').addEventListener('change', () => {
  const key = todayKey(), rec = recFor(key, true), on = $('#wfhToday').checked;
  rec.wfh = on || undefined; logEvent(rec, nowHM(), on ? 'wfh.on' : 'wfh.off');
  touch(key); afterEdit(); toast(T(on ? 'today.wfhOn' : 'today.wfhOff'));
});
function punch(kind) {
  if (!ready) { toast(T('toast.loading')); return; }
  const key = todayKey(), rec = recFor(key, true), t = nowHM();
  if (kind === 'in') { rec.manualIn = t; logEvent(rec, t, 'manual.in'); toast(T('toast.checkedIn', { t })); }
  else {
    const was = rec.manualOut; rec.manualOut = t;
    if (was) logEvent(rec, t, 'manual.outUpdate', { was }); else logEvent(rec, t, 'manual.out');
    toast(T('toast.checkedOut', { t }));
  }
  touch(key); renderToday();
}
/* "Confirm check-out at 12:08": the provisional check-out becomes the check-out now. */
function confirmLeave() {
  if (!ready) { toast(T('toast.loading')); return; }
  const key = todayKey(), rec = recFor(key, true), at = rec.gps && rec.gps.lastLeave;
  const evs = settleLeave(rec.gps, key, Date.now(), settings, 'app');
  if (!evs.length) return;
  evs.forEach(e => logEvent(rec, e.t, e.code, e.p));
  touch(key); renderToday(); toast(T('toast.confirmedOut', { t: at }));
}
/* Provisional check-outs whose waiting time has passed (or whose day is over) become check-outs. */
function settleDays() {
  if (!ready) return false;
  const now = Date.now(); let changed = false;
  for (const mo of Object.values(months)) {
    for (const [key, rec] of Object.entries(mo.days || {})) {
      const evs = settleLeave(rec.gps, key, now, settings);
      if (!evs.length) continue;
      evs.forEach(e => logEvent(rec, e.t, e.code, e.p));
      touch(key); changed = true;
      if (key === todayKey()) evs.forEach(e => toast(eventText(e)));
    }
  }
  return changed;
}
$('#editTodayBtn').addEventListener('click', () => openEdit(todayKey()));
const tickClock = () => { const d = new Date(); $('#clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
tickClock(); setInterval(tickClock, 1000);
setInterval(() => {
  if (!ready) return;
  const changed = settleDays();
  if (!$('#view-today').hidden) renderToday();
  if (changed && (!$('#view-month').hidden || !$('#view-pay').hidden)) renderMonthViews();
}, 20000);

/* ---------- GPS (web: only while the page is open) ---------- */
const gpsRt = { day: null, insideSince: null, outsideSince: null, lastInside: null, lastDist: null, acc: null };
function loadRt() {
  try { const v = JSON.parse(localStorage.getItem('olive:gpsrt') || 'null'); if (v && v.day === todayKey()) Object.assign(gpsRt, v); } catch (e) {}
}
function storeRt() { try { localStorage.setItem('olive:gpsrt', JSON.stringify(gpsRt)); } catch (e) {} }
function gpsUI(state, html) {
  const dot = $('#gpsDot'), pill = $('#gpsPill');
  dot.className = 'gps-dot ' + (state === 'on' ? 'on' : state === 'off' ? 'off' : '');
  pill.className = 'pill ' + (state === 'on' ? 'in' : state === 'off' ? 'warn' : '');
  pill.textContent = T(state === 'on' ? 'gps.pill.on' : state === 'off' ? 'gps.pill.off' : 'gps.pill.idle');
  $('#gpsText').innerHTML = html;
}
function gpsTick(nowMs) {
  if (gpsRt.lastInside == null) return;
  const key = todayKey();
  if (gpsRt.day !== key) { gpsRt.day = key; gpsRt.insideSince = null; gpsRt.outsideSince = null; }
  const rec = recFor(key, true);
  rec.gps = rec.gps || {};
  const before = JSON.stringify(rec.gps);
  const evs = gpsStep(gpsRt, rec.gps, gpsRt.lastInside, nowMs || Date.now(), settings, rec.manualIn || null);
  evs.forEach(e => logEvent(rec, e.t, e.code, e.p));
  storeRt();
  if (evs.length || JSON.stringify(rec.gps) !== before) { touch(key); renderToday(); evs.forEach(e => toast(eventText(e))); }
  const o = settings.office;
  gpsUI('on', T('gps.web.status', {
    dist: Math.round(gpsRt.lastDist), acc: Math.round(gpsRt.acc), office: esc(o.name || T('office.default')),
    where: gpsRt.lastInside ? T('gps.web.inside') : T('gps.web.outside', { r: o.radius }),
  }));
}
let watchId = null, gpsTimer = null;
function startGps() {
  if (NATIVE) return startNativeGeofence();
  const o = settings.office;
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (o.lat == null || o.lng == null) { gpsUI('idle', T('gps.noOffice.web')); return; }
  if (!('geolocation' in navigator)) { gpsUI('off', esc(T('gps.noGeo'))); return; }
  gpsUI('idle', esc(T('gps.asking')));
  try {
    watchId = navigator.geolocation.watchPosition(pos => {
      const c = pos.coords;
      gpsRt.lastDist = distanceM(c.latitude, c.longitude, +o.lat, +o.lng);
      gpsRt.acc = c.accuracy;
      gpsRt.lastInside = gpsRt.lastDist <= +o.radius;
      gpsTick(pos.timestamp || Date.now());
    }, err => {
      const why = err.code === 1 ? T('gps.blocked') : T('gps.noFix');
      gpsUI('off', esc(why + ' ' + T('gps.frameHint')));
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  } catch (e) { gpsUI('off', esc(T('gps.cantRun'))); }
  clearInterval(gpsTimer);
  gpsTimer = setInterval(() => gpsTick(Date.now()), 30000); // keeps counting the 5 minutes even if you stand still
}

/* ---------- Android: background check-in (geofence + active tracking) ---------- */
let geoRt = {};
function loadGeoRt() { try { geoRt = JSON.parse(localStorage.getItem('olive:geort') || '{}') || {}; } catch (e) { geoRt = {}; } }
function storeGeoRt() {
  const keep = {}, tk = todayKey(), yk = dateKey(new Date(Date.now() - 86400000));
  [tk, yk].forEach(k => { if (geoRt[k]) keep[k] = geoRt[k]; });
  geoRt = keep;
  try { localStorage.setItem('olive:geort', JSON.stringify(geoRt)); } catch (e) {}
}
let syncRunning = null;
function syncGeofenceEvents() {
  // One sync at a time: two overlapping reads of the queue logged every signal twice
  if (!syncRunning) syncRunning = doSyncGeofenceEvents().finally(() => { syncRunning = null; });
  return syncRunning;
}
async function doSyncGeofenceEvents() {
  if (!NATIVE || !ready) return;
  let res;
  try { res = await Native.geo.getEvents(); } catch (e) { return; }
  const events = (res && res.events) || [];
  if (!events.length) return;
  const keys = [...new Set(events.map(e => dateKey(new Date(e.time))))];
  for (const k of keys) { const [y, m] = k.split('-').map(Number); await ensureMonth(y, m); }
  const out = geofenceReplay(events, geoRt, k => recFor(k, true), settings);
  out.forEach(x => {
    const rec = recFor(x.key, true);
    if (x.kind === 'signal') {
      const { key, kind, ...sig } = x;
      rec.signals = (rec.signals || []).concat([sig]).slice(-60);
    } else logEvent(rec, x.t, x.code, x.p);
  });
  keys.forEach(touch);
  storeGeoRt();
  settleDays();
  try { await Native.geo.clearEvents({ upTo: Math.max(...events.map(e => e.time)) }); } catch (e) {}
  renderToday();
  if (!$('#view-month').hidden || !$('#view-pay').hidden) renderMonthViews();
  const lastEv = out.filter(x => x.kind === 'event').pop();
  if (lastEv) toast(eventText(lastEv));
}
function nativeCard(st) {
  const o = settings.office, w = settings.work;
  const btn = (id, key) => `<button class="btn sm" id="${id}" style="margin-top:8px">${esc(T(key))}</button>`;
  if (o.lat == null || o.lng == null) return gpsUI('idle', T('gps.noOffice.native'));
  if (!st.fine) return gpsUI('off', esc(T('gps.needFine')) + '<br>' + btn('gpPermFine', 'gps.btnFine'));
  if (!st.background) return gpsUI('off', T('gps.needBg') + '<br>' + btn('gpPermBg', 'gps.btnBg'));
  const t = st.tracking || {};
  const where = t.wifi ? T('gps.where.wifi') : t.dist >= 0 ? T('gps.where.dist', { dist: fmtDist(t.dist) }) : '';
  const when = t.at ? ' ' + T('gps.at', { t: fromMin(minOfDay(t.at)) }) : '';
  let html, state;
  if (t.running) {
    state = 'on';
    const checkedIn = t.mode === 'waiting' && recFor(todayKey()) && computeDay(todayKey(), recFor(todayKey()), settings).inHM;
    const lbl = checkedIn ? T('gps.mode.checkedIn') : (I18N['gps.mode.' + t.mode] ? T('gps.mode.' + t.mode) : T('gps.mode.tracking'));
    html = `<b>${esc(lbl)}</b>${where ? '<br>' + esc(where + when) : ''}<br><span class="small muted">${esc(T('gps.silentNote'))}</span><br>` + btn('gpTrackOff', 'gps.btnOff');
  } else if (t.done) {
    state = 'idle';
    html = esc(T('gps.stoppedToday')) + '<br>' + btn('gpTrackOn', 'gps.btnResume');
  } else if (t.shouldTrack) {
    state = 'idle';
    html = esc(T('gps.notStarted')) + '<br>' + btn('gpTrackOn', 'gps.btnStart');
  } else {
    state = st.registered ? 'on' : 'idle';
    html = esc(T('gps.outsideWindow', { start: w.trackStart, end: w.trackEnd }));
  }
  const nets = st.wifiNetworks || [];
  html += `<br><span class="small muted">${esc(nets.length ? T('gps.wifiList', { names: nets.map(n => n.ssid).slice(0, 3).join(', ') + (nets.length > 3 ? '…' : '') }) : T('gps.wifiNone'))}</span>`;
  if (st.batteryOptimized) html += `<br><span class="small">${esc(T('gps.battery'))}</span><br>` + btn('gpBattery', 'gps.btnBattery');
  gpsUI(state, html);
  $('#gpsPill').textContent = T(t.running ? 'gps.pill.on' : st.registered ? 'gps.pill.bg' : 'gps.pill.idle');
}
function bindNativeButtons() {
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  on('gpPermFine', async () => { try { await Native.geo.requestLocation(); } catch (e) {} startNativeGeofence(); });
  on('gpPermBg', async () => { try { await Native.geo.requestBackground(); } catch (e) {} setTimeout(startNativeGeofence, 800); });
  on('gpBattery', async () => { try { await Native.geo.openBatterySettings(); } catch (e) {} });
  on('gpTrackOff', async () => { try { nativeCard(await Native.geo.tracking({ action: 'off' })); bindNativeButtons(); toast(T('gps.trackOffToast')); } catch (e) {} });
  on('gpTrackOn', async () => { try { nativeCard(await Native.geo.tracking({ action: 'resume' })); bindNativeButtons(); } catch (e) {} });
}
async function refreshNative() {
  if (!NATIVE || !Native.geo) return;
  try { nativeCard(await Native.geo.getStatus()); bindNativeButtons(); } catch (e) {}
}
let lastTodaySig = '';
function syncTodayToNative() {
  if (!NATIVE || !ready || !Native.geo) return;
  const key = todayKey(), r = computeDay(key, recFor(key) || {}, settings);
  const out = r.outHM && !r.provisionalOut ? r.outHM : '';
  const prov = r.provisionalOut ? r.outHM : '';
  const sig = key + '|' + (r.inHM || '') + '|' + out + '|' + prov;
  if (sig === lastTodaySig) return;
  lastTodaySig = sig;
  Native.geo.setToday({ date: key, in: r.inHM || '', out, prov }).catch(() => { lastTodaySig = ''; });
}
async function startNativeGeofence() {
  const o = settings.office, w = settings.work;
  $('#wakeLock').closest('label').hidden = true;
  if (!Native.geo) { gpsUI('off', esc(T('gps.nativeMissing'))); return; }
  try { await Native.geo.setLanguage({ lang: LANG }); } catch (e) { /* older native builds */ }
  let st = { fine: false, background: false, registered: false };
  try {
    if (o.lat != null && o.lng != null) {
      st = await Native.geo.configure({
        lat: +o.lat, lng: +o.lng, radius: +o.radius, dwellMin: +w.dwellMin, name: o.name || T('office.default'),
        trackStart: w.trackStart, trackEnd: w.trackEnd, cutoff: w.afternoonCutoff, tripWindow: +w.tripWindowMin,
        lunchStart: w.lunchStart, lunchEnd: w.lunchEnd, finalizeMin: +w.leaveFinalizeMin,
        offDays: offDaysAhead(), lang: LANG,
      });
    } else { st = await Native.geo.getStatus(); }
  } catch (e) { gpsUI('off', esc(T('gps.nativeError', { msg: (e && e.message) || e }))); return; }
  nativeCard(st); bindNativeButtons();
  await syncGeofenceEvents();
  syncTodayToNative();
  clearInterval(gpsTimer);
  gpsTimer = setInterval(async () => { await syncGeofenceEvents(); refreshNative(); }, 30000);
}

/* Holidays plus the weekly rest days of the next 400 days: no tracking on those days */
function offDaysAhead() {
  const out = new Set(settings.holidays.map(h => h.date)), wd = workDaysOf(settings), d = new Date();
  for (let i = 0; i < 400; i++, d.setDate(d.getDate() + 1)) if (!wd.includes(d.getDay())) out.add(dateKey(d));
  return [...out];
}
let wakeSentinel = null;
$('#wakeLock').addEventListener('change', async e => {
  if (e.target.checked) {
    try { wakeSentinel = await navigator.wakeLock.request('screen'); toast(T('wake.on')); }
    catch (err) { e.target.checked = false; toast(T('wake.fail')); }
  } else if (wakeSentinel) { wakeSentinel.release(); wakeSentinel = null; }
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if ($('#wakeLock').checked) { try { wakeSentinel = await navigator.wakeLock.request('screen'); } catch (e) {} }
    if (ready && NATIVE) { startNativeGeofence(); }
    else if (ready) { gpsTick(Date.now()); renderToday(); }
  }
});

/* ---------- TIMESHEET + PAY ---------- */
/* A pay month may start in the previous calendar month (e.g. 24 Oct – 23 Nov): load and merge both */
const prevMonth = (y, m) => m === 1 ? [y - 1, 12] : [y, m - 1];
async function loadPeriod(y, m) {
  await ensureMonth(y, m);
  if (periodOf(y, m, settings).start > 1) await ensureMonth(...prevMonth(y, m));
}
function periodDays(y, m) {
  const cur = (months[monthKey(y, m)] || {}).days || {};
  if (periodOf(y, m, settings).start === 1) return cur;
  return { ...((months[monthKey(...prevMonth(y, m))] || {}).days || {}), ...cur };
}
const periodRangeTxt = M => M.period.start > 1 ? fmtDM(M.period.from) + ' – ' + fmtDM(M.period.to) : '';
function curMonthCalc() {
  const mo = months[monthKey(view.y, view.m)] || { days: {} };
  const n = new Date();
  return computeMonth(view.y, view.m, periodDays(view.y, view.m), settings, { key: todayKey(), min: n.getHours() * 60 + n.getMinutes() }, mo);
}
$$('[data-mnav]').forEach(b => b.addEventListener('click', async () => {
  let m = view.m + +b.dataset.mnav, y = view.y;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  view = { y, m }; await loadPeriod(y, m); settleDays(); renderMonthViews();
}));
/* Show the pay month that contains today (after the policy's period start changes, or at launch) */
async function viewToday() { view = payMonthOf(todayKey(), settings); await loadPeriod(view.y, view.m); }
function renderMonthViews() {
  const range = periodOf(view.y, view.m, settings);
  $$('.month-title').forEach(h => h.innerHTML = esc(T(range.start > 1 ? 'month.titlePeriod' : 'month.title', { month: range.start > 1 && LANG === 'vi' ? view.m : monthName(view.m), year: view.y }))
    + (range.start > 1 ? `<span class="period-range">${esc(fmtDM(range.from) + ' – ' + fmtDM(range.to))}</span>` : ''));
  const M = curMonthCalc();
  renderMonth(M); renderPay(M);
}
function typePill(r) {
  const t = r.dt.type;
  if (t === 'holiday') return `<span class="pill r300" title="${esc(dayLabel(r.dt))}">${esc(T('pill.hol'))}</span>`;
  if (t === 'comp') return `<span class="pill r200" title="${esc(dayLabel(r.dt))}">${esc(T('pill.comp'))}</span>`;
  if (t === 'sunday' || t === 'rest') return `<span class="pill r200">${esc(dowShort(r.dt.dow))}</span>`;
  if (t === 'saturday') return `<span class="pill">${esc(dowShort(6))}</span>`;
  return '';
}
const rnote = (raw, rd) => rd && rd !== raw ? `<span class="muted small"> → ${rd}</span>` : '';
const dash = v => v ? v : '<span class="muted">—</span>';
const tripText = r => r.trips.length ? r.trips.map(x => x.start + '–' + (x.end || '…')).join(', ') : T('month.yes');
const leaveText = lv => T(lv.type === 'paid' ? 'leave.paid' : 'leave.unpaid') + (lv.hours > 0 && lv.hours < 8 && lv.part !== 'am' && lv.part !== 'pm' ? ' · ' + T('leave.hours', { n: fmtNum(lv.hours) }) : lv.part === 'am' ? ' · ' + T('edit.part.am') : lv.part === 'pm' ? ' · ' + T('edit.part.pm') : '');
const leavePill = r => r.leave ? `<span class="pill ${r.leave.type === 'paid' ? 'leave' : 'unpaid'}">${esc(T(r.leave.type === 'paid' ? 'pill.leave' : 'pill.unpaid'))}${r.leave.days < 1 ? (r.leave.part === 'am' || r.leave.part === 'pm' ? ' ½' : ' ' + fmtNum(r.leave.hours) + 'h') : ''}</span>` : '';
const wfhPill = r => r.wfh ? '<span class="pill in">WFH</span>' : '';
const itemName = it => it.name || (it.tpl ? T('item.tpl.' + it.tpl) : '');
function renderMonth(M) {
  const t = M.totals;
  $('#monthStats').innerHTML = [
    [T('stat.worked'), fmtH(t.workedMin), ''],
    [T('stat.cong'), fmtNum(round2(t.cong + t.paidCong + t.paidLeave)) + ' / ' + M.std, ''],
    ['OT 150%', fmtH(t.ot150), 'r150'],
    ['OT 200%', fmtH(t.ot200), 'r200'],
    ['OT 300%', fmtH(t.ot300), 'r300'],
    [T('stat.trip'), t.tripDays, 'trip'],
    [T('stat.leave'), fmtNum(t.paidLeave) + ' · ' + fmtNum(t.unpaidLeave), ''],
    ...(M.policy.wfh ? [[T('stat.wfh'), t.wfhDays + (t.wfhCap != null ? ' / ' + t.wfhCap : ''), t.wfhCap != null && t.wfhDays > t.wfhCap ? 'r300' : '']] : []),
  ].map(([k, v, c]) => `<div class="stat ${c}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`).join('');
  $('#monthWarn').innerHTML = t.missing ? `<div class="notice">${esc(T('month.warn', { n: t.missing }))}</div>` : '';
  const tk = todayKey();
  const th = (k, n) => `<th${n ? ' class="n"' : ''}>${esc(T(k))}</th>`;
  const head = `<thead><tr><th class="sticky">${esc(T('col.date'))}</th>${th('col.type')}${th('col.in')}${th('col.out')}${th('col.lunch', 1)}${th('col.worked', 1)}${th('col.cong', 1)}<th class="n">OT 150%</th><th class="n">OT 200%</th><th class="n">OT 300%</th>${th('col.trip')}${th('col.note')}</tr></thead>`;
  const body = M.rows.map(r => {
    const cls = [r.dt.type === 'sunday' || r.dt.type === 'rest' || r.dt.type === 'comp' ? 'sun' : '', r.dt.type === 'holiday' ? 'hol' : '', !r.inHM ? 'off' : '', r.key === tk ? 'today' : ''].join(' ');
    const warn = r.missingOut || r.invalid ? ' ⚠' : '';
    const cong = r.cong + r.paidCong + r.paidLeave;
    return `<tr class="${cls}" data-key="${r.key}">
      <td class="sticky"><b>${esc(fmtDM(r.key))}</b> <span class="muted">${esc(dowShort(r.dt.dow))}</span>${warn}</td>
      <td>${typePill(r)}${leavePill(r)}${wfhPill(r)}</td>
      <td class="mono">${r.inHM ? esc(r.inHM) + `<span class="srcdot ${r.inSrc}"></span>` + rnote(r.inHM, r.inR) : dash()}</td>
      <td class="mono">${r.outHM ? esc(r.outHM) + `<span class="srcdot ${r.outSrc}"></span>` + (r.provisionalOut ? `<span class="muted small"> ${esc(T('month.provisional'))}</span>` : '') + rnote(r.outHM, r.outR) : (r.live ? `<span class="muted">${esc(T('month.working'))}</span>` : dash())}</td>
      <td class="n">${r.lunchMin ? r.lunchMin + "'" : dash()}</td>
      <td class="n">${r.workedMin ? fmtH(r.workedMin) : dash()}</td>
      <td class="n">${cong ? fmtNum(cong) : dash()}</td>
      <td class="n" style="color:var(--r150)">${r.ot150 ? fmtH(r.ot150) : dash()}</td>
      <td class="n" style="color:var(--r200)">${r.ot200 ? fmtH(r.ot200) : dash()}</td>
      <td class="n" style="color:var(--r300)">${r.ot300 ? fmtH(r.ot300) : dash()}</td>
      <td>${r.trip ? `<span class="pill trip">${esc(tripText(r))}</span>` : ''}</td>
      <td class="small" style="max-width:220px;white-space:normal">${esc([nightNote(r), r.note || (r.dt.type === 'holiday' || r.dt.type === 'comp' ? dayLabel(r.dt) : '')].filter(Boolean).join(' · '))}</td></tr>`;
  }).join('');
  const foot = `<tfoot><tr><td class="sticky">${esc(T('col.total'))}</td><td></td><td></td><td></td><td></td><td class="n">${fmtH(t.workedMin)}</td><td class="n">${fmtNum(round2(t.cong + t.paidCong + t.paidLeave))}</td><td class="n">${fmtH(t.ot150)}</td><td class="n">${fmtH(t.ot200)}</td><td class="n">${fmtH(t.ot300)}</td><td>${esc(T('month.days', { n: t.tripDays }))}</td><td></td></tr></tfoot>`;
  const tb = $('#monthTable');
  tb.innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
  tb.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openEdit(tr.dataset.key)));
}
$('#addDayBtn').addEventListener('click', () => {
  const tk = todayKey(), p = periodOf(view.y, view.m, settings);
  openEdit(p.keys.includes(tk) ? tk : p.from);
});

function payBreakdown(M) {
  const rows = M.rows, t = M.totals;
  const sals = [...new Set(rows.filter(r => r.salary).map(r => r.salary.id))];
  const single = sals.length === 1 ? rows.find(r => r.salary).salary : null;
  return {
    single, multi: sals.length > 1, otBase: single ? single.base : null,
    dayRate: single ? (M.policy.dayPay === 'gross' ? single.gross : single.base) / M.std : null,
    leaveRate: single ? (M.policy.leavePay === 'gross' ? single.gross : single.base) / M.std : null,
    hourly: single ? (M.policy.otBasis === 'gross' ? single.gross : single.base) / M.std / 8 : null,
    items: t.items.filter(i => i.amount > 0 || i.kind === 'performance'),
    workCong: round2(t.cong), paidCong: t.paidCong, paidLeave: t.paidLeave, unpaidLeave: t.unpaidLeave,
    workPay: t.workPay, paidPay: t.holidayPay, leavePay: t.leavePay,
    ot150Pay: t.ot150Pay, ot200Pay: t.ot200Pay, ot300Pay: t.ot300Pay, D: M.deductions,
  };
}
const statusLabel = s => T(s === 'official' ? 'pay.status.official' : 'pay.status.probation');
/* Night work lines that have hours this month: [key, minutes, percent, pay] */
const nightLines = t => [['otn200', t.otn200, 200, t.otn200Pay], ['otn270', t.otn270, 270, t.otn270Pay], ['otn390', t.otn390, 390, t.otn390Pay], ['night', t.nightMin, 30, t.nightPay]].filter(x => x[1] > 0);
const nightNote = r => [r.otn200 && T('note.otn', { h: fmtHdec(r.otn200), pct: 200 }), r.otn270 && T('note.otn', { h: fmtHdec(r.otn270), pct: 270 }), r.otn390 && T('note.otn', { h: fmtHdec(r.otn390), pct: 390 }), r.nightMin && T('note.night', { h: fmtHdec(r.nightMin) })].filter(Boolean).join(' · ');
/* One pay item's explanation: "21 workdays × 20,000", "19,658,063 × 33.33% × 21/21 workdays" … */
function itemDetail(i, M) {
  const t = M.totals, b = { cong: fmtNum(round2(t.cong)), std: M.std, amt: fmtVnd(i.unit) };
  const tax = i.tax === 'exempt' ? ' · ' + T('item.tax.exempt') : i.tax === 'meal' ? ' · ' + T('item.mealSub', { cap: fmtVnd(M.deductions.mealCap) }) : '';
  const sal = (M.rows.find(r => r.salary) || {}).salary;
  switch (i.kind) {
    case 'perDay': return T('item.d.perDay', b) + tax;
    case 'lunchDay': return T('item.d.lunchDay', { ...b, n: t.lunchDays }) + tax;
    case 'byDays': return T('item.d.byDays', b) + tax;
    case 'fixed': return T('item.d.fixed', b) + tax;
    case 'performance': return (M.rating ? T('item.d.perf', { ...b, base: sal ? fmtVnd(sal.base) : '—', pct: fmtPct(M.rating.pct), rating: M.rating.name }) : T('item.d.perfNone')) + tax;
    default: return tax;
  }
}
const neg = n => n ? '−' + fmtVnd(n) : fmtVnd(0);
/* Insurance and PIT lines shared by the Pay tab and the exports: [label, detail, amount] */
function deductionLines(D) {
  const I = D.insurance, out = [];
  if (I.due) {
    const on = T('pay.ins.on', { base: fmtVnd(I.base) }) + (I.capped ? ' ' + T('pay.ins.capped') : '');
    out.push([T('pay.ins.social'), on, I.social], [T('pay.ins.health'), on, I.health], [T('pay.ins.unemp'), on, I.unemployment]);
  } else {
    out.push([T('pay.ins.title'), T('pay.ins.none.' + I.reason), 0]);
  }
  if (D.progIncome > 0) {
    out.push([T('pay.pit.prog'), T('pay.pit.progSub', {
      income: fmtVnd(D.progIncome), ins: fmtVnd(I.total), fam: fmtVnd(D.family), n: D.dependents, taxable: fmtVnd(D.taxable),
    }), D.pitProgressive]);
  }
  if (D.probationIncome > 0 && D.mode !== 'progressive') {
    out.push([T('pay.pit.prob'), D.mode === 'commit' ? T('pay.pit.commit')
      : D.flatDue ? T('pay.pit.flatSub', { income: fmtVnd(D.probationIncome) })
      : T('pay.pit.below', { income: fmtVnd(D.probationIncome), min: fmtVnd(D.flatThreshold) }), D.pitFlat]);
  }
  return out;
}
function renderPay(M) {
  const t = M.totals, b = payBreakdown(M), D = M.deductions;
  const statusTxt = b.multi ? T('pay.status.multi') : b.single ? statusLabel(b.single.status) + ' · ' + T('pay.perMonth', { amount: fmtVnd(b.single.gross) }) : T('pay.status.none');
  $('#payTotal').innerHTML = `<span class="small muted">${esc(T('pay.netEstimate', { month: monthInline(view.m) }))}</span>
    <span class="v num">${fmtVnd(D.net)}</span>
    <span class="small">${esc(T('pay.grossLine', { gross: fmtVnd(D.gross), ded: fmtVnd(D.totalDeductions) }))}</span>
    <span class="row small"><span class="pill ${b.single && b.single.status === 'official' ? 'in' : ''}">${esc(statusTxt)}</span><span class="muted">${esc(T(M.policy.dayPay === 'base' ? 'pay.formulaBase' : 'pay.formula', { std: M.std }))}</span></span>
    ${t.noSalaryDays ? `<div class="notice" style="margin-top:8px">${esc(T('pay.noSalaryWarn', { n: t.noSalaryDays }))}</div>` : ''}
    ${t.otPending ? `<div class="notice" style="margin-top:8px">${esc(T('pay.otPending', { h: fmtHdec(t.otPending) }))}</div>` : ''}
    ${t.wfhCap != null && t.wfhDays > t.wfhCap ? `<div class="notice" style="margin-top:8px">${esc(T('pay.wfhOver', { n: t.wfhDays, cap: t.wfhCap, pct: M.policy.wfhCapPct }))}</div>` : ''}`;
  const hourly = b.hourly;
  const sub = txt => txt ? `<br><span class="small muted">${esc(txt)}</span>` : '';
  const unit = pct => hourly ? T('pay.perHour', { rate: fmtVnd(hourly), pct }) : '';
  const hrs = min => esc(T('pay.hours', { h: fmtHdec(min) }));
  const line = (label, detail, amount, cls = '') => `<tr><td>${label}${sub(detail)}</td><td class="n ${cls}">${amount}</td></tr>`;
  const sec = k => `<tr><td class="sec" colspan="2">${esc(T(k))}</td></tr>`;
  $('#payLines').innerHTML = `<h3>${esc(T('pay.details'))}</h3><table class="lines" style="margin-top:6px"><tbody>
    ${sec('pay.sec.income')}
    ${line(esc(T('pay.line.work')), T('pay.line.workSub', { n: fmtNum(b.workCong) }) + ' (' + T('pay.hours', { h: fmtNum(round2(b.workCong * 8)) }) + ')' + (b.single ? ' × ' + fmtVnd(b.dayRate) : ''), fmtVnd(b.workPay))}
    ${line(esc(T('pay.line.paid')), T('pay.line.paidSub', { n: b.paidCong }), fmtVnd(b.paidPay))}
    ${line(esc(T(M.policy.leavePay === 'gross' ? 'pay.line.leave' : 'pay.line.leave')), T(M.policy.leavePay === 'gross' ? 'pay.line.leaveSubGross' : 'pay.line.leaveSub', { n: fmtNum(b.paidLeave) }) + (b.single ? ' × ' + fmtVnd(b.leaveRate) : ''), fmtVnd(b.leavePay))}
    ${b.items.map(i => line(esc(itemName(i)), itemDetail(i, M), fmtVnd(i.amount))).join('')}
    ${line(`<span class="pill r150">${esc(T('pay.line.ot150'))}</span> ${hrs(t.ot150)}`, unit(150), fmtVnd(b.ot150Pay))}
    ${line(`<span class="pill r200">${esc(T('pay.line.ot200'))}</span> ${hrs(t.ot200)}`, unit(200), fmtVnd(b.ot200Pay))}
    ${line(`<span class="pill r300">${esc(T('pay.line.ot300'))}</span> ${hrs(t.ot300)}`, unit(300), fmtVnd(b.ot300Pay))}
    ${nightLines(t).map(([k, min, pct, pay]) => line(`<span class="pill ${k === 'night' ? '' : 'r200'}">${esc(T('pay.line.' + k))}</span> ${hrs(min)}`, unit(pct), fmtVnd(pay))).join('')}
    <tr class="sub"><td>${esc(T('pay.line.gross'))}${sub(D.mealExempt || D.exemptItems ? T('pay.line.grossSubFree', { ot: fmtVnd(t.otPay), free: fmtVnd(D.mealExempt + D.exemptItems) }) : T('pay.line.grossSub', { ot: fmtVnd(t.otPay) }))}${b.multi && t.byStatus.probation != null && t.byStatus.official != null ? sub(T('pay.line.byStatus', { p: fmtVnd(t.byStatus.probation), o: fmtVnd(t.byStatus.official) })) : ''}</td><td class="n">${fmtVnd(D.gross)}</td></tr>
    ${sec('pay.sec.deduct')}
    ${deductionLines(D).map(([l, d, a]) => line(esc(l), d, neg(a), a ? 'neg' : '')).join('')}
    <tr class="sub"><td>${esc(T('pay.line.deductTotal'))}</td><td class="n neg">${neg(D.totalDeductions)}</td></tr>
    <tr><td>${esc(T('pay.line.net'))}</td><td class="n">${fmtVnd(D.net)}</td></tr></tbody></table>
    <p class="small muted" style="margin-bottom:0">${esc(T('pay.note'))}</p>`;
  renderLeaveCard(M);
  renderContractSummary(M);
  renderRating(M);
}
/* The month's performance rating (only when a performance item exists) */
function renderRating(M) {
  const box = $('#payRating'), has = M.policy.items.some(i => i.kind === 'performance') && M.policy.ratings.length;
  box.hidden = !has; if (!has) return;
  const mo = months[monthKey(view.y, view.m)] || {};
  box.innerHTML = `<div class="fields"><label class="f"><span>${esc(T('pay.rating', { month: monthInline(view.m) }))}</span><select id="payRatingSel">${M.policy.ratings.map(r => `<option value="${esc(r.id)}" ${M.rating && M.rating.id === r.id ? 'selected' : ''}>${esc(r.name)} · ${esc(fmtPct(r.pct))}%</option>`).join('')}</select><span class="hint">${esc(T(mo.rating ? 'pay.ratingChosen' : 'pay.ratingDefault'))}</span></label></div>`;
  $('#payRatingSel').onchange = async e => {
    const mo2 = await ensureMonth(view.y, view.m); mo2.rating = e.target.value;
    saveMonth(monthKey(view.y, view.m)); renderMonthViews(); toast(T('set.saved'));
  };
}
/* Annual leave needs every month of the year */
const loadedYears = new Set();
async function ensureYear(y) {
  if (loadedYears.has(y)) return false;
  for (let m = 1; m <= 12; m++) await ensureMonth(y, m);
  loadedYears.add(y); return true;
}
function renderLeaveCard(M) {
  const u = leaveUsed(view.y, m => (months[monthKey(view.y, m)] || {}).days, settings, M.period.to);
  const t = M.totals;
  $('#payLeave').innerHTML = `<h3>${esc(T('lv.title'))}</h3>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="k">${esc(T(u.monthly ? 'lv.usedAccrued' : 'lv.used', { y: view.y, d: fmtDM(M.period.to) }))}</div><div class="v">${fmtNum(u.used)} / ${fmtNum(u.accrued)}</div></div>
      <div class="stat ${u.left < 0 ? 'r300' : 'r200'}"><div class="k">${esc(T('lv.left'))}</div><div class="v">${fmtNum(u.left)}</div></div>
      <div class="stat"><div class="k">${esc(T('lv.month'))}</div><div class="v">${fmtNum(t.paidLeave)} · ${fmtNum(t.unpaidLeave)}</div></div>
      ${M.policy.t13 ? `<div class="stat"><div class="k">${esc(T('lv.t13', { y: view.y }))}</div><div class="v">${fmtNum(round2(yearT13(view.y)))}</div></div>` : ''}
      ${M.policy.wfh ? `<div class="stat ${t.wfhCap != null && t.wfhDays > t.wfhCap ? 'r300' : ''}"><div class="k">${esc(T('lv.wfh'))}</div><div class="v">${t.wfhDays}${t.wfhCap != null ? ' / ' + t.wfhCap : ''}</div></div>` : ''}
    </div>
    ${u.left < 0 ? `<div class="notice" style="margin-top:10px">${esc(T('lv.over', { n: fmtNum(-u.left) }))}</div>` : ''}
    <p class="small muted" style="margin-bottom:0">${esc(T('lv.hint'))}</p>`;
  ensureYear(view.y).then(loaded => { if (loaded && !$('#view-pay').hidden) renderLeaveCard(curMonthCalc()); });
}
/* Days counted for the 13th-month salary this year (workdays, paid holidays, paid leave) */
function yearT13(y) {
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const mo = months[monthKey(y, m)]; if (!mo) continue;
    const cal = { ...settings, policy: { ...policyOf(settings), periodStart: 1 } };   // calendar months
    n += computeMonth(y, m, mo.days, cal, null, mo).totals.t13Cong;
  }
  return n;
}
function renderContractSummary(M) {
  const C = M.contract;
  const baseMode = M.policy.dayPay === 'base';
  const item = (k, p) => p.from && (p.gross > 0 || p.base > 0) ? `<li><span><b>${esc(T(k))}</b><br><span class="small muted">${esc(fmtDMY(p.from))} – ${esc(p.to ? fmtDMY(p.to) : T('ct.openEnded'))}</span></span><span class="small" style="text-align:right">${baseMode ? esc(T('ct.titleIs', { amount: fmtVnd(p.base) })) : esc(T('ct.grossIs', { amount: fmtVnd(p.gross) })) + '<br><span class="muted">' + esc(T('ct.baseIs', { amount: fmtVnd(p.base > 0 ? p.base : p.gross) })) + '</span>'}</span></li>` : '';
  const list = item('ct.probation', C.probation) + item('ct.official', C.official);
  $('#payContract').innerHTML = `<div class="spread"><h3>${esc(T('ct.title'))}</h3><button class="btn sm" id="goContract">${esc(T('ct.edit'))}</button></div>
    <ul class="sal-list" style="margin-top:12px">${list || `<li class="empty small" style="display:block">${esc(T('ct.empty'))}</li>`}</ul>`;
  $('#goContract').onclick = () => { showTab('settings'); $('#contractCard').scrollIntoView({ block: 'start' }); };
}

/* ---------- Edit a day ---------- */
let editKey = null, delArmed = false;
async function openEdit(key) {
  const [y, m] = key.split('-').map(Number); await ensureMonth(y, m);
  editKey = key; delArmed = false; $('#edDelete').textContent = T('edit.delete');
  const rec = recFor(key) || {}, g = rec.gps || {}, dt = dayTypeOf(key, settings);
  $('#edTitle').textContent = T('edit.title', { d: fmtDMY(key) });
  $('#edMeta').innerHTML = `<span class="pill">${esc(dowShort(dt.dow))}</span><span class="pill ${dt.type === 'holiday' ? 'r300' : dt.type === 'sunday' || dt.type === 'rest' || dt.type === 'comp' ? 'r200' : ''}">${esc(dayLabel(dt))}</span>`;
  $('#edDate').value = key;
  $('#edIn').value = rec.manualIn || g.in || '';
  $('#edOut').value = rec.manualOut || g.out || '';
  $('#edNote').value = rec.note || '';
  $('#edTrip').checked = !!(rec.manualTrip || (g.trips && g.trips.length));
  const lv = rec.leave || {};
  $('#edLeavePaid').checked = lv.type === 'paid'; $('#edLeaveUnpaid').checked = lv.type === 'unpaid';
  fillLeaveParts();
  $('#edLeavePart').value = leavePartValue(lv);
  const P = policyOf(settings);
  $('#edWfhBox').hidden = !P.wfh || !dt.work; $('#edWfh').checked = !!rec.wfh;
  $('#edOtBox').hidden = !P.otApproval;
  $('#edOtApproved').value = rec.otApproved > 0 ? rec.otApproved : '';
  const rd = computeDay(key, rec, settings);
  $('#edOtHint').textContent = T('edit.otRecorded', { h: fmtHdec(rd.otRecorded) });
  const leaveable = dt.type === 'weekday' || dt.type === 'saturday';
  $('#edLeaveBox').hidden = !leaveable;
  $('#edLeavePart').closest('label').hidden = dt.type === 'saturday';
  syncLeavePart();
  $('#edGps').textContent = g.in || g.out || (g.trips && g.trips.length)
    ? T('edit.gpsInfo', {
      in: g.in || '—', out: g.out || '—',
      trips: g.trips && g.trips.length ? T('edit.gpsTrips', { trips: g.trips.map(x => x.start + '–' + (x.end || '…')).join(', ') }) : '',
    })
    : T('edit.manualWins');
  $('#edUseGps').hidden = !(g.in || g.out);
  $('#editModal').hidden = false; $('#edIn').focus();
}
function closeEdit() { $('#editModal').hidden = true; editKey = null; }
/* Leave choices follow the policy's smallest unit: half days, or whole hours */
function fillLeaveParts() {
  const unit = +policyOf(settings).leaveUnitHours || 4, sel = $('#edLeavePart');
  const opts = unit >= 4 ? [['full', T('edit.part.full')], ['am', T('edit.part.am')], ['pm', T('edit.part.pm')]]
    : [['full', T('edit.part.full')], ...[1, 2, 3, 4, 5, 6, 7].map(h => ['h' + h, T('leave.hours', { n: h })])];
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
}
function leavePartValue(lv) {
  const unit = +policyOf(settings).leaveUnitHours || 4;
  if (!lv || !lv.type) return 'full';
  const h = lv.hours > 0 ? +lv.hours : lv.part === 'am' || lv.part === 'pm' ? 4 : 8;
  if (h >= 8) return 'full';
  if (unit >= 4) return lv.part === 'pm' ? 'pm' : 'am';
  return 'h' + Math.round(h);
}
function syncLeavePart() { $('#edLeavePart').disabled = !$('#edLeavePaid').checked && !$('#edLeaveUnpaid').checked; }
$('#edLeavePaid').addEventListener('change', () => { if ($('#edLeavePaid').checked) $('#edLeaveUnpaid').checked = false; syncLeavePart(); });
$('#edLeaveUnpaid').addEventListener('change', () => { if ($('#edLeaveUnpaid').checked) $('#edLeavePaid').checked = false; syncLeavePart(); });
$('#edClose').addEventListener('click', closeEdit);
$('#editModal').addEventListener('click', e => { if (e.target.id === 'editModal') closeEdit(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#editModal').hidden) closeEdit(); });
$('#edDate').addEventListener('change', e => { if (e.target.value) openEdit(e.target.value); });
function afterEdit() { renderToday(); renderMonthViews(); }
$('#edSave').addEventListener('click', () => {
  const key = editKey, rec = recFor(key, true), g = rec.gps || {};
  const vin = $('#edIn').value, vout = $('#edOut').value;
  if (vin && vout && toMin(vout) <= toMin(vin)) { toast(T('edit.outBeforeIn')); return; }
  if (vout && !vin) { toast(T('edit.needIn')); return; }
  const changed = vin !== (rec.manualIn || g.in || '') || vout !== (rec.manualOut || g.out || '');
  // Same as GPS → keep GPS; different → store as a manual time; empty → clear it completely.
  rec.manualIn = vin && vin !== g.in ? vin : null;
  rec.manualOut = vout && vout !== g.out ? vout : null;
  if (!vin) { g.in = null; g.out = null; }
  if (!vout) g.out = null;
  if (rec.gps) rec.gps = g;
  rec.note = $('#edNote').value.trim();
  rec.manualTrip = $('#edTrip').checked && !(g.trips && g.trips.length) ? true : false;
  if (!$('#edTrip').checked && g.trips && g.trips.length) g.trips = [];
  const lvType = $('#edLeavePaid').checked ? 'paid' : $('#edLeaveUnpaid').checked ? 'unpaid' : null;
  const prevLv = JSON.stringify(rec.leave || null);
  const pv = dayTypeOf(key, settings).type === 'saturday' ? 'full' : $('#edLeavePart').value;
  rec.leave = lvType && !$('#edLeaveBox').hidden ? (pv[0] === 'h' ? { type: lvType, hours: +pv.slice(1) } : { type: lvType, part: pv }) : null;
  if (JSON.stringify(rec.leave) !== prevLv) logEvent(rec, nowHM(), 'edit.leave.' + (rec.leave ? rec.leave.type + '.' + (rec.leave.hours ? 'hours' : rec.leave.part) : 'none'), rec.leave && rec.leave.hours ? { n: rec.leave.hours } : undefined);
  const P = policyOf(settings);
  if (!$('#edWfhBox').hidden) {
    const w = $('#edWfh').checked;
    if (!!rec.wfh !== w) logEvent(rec, nowHM(), w ? 'wfh.on' : 'wfh.off');
    rec.wfh = w || undefined;
  }
  if (P.otApproval) {
    const ap = Math.max(0, num($('#edOtApproved').value, 0));
    if ((+rec.otApproved || 0) !== ap) logEvent(rec, nowHM(), 'ot.approved', { h: fmtNum(ap) });
    rec.otApproved = ap || undefined;
  }
  if (changed) logEvent(rec, nowHM(), 'edit', { in: vin || '—', out: vout || '—' });
  touch(key); closeEdit(); afterEdit(); toast(T('edit.saved', { d: fmtDM(key) }));
});
$('#edUseGps').addEventListener('click', () => {
  const rec = recFor(editKey, true); rec.manualIn = null; rec.manualOut = null;
  logEvent(rec, nowHM(), 'edit.useGps');
  touch(editKey); const k = editKey; closeEdit(); afterEdit(); toast(T('edit.usingGps', { d: fmtDM(k) }));
});
$('#edDelete').addEventListener('click', () => {
  if (!delArmed) { delArmed = true; $('#edDelete').textContent = T('edit.confirmDelete'); return; }
  const [y, m] = editKey.split('-').map(Number); const mo = months[monthKey(y, m)];
  if (mo) delete mo.days[editKey];
  touch(editKey); const k = editKey; closeEdit(); afterEdit(); toast(T('edit.deleted', { d: fmtDM(k) }));
});

/* ---------- Settings ---------- */
function renderSettings() {
  const o = settings.office, w = settings.work;
  $('#setLang').value = LANG;
  $('#setName').value = settings.name || '';
  $('#offName').value = o.name || ''; $('#offLat').value = o.lat ?? ''; $('#offLng').value = o.lng ?? ''; $('#offRadius').value = o.radius;
  $('#mapLink').href = o.lat != null ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : 'https://maps.google.com';
  $('#wLunchStart').value = w.lunchStart; $('#wLunchEnd').value = w.lunchEnd; $('#wSat').value = w.satStdHours;
  $('#wCutoff').value = w.afternoonCutoff; $('#wTrip').value = w.tripWindowMin; $('#wDwell').value = w.dwellMin;
  $('#wLeave').value = w.leaveConfirmMin; $('#wBlock').value = w.otBlockMin; $('#wFinalize').value = w.leaveFinalizeMin;
  $('#wRoundMin').value = w.roundMin; $('#wRoundMode').value = w.roundMode;
  const sel = $('#wStd'); if (![...sel.options].some(op => op.value === String(w.stdDaysMode))) sel.add(new Option(T('set.std.n', { n: w.stdDaysMode }), w.stdDaysMode)); sel.value = String(w.stdDaysMode);
  renderHolidays();
  renderPolicy();
  renderContract();
  $('#autoCard').hidden = !NATIVE;
  $('#wTrackStart').value = w.trackStart; $('#wTrackEnd').value = w.trackEnd;
  if (NATIVE && Native.geo) Native.geo.getStatus().then(st => renderWifiList(st.wifiNetworks || [], st.wifiCanScan)).catch(() => {});
  $('#backupNote').textContent = T(Store.mode === 'cloud' ? 'set.backupNote.cloud' : NATIVE ? 'set.backupNote.phone' : 'set.backupNote.local');
}
function renderHolidays() {
  const list = settings.holidays.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  $('#holList').innerHTML = list.map(h => `<div class="hol-item"><span class="mono">${esc(fmtDMY(h.date))}</span><span>${esc(holidayName(h))}</span><span class="pill ${h.kind === 'holiday' ? 'r300' : 'r200'}">${h.kind === 'holiday' ? '300%' : esc(T('pill.comp'))}</span><button class="x-btn" data-del-hol="${h.date}" aria-label="${esc(T('set.holDelete'))}">✕</button></div>`).join('') || `<div class="empty small">${esc(T('set.holEmpty'))}</div>`;
  $$('[data-del-hol]').forEach(x => x.onclick = () => { settings.holidays = settings.holidays.filter(h => h.date !== x.dataset.delHol); saveSettings(); renderHolidays(); });
}
const num = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
function readSettingsForm() {
  const o = settings.office, w = settings.work;
  settings.name = $('#setName').value.trim();
  o.name = $('#offName').value.trim();
  const lat = $('#offLat').value.trim(), lng = $('#offLng').value.trim();
  o.lat = lat === '' ? null : num(lat, null); o.lng = lng === '' ? null : num(lng, null);
  o.radius = Math.max(30, num($('#offRadius').value, 150));
  w.lunchStart = $('#wLunchStart').value || '12:00'; w.lunchEnd = $('#wLunchEnd').value || '13:00';
  w.satStdHours = Math.min(8, Math.max(1, num($('#wSat').value, 4)));
  w.afternoonCutoff = $('#wCutoff').value || '15:00';
  w.tripWindowMin = Math.max(5, num($('#wTrip').value, 60)); w.dwellMin = Math.max(1, num($('#wDwell').value, 5));
  w.leaveConfirmMin = Math.max(1, num($('#wLeave').value, 3)); w.otBlockMin = Math.max(1, num($('#wBlock').value, 30));
  w.leaveFinalizeMin = Math.max(5, num($('#wFinalize').value, 60));
  w.roundMin = Math.max(1, num($('#wRoundMin').value, 15)); w.roundMode = $('#wRoundMode').value || 'down';
  w.stdDaysMode = $('#wStd').value;
  w.trackStart = $('#wTrackStart').value || '05:30'; w.trackEnd = $('#wTrackEnd').value || '20:00';
  saveSettings();
  $('#mapLink').href = o.lat != null ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : 'https://maps.google.com';
}
['#setName', '#offName', '#offLat', '#offLng', '#offRadius', '#wLunchStart', '#wLunchEnd', '#wSat', '#wCutoff', '#wTrip', '#wDwell', '#wLeave', '#wFinalize', '#wBlock', '#wRoundMin', '#wRoundMode', '#wStd', '#wTrackStart', '#wTrackEnd']
  .forEach(s => $(s).addEventListener('change', () => { readSettingsForm(); if (['#offName', '#offLat', '#offLng', '#offRadius', '#wTrackStart', '#wTrackEnd', '#wCutoff', '#wDwell', '#wTrip', '#wFinalize', '#wLunchStart', '#wLunchEnd'].includes(s)) startGps(); toast(T('set.saved')); }));
function renderWifiList(nets, canScan) {
  $('#wifiList').innerHTML = nets.length
    ? esc(T('set.wifiSaved', { names: '\u0000' })).replace('\u0000', nets.map(n => '<b>' + esc(n.ssid) + '</b>').join(', '))
    : (canScan === false ? `<span style="color:var(--warn)">${esc(T('set.wifiOff'))}</span>` : `<span class="muted">${esc(T('set.wifiEmpty'))}</span>`);
}
$('#wifiLearnBtn').addEventListener('click', async () => {
  if (!NATIVE || !Native.geo) return;
  const b = $('#wifiLearnBtn'); b.disabled = true; b.textContent = T('set.wifiScanning');
  try {
    const res = await Native.geo.learnWifi();
    const nets = res.networks || [];
    renderWifiList(nets, true);
    toast(nets.length ? T('set.wifiLearned', { n: nets.length }) : T('set.wifiWeak'));
  } catch (e) { toast((e && e.message) || T('set.wifiFail')); }
  b.disabled = false; b.textContent = T('set.wifiLearn');
});
$('#wifiClearBtn').addEventListener('click', async () => {
  if (!NATIVE || !Native.geo) return;
  try { const st = await Native.geo.clearWifi(); renderWifiList(st.wifiNetworks || [], st.wifiCanScan); toast(T('set.wifiCleared')); } catch (e) {}
});
$('#useHereBtn').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast(T('set.noGps')); return; }
  toast(T('set.locating'));
  navigator.geolocation.getCurrentPosition(p => {
    $('#offLat').value = p.coords.latitude.toFixed(6); $('#offLng').value = p.coords.longitude.toFixed(6);
    readSettingsForm(); startGps(); toast(T('set.locSaved', { acc: Math.round(p.coords.accuracy) }));
  }, () => toast(T('set.locFail')), { enableHighAccuracy: true, timeout: 20000 });
});
$('#holForm').addEventListener('submit', e => {
  e.preventDefault();
  const date = $('#holDate').value, name = $('#holName').value.trim();
  if (!date || !name) return;
  settings.holidays = settings.holidays.filter(h => h.date !== date);
  settings.holidays.push({ date, name, kind: $('#holKind').value });
  saveSettings(); renderHolidays(); $('#holName').value = ''; toast(T('set.holAdded', { d: fmtDMY(date) }));
});

/* ---------- Company pay policy ---------- */
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
let editItemId = null, applyArmed = false;
function renderPolicy() {
  const P = policyOf(settings), wd = workDaysOf(settings);
  $('#polPreset').value = P.preset || 'custom';
  $('#polApply').textContent = T('pol.apply'); applyArmed = false;
  $('#polDays').innerHTML = DOW_ORDER.map(d => `<label class="check"><input type="checkbox" data-wd="${d}" ${wd.includes(d) ? 'checked' : ''}> ${esc(dowShort(d))}</label>`).join('');
  $$('[data-wd]').forEach(x => x.onchange = () => readPolicy());
  $('#polPeriod').value = P.periodStart || 1;
  $('#polDayPay').value = P.dayPay; $('#polOtBasis').value = P.otBasis; $('#polLeavePay').value = P.leavePay;
  $('#polLeaveUnit').value = String(+P.leaveUnitHours >= 4 ? 4 : 1);
  $('#polAccrual').value = P.leaveAccrual === 'monthly' ? 'monthly' : 'annual';
  $('#polOtApproval').checked = !!P.otApproval; $('#polWfh').checked = !!P.wfh; $('#polT13').checked = !!P.t13;
  $('#polWfhCap').value = P.wfhCapPct || 0; $('#polWfhCapBox').hidden = !P.wfh;
  const taxTxt = it => T('item.tax.' + (it.tax || 'taxable'));
  const amtTxt = it => it.kind === 'performance' ? T('item.perfSub') : fmtVnd(+it.amount || 0);
  $('#polItems').innerHTML = (P.items || []).length ? P.items.map(it => `<li><span data-edit-item="${esc(it.id)}" style="cursor:pointer;flex:1;min-width:0"><b>${esc(itemName(it))}</b> <span class="small">${esc(amtTxt(it))}</span><br><span class="small muted">${esc(T('item.kind.' + it.kind))}<br>${esc(taxTxt(it))} · ${esc(T(it.when === 'probation' ? 'ct.probation' : it.when === 'official' ? 'ct.official' : 'item.when.both'))}</span></span><button class="x-btn" data-del-item="${esc(it.id)}" aria-label="${esc(T('item.delete'))}">✕</button></li>`).join('')
    : `<li class="empty small" style="display:block">${esc(T('item.empty'))}</li>`;
  $$('[data-edit-item]').forEach(x => x.onclick = () => loadItem(x.dataset.editItem));
  $$('[data-del-item]').forEach(x => x.onclick = () => {
    settings.policy = { ...P, preset: 'custom', items: P.items.filter(i => i.id !== x.dataset.delItem) };
    if (editItemId === x.dataset.delItem) clearItem();
    afterPolicy(T('item.deleted'));
  });
  if (!editItemId) clearItem(); else syncItemForm();
  const hasPerf = (P.items || []).some(i => i.kind === 'performance');
  $('#polRatingsBox').hidden = !hasPerf;
  $('#polRatings').innerHTML = (P.ratings || []).map((r, i) => `<div class="row rt-row" style="gap:8px;margin-bottom:6px;flex-wrap:nowrap">
      <label class="check" title="${esc(T('pol.ratingDefault'))}"><input type="radio" name="rtDefault" data-rt-def="${i}" ${P.defaultRating === r.id ? 'checked' : ''}></label>
      <input data-rt-name="${i}" value="${esc(r.name)}" style="flex:2;min-width:0">
      <input data-rt-pct="${i}" value="${esc(fmtPct(r.pct))}" inputmode="decimal" style="flex:1;min-width:0;max-width:96px">
      <span class="small muted">%</span><button class="x-btn" data-rt-del="${i}" aria-label="${esc(T('item.delete'))}">✕</button></div>`).join('');
  $$('[data-rt-name],[data-rt-pct],[data-rt-def]').forEach(x => x.onchange = readRatings);
  $$('[data-rt-del]').forEach(x => x.onclick = () => { const list = P.ratings.slice(); list.splice(+x.dataset.rtDel, 1); settings.policy = { ...P, ratings: list }; afterPolicy(); });
  syncContractLabels();
}
const fmtPct = p => Number(p).toLocaleString(LOCALE(), { maximumFractionDigits: 2 });
function readPolicy() {
  const P = policyOf(settings);
  const wd = $$('[data-wd]').filter(x => x.checked).map(x => +x.dataset.wd);
  if (!wd.length) { toast(T('pol.needDay')); renderPolicy(); return; }
  settings.work.workDays = wd.sort();
  const periodStart = Math.min(28, Math.max(1, Math.floor(num($('#polPeriod').value, 1))));
  const periodChanged = periodStart !== (+P.periodStart || 1);
  settings.policy = { ...P, preset: 'custom', periodStart,
    dayPay: $('#polDayPay').value, otBasis: $('#polOtBasis').value, leavePay: $('#polLeavePay').value,
    leaveUnitHours: +$('#polLeaveUnit').value, leaveAccrual: $('#polAccrual').value, otApproval: $('#polOtApproval').checked, wfh: $('#polWfh').checked,
    t13: $('#polT13').checked, wfhCapPct: Math.min(100, Math.max(0, num($('#polWfhCap').value, 0))) };
  if (periodChanged) { viewToday().then(() => afterPolicy(T('set.saved'))); } else afterPolicy(T('set.saved'));
  startGps();
}
function readRatings() {
  const P = policyOf(settings);
  const list = P.ratings.map((r, i) => {
    const pctIn = $(`[data-rt-pct="${i}"]`).value, same = pctIn === fmtPct(r.pct);
    return { ...r, name: $(`[data-rt-name="${i}"]`).value.trim() || r.name, pct: same ? r.pct : Math.max(0, num(pctIn, r.pct)) };
  });
  const def = $$('[data-rt-def]').find(x => x.checked);
  settings.policy = { ...P, ratings: list, defaultRating: def ? list[+def.dataset.rtDef].id : P.defaultRating };
  afterPolicy(T('set.saved'));
}
$('#rtAdd').addEventListener('click', () => {
  const P = policyOf(settings);
  settings.policy = { ...P, ratings: [...(P.ratings || []), { id: 'r' + Date.now(), name: T('pol.ratingNew'), pct: 0 }] };
  afterPolicy();
});
function afterPolicy(msg) { saveSettings(); renderPolicy(); renderMonthViews(); renderToday(); if (msg) toast(msg); }
['#polPeriod', '#polAccrual', '#polDayPay', '#polOtBasis', '#polLeavePay', '#polLeaveUnit', '#polOtApproval', '#polWfh', '#polT13', '#polWfhCap']
  .forEach(sel => $(sel).addEventListener('change', readPolicy));
$('#polApply').addEventListener('click', () => {
  const id = $('#polPreset').value, pre = POLICY_PRESETS[id];
  if (!pre) { toast(T('pol.customHint')); return; }
  if (!applyArmed) { applyArmed = true; $('#polApply').textContent = T('pol.applyConfirm'); return; }
  settings.work = { ...settings.work, ...pre.work, workDays: pre.work.workDays.slice() };
  settings.policy = pre.policy();
  editItemId = null; saveSettings(); renderSettings(); startGps();
  viewToday().then(() => { renderMonthViews(); renderToday(); });
  toast(T('pol.applied'));
});
$('#polPreset').addEventListener('change', () => { applyArmed = false; $('#polApply').textContent = T('pol.apply'); });
function clearItem() {
  editItemId = null; $('#itName').value = ''; $('#itKind').value = 'perDay'; $('#itAmount').value = '';
  $('#itWhen').value = 'both'; $('#itTax').value = 'taxable'; syncItemForm();
}
function loadItem(id) {
  const it = (policyOf(settings).items || []).find(i => i.id === id); if (!it) return;
  editItemId = id; $('#itName').value = itemName(it); $('#itKind').value = it.kind;
  $('#itAmount').value = it.amount > 0 ? fmtNum(it.amount) : ''; $('#itWhen').value = it.when || 'both'; $('#itTax').value = it.tax || 'taxable';
  syncItemForm(); $('#itName').focus(); toast(T('pay.editing'));
}
function syncItemForm() {
  $('#itAmountBox').hidden = $('#itKind').value === 'performance';
  $('#itSave').textContent = T(editItemId ? 'item.update' : 'item.save');
}
$('#itKind').addEventListener('change', syncItemForm);
$('#itNew').addEventListener('click', clearItem);
$('#itSave').addEventListener('click', () => {
  const P = policyOf(settings), kind = $('#itKind').value, name = $('#itName').value.trim();
  const amount = kind === 'performance' ? 0 : moneyVal('#itAmount');
  if (!name) { toast(T('item.needName')); return; }
  if (kind !== 'performance' && !amount) { toast(T('item.needAmount')); return; }
  const items = (P.items || []).slice(), old = items.find(i => i.id === editItemId);
  const it = { id: old ? old.id : 'i' + Date.now(), tpl: old && itemName(old) === name ? old.tpl : undefined,
    name: old && old.tpl && itemName(old) === name ? '' : name, kind, amount, when: $('#itWhen').value, tax: $('#itTax').value };
  if (old) items[items.indexOf(old)] = it; else items.push(it);
  let ratings = P.ratings || [], def = P.defaultRating;
  if (kind === 'performance' && !ratings.length) { ratings = POLICY_PRESETS.office.policy().ratings; def = 'solid'; }
  settings.policy = { ...P, preset: 'custom', items, ratings, defaultRating: def };
  editItemId = null; afterPolicy(T('item.saved'));
});
/* Share the rules (not salaries or timesheets) with colleagues */
const POLICY_WORK_KEYS = ['workDays', 'lunchStart', 'lunchEnd', 'satStdHours', 'stdDaysMode', 'roundMin', 'roundMode', 'otBlockMin', 'congUnitMin'];
$('#polExport').addEventListener('click', async () => {
  const work = {}; POLICY_WORK_KEYS.forEach(k => work[k] = settings.work[k]);
  const data = { type: 'olive-timekeeper-policy', version: 1, work, policy: policyOf(settings) };
  await saveFile('olive-timekeeper-policy.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
});
$('#polImport').addEventListener('click', () => $('#polFile').click());
$('#polFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.type !== 'olive-timekeeper-policy' || !data.policy) throw new Error('type');
    const work = {}; POLICY_WORK_KEYS.forEach(k => { if (data.work && data.work[k] != null) work[k] = data.work[k]; });
    settings.work = { ...settings.work, ...work };
    settings.policy = { ...POLICY_PRESETS.gross.policy(), ...data.policy };
    editItemId = null; saveSettings(); renderSettings(); startGps();
    await viewToday(); renderMonthViews(); renderToday();
    toast(T('pol.imported'));
  } catch (err) { toast(T('pol.importBad')); }
});
function syncContractLabels() {
  const baseMode = policyOf(settings).dayPay === 'base';
  $('#ctPGross').closest('label').hidden = baseMode; $('#ctOGross').closest('label').hidden = baseMode;
  $('#ctPBase').closest('label').querySelector('span').textContent = T(baseMode ? 'ct.baseTitleProb' : 'ct.base');
  $('#ctOBase').closest('label').querySelector('span').textContent = T(baseMode ? 'ct.baseTitle' : 'ct.baseIns');
}

/* ---------- Contract & salary ---------- */
const moneyVal = sel => +($(sel).value || '').replace(/\D/g, '');
const moneySet = (sel, n) => { $(sel).value = n > 0 ? fmtNum(n) : ''; };
$$('[data-money]').forEach(inp => inp.addEventListener('input', () => {
  const digits = inp.value.replace(/\D/g, ''); inp.value = digits ? fmtNum(+digits) : '';
}));
function renderContract() {
  const C = contractOf(settings);
  $('#ctPFrom').value = C.probation.from || ''; $('#ctPTo').value = C.probation.to || '';
  moneySet('#ctPBase', C.probation.base); moneySet('#ctPGross', C.probation.gross);
  $('#ctOFrom').value = C.official.from || ''; $('#ctOTo').value = C.official.to || '';
  moneySet('#ctOBase', C.official.base); moneySet('#ctOGross', C.official.gross);
  $('#ctDeps').value = C.dependents || 0; $('#ctProbTax').value = C.probationTax || 'flat10';
  $('#ctLeaveDays').value = C.leaveDaysPerYear;
}
function readContract(changed) {
  const p = { from: $('#ctPFrom').value, to: $('#ctPTo').value, base: moneyVal('#ctPBase'), gross: moneyVal('#ctPGross') };
  const o = { from: $('#ctOFrom').value, to: $('#ctOTo').value, base: moneyVal('#ctOBase'), gross: moneyVal('#ctOGross') };
  // Permanent start entered and probation end empty → probation ends the day before
  if (changed === '#ctOFrom' && o.from && p.from && !p.to && p.from < o.from) { p.to = addDays(o.from, -1); $('#ctPTo').value = p.to; }
  if (changed === '#ctPTo' && p.to && !o.from) { o.from = addDays(p.to, 1); $('#ctOFrom').value = o.from; }
  for (const x of [p, o]) if (x.from && x.to && x.to < x.from) { toast(T('ct.badRange')); return; }
  if (p.base > p.gross && p.gross || o.base > o.gross && o.gross) toast(T('ct.baseOverGross'));
  if (p.to && o.from && p.to >= o.from) toast(T('ct.overlap'));
  settings.contract = {
    probation: p, official: o,
    dependents: Math.max(0, Math.floor(num($('#ctDeps').value, 0))),
    probationTax: $('#ctProbTax').value || 'flat10',
    leaveDaysPerYear: Math.max(0, num($('#ctLeaveDays').value, 12)),
  };
  settings.salaries = []; // replaced by the contract
  saveSettings(); renderMonthViews(); toast(T('ct.saved'));
}
['#ctPFrom', '#ctPTo', '#ctPBase', '#ctPGross', '#ctOFrom', '#ctOTo', '#ctOBase', '#ctOGross', '#ctDeps', '#ctProbTax', '#ctLeaveDays']
  .forEach(sel => $(sel).addEventListener('change', () => readContract(sel)));

/* ---------- Files ---------- */
async function saveFile(filename, blob) {
  if (NATIVE) {
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const w = await Native.fs.writeFile({ path: filename, data: b64, directory: 'CACHE' });
      await Native.share.share({ title: filename, files: [w.uri], dialogTitle: T('file.shareTitle', { f: filename }) });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast(T('file.shareFail', { msg: (e && e.message) || T('file.error') })); }
    return;
  }
  const dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast(T('file.saved', { f: filename })); }
    catch (e) { if (e && e.code === 'declined') return; toast(T('file.dlFail', { code: (e && e.code) || T('file.error') })); }
    return;
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast(T('file.downloaded', { f: filename }));
}
const libs = {};
function loadOne(src) {
  return libs[src] || (libs[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete libs[src]; s.remove(); rej(new Error('load')); }; document.head.appendChild(s); }));
}
// The app / static-site build ships the libraries in lib/; on claude.ai they load from cdnjs.
function loadScript(src) {
  const local = 'lib/' + src.split('/').pop();
  if (window.claude) return loadOne(src);
  return loadOne(local).catch(() => loadOne(src));
}
const LIB_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const LIB_H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const LIB_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
const fileBase = () => T('file.base') + '-' + view.y + '-' + pad(view.m) + (settings.name ? '-' + slug(settings.name) : '');
const hdec = min => round2(min / 60);

function reportHeader(M) {
  const b = payBreakdown(M);
  return {
    b,
    salaryTxt: b.multi ? T('x.salaryMulti') : b.single ? T('x.salaryPerMonth', { amount: fmtNum(b.single.gross) }) : T('x.salaryNone'),
    otBaseTxt: b.multi ? T('x.salaryMulti') : b.single ? T('x.salaryPerMonth', { amount: fmtNum(b.otBase) }) : T('x.salaryNone'),
    statusTxt: b.multi ? T('x.statusMulti') : b.single ? statusLabel(b.single.status) : '—',
  };
}
function srcTxt(s) { return s === 'manual' ? T('x.src.manual') : s === 'gps' ? 'GPS' : ''; }

$('#xlsxBtn').addEventListener('click', async () => {
  const btn = $('#xlsxBtn'); btn.disabled = true;
  try {
    await loadScript(LIB_XLSX);
    const M = curMonthCalc(), t = M.totals, h = reportHeader(M), b = h.b;
    const C = k => T('x.col.' + k);
    const aoa = [
      [T('x.title', { month: monthName(view.m).toUpperCase(), year: view.y }) + (periodRangeTxt(M) ? ' (' + periodRangeTxt(M) + ')' : '')],
      [T('x.employee'), settings.name || '', '', T('x.status'), h.statusTxt, '', T('x.salary'), h.salaryTxt, '', T('x.otBase'), h.otBaseTxt],
      [T('x.std'), M.std, '', T('x.hourly'), b.single ? Math.round(b.otBase / M.std / 8) : T('x.hourlyPerDay'), '', T('x.exportedAt'), new Date().toLocaleString(LOCALE())],
      [],
      ['date', 'dow', 'type', 'in', 'inR', 'inSrc', 'out', 'outR', 'outSrc', 'lunch', 'worked', 'cong', 'paid', 'leave', 'ot150', 'ot200', 'ot300', 'trip', 'dayPay', 'otPay', 'dayTotal', 'note'].map(C),
    ];
    M.rows.forEach(r => aoa.push([
      fmtDMY(r.key), dowShort(r.dt.dow), dayLabel(r.dt),
      r.inHM || '', r.inR || '', srcTxt(r.inSrc), r.outHM || (r.live ? T('month.working') : r.missingOut ? T('x.missing') : ''), r.outHM ? (r.outR || '') : '', srcTxt(r.outSrc),
      r.lunchMin || '', r.workedMin ? hdec(r.workedMin) : '', r.cong || '', r.paidCong || '', r.leave ? leaveText(r.leave) : '',
      r.ot150 ? hdec(r.ot150) : '', r.ot200 ? hdec(r.ot200) : '', r.ot300 ? hdec(r.ot300) : '',
      r.trip ? (r.trips.length ? r.trips.map(x => x.start + '-' + (x.end || '?')).join(', ') : T('month.yes')) : '',
      r.basePay + r.itemsPay || '', r.otPay || '', r.total || '', [r.wfh ? 'WFH' : '', r.otPending ? T('x.otPending', { h: fmtHdec(r.otPending) }) : '', nightNote(r), r.note].filter(Boolean).join(' · '),
    ]));
    aoa.push([T('x.total'), '', '', '', '', '', '', '', '', '', hdec(t.workedMin), round2(t.cong), t.paidCong, T('x.leaveTotal', { p: fmtNum(t.paidLeave), u: fmtNum(t.unpaidLeave) }), hdec(t.ot150), hdec(t.ot200), hdec(t.ot300), T('x.unit.days', { n: t.tripDays }), t.basePay, t.otPay, t.total, '']);
    aoa.push([]);
    aoa.push([T('x.summary')]);
    const line = (label, qty, amount) => { const a = Array(22).fill(''); a[0] = label; a[3] = qty; a[20] = amount; return a; };
    const D = b.D;
    aoa.push(line(T('x.line.work'), T('x.unit.workdays', { n: b.workCong }), b.workPay));
    aoa.push(line(T('x.line.paid'), T('x.unit.days', { n: b.paidCong }), b.paidPay));
    aoa.push(line(T('x.line.leave'), T('x.unit.days', { n: b.paidLeave }), b.leavePay));
    b.items.forEach(i => aoa.push(line(itemName(i), itemDetail(i, M), i.amount)));
    aoa.push(line(T('x.line.ot150'), T('x.unit.hours', { n: hdec(t.ot150) }), b.ot150Pay));
    aoa.push(line(T('x.line.ot200'), T('x.unit.hours', { n: hdec(t.ot200) }), b.ot200Pay));
    aoa.push(line(T('x.line.ot300'), T('x.unit.hours', { n: hdec(t.ot300) }), b.ot300Pay));
    nightLines(t).forEach(([k, min, , pay]) => aoa.push(line(T('pay.line.' + k), T('x.unit.hours', { n: hdec(min) }), pay)));
    aoa.push(line(T('x.line.gross'), '', D.gross));
    deductionLines(D).forEach(([l, d, a]) => aoa.push(line(l, d, a ? -a : 0)));
    aoa.push(line(T('x.line.deductTotal'), '', -D.totalDeductions));
    aoa.push(line(T('x.line.net'), '', D.net));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [12, 5, 22, 8, 11, 9, 9, 11, 9, 10, 10, 10, 12, 16, 11, 11, 11, 16, 16, 13, 14, 30].map(w => ({ wch: w }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
    const moneyCols = [18, 19, 20];
    for (let R = 5; R < aoa.length; R++) moneyCols.forEach(Cc => { const c = ws[XLSX.utils.encode_cell({ r: R, c: Cc })]; if (c && typeof c.v === 'number') c.z = '#,##0'; });
    ws['!autofilter'] = { ref: 'A5:V' + (5 + M.rows.length) };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, T('x.sheet', { mm: pad(view.m), yyyy: view.y }));
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await saveFile(fileBase() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } catch (e) { console.error(e); toast(T('xlsx.fail')); }
  btn.disabled = false;
});

$('#pdfBtn').addEventListener('click', async () => {
  const btn = $('#pdfBtn'); btn.disabled = true; toast(T('pdf.making'));
  try {
    await Promise.all([loadScript(LIB_H2C), loadScript(LIB_JSPDF)]);
    const M = curMonthCalc(), t = M.totals, h = reportHeader(M), b = h.b;
    const stage = $('#pdfStage');
    const P = k => esc(T('pdf.col.' + k));
    const head = `<tr><th>${P('date')}</th><th>${P('dow')}</th><th>${P('type')}</th><th>${P('in')}</th><th>${P('out')}</th><th class="n">${P('lunch')}</th><th class="n">${P('worked')}</th><th class="n">${P('cong')}</th><th class="n">OT 150%</th><th class="n">OT 200%</th><th class="n">OT 300%</th><th>${P('trip')}</th><th class="n">${P('amount')}</th><th>${P('note')}</th></tr>`;
    const row = r => `<tr><td>${esc(fmtDM(r.key))}</td><td>${esc(dowShort(r.dt.dow))}</td><td>${esc(dayLabel(r.dt))}</td><td>${r.inHM ? r.inHM + (r.inR && r.inR !== r.inHM ? ' → ' + r.inR : '') + (r.inSrc === 'gps' ? ' (GPS)' : '') : ''}</td><td>${r.outHM ? r.outHM + (r.outR && r.outR !== r.outHM ? ' → ' + r.outR : '') + (r.outSrc === 'gps' ? ' (GPS)' : '') : r.missingOut ? esc(T('pdf.missing')) : ''}</td><td class="n">${r.lunchMin || ''}</td><td class="n">${r.workedMin ? fmtH(r.workedMin) : ''}</td><td class="n">${(r.cong + r.paidCong + r.paidLeave) ? fmtNum(r.cong + r.paidCong + r.paidLeave) : ''}</td><td class="n">${r.ot150 ? fmtH(r.ot150) : ''}</td><td class="n">${r.ot200 ? fmtH(r.ot200) : ''}</td><td class="n">${r.ot300 ? fmtH(r.ot300) : ''}</td><td>${r.trip ? esc(tripText(r)) : ''}</td><td class="n">${r.total ? fmtNum(r.total) : ''}</td><td>${esc([r.wfh ? 'WFH' : '', r.leave ? leaveText(r.leave) : '', nightNote(r), r.note].filter(Boolean).join(' · '))}</td></tr>`;
    const metaItem = (k, v) => `<span>${esc(T(k))}: <b>${esc(v)}</b></span>`;
    const meta = `<div class="meta">${metaItem('x.employee', settings.name || '—')}${metaItem('x.status', h.statusTxt)}${metaItem('x.salary', h.salaryTxt)}${metaItem('x.otBase', h.otBaseTxt)}${metaItem('x.std', M.std)}</div>`;
    const rows = M.rows, chunks = [rows.slice(0, 16), rows.slice(16)];
    const totalPages = 3;
    const foot = p => `<div class="foot"><span>${esc(T('pdf.footer'))}</span><span>${esc(T('pdf.page', { p, n: totalPages }))}</span></div>`;
    const mt = { month: monthInline(view.m), year: view.y };
    const sumRow = (label, qty, amount) => `<tr><td>${esc(label)}</td><td class="n" style="white-space:nowrap">${esc(qty)}</td><td class="n">${fmtNum(amount)}</td></tr>`;
    const pages = [
      `<div class="pdf-page"><h1>${esc(T('pdf.title', mt) + (periodRangeTxt(M) ? ' · ' + periodRangeTxt(M) : ''))}</h1>${meta}<table>${head}${chunks[0].map(row).join('')}</table>${foot(1)}</div>`,
      `<div class="pdf-page"><table>${head}${chunks[1].map(row).join('')}<tr><th colspan="6">${esc(T('col.total'))}</th><th class="n">${fmtH(t.workedMin)}</th><th class="n">${fmtNum(round2(t.cong + t.paidCong + t.paidLeave))}</th><th class="n">${fmtH(t.ot150)}</th><th class="n">${fmtH(t.ot200)}</th><th class="n">${fmtH(t.ot300)}</th><th>${esc(T('month.days', { n: t.tripDays }))}</th><th class="n">${fmtNum(t.total)}</th><th></th></tr></table>${foot(2)}</div>`,
      `<div class="pdf-page"><h1>${esc(T('pdf.payTitle', mt))}</h1>${meta}
        <table style="width:100%;font-size:12px">
        <tr><th>${esc(T('pdf.item'))}</th><th class="n">${esc(T('pdf.qty'))}</th><th class="n">${esc(T('pdf.amountVnd'))}</th></tr>
        ${sumRow(T('x.line.work'), T('x.unit.workdays', { n: fmtNum(b.workCong) }), b.workPay)}
        ${sumRow(T('x.line.paid'), T('x.unit.days', { n: b.paidCong }), b.paidPay)}
        ${sumRow(T('x.line.leave'), T('x.unit.days', { n: fmtNum(b.paidLeave) }), b.leavePay)}
        ${b.items.map(i => `<tr><td>${esc(itemName(i))} <span style="color:var(--pdf-muted);font-size:10px">· ${esc(itemDetail(i, M))}</span></td><td></td><td class="n">${fmtNum(i.amount)}</td></tr>`).join('')}
        ${sumRow(T('x.line.ot150'), T('x.unit.hours', { n: fmtHdec(t.ot150) }), b.ot150Pay)}
        ${sumRow(T('x.line.ot200'), T('x.unit.hours', { n: fmtHdec(t.ot200) }), b.ot200Pay)}
        ${sumRow(T('x.line.ot300'), T('x.unit.hours', { n: fmtHdec(t.ot300) }), b.ot300Pay)}
        ${nightLines(t).map(([k, min, , pay]) => sumRow(T('pay.line.' + k), T('x.unit.hours', { n: fmtHdec(min) }), pay)).join('')}
        <tr><th>${esc(T('x.line.gross'))}</th><th></th><th class="n">${fmtNum(b.D.gross)}</th></tr>
        ${deductionLines(b.D).map(([l, d, a]) => `<tr><td>${esc(l)} <span style="color:var(--pdf-muted);font-size:10px">· ${esc(d)}</span></td><td></td><td class="n">${a ? '−' + fmtNum(a) : '0'}</td></tr>`).join('')}
        <tr><th>${esc(T('x.line.deductTotal'))}</th><th></th><th class="n">${b.D.totalDeductions ? '−' : ''}${fmtNum(b.D.totalDeductions)}</th></tr>
        <tr><th>${esc(T('pdf.totalLine'))}</th><th></th><th class="n">${fmtNum(b.D.net)}</th></tr></table>
        <p style="color:var(--pdf-muted);font-size:10px;line-height:1.35;margin:8px 0 0">${esc(T('pdf.method', { std: M.std, sat: settings.work.satStdHours, round: settings.work.roundMin, block: settings.work.otBlockMin }))}</p>${foot(3)}</div>`,
    ];
    stage.innerHTML = pages.join('');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const els = stage.querySelectorAll('.pdf-page');
    for (let i = 0; i < els.length; i++) {
      const canvas = await html2canvas(els[i], { scale: 2, backgroundColor: '#ffffff', logging: false });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
    }
    stage.innerHTML = '';
    await saveFile(fileBase() + '.pdf', pdf.output('blob'));
  } catch (e) { console.error(e); toast(T('pdf.fail')); }
  btn.disabled = false;
});

/* ---------- Backup ---------- */
const BACKUP_IDS = ['olive-timekeeper', 'cham-cong-olive']; // the second one is the app's former name
$('#exportJsonBtn').addEventListener('click', async () => {
  const keys = [];
  const y0 = new Date().getFullYear();
  for (let y = y0 - 1; y <= y0 + 1; y++) for (let m = 1; m <= 12; m++) keys.push([y, m]);
  for (const [y, m] of keys) await ensureMonth(y, m);
  const data = { app: BACKUP_IDS[0], version: 1, exportedAt: new Date().toISOString(), settings, months: Object.fromEntries(Object.entries(months).filter(([, v]) => v.days && Object.keys(v.days).length)) };
  await saveFile('olive-timekeeper-backup-' + todayKey() + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
});
$('#importJson').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!BACKUP_IDS.includes(data.app)) throw new Error('x');
    settings = mergeSettings(data.settings);
    if (settings.lang && settings.lang !== LANG) { setLang(settings.lang); try { localStorage.setItem('olive:lang', LANG); } catch (err) {} applyLang(); }
    saveSettings();
    for (const [mk, mo] of Object.entries(data.months || {})) { months[mk] = mo; saveMonth(mk); }
    setStoreChip(); renderAll(); toast(T('bk.imported'));
  } catch (err) { toast(T('bk.bad')); }
  e.target.value = '';
});

/* ---------- Startup ---------- */
function mergeSettings(s) {
  const d = DEFAULT_SETTINGS();
  if (!s) return d;
  const work = { ...d.work, ...(s.work || {}) };
  if (work.roundRule !== 2) { work.roundMode = 'down'; work.roundRule = 2; } // company rule: round down
  const office = { ...d.office, ...(s.office || {}) };
  if (office.name === 'Văn phòng') office.name = ''; // old default name → shown as "the office" in each language
  if (!Array.isArray(work.workDays) || !work.workDays.length) work.workDays = d.work.workDays.slice();
  return { ...d, ...s, lang: s.lang || null, office, work, salaries: s.salaries || [], contract: contractOf(s), policy: policyOf(s), holidays: migrateHolidays(s.holidays || d.holidays) };
}
function renderAll() { renderToday(); renderMonthViews(); if (!$('#view-settings').hidden) renderSettings(); }
function setStoreChip() {
  const chip = $('#storeChip');
  chip.classList.toggle('ok', true);
  $('#storeText').textContent = T(Store.mode === 'cloud' ? 'store.cloud' : NATIVE ? 'store.phone' : 'store.local');
}
async function boot() {
  try { renderToday(); } catch (e) { console.error(e); }
  await Store.init();
  settings = mergeSettings(await Store.get('settings'));
  const lang = settings.lang || cachedLang() || detectLang();
  if (lang !== LANG) { setLang(lang); applyLang(); }
  if (settings.lang) { try { localStorage.setItem('olive:lang', LANG); } catch (e) {} }
  const n = new Date();
  await ensureMonth(n.getFullYear(), n.getMonth() + 1);
  await viewToday();
  ready = true;
  settleDays();
  setStoreChip(); renderAll(); loadRt(); loadGeoRt(); startGps();
  if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads');
}
boot().catch(e => { console.error(e); toast(T('err.boot', { msg: (e && e.message) || e })); });
window.addEventListener('error', e => toast(T('err.generic', { msg: e.message || T('err.unknown') })));
