/**
 * NOVA Browser — منطق واجهة المستخدم
 * إدارة التبويبات، شريط العنوان الذكي، الصفحة الرئيسية، الخلفيات التفاعلية،
 * الإشارات المرجعية، السجل، التنزيلات، الجلسات، والإعدادات.
 * صفحات الويب تُعرض عبر <webview> (Chromium حقيقي بعملية منفصلة) — لا iframe.
 */
'use strict';

/* ================= بيئة التشغيل ================= */
const IN_ELECTRON = !!window.nova;
if (!IN_ELECTRON) {
  // تشغيل الواجهة خارج Electron = معاينة تصميم فقط (التصفح الحقيقي يحتاج Chromium)
  window.nova = {
    minimize() {}, toggleMaximize() {}, close() {},
    onWindowState() {}, onOpenNewTab() {}, onSearchNewTab() {}, onDownloadUpdate() {}, onShortcut() {},
    openIncognito() { toast('النوافذ المتخفية تعمل داخل تطبيق Electron'); },
    openExternal(u) { window.open(u, '_blank'); },
    openDownload: async () => false, showInFolder() {}, openDownloadsFolder() { toast('متاح داخل التطبيق'); },
    clearSiteData: async () => true, getVersion: async () => '1.0.0 (معاينة)',
    setUiZoom(f) { document.body.style.zoom = f; }
  };
  document.body.classList.add('demo');
  document.getElementById('demo-chip').hidden = false;
}
const IS_INCOGNITO = new URLSearchParams(location.search).get('incognito') === '1' || !!window.nova.isIncognito;
const INCOG_PARTITION = `nova-incognito-${Date.now()}`; // قسم ذاكرة مؤقت لا يُحفظ على القرص
if (IS_INCOGNITO) {
  document.body.classList.add('incognito');
  document.getElementById('incognito-badge').hidden = false;
  document.getElementById('incognito-note').hidden = false;
}

/* ================= أدوات ================= */
const el = (id) => document.getElementById(id);
const { normalizeInput, isUrlLike, hostnameOf, isSecure } = window.NovaUrl;
let toastTimer = null;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function store(key, fallback) {
  try { const v = localStorage.getItem('nova.' + key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem('nova.' + key, JSON.stringify(val)); } catch { /* ممتلئ */ }
}
function fmtBytes(n) {
  if (!n) return '—';
  const u = ['بايت', 'كيلوبايت', 'ميغابايت', 'غيغابايت'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}
function fmtTime(t) {
  const d = new Date(t), now = new Date();
  const day = d.toDateString() === now.toDateString()
    ? 'اليوم'
    : d.toLocaleDateString('ar', { day: 'numeric', month: 'short' });
  return `${day} · ${d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`;
}

/* ================= أيقونات ================= */
const STAR_SVG = `<svg viewBox="0 0 100 100"><path d="M50 4 L61 39 L96 50 L61 61 L50 96 L39 61 L4 50 L39 39 Z" fill="#7c5cff"/><circle cx="78" cy="20" r="6" fill="#38b6ff"/></svg>`;
const HOME_FAVICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(STAR_SVG);
const GLOBE_FAVICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8a90b8" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>`);
const ICON_LOCK = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const ICON_WARN = `<svg viewBox="0 0 24 24"><path d="M12 4L2.5 20.5h19z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>`;
const ICON_SEARCH = `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
const ICON_CLOCK = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_STAR = `<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`;

/* ================= محركات البحث ================= */
const ENGINES = {
  google: {
    name: 'Google',
    template: 'https://www.google.com/search?q=%s',
    suggestUrl: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
    parse: (j) => (Array.isArray(j && j[1]) ? j[1] : [])
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    template: 'https://duckduckgo.com/?q=%s',
    suggestUrl: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=json`,
    parse: (j) => (Array.isArray(j) ? j.map((x) => x.phrase).filter(Boolean) : [])
  },
  bing: {
    name: 'Bing',
    template: 'https://www.bing.com/search?q=%s',
    suggestUrl: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
    parse: (j) => (Array.isArray(j && j[1]) ? j[1] : [])
  },
  brave: {
    name: 'Brave',
    template: 'https://search.brave.com/search?q=%s',
    suggestUrl: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=json`,
    parse: (j) => (Array.isArray(j) ? j.map((x) => x.phrase).filter(Boolean) : [])
  }
};

/* ================= الحالة والإعدادات ================= */
const ACCENTS = {
  violet: ['#7c5cff', '#38b6ff'], blue: ['#2f7bff', '#35e0ff'], teal: ['#00c2a8', '#4dd0ff'],
  pink: ['#ff5ca8', '#a86bff'], amber: ['#ff9a3d', '#ffd25c']
};
const GROUP_COLORS = { violet: '#8b6bff', blue: '#3fa9ff', green: '#3ddc97', orange: '#ffb020', pink: '#ff6b9d' };
const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const settings = Object.assign({
  theme: 'dark', accent: 'violet', animations: true, lowResource: false,
  bg: 'gradient', bgColor: '#141a3a', engine: 'google',
  restoreSession: true, recordHistory: true, suggestions: true, uiZoom: 1
}, store('settings', {}));

let bookmarks = IS_INCOGNITO ? [] : store('bookmarks', []);
let historyItems = IS_INCOGNITO ? [] : store('history', []);
let shortcuts = store('shortcuts', [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'ويكيبيديا', url: 'https://ar.wikipedia.org' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'BBC عربي', url: 'https://www.bbc.com/arabic' },
  { name: 'MDN', url: 'https://developer.mozilla.org' }
]);

let tabs = [];
let activeTabId = null;
let closedStack = [];
let downloads = new Map();
let nextTabId = 1;

/* ================= خزنة كلمات المرور المشفّرة ================= */
let pwMasterKey = null;       // مفتاح تشفير مشتق من كلمة المرور الرئيسية
let pwUnlocked = false;
let pwVault = [];             // [{ site, user, pass, time }]
let pwEncrypted = null;       // { salt, data } المخزّن في localStorage

const PW_KEY = 'nova.pwvault';

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function savePwVault() {
  try { localStorage.setItem(PW_KEY, JSON.stringify(pwEncrypted)); } catch { /* ممتلئ */ }
}

async function lockPwVault() {
  pwMasterKey = null;
  pwUnlocked = false;
  pwVault = [];
  el('pw-lock').classList.add('visible');
  el('pw-vault').classList.remove('visible');
  el('pw-add-form').classList.remove('visible');
  el('pw-master-input').value = '';
  toast('تم قفل خزنة كلمات المرور');
}

async function unlockPwVault(password) {
  if (!pwEncrypted) { pwUnlocked = true; showPwVault(); return; }
  try {
    const salt = base64ToBytes(pwEncrypted.salt);
    const key = await deriveKey(password, salt);
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(pwEncrypted.iv) },
      key,
      base64ToBytes(pwEncrypted.data)
    );
    pwVault = JSON.parse(new TextDecoder().decode(dec));
    pwMasterKey = key;
    pwUnlocked = true;
    showPwVault();
    toast('تم فك قفل الخزنة');
  } catch {
    toast('كلمة مرور غير صحيحة');
    throw new Error('bad password');
  }
}

function showPwVault() {
  el('pw-lock').classList.remove('visible');
  el('pw-vault').classList.add('visible');
  renderPwVault();
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function savePwEntry(site, user, pass) {
  if (!pwMasterKey) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    pwMasterKey,
    enc.encode(JSON.stringify({ site, user, pass, time: Date.now() }))
  );
  pwVault.push({ site, user, pass, time: Date.now() });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    pwMasterKey,
    enc.encode(JSON.stringify(pwVault))
  );
  pwEncrypted = { salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(wrapped) };
  savePwVault();
  renderPwVault();
  toast('تم حفظ تسجيل الدخول');
}

function renderPwVault(filter = '') {
  const list = el('pw-list');
  const empty = el('pw-empty');
  const stats = el('pw-stats');
  const items = pwVault.filter((p) => (p.site + p.user).toLowerCase().includes(filter.toLowerCase()));
  stats.textContent = `${pwVault.length} عنصر`;
  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = pwVault.length === 0 ? false : true;
    if (pwVault.length === 0) empty.textContent = 'لا توجد كلمات مرور محفوظة بعد.';
    else empty.textContent = 'لا توجد نتائج مطابقة.';
    return;
  }
  empty.hidden = true;
  list.innerHTML = '';
  items.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'pw-row';
    const initials = (p.site.charAt(0) + (p.user ? p.user.charAt(0) : '')).toUpperCase();
    row.innerHTML = `
      <div class="pw-icon">${initials}</div>
      <div class="pw-info">
        <div class="pw-site"></div>
        <div class="pw-user"></div>
      </div>
      <div class="pw-actions">
        <button class="pw-btn reveal" title="إظهار/إخفاء كلمة المرور">👁</button>
        <button class="pw-btn" title="نسخ كلمة المرور">📋</button>
      </div>
    `;
    row.querySelector('.pw-site').textContent = p.site;
    row.querySelector('.pw-user').textContent = p.user || '—';
    const revealBtn = row.querySelector('.pw-btn.reveal');
    const copyBtn = row.querySelector('.pw-actions .pw-btn:last-child');
    let revealed = false;
    revealBtn.addEventListener('click', () => {
      revealed = !revealed;
      revealBtn.textContent = revealed ? '🙈' : '👁';
      revealBtn.title = revealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور';
      // نعرض كلمة المرور أسفل الصف مؤقتًا
      const existing = row.querySelector('.pw-reveal-text');
      if (existing) existing.remove();
      if (revealed) {
        const d = document.createElement('div');
        d.className = 'pw-reveal-text';
        d.style.cssText = 'margin-inline-start:44px;color:var(--ok);font-family:ui-monospace,monospace;font-size:12px;direction:ltr;word-break:break-all;margin-top:6px;';
        d.textContent = p.pass;
        row.querySelector('.pw-info').appendChild(d);
      }
    });
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(p.pass);
      toast('تم نسخ كلمة المرور');
    });
    row.addEventListener('click', (e) => {
      if (!e.target.closest('.pw-actions')) revealBtn.click();
    });
    list.appendChild(row);
  });
}

/* ================= مانع الإعلانات ================= */
let adblockEnabled = store('adblock', true);
let adblockBlocked = 0;

function updateAdblockUI() {
  const btn = el('adblock-toggle');
  const cnt = el('adblock-count');
  if (btn) btn.checked = adblockEnabled;
  if (cnt) cnt.textContent = adblockBlocked;
  save('adblock', adblockEnabled);
}

async function requestAdblockStats() {
  // الإحصائيات تُتبع محليًا؛ مانع الإعلانات نفسه يُنفّذ في العملية الرئيسية (main.js)
  updateAdblockUI();
}

function incrementAdblock() {
  if (!adblockEnabled) return;
  adblockBlocked += 1;
  const cnt = el('adblock-count');
  if (cnt) cnt.textContent = adblockBlocked;
}

/* ================= الشريط الجانبي ================= */
function toggleSidebar() {
  const sidebar = el('sidebar');
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.remove('open');
    sidebar.hidden = true;
    el('backdrop').hidden = true;
  } else {
    renderSidebarBookmarks();
    sidebar.hidden = false;
    el('backdrop').hidden = false;
    el('backdrop').classList.remove('hidden'); //.show backdrop
    sidebar.classList.add('open');
  }
}

function renderSidebarBookmarks(filter = '') {
  const list = el('sidebar-list');
  const items = bookmarks.filter((b) => (b.title + b.url).toLowerCase().includes(filter.toLowerCase()));
  if (!items.length) {
    list.innerHTML = '<div class="sidebar-empty">لا توجد إشارات مرجعية بعد.</div>';
    return;
  }
  list.innerHTML = '';
  items.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'sidebar-item';
    row.innerHTML = `<img alt="" src="${b.favicon || GLOBE_FAVICON}"><div class="grow"><div class="t"></div><div class="s"></div></div><span class="del">×</span>`;
    row.querySelector('.t').textContent = b.title || b.url;
    row.querySelector('.s').textContent = b.url;
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) return;
      navigate(activeTab(), b.url);
      toggleSidebar();
    });
    row.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      bookmarks = bookmarks.filter((x) => x !== b);
      persistBookmarks();
      updateBookmarkStar();
      renderSidebarBookmarks(el('sidebar-search').value);
      renderBookmarks(el('bookmarks-search').value);
    });
    list.appendChild(row);
  });
}

/* ================= التعبئة التلقائية لكلمات المرور ================= */
function offerPwAutofill(tab) {
  if (!pwUnlocked || !tab || tab.isHome) return;
  const host = hostnameOf(tab.pendingUrl || tab.url);
  const match = pwVault.find((p) => p.site === host || p.site.includes(host) || host.includes(p.site));
  if (!match) return;
  const wv = tab.wv;
  if (!wv) return;
  // إرسال بيانات التعبئة إلى صفحة الويب عبرスク्रיפت في webview (يُنفذ في سياق الصفحة)
  callWebView(wv, 'executeJavaScript', `(
    () => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="username"]');
      const passes = document.querySelectorAll('input[type="password"]');
      if (inputs.length && passes.length) {
        const userInput = inputs[0];
        const passInput = passes[0];
        if (!userInput.value && !passInput.value) {
          userInput.value = ${JSON.stringify(match.user)};
          passInput.value = ${JSON.stringify(match.pass)};
          userInput.dispatchEvent(new Event('input', { bubbles: true }));
          passInput.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }
  )()`).catch(() => {});
}

const activeTab = () => tabs.find((t) => t.id === activeTabId) || null;
const persistBookmarks = () => { if (!IS_INCOGNITO) save('bookmarks', bookmarks); };
const persistHistory = () => { if (!IS_INCOGNITO) save('history', historyItems.slice(0, 600)); };
const persistSettings = () => save('settings', settings);

/* ================= تطبيق الإعدادات ================= */
const osLight = window.matchMedia('(prefers-color-scheme: light)');
const osReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function applyTheme() {
  const light = settings.theme === 'light' || (settings.theme === 'auto' && osLight.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelectorAll('#theme-seg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.themeVal === settings.theme));
}
function applyAccent() {
  const [a, b] = ACCENTS[settings.accent] || ACCENTS.violet;
  document.documentElement.style.setProperty('--accent', a);
  document.documentElement.style.setProperty('--accent2', b);
  document.querySelectorAll('#accent-swatches .swatch').forEach((s) =>
    s.classList.toggle('active', s.dataset.accent === settings.accent));
}
function motionReduced() {
  return !settings.animations || settings.lowResource || osReducedMotion.matches;
}
function applyMotion() {
  document.body.classList.toggle('reduced-motion', motionReduced());
  document.body.classList.toggle('low-resource', settings.lowResource);
  el('set-animations').checked = settings.animations;
  el('set-low-resource').checked = settings.lowResource;
}
function applyBackground() {
  const hp = el('home-page');
  hp.className = 'bg-' + settings.bg;
  document.documentElement.style.setProperty('--home-solid', settings.bgColor);
  el('bg-color').value = settings.bgColor;
  el('bg-solid-row').hidden = settings.bg !== 'solid';
  el('bg-image-row').hidden = settings.bg !== 'image';
  if (settings.bg === 'image') {
    const img = store('bgImage', '');
    hp.style.backgroundImage = img ? `url("${img}")` : 'none';
  } else hp.style.backgroundImage = '';
  document.querySelectorAll('#bg-grid .bg-card').forEach((c) =>
    c.classList.toggle('active', c.dataset.bg === settings.bg));
  restartGeoAnimation();
}
function applyUiZoom() {
  window.nova.setUiZoom(settings.uiZoom);
  el('set-ui-zoom').value = settings.uiZoom;
  el('ui-zoom-val').textContent = Math.round(settings.uiZoom * 100) + '%';
}
function applySettingsToControls() {
  el('set-engine').value = settings.engine;
  el('set-restore').checked = settings.restoreSession;
  el('set-record-history').checked = settings.recordHistory;
  el('set-suggestions').checked = settings.suggestions;
}

/* ================= خلفية هندسية متحركة (Canvas منخفض الاستهلاك) ================= */
let geo = { points: [], raf: 0, timer: 0, w: 0, h: 0 };
function geoVisible() {
  const tab = activeTab();
  return settings.bg === 'geometric' && !settings.lowResource &&
    tab && tab.isHome && !document.hidden;
}
function geoResize() {
  const c = el('bg-canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  geo.w = c.clientWidth; geo.h = c.clientHeight;
  c.width = geo.w * dpr; c.height = geo.h * dpr;
  const n = Math.round(Math.min(46, Math.max(18, (geo.w * geo.h) / 42000)));
  geo.points = Array.from({ length: n }, () => ({
    x: Math.random() * geo.w, y: Math.random() * geo.h,
    vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28
  }));
}
function geoFrame() {
  geo.raf = 0; geo.timer = 0;
  if (!geoVisible()) { // تتوقف الحركة عندما تكون غير مرئية
    geo.timer = setTimeout(geoFrame, 600);
    return;
  }
  const c = el('bg-canvas');
  const ctx = c.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  if (!geo.w || c.clientWidth !== geo.w) geoResize();
  const still = motionReduced();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, geo.w, geo.h);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#38b6ff';
  const pts = geo.points, R = 150;
  for (const p of pts) {
    if (!still) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > geo.w) p.vx *= -1;
      if (p.y < 0 || p.y > geo.h) p.vy *= -1;
    }
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R) {
        ctx.globalAlpha = 0.16 * (1 - Math.sqrt(d2) / R);
        ctx.strokeStyle = accent;
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = accent;
  for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  if (!still) geo.raf = requestAnimationFrame(geoFrame);
  else geo.timer = setTimeout(geoFrame, 1200);
}
function restartGeoAnimation() {
  cancelAnimationFrame(geo.raf);
  clearTimeout(geo.timer);
  geo.w = 0;
  if (settings.bg === 'geometric') geoFrame();
}

/* ================= إدارة التبويبات ================= */
function callWebView(tab, method, ...args) {
  try { if (tab.wv && typeof tab.wv[method] === 'function') return tab.wv[method](...args); }
  catch { /* الضيف غير جاهز بعد */ }
  return undefined;
}

/** إظهار محرك عرض التبويب النشط فقط، وإخفاء البقية (توفير للموارد ومنع التداخل) */
function syncWebViewVisibility() {
  tabs.forEach((t) => {
    if (t.wv) t.wv.classList.toggle('active', t.id === activeTabId && !t.isHome);
  });
}

function createTab({ url = null, title = null, active = true, pinned = false, group = null, lazy = false } = {}) {
  const tab = {
    id: nextTabId++, title: title || 'تبويب جديد', favicon: null,
    url: 'nova://home', isHome: true, loading: false, error: null,
    pinned, group, zoom: 1, started: false, pendingUrl: null, wv: null, el: null
  };

  // إنشاء محرك العرض (Chromium) لهذا التبويب
  const wv = document.createElement('webview');
  wv.setAttribute('src', 'about:blank');
  wv.setAttribute('allowpopups', '');
  if (IS_INCOGNITO) wv.setAttribute('partition', INCOG_PARTITION);
  wv.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes');
  tab.wv = wv;
  el('webviews').appendChild(wv);
  bindWebViewEvents(tab);

  // إدراج مع احترام منطقة التبويبات المثبتة
  const insertAt = pinned ? tabs.filter((t) => t.pinned).length : tabs.length;
  tabs.splice(insertAt, 0, tab);

  if (url) {
    if (lazy && !active) { // تبويب مستعاد: لا يُحمَّل حتى يُفعَّل (توفير للموارد)
      tab.pendingUrl = url;
      tab.url = url;
      tab.isHome = false;
      tab.title = title || hostnameOf(url) || url;
    } else {
      navigate(tab, url);
    }
  }
  renderTabs();
  if (active) activateTab(tab.id);
  saveSessionSoon();
  return tab;
}

function bindWebViewEvents(tab) {
  const wv = tab.wv;
  if (!IN_ELECTRON) return; // في وضع المعاينة لا توجد أحداث Chromium
  const isActive = () => tab.id === activeTabId;

  wv.addEventListener('did-start-loading', () => {
    tab.loading = true; tab.error = null;
    patchTab(tab);
    if (isActive()) { updateNavButtons(); progressStart(); }
  });
  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    patchTab(tab);
    if (isActive()) { updateNavButtons(); progressDone(); offerPwAutofill(tab); }
  });
  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.title;
    patchTab(tab);
    touchHistoryTitle(tab);
    saveSessionSoon();
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons[0]) { tab.favicon = e.favicons[0]; patchTab(tab); }
  });
  const onNavigate = (url) => {
    if (!url || url === 'about:blank') return;
    tab.url = url;
    tab.isHome = false;
    recordHistory(tab);
    if (isActive()) { syncOmnibox(); updateBookmarkStar(); }
    saveSessionSoon();
  };
  wv.addEventListener('did-navigate', (e) => onNavigate(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNavigate(e.url); });
  wv.addEventListener('will-navigate', (e) => {
    // حظر مخططات خطرة؛ تمرير mailto وما شابه للنظام
    const u = String(e.url || '');
    if (!/^(https?|about):/i.test(u)) {
      e.preventDefault();
      if (/^(mailto|tel):/i.test(u)) window.nova.openExternal(u);
    }
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return; // -3 = إيقاف متعمد من المستخدم
    tab.error = { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL || tab.url };
    tab.loading = false;
    patchTab(tab);
    if (isActive()) { progressDone(); updateOverlays(); }
  });
  wv.addEventListener('dom-ready', () => {
    callWebView(tab, 'setZoomFactor', tab.zoom);
    if (isActive()) updateNavButtons();
  });
  wv.addEventListener('found-in-page', (e) => {
    if (!isActive()) return;
    const r = e.result || {};
    el('find-count').textContent = r.matches ? `${r.activeMatchOrdinal || 0}/${r.matches}` : (el('find-input').value ? 'لا نتائج' : '');
  });
  wv.addEventListener('crashed', () => {
    tab.error = { code: 0, desc: 'توقفت عملية عرض الصفحة عن الاستجابة.', url: tab.url };
    if (isActive()) updateOverlays();
  });
}

function navigate(tab, rawInput) {
  if (!tab) return;
  const engine = ENGINES[settings.engine] || ENGINES.google;
  const res = normalizeInput(rawInput, engine.template);
  hideSuggestions();

  if (res.type === 'home') {
    tab.isHome = true;
    tab.url = 'nova://home';
    tab.error = null;
    tab.title = 'تبويب جديد';
    tab.favicon = null;
    callWebView(tab, 'stop');
    patchTab(tab);
    syncWebViewVisibility();
    if (tab.id === activeTabId) { syncOmnibox(); updateOverlays(); updateNavButtons(); focusHomeSearch(); }
    saveSessionSoon();
    return;
  }

  tab.isHome = false;
  tab.error = null;
  tab.url = res.url;
  tab.pendingUrl = null;

  if (!IN_ELECTRON) {
    // وضع المعاينة: محاكاة تنقل لعرض حالة الواجهة فقط
    tab.title = hostnameOf(res.url) || res.url;
    tab.loading = true;
    patchTab(tab);
    if (tab.id === activeTabId) { syncOmnibox(); updateOverlays(); progressStart(); }
    setTimeout(() => { tab.loading = false; patchTab(tab); if (tab.id === activeTabId) progressDone(); }, 650);
    saveSessionSoon();
    return;
  }

  if (!tab.started) { tab.wv.setAttribute('src', res.url); tab.started = true; }
  else callWebView(tab, 'loadURL', res.url);
  patchTab(tab);
  syncWebViewVisibility();
  if (tab.id === activeTabId) { syncOmnibox(); updateOverlays(); }
  saveSessionSoon();
}

function activateTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeTabId = id;

  if (tab.pendingUrl) { const u = tab.pendingUrl; tab.pendingUrl = null; navigate(tab, u); }
  syncWebViewVisibility();
  renderTabs();
  syncOmnibox();
  updateNavButtons();
  updateBookmarkStar();
  updateZoomChip();
  updateOverlays();
  closeFindBar(false);
  tab.loading ? progressStart() : progressDone();
  if (tab.isHome) { restartHomeAnimation(); restartGeoAnimation(); focusHomeSearch(); }
  saveSessionSoon();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const [tab] = tabs.splice(idx, 1);
  if (!tab.isHome && tab.url !== 'nova://home') {
    closedStack.push({ url: tab.pendingUrl || tab.url, title: tab.title, pinned: tab.pinned, group: tab.group });
    if (closedStack.length > 25) closedStack.shift();
  }
  try { callWebView(tab, 'stop'); } catch { /* لا شيء */ }
  tab.wv && tab.wv.remove();

  if (tabs.length === 0) { createTab({}); return; }
  if (activeTabId === id) activateTab(tabs[Math.min(idx, tabs.length - 1)].id);
  else renderTabs();
  saveSessionSoon();
}

function reopenClosedTab() {
  const last = closedStack.pop();
  if (!last) { toast('لا يوجد تبويب مغلق لاستعادته'); return; }
  createTab({ url: last.url, title: last.title, pinned: last.pinned, group: last.group });
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeTabId);
  activateTab(tabs[(i + dir + tabs.length) % tabs.length].id);
}

/* -------- رسم شريط التبويبات -------- */
function renderTabs() {
  const wrap = el('tabs');
  wrap.innerHTML = '';
  tabs.forEach((tab) => {
    const d = document.createElement('div');
    d.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.pinned ? ' pinned' : '');
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false');
    d.draggable = true;
    d.title = tab.isHome ? 'تبويب جديد' : `${tab.title}\n${tab.url}`;
    d.dataset.id = tab.id;

    if (tab.group && GROUP_COLORS[tab.group]) {
      const bar = document.createElement('i');
      bar.className = 'group-bar';
      bar.style.background = GROUP_COLORS[tab.group];
      d.appendChild(bar);
    }
    const iconWrap = document.createElement('span');
    iconWrap.className = 'tab-icon';
    d.appendChild(iconWrap);

    const title = document.createElement('span');
    title.className = 'title';
    d.appendChild(title);

    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.title = 'إغلاق التبويب';
    close.setAttribute('aria-label', 'إغلاق التبويب');
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
    d.appendChild(close);

    d.addEventListener('click', () => activateTab(tab.id));
    d.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });
    d.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabMenu(tab, e.clientX, e.clientY); });
    d.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(tab.id));
      e.dataTransfer.effectAllowed = 'move';
    });
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drag-over'); });
    d.addEventListener('dragleave', () => d.classList.remove('drag-over'));
    d.addEventListener('drop', (e) => {
      e.preventDefault();
      d.classList.remove('drag-over');
      const dragId = Number(e.dataTransfer.getData('text/plain'));
      moveTab(dragId, tab.id);
    });

    tab.el = d;
    wrap.appendChild(d);
    patchTab(tab);
  });
}

function patchTab(tab) {
  if (!tab.el) return;
  const iconWrap = tab.el.querySelector('.tab-icon');
  const title = tab.el.querySelector('.title');
  if (title) title.textContent = tab.isHome ? 'تبويب جديد' : (tab.title || tab.url);
  tab.el.title = tab.isHome ? 'تبويب جديد' : `${tab.title}\n${tab.url}`;
  if (iconWrap) {
    if (tab.loading) {
      if (!iconWrap.querySelector('.spinner')) iconWrap.innerHTML = '<span class="spinner"></span>';
    } else {
      const src = tab.isHome ? HOME_FAVICON : (tab.favicon || GLOBE_FAVICON);
      const img = iconWrap.querySelector('img.favicon');
      if (!img) iconWrap.innerHTML = `<img class="favicon" alt="" src="${src}">`;
      else if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    }
  }
}

function moveTab(dragId, targetId) {
  const from = tabs.findIndex((t) => t.id === dragId);
  const to = tabs.findIndex((t) => t.id === targetId);
  if (from === -1 || to === -1 || from === to) return;
  const dragged = tabs[from];
  // المثبتة تبقى داخل منطقتها وغير المثبتة لا تدخلها
  if (dragged.pinned !== tabs[to].pinned) { toast('لا يمكن خلط التبويبات المثبتة مع العادية'); return; }
  tabs.splice(from, 1);
  tabs.splice(to, 0, dragged);
  renderTabs();
  saveSessionSoon();
}

function setPinned(tab, pinned) {
  tab.pinned = pinned;
  tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  renderTabs();
  saveSessionSoon();
}

/* -------- قائمة سياق التبويب -------- */
function openTabMenu(tab, x, y) {
  const menu = el('tab-menu');
  menu.innerHTML = '';
  const add = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { menu.hidden = true; fn(); });
    menu.appendChild(b);
    return b;
  };
  add(tab.pinned ? 'إلغاء تثبيت التبويب' : 'تثبيت التبويب', () => setPinned(tab, !tab.pinned));
  add('تكرار التبويب', () => createTab({ url: tab.isHome ? null : (tab.pendingUrl || tab.url), group: tab.group }));
  add('إعادة تحميل التبويب', () => reloadTab(tab, false));
  const lbl = document.createElement('div');
  lbl.className = 'menu-label';
  lbl.textContent = 'لون المجموعة';
  menu.appendChild(lbl);
  const colors = document.createElement('div');
  colors.className = 'group-colors';
  const noneBtn = document.createElement('button');
  noneBtn.className = 'gcolor none' + (!tab.group ? ' active' : '');
  noneBtn.title = 'بدون مجموعة';
  noneBtn.addEventListener('click', () => { tab.group = null; menu.hidden = true; renderTabs(); saveSessionSoon(); });
  colors.appendChild(noneBtn);
  Object.entries(GROUP_COLORS).forEach(([key, val]) => {
    const c = document.createElement('button');
    c.className = 'gcolor' + (tab.group === key ? ' active' : '');
    c.style.background = val;
    c.title = key;
    c.addEventListener('click', () => { tab.group = key; menu.hidden = true; renderTabs(); saveSessionSoon(); });
    colors.appendChild(c);
  });
  menu.appendChild(colors);
  menu.appendChild(document.createElement('hr'));
  add('إغلاق التبويبات الأخرى', () => {
    [...tabs].forEach((t) => { if (t.id !== tab.id) closeTab(t.id); });
    activateTab(tab.id);
  });
  add('إغلاق التبويب', () => closeTab(tab.id));

  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 10)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 10)) + 'px';
}

/* ================= التنقل ================= */
function reloadTab(tab, hard) {
  if (!tab || tab.isHome) return;
  if (tab.pendingUrl) { navigate(tab, tab.pendingUrl); return; }
  tab.error = null;
  if (tab.id === activeTabId) updateOverlays();
  callWebView(tab, hard ? 'reloadIgnoringCache' : 'reload');
  if (!IN_ELECTRON) navigate(tab, tab.url);
}
function updateNavButtons() {
  const tab = activeTab();
  let back = false, fwd = false;
  if (tab && !tab.isHome && IN_ELECTRON) {
    back = !!callWebView(tab, 'canGoBack');
    fwd = !!callWebView(tab, 'canGoForward');
  }
  el('back-btn').disabled = !back;
  el('fwd-btn').disabled = !fwd;
  const loading = !!(tab && tab.loading);
  el('reload-icon').hidden = loading;
  el('stop-icon').hidden = !loading;
  el('reload-btn').title = loading ? 'إيقاف التحميل' : 'إعادة تحميل';
}
let progressInterval = 0;
function progressStart() {
  const fill = el('progress-fill');
  fill.style.opacity = '1';
  let w = 12;
  fill.style.width = w + '%';
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    w = Math.min(86, w + (86 - w) * 0.06);
    fill.style.width = w + '%';
  }, 120);
}
function progressDone() {
  const fill = el('progress-fill');
  clearInterval(progressInterval);
  fill.style.width = '100%';
  setTimeout(() => { fill.style.opacity = '0'; setTimeout(() => { fill.style.width = '0'; }, 320); }, 160);
}

function updateOverlays() {
  const tab = activeTab();
  const home = el('home-page'), err = el('error-page'), demo = el('demo-page');
  home.hidden = !(tab && tab.isHome);
  err.hidden = true;
  demo.hidden = true;
  if (tab && !tab.isHome) {
    if (tab.error && IN_ELECTRON) {
      err.hidden = false;
      el('error-title').textContent = 'تعذّر تحميل الصفحة';
      el('error-desc').textContent = friendlyError(tab.error);
      el('error-url').textContent = tab.error.url || '';
    } else if (!IN_ELECTRON) {
      demo.hidden = false;
      el('demo-url').textContent = tab.url;
    }
  }
  restartGeoAnimation();
}
function friendlyError(e) {
  const map = {
    '-105': 'تعذّر العثور على عنوان الموقع (خطأ DNS). تحقق من كتابة العنوان ومن اتصالك بالإنترنت.',
    '-106': 'يبدو أنك غير متصل بالإنترنت. تحقق من الاتصال ثم أعد المحاولة.',
    '-102': 'رفض الموقع الاتصال. ربما يكون الخادم متوقفًا مؤقتًا.',
    '-118': 'استغرق الاتصال بالموقع وقتًا طويلًا وانتهت المهلة.',
    '-324': 'أغلق الخادم الاتصال دون إرسال بيانات.'
  };
  if (map[String(e.code)]) return map[String(e.code)];
  if (String(e.desc || '').includes('CERT') || [-200, -201, -202].includes(e.code)) {
    return 'مشكلة في شهادة أمان الموقع (HTTPS). لم يتم تجاوز الخطأ حفاظًا على سلامتك.';
  }
  return `حدث خطأ أثناء تحميل الصفحة (${e.desc || 'خطأ غير معروف'}).`;
}

/* ================= شريط العنوان الذكي والاقتراحات ================= */
const omnibox = el('omnibox');
function syncOmnibox() {
  const tab = activeTab();
  if (document.activeElement !== omnibox) {
    omnibox.value = !tab || tab.isHome ? '' : (tab.pendingUrl || tab.url);
  }
  const lock = el('lock-icon');
  if (!tab || tab.isHome) {
    lock.className = 'home';
    lock.innerHTML = STAR_SVG;
    lock.title = 'صفحة NOVA الرئيسية';
  } else if (isSecure(tab.url)) {
    lock.className = 'secure';
    lock.innerHTML = ICON_LOCK;
    lock.title = 'اتصال آمن (HTTPS)';
  } else {
    lock.className = 'insecure';
    lock.innerHTML = ICON_WARN;
    lock.title = 'غير آمن — الاتصال بهذا الموقع غير مشفّر (HTTP)';
  }
}

let suggestAbort = null;
let suggestItems = [];
let suggestIndex = -1;
let suggestDebounce = 0;

function hideSuggestions() {
  el('suggestions').hidden = true;
  suggestItems = [];
  suggestIndex = -1;
}
function localSuggestions(q) {
  const needle = q.toLowerCase();
  const seen = new Set();
  const out = [];
  const push = (kind, title, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ kind, title: title || url, sub: url, action: () => navigate(activeTab(), url) });
  };
  bookmarks.forEach((b) => { if ((b.title + b.url).toLowerCase().includes(needle)) push('إشارة', b.title, b.url); });
  historyItems.forEach((h) => { if ((h.title + h.url).toLowerCase().includes(needle)) push('السجل', h.title, h.url); });
  return out.slice(0, 5);
}
async function remoteSuggestions(q) {
  if (!settings.suggestions || settings.lowResource) return [];
  const engine = ENGINES[settings.engine] || ENGINES.google;
  try {
    suggestAbort && suggestAbort.abort();
    suggestAbort = new AbortController();
    const ctrl = suggestAbort;
    const timer = setTimeout(() => ctrl.abort(), 1800);
    const res = await fetch(engine.suggestUrl(q), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const list = engine.parse(await res.json());
    return list.filter((s) => s && s.toLowerCase() !== q.toLowerCase()).slice(0, 5)
      .map((s) => ({ kind: engine.name, title: s, sub: '', action: () => navigate(activeTab(), s) }));
  } catch { return []; }
}
async function showSuggestions() {
  const q = omnibox.value.trim();
  if (!q || document.activeElement !== omnibox) { hideSuggestions(); return; }
  const items = [];
  if (isUrlLike(q) || /^https?:\/\//i.test(q)) {
    items.push({ kind: 'رابط', title: q, sub: 'زيارة الموقع مباشرة', action: () => navigate(activeTab(), q) });
  } else {
    const engine = ENGINES[settings.engine] || ENGINES.google;
    items.push({ kind: engine.name, title: q, sub: '', action: () => navigate(activeTab(), q) });
  }
  items.push(...localSuggestions(q));
  renderSuggestions(items);
  const remote = await remoteSuggestions(q);
  if (omnibox.value.trim() === q && remote.length) renderSuggestions([...items, ...remote].slice(0, 8));
}
function renderSuggestions(items) {
  suggestItems = items;
  suggestIndex = -1;
  const box = el('suggestions');
  if (!items.length) { box.hidden = true; return; }
  box.innerHTML = '';
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'suggestion';
    b.setAttribute('role', 'option');
    const icon = it.kind === 'إشارة' ? ICON_STAR : it.kind === 'السجل' ? ICON_CLOCK : it.kind === 'رابط' ? '' : ICON_SEARCH;
    b.innerHTML = `<span class="s-icon">${it.kind === 'رابط' ? `<img src="${GLOBE_FAVICON}" alt="">` : icon}</span>
      <span class="s-main"><span class="s-title"></span>${it.sub ? '<span class="s-sub"></span>' : ''}</span>
      <span class="s-kind">${it.kind}</span>`;
    b.querySelector('.s-title').textContent = it.title;
    if (it.sub) b.querySelector('.s-sub').textContent = it.sub;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); it.action(); omnibox.blur(); });
    b.addEventListener('mouseenter', () => selectSuggestion(i, false));
    box.appendChild(b);
  });
  const r = el('omnibox-wrap').getBoundingClientRect();
  box.style.left = r.left + 'px';
  box.style.top = (r.bottom + 8) + 'px';
  box.style.width = r.width + 'px';
  box.hidden = false;
}
function selectSuggestion(i, fillInput) {
  suggestIndex = i;
  [...el('suggestions').children].forEach((c, j) => c.classList.toggle('selected', j === i));
  if (fillInput && suggestItems[i]) omnibox.value = suggestItems[i].title;
}

/* ================= الصفحة الرئيسية والاختصارات ================= */
function tileHue(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function renderShortcuts() {
  const wrap = el('shortcuts');
  wrap.innerHTML = '';
  shortcuts.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'shortcut';
    b.title = `${s.name}\n${s.url}`;
    const hue = tileHue(s.name + s.url);
    b.innerHTML = `<span class="tile" style="background:linear-gradient(135deg,hsl(${hue},72%,56%),hsl(${(hue + 45) % 360},75%,48%))"></span><span></span>`;
    b.querySelector('.tile').textContent = (s.name || '?').trim().charAt(0).toUpperCase();
    b.querySelectorAll('span')[1].textContent = s.name;
    const rm = document.createElement('span');
    rm.className = 'remove';
    rm.textContent = '×';
    rm.title = 'حذف الاختصار';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      shortcuts.splice(i, 1);
      save('shortcuts', shortcuts);
      renderShortcuts();
      toast('تم حذف الاختصار');
    });
    b.appendChild(rm);
    b.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) createTab({ url: s.url, active: false });
      else navigate(activeTab(), s.url);
    });
    wrap.appendChild(b);
  });
  const add = document.createElement('button');
  add.className = 'shortcut';
  add.innerHTML = `<span class="tile ghost">+</span><span>إضافة اختصار</span>`;
  add.addEventListener('click', openShortcutModal);
  wrap.appendChild(add);
}
function restartHomeAnimation() {
  // إعادة تشغيل حركة دخول عناصر الرئيسية عند كل تفعيل لتبويب رئيسي
  document.querySelectorAll('#home-page .anim-item, #home-page .home-logo').forEach((n) => {
    n.style.animation = 'none';
    void n.offsetHeight;
    n.style.animation = '';
  });
}
function focusHomeSearch() {
  // لا نسرق التركيز أثناء كتابة المستخدم في مكان آخر
  const a = document.activeElement;
  if (!a || a === document.body || a.tagName === 'WEBVIEW') {
    requestAnimationFrame(() => el('home-search-input').focus({ preventScroll: true }));
  }
}
function updateClock() {
  const now = new Date();
  el('home-clock').textContent =
    `${now.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })} · ` +
    now.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* حوار إضافة اختصار */
function openShortcutModal() {
  el('modal-wrap').hidden = false;
  el('modal-name').value = '';
  el('modal-url').value = '';
  el('modal-name').focus();
}
function closeShortcutModal() { el('modal-wrap').hidden = true; }
function submitShortcut() {
  const name = el('modal-name').value.trim();
  const raw = el('modal-url').value.trim();
  if (!raw) { toast('اكتب عنوان الموقع أولًا'); return; }
  const engine = ENGINES[settings.engine] || ENGINES.google;
  const res = normalizeInput(raw, engine.template);
  if (res.type !== 'url') { toast('هذا العنوان لا يبدو كموقع صالح'); return; }
  shortcuts.push({ name: name || hostnameOf(res.url) || res.url, url: res.url });
  save('shortcuts', shortcuts);
  renderShortcuts();
  closeShortcutModal();
  toast('تمت إضافة الاختصار');
}

/* ================= السجل والإشارات ================= */
function recordHistory(tab) {
  if (IS_INCOGNITO || !settings.recordHistory) return;
  if (!/^https?:/i.test(tab.url)) return;
  const now = Date.now();
  const first = historyItems[0];
  if (first && first.url === tab.url) { first.time = now; if (tab.title) first.title = tab.title; }
  else historyItems.unshift({ url: tab.url, title: tab.title && tab.title !== 'تبويب جديد' ? tab.title : hostnameOf(tab.url), time: now });
  historyItems = historyItems.slice(0, 600);
  persistHistory();
}
function touchHistoryTitle(tab) {
  if (IS_INCOGNITO || !settings.recordHistory) return;
  const item = historyItems.find((h) => h.url === tab.url);
  if (item && tab.title) { item.title = tab.title; persistHistory(); }
}
function isBookmarked(url) { return bookmarks.some((b) => b.url === url); }
function toggleBookmark() {
  const tab = activeTab();
  if (!tab || tab.isHome) { toast('افتح صفحة أولًا لحفظها'); return; }
  const url = tab.pendingUrl || tab.url;
  if (isBookmarked(url)) {
    bookmarks = bookmarks.filter((b) => b.url !== url);
    toast('أُزيلت من الإشارات المرجعية');
  } else {
    bookmarks.unshift({ title: tab.title || hostnameOf(url), url, favicon: tab.favicon || '', time: Date.now() });
    toast(IS_INCOGNITO ? 'حُفظت لهذه الجلسة فقط' : 'أُضيفت إلى الإشارات المرجعية');
  }
  persistBookmarks();
  updateBookmarkStar();
}
function updateBookmarkStar() {
  const tab = activeTab();
  el('bookmark-btn').classList.toggle('filled', !!(tab && !tab.isHome && isBookmarked(tab.pendingUrl || tab.url)));
}

/* ================= التكبير والبحث داخل الصفحة ================= */
function setZoom(tab, factor) {
  if (!tab || tab.isHome) return;
  tab.zoom = ZOOM_LEVELS.reduce((best, z) => (Math.abs(z - factor) < Math.abs(best - factor) ? z : best), 1);
  callWebView(tab, 'setZoomFactor', tab.zoom);
  updateZoomChip();
}
function zoomStep(dir) {
  const tab = activeTab();
  if (!tab) return;
  const i = ZOOM_LEVELS.indexOf(tab.zoom);
  const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + dir))];
  setZoom(tab, next);
  toast(`التكبير: ${Math.round(next * 100)}%`);
}
function updateZoomChip() {
  const tab = activeTab();
  const chip = el('zoom-chip');
  const show = tab && !tab.isHome && tab.zoom !== 1;
  chip.hidden = !show;
  if (show) chip.textContent = Math.round(tab.zoom * 100) + '%';
}

function openFindBar() {
  const tab = activeTab();
  if (!tab || tab.isHome) { toast('البحث داخل الصفحة متاح في صفحات الويب'); return; }
  el('find-bar').hidden = false;
  const inp = el('find-input');
  inp.focus();
  inp.select();
  if (inp.value) callWebView(tab, 'findInPage', inp.value);
}
function closeFindBar(stopSearch) {
  if (el('find-bar').hidden) return;
  el('find-bar').hidden = true;
  el('find-count').textContent = '';
  if (stopSearch !== false) callWebView(activeTab() || {}, 'stopFindInPage', 'clearSelection');
}

/* ================= الجلسة ================= */
let sessionTimer = 0;
function saveSessionSoon() {
  if (IS_INCOGNITO) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 350);
}
function saveSession() {
  if (IS_INCOGNITO) return;
  save('session', {
    tabs: tabs.map((t) => ({
      url: t.isHome ? null : (t.pendingUrl || t.url),
      title: t.title, pinned: t.pinned, group: t.group
    })),
    activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTabId))
  });
}
function restoreSession() {
  if (IS_INCOGNITO || !settings.restoreSession) return false;
  const s = store('session', null);
  if (!s || !Array.isArray(s.tabs) || !s.tabs.length) return false;
  const activeIdx = Math.min(s.activeIndex || 0, s.tabs.length - 1);
  s.tabs.forEach((st, i) => {
    createTab({
      url: st.url || null, title: st.title || null,
      pinned: !!st.pinned, group: st.group || null,
      active: i === activeIdx, lazy: i !== activeIdx
    });
  });
  return tabs.length > 0;
}

/* ================= مركز التحكم (الإعدادات والقوائم) ================= */
function openDrawer(view) {
  el('backdrop').hidden = false;
  el('drawer').hidden = false;
  switchDrawerView(view || 'settings');
  el('downloads-dot').hidden = true;
}
function closeDrawer() {
  el('backdrop').hidden = true;
  el('drawer').hidden = true;
}
function switchDrawerView(view) {
  document.querySelectorAll('.drawer-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  ['settings', 'bookmarks', 'history', 'downloads'].forEach((v) => { el('view-' + v).hidden = v !== view; });
  if (view === 'bookmarks') renderBookmarks();
  if (view === 'history') renderHistory();
  if (view === 'downloads') renderDownloads();
}
function emptyState(text) { return `<div class="empty-state">${text}</div>`; }

function renderBookmarks(filter = '') {
  const list = el('bookmarks-list');
  const items = bookmarks.filter((b) => (b.title + b.url).toLowerCase().includes(filter.toLowerCase()));
  if (!items.length) { list.innerHTML = emptyState('لا توجد إشارات مرجعية بعد.<br>اضغط النجمة بجانب شريط العنوان أو Ctrl+D لحفظ الصفحة الحالية.'); return; }
  list.innerHTML = '';
  items.forEach((b) => {
    const row = document.createElement('button');
    row.className = 'list-item';
    row.innerHTML = `<img alt="" src="${b.favicon || GLOBE_FAVICON}"><span class="grow"><div class="t"></div><div class="s ltr"></div></span><span class="del" title="حذف">×</span>`;
    row.querySelector('.t').textContent = b.title || b.url;
    row.querySelector('.s').textContent = b.url;
    row.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) createTab({ url: b.url, active: false });
      else { navigate(activeTab(), b.url); closeDrawer(); }
    });
    row.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      bookmarks = bookmarks.filter((x) => x !== b);
      persistBookmarks();
      updateBookmarkStar();
      renderBookmarks(el('bookmarks-search').value);
    });
    list.appendChild(row);
  });
}
function renderHistory(filter = '') {
  const list = el('history-list');
  const items = historyItems.filter((h) => (h.title + h.url).toLowerCase().includes(filter.toLowerCase())).slice(0, 160);
  if (!items.length) {
    list.innerHTML = emptyState(IS_INCOGNITO ? 'وضع التخفي: لا يُسجَّل أي سجل تصفح.' : 'سجل التصفح فارغ.');
    return;
  }
  list.innerHTML = '';
  items.forEach((h) => {
    const row = document.createElement('button');
    row.className = 'list-item';
    row.innerHTML = `<img alt="" src="${GLOBE_FAVICON}"><span class="grow"><div class="t"></div><div class="s ltr"></div><div class="s"></div></span><span class="del" title="حذف من السجل">×</span>`;
    row.querySelector('.t').textContent = h.title || h.url;
    row.querySelectorAll('.s')[0].textContent = h.url;
    row.querySelectorAll('.s')[1].textContent = fmtTime(h.time);
    row.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) createTab({ url: h.url, active: false });
      else { navigate(activeTab(), h.url); closeDrawer(); }
    });
    row.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      historyItems = historyItems.filter((x) => x !== h);
      persistHistory();
      renderHistory(el('history-search').value);
    });
    list.appendChild(row);
  });
}
function renderDownloads() {
  const list = el('downloads-list');
  const items = [...downloads.values()].reverse();
  if (!items.length) {
    list.innerHTML = emptyState(IN_ELECTRON ? 'لا توجد تنزيلات في هذه الجلسة بعد.<br>ستظهر هنا الملفات أثناء تنزيلها مع شريط التقدم.' : 'التنزيلات الحقيقية تعمل داخل تطبيق Electron.');
    return;
  }
  list.innerHTML = '';
  items.forEach((d) => {
    const pct = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
    const ext = (d.filename.split('.').pop() || '').slice(0, 4);
    const row = document.createElement('div');
    row.className = 'list-item';
    const stateText = d.state === 'completed' ? 'اكتمل التنزيل'
      : d.state === 'cancelled' ? 'أُلغي'
      : d.state === 'interrupted' ? 'توقف — حدثت مشكلة'
      : `${fmtBytes(d.receivedBytes)} من ${fmtBytes(d.totalBytes)} · ${pct}%`;
    row.innerHTML = `<span class="file-icon"></span><span class="grow"><div class="t"></div><div class="s"></div>${d.state === 'progressing' ? `<div class="dl-progress"><i style="width:${pct}%"></i></div>` : ''}</span>`;
    row.querySelector('.file-icon').textContent = ext || 'ملف';
    row.querySelector('.t').textContent = d.filename;
    row.querySelector('.s').textContent = stateText;
    if (d.state === 'completed') {
      const open = document.createElement('button');
      open.className = 'act'; open.textContent = 'فتح';
      open.addEventListener('click', () => window.nova.openDownload(d.savePath));
      const folder = document.createElement('button');
      folder.className = 'act'; folder.textContent = 'المجلد';
      folder.addEventListener('click', () => window.nova.showInFolder(d.savePath));
      row.append(open, folder);
    }
    list.appendChild(row);
  });
}

/* ================= إجراءات الاختصارات العالمية ================= */
function handleAction(action) {
  const tab = activeTab();
  if (action.startsWith('goto-tab:')) {
    const i = Number(action.split(':')[1]);
    if (tabs[i]) activateTab(tabs[i].id);
    return;
  }
  switch (action) {
    case 'new-tab': createTab({}); break;
    case 'close-tab': if (tab) closeTab(tab.id); break;
    case 'reopen-tab': reopenClosedTab(); break;
    case 'next-tab': cycleTab(1); break;
    case 'prev-tab': cycleTab(-1); break;
    case 'focus-omnibox': omnibox.focus(); omnibox.select(); break;
    case 'reload': reloadTab(tab, false); break;
    case 'hard-reload': reloadTab(tab, true); break;
    case 'find': el('find-bar').hidden ? openFindBar() : closeFindBar(); break;
    case 'bookmark': toggleBookmark(); break;
    case 'history': openDrawer('history'); break;
    case 'downloads': openDrawer('downloads'); break;
    case 'zoom-in': zoomStep(1); break;
    case 'zoom-out': zoomStep(-1); break;
    case 'zoom-reset': setZoom(tab, 1); break;
    case 'incognito': window.nova.openIncognito(); break;
    case 'home': navigate(tab, 'nova://home'); break;
    case 'back': callWebView(tab || {}, 'goBack'); break;
    case 'forward': callWebView(tab || {}, 'goForward'); break;
  }
}

/* ================= ربط الأحداث ================= */
function bindUI() {
  el('win-min').addEventListener('click', () => window.nova.minimize());
  el('win-max').addEventListener('click', () => window.nova.toggleMaximize());
  el('win-close').addEventListener('click', () => window.nova.close());
  window.nova.onWindowState(() => {}); // تُبقينا القناة مفتوحة لتحديثات مستقبلية

  el('new-tab-btn').addEventListener('click', () => createTab({}));
  el('back-btn').addEventListener('click', () => callWebView(activeTab() || {}, 'goBack'));
  el('fwd-btn').addEventListener('click', () => callWebView(activeTab() || {}, 'goForward'));
  el('reload-btn').addEventListener('click', () => {
    const tab = activeTab();
    if (!tab) return;
    if (tab.loading) { callWebView(tab, 'stop'); tab.loading = false; updateNavButtons(); progressDone(); }
    else reloadTab(tab, false);
  });
  el('home-btn').addEventListener('click', () => navigate(activeTab(), 'nova://home'));
  el('bookmark-btn').addEventListener('click', toggleBookmark);
  el('zoom-chip').addEventListener('click', () => setZoom(activeTab(), 1));

  el('menu-btn').addEventListener('click', () => (el('drawer').hidden ? openDrawer('settings') : closeDrawer()));
  el('bookmarks-btn').addEventListener('click', () => openDrawer('bookmarks'));
  el('history-btn').addEventListener('click', () => openDrawer('history'));
  el('downloads-btn').addEventListener('click', () => openDrawer('downloads'));
  el('drawer-close').addEventListener('click', closeDrawer);
  el('backdrop').addEventListener('click', closeDrawer);
  document.querySelectorAll('.drawer-tab').forEach((t) => t.addEventListener('click', () => switchDrawerView(t.dataset.view)));

  /* شريط العنوان */
  omnibox.addEventListener('focus', () => { omnibox.select(); if (omnibox.value.trim()) showSuggestions(); });
  omnibox.addEventListener('input', () => {
    clearTimeout(suggestDebounce);
    suggestDebounce = setTimeout(showSuggestions, 140);
  });
  omnibox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestItems.length) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const next = (suggestIndex + dir + suggestItems.length + 1) % (suggestItems.length + 1);
      if (next === suggestItems.length) { suggestIndex = -1; [...el('suggestions').children].forEach((c) => c.classList.remove('selected')); }
      else selectSuggestion(next, true);
    } else if (e.key === 'Enter') {
      const chosen = suggestIndex >= 0 ? suggestItems[suggestIndex] : null;
      if (chosen) chosen.action();
      else navigate(activeTab(), omnibox.value);
      omnibox.blur();
    } else if (e.key === 'Escape') {
      hideSuggestions();
      syncOmniboxForce();
      omnibox.blur();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
      // Ctrl+Enter يكمل www.… .com
      const v = omnibox.value.trim().replace(/^www\.|\.com$/g, '');
      navigate(activeTab(), `www.${v}.com`);
      omnibox.blur();
    }
  });
  omnibox.addEventListener('blur', () => setTimeout(() => { hideSuggestions(); syncOmniboxForce(); }, 120));

  /* بحث الرئيسية */
  el('home-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = el('home-search-input').value.trim();
    if (v) { navigate(activeTab(), v); el('home-search-input').value = ''; }
  });

  /* أزرار صفحة الخطأ/المعاينة */
  el('error-retry').addEventListener('click', () => reloadTab(activeTab(), false));
  el('error-home').addEventListener('click', () => navigate(activeTab(), 'nova://home'));
  el('demo-home').addEventListener('click', () => navigate(activeTab(), 'nova://home'));
  el('demo-open').addEventListener('click', () => { const t = activeTab(); if (t) window.open(t.url, '_blank'); });

  /* البحث داخل الصفحة */
  el('find-input').addEventListener('input', () => {
    const v = el('find-input').value;
    const tab = activeTab();
    if (!tab) return;
    if (v) callWebView(tab, 'findInPage', v);
    else { callWebView(tab, 'stopFindInPage', 'clearSelection'); el('find-count').textContent = ''; }
  });
  el('find-input').addEventListener('keydown', (e) => {
    const tab = activeTab();
    const v = el('find-input').value;
    if (!tab || !v) return;
    if (e.key === 'Enter') callWebView(tab, 'findInPage', v, { forward: !e.shiftKey, findNext: true });
    if (e.key === 'Escape') closeFindBar();
  });
  el('find-next').addEventListener('click', () => { const t = activeTab(), v = el('find-input').value; if (t && v) callWebView(t, 'findInPage', v, { forward: true, findNext: true }); });
  el('find-prev').addEventListener('click', () => { const t = activeTab(), v = el('find-input').value; if (t && v) callWebView(t, 'findInPage', v, { forward: false, findNext: true }); });
  el('find-close').addEventListener('click', () => closeFindBar());

  /* حوار الاختصار */
  el('modal-cancel').addEventListener('click', closeShortcutModal);
  el('modal-ok').addEventListener('click', submitShortcut);
  el('modal-wrap').addEventListener('click', (e) => { if (e.target === el('modal-wrap')) closeShortcutModal(); });
  el('modal-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitShortcut(); });

  /* البحث داخل القوائم */
  el('bookmarks-search').addEventListener('input', (e) => renderBookmarks(e.target.value));
  el('history-search').addEventListener('input', (e) => renderHistory(e.target.value));

  /* ---- الإعدادات ---- */
  document.querySelectorAll('#theme-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.theme = b.dataset.themeVal; persistSettings(); applyTheme();
  }));
  document.querySelectorAll('#accent-swatches .swatch').forEach((s) => s.addEventListener('click', () => {
    settings.accent = s.dataset.accent; persistSettings(); applyAccent(); restartGeoAnimation();
  }));
  document.querySelectorAll('#bg-grid .bg-card').forEach((c) => c.addEventListener('click', () => {
    settings.bg = c.dataset.bg;
    persistSettings(); applyBackground();
    const tab = activeTab();
    if (!(tab && tab.isHome)) toast('ستظهر الخلفية الجديدة في الصفحة الرئيسية');
  }));
  el('bg-color').addEventListener('input', (e) => {
    settings.bgColor = e.target.value; settings.bg = 'solid';
    persistSettings(); applyBackground();
  });
  el('bg-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast('الصورة كبيرة جدًا — الحد الأقصى 3 ميغابايت للحفظ المحلي'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        localStorage.setItem('nova.bgImage', JSON.stringify(reader.result));
        settings.bg = 'image'; persistSettings(); applyBackground();
        toast('تم تعيين الخلفية');
      } catch { toast('تعذّر حفظ الصورة (مساحة التخزين ممتلئة)'); }
    };
    reader.readAsDataURL(file);
  });
  el('set-animations').addEventListener('change', (e) => { settings.animations = e.target.checked; persistSettings(); applyMotion(); restartGeoAnimation(); });
  el('set-low-resource').addEventListener('change', (e) => { settings.lowResource = e.target.checked; persistSettings(); applyMotion(); restartGeoAnimation(); });
  el('set-engine').addEventListener('change', (e) => { settings.engine = e.target.value; persistSettings(); toast(`محرك البحث: ${ENGINES[settings.engine].name}`); });
  el('set-restore').addEventListener('change', (e) => { settings.restoreSession = e.target.checked; persistSettings(); saveSessionSoon(); });
  el('set-record-history').addEventListener('change', (e) => { settings.recordHistory = e.target.checked; persistSettings(); });
  el('set-suggestions').addEventListener('change', (e) => { settings.suggestions = e.target.checked; persistSettings(); });
  el('set-ui-zoom').addEventListener('input', (e) => { settings.uiZoom = Number(e.target.value); persistSettings(); applyUiZoom(); });

  el('btn-incognito').addEventListener('click', () => window.nova.openIncognito());
  el('btn-clear-history').addEventListener('click', () => {
    historyItems = []; persistHistory(); renderHistory();
    toast('تم مسح سجل التصفح');
  });
  el('btn-clear-sitedata').addEventListener('click', async () => {
    await window.nova.clearSiteData();
    toast('تم مسح بيانات المواقع وذاكرة التخزين المؤقت');
  });
  el('btn-open-downloads-folder').addEventListener('click', () => window.nova.openDownloadsFolder());

  /* أحداث من العملية الرئيسية */
  window.nova.onOpenNewTab((url) => createTab({ url }));
  window.nova.onSearchNewTab((text) => createTab({ url: text }));
  window.nova.onDownloadUpdate((d) => {
    downloads.set(d.id, d);
    if (d.state === 'completed') {
      el('downloads-dot').hidden = false;
      toast(`اكتمل تنزيل ${d.filename}`);
    }
    if (!el('view-downloads').hidden) renderDownloads();
  });
  window.nova.onShortcut(handleAction);

  /* إغلاق القوائم العائمة */
  document.addEventListener('click', (e) => {
    const menu = el('tab-menu');
    if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    const sidebar = el('sidebar');
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !el('sidebar-toggle').contains(e.target)) {
      sidebar.classList.remove('open');
      sidebar.hidden = true;
      el('backdrop').hidden = true;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); el('tab-menu').hidden = true; closeShortcutModal(); closeFindBar(); const sb=el('sidebar'); if(sb.classList.contains('open')){sb.classList.remove('open');sb.hidden=true;el('backdrop').hidden=true;} }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
  });

  /* الشريط الجانبي */
  el('sidebar-toggle').addEventListener('click', toggleSidebar);
  el('sidebar-close').addEventListener('click', () => { el('sidebar').classList.remove('open'); el('sidebar').hidden = true; el('backdrop').hidden = true; });
  el('sidebar-search').addEventListener('input', (e) => renderSidebarBookmarks(e.target.value));

  /* خزنة كلمات المرور */
  el('pw-unlock-btn').addEventListener('click', async () => {
    const pw = el('pw-master-input').value;
    if (!pw) { toast('أدخل كلمة المرور الرئيسية أولًا'); return; }
    try { await unlockPwVault(pw); } catch { /* الخطأ يُعرض بالفعل */ }
  });
  el('pw-master-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('pw-unlock-btn').click(); });
  el('pw-add-btn').addEventListener('click', () => { el('pw-add-form').classList.toggle('visible'); });
  el('pw-cancel-btn').addEventListener('click', () => { el('pw-add-form').classList.remove('visible'); });
  el('pw-gen-btn').addEventListener('click', () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let pass = '';
    for (let i = 0; i < 16; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    el('pw-add-pass').value = pass;
    toast('تم إنشاء كلمة مرور قوية');
  });
  el('pw-save-btn').addEventListener('click', async () => {
    const site = el('pw-add-site').value.trim();
    const user = el('pw-add-user').value.trim();
    const pass = el('pw-add-pass').value.trim();
    if (!site || !pass) { toast('أضف الموقع وكلمة المرور على الأقل'); return; }
    if (!pwUnlocked) { toast('يجب فتح الخزنة أولًا'); return; }
    await savePwEntry(site, user, pass);
    el('pw-add-site').value = ''; el('pw-add-user').value = ''; el('pw-add-pass').value = '';
    el('pw-add-form').classList.remove('visible');
  });
  el('pw-search').addEventListener('input', (e) => renderPwVault(e.target.value));

  /* مانع الإعلانات */
  el('adblock-toggle').addEventListener('change', (e) => { adblockEnabled = e.target.checked; updateAdblockUI(); });

  /* اختصارات لوحة المفاتيح في وضع المعاينة (في Electron تأتي من قائمة التطبيق) */
  if (!IN_ELECTRON) {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const map = { t: e.shiftKey ? 'reopen-tab' : 'new-tab', w: 'close-tab', l: 'focus-omnibox', k: 'focus-omnibox', r: 'reload', f: 'find', d: 'bookmark', h: 'history', j: 'downloads', n: e.shiftKey ? 'incognito' : null, tab: e.shiftKey ? 'prev-tab' : 'next-tab', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' };
      const action = map[k] || (e.key === 'Tab' ? map.tab : null);
      if (action) { e.preventDefault(); handleAction(action); }
    });
  }

  osLight.addEventListener?.('change', applyTheme);
  osReducedMotion.addEventListener?.('change', applyMotion);
  document.addEventListener('visibilitychange', restartGeoAnimation);
  window.addEventListener('resize', () => { geo.w = 0; });
  window.addEventListener('beforeunload', saveSession);
}

function syncOmniboxForce() {
  const tab = activeTab();
  omnibox.value = !tab || tab.isHome ? '' : (tab.pendingUrl || tab.url);
}

/* ================= التهيئة ================= */
function init() {
  bindUI();
  applyTheme();
  applyAccent();
  applyMotion();
  applyBackground();
  applyUiZoom();
  applySettingsToControls();
  renderShortcuts();
  updateClock();
  setInterval(updateClock, 10000);
  window.nova.getVersion().then((v) => { el('app-version').textContent = v; }).catch(() => {});

  // تحميل خزنة كلمات المرور المشفرة إن وجدت
  try {
    const raw = localStorage.getItem(PW_KEY);
    if (raw) pwEncrypted = JSON.parse(raw);
  } catch { pwEncrypted = null; }
  if (pwEncrypted) el('pw-lock').classList.add('visible');
  updateAdblockUI();
  requestAdblockStats();
  setInterval(requestAdblockStats, 30000);

  if (!restoreSession()) createTab({});
  if (IS_INCOGNITO) toast('نافذة تصفح متخفٍ — لن يُحفظ أي سجل');
}
init();
