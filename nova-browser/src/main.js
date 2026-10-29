/**
 * NOVA Browser — العملية الرئيسية (Main Process)
 *
 * المسؤوليات:
 *  - إنشاء نوافذ التطبيق (بدون إطار، مع عناصر تحكم مخصصة)
 *  - إدارة التنزيلات الحقيقية عبر جلسة Chromium
 *  - طلب أذونات المواقع (كاميرا/ميكروفون/موقع) من المستخدم صراحةً
 *  - توجيه الروابط التي تُفتح في نوافذ جديدة إلى تبويبات جديدة
 *  - قائمة سياقية حقيقية لصفحات الويب
 *  - اختصارات لوحة مفاتيح عالمية داخل النافذة عبر قائمة تطبيق مخفية
 *
 * الأمان:
 *  - nodeIntegration معطّل، وcontextIsolation مفعّل، وsandbox مفعّل لواجهة المتصفح
 *  - صفحات الويب تعمل في عمليات عرض منفصلة (webview) دون أي وصول لواجهات النظام
 *  - لا يتم تجاوز أخطاء شهادات HTTPS إطلاقًا (السلوك الافتراضي الصارم)
 */
'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const configuredSessions = new WeakSet();
let nextDownloadId = 1;

/* ================= مانع الإعلانات ================= */
// نطاقات إعلانات ومتعقبين معروفة (قائمة أساسية مدمجة — قابلة للتوسيع)
const AD_TRACKER_DOMAINS = new Set([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com',
  'ads.google.com', 'adservices.google.com', 'pagead2.googlesyndication.com',
  'facebook.com/tr', 'connect.facebook.net', 'www.facebook.com/tr',
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
  'amazon-adsystem.com', 'aax.amazon.com',
  'bing.com/msclk', 'c.bing.com',
  'adnxs.com', 'appnexus.com', 'rubiconproject.com', 'openx.net',
  'pubmatic.com', 'taboola.com', 'outbrain.com', 'adroll.com',
  'criteo.com', 'adsafeprotected.com', 'moatads.com',
  'quantserve.com', 'scorecardresearch.com', 'addthis.com',
  'adobetag.com', 'demdex.net', 'everestjs.net',
  'ads.yahoo.com', 'yieldmanager.com',
  'ads.twitch.tv', 'tpc.googlesyndication.com'
]);

function isAdTracker(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // المضيف نفسه أو نطاق فرعي من نطاق محظور
    for (const blocked of AD_TRACKER_DOMAINS) {
      if (host === blocked || host.endsWith('.' + blocked)) return true;
    }
  } catch { /* عنوان غير صالح */ }
  return false;
}

let adblockBlockedTotal = 0;
let adblockEnabled = true;

/** النافذة المالكة لمحتوى ويب (يتعامل مع ضيوف webview) */
function ownerWindowOf(webContents) {
  if (!webContents) return BrowserWindow.getFocusedWindow();
  const host = webContents.hostWebContents || webContents;
  return BrowserWindow.fromWebContents(host) || BrowserWindow.getFocusedWindow();
}

/** مسار فريد لملف داخل مجلد التنزيلات (يتجنب الكتابة فوق ملفات موجودة) */
function uniqueSavePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

/** تجهيز جلسة: تنزيلات + أذونات (يُستدعى مرة واحدة لكل جلسة/قسم) */
function setupSession(ses) {
  if (!ses || configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  // رفض جميع الأذونات افتراضيًا عند التحقق الصامت
  ses.setPermissionCheckHandler(() => false);

  // طلب الإذن بصراحة من المستخدم قبل أي وصول للكاميرا/الميكروفون/الموقع/الإشعارات
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const win = ownerWindowOf(webContents);
    const site = (details && details.requestingUrl) || webContents.getURL() || 'هذا الموقع';
    const labels = {
      media: 'الكاميرا أو الميكروفون',
      geolocation: 'موقعك الجغرافي',
      notifications: 'إرسال الإشعارات',
      midi: 'أجهزة MIDI',
      pointerLock: 'قفل مؤشر الفأرة',
      fullscreen: 'ملء الشاشة'
    };
    dialog
      .showMessageBox(win, {
        type: 'question',
        title: 'طلب إذن — NOVA Browser',
        message: `يريد الموقع التالي استخدام ${labels[permission] || permission}:`,
        detail: site,
        buttons: ['سماح', 'رفض'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => callback(response === 0))
      .catch(() => callback(false));
  });

  // مانع الإعلانات: حظر طلبات نطاقات الإعلانات والمتعقبين المعروفة
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (!adblockEnabled) return callback({ cancel: false });
    if (isAdTracker(details.url)) {
      adblockBlockedTotal += 1;
      return callback({ cancel: true });
    }
    callback({ cancel: false });
  });

  // التنزيلات الحقيقية: حفظ في مجلد التنزيلات وبثّ التقدم للواجهة
  ses.on('will-download', (_event, item, webContents) => {
    const win = ownerWindowOf(webContents);
    const dir = app.getPath('downloads');
    const savePath = uniqueSavePath(dir, item.getFilename());
    item.setSavePath(savePath);

    const id = nextDownloadId++;
    const send = (state) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('download-update', {
        id,
        filename: path.basename(savePath),
        savePath,
        url: item.getURL(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state
      });
    };
    send('progressing');
    item.on('updated', (_e, state) => send(state)); // progressing | interrupted
    item.once('done', (_e, state) => send(state)); // completed | cancelled | interrupted
  });
}

/** قائمة سياقية حقيقية لمحتوى صفحات الويب */
function attachWebContentsBehavior(contents) {
  setupSession(contents.session);
  if (contents.getType() !== 'webview') return;

  // الروابط التي تطلب نافذة جديدة تُفتح كتبويب جديد داخل NOVA
  contents.setWindowOpenHandler(({ url }) => {
    const win = ownerWindowOf(contents);
    if (win && !win.isDestroyed() && /^https?:\/\//i.test(url)) {
      win.webContents.send('open-new-tab', url);
    }
    return { action: 'deny' };
  });

  contents.on('context-menu', (_e, params) => {
    const win = ownerWindowOf(contents);
    const template = [];
    template.push(
      { label: 'رجوع', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: 'تقدّم', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { label: 'إعادة تحميل', click: () => contents.reload() },
      { type: 'separator' }
    );
    if (params.linkURL) {
      template.push(
        { label: 'فتح الرابط في تبويب جديد', click: () => win && win.webContents.send('open-new-tab', params.linkURL) },
        { label: 'نسخ عنوان الرابط', click: () => require('electron').clipboard.writeText(params.linkURL) }
      );
    }
    if (params.mediaType === 'image' && params.srcURL) {
      template.push(
        { label: 'فتح الصورة في تبويب جديد', click: () => win && win.webContents.send('open-new-tab', params.srcURL) },
        { label: 'حفظ الصورة', click: () => contents.downloadURL(params.srcURL) },
        { label: 'نسخ عنوان الصورة', click: () => require('electron').clipboard.writeText(params.srcURL) }
      );
    }
    if (params.selectionText) {
      template.push(
        { label: 'نسخ', role: 'copy' },
        {
          label: `البحث عن «${params.selectionText.slice(0, 28)}»`,
          click: () => win && win.webContents.send('search-new-tab', params.selectionText)
        }
      );
    }
    if (params.isEditable) {
      template.push(
        { label: 'قص', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'نسخ', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'لصق', role: 'paste', enabled: params.editFlags.canPaste }
      );
    }
    template.push(
      { type: 'separator' },
      { label: 'حفظ الصفحة كاملة (تنزيل)', click: () => contents.downloadURL(contents.getURL()) },
      { label: 'فحص العنصر', click: () => contents.inspectElement(params.x, params.y) }
    );
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

/** إنشاء نافذة متصفح (عادية أو متخفية) */
function createWindow({ incognito = false } = {}) {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#070912',
    title: incognito ? 'NOVA Browser — تصفح متخفٍ' : 'NOVA Browser',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // محرك Chromium الحقيقي لعرض صفحات الويب
      spellcheck: true,
      additionalArguments: incognito ? ['--nova-incognito'] : []
    }
  });

  win.setMenuBarVisibility(false); // القائمة مخفية لكن اختصاراتها تعمل
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: incognito ? { incognito: '1' } : {}
  });
  win.once('ready-to-show', () => win.show());

  const sendState = () =>
    !win.isDestroyed() && win.webContents.send('window-state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('enter-full-screen', sendState);
  win.on('leave-full-screen', sendState);

  // واجهة المتصفح نفسها لا تغادر صفحتها المحلية أبدًا
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return win;
}

/** قائمة تطبيق تحمل الاختصارات فقط (شريط القوائم مخفي) */
function buildShortcutMenu() {
  const send = (action) => () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.send('nova-shortcut', action);
  };
  const items = [
    ['new-tab', 'Control+T'],
    ['close-tab', 'Control+W'],
    ['reopen-tab', 'Control+Shift+T'],
    ['focus-omnibox', 'Control+L'],
    ['focus-omnibox', 'Control+K'],
    ['reload', 'Control+R'],
    ['reload', 'F5'],
    ['hard-reload', 'Control+Shift+R'],
    ['find', 'Control+F'],
    ['bookmark', 'Control+D'],
    ['history', 'Control+H'],
    ['downloads', 'Control+J'],
    ['next-tab', 'Control+Tab'],
    ['prev-tab', 'Control+Shift+Tab'],
    ['zoom-in', 'Control+='],
    ['zoom-out', 'Control+-'],
    ['zoom-reset', 'Control+0'],
    ['incognito', 'Control+Shift+N'],
    ['home', 'Alt+Home'],
    ['back', 'Alt+Left'],
    ['forward', 'Alt+Right']
  ];
  const template = items.map(([action, accelerator]) => ({
    label: action,
    accelerator,
    click: send(action)
  }));
  for (let i = 1; i <= 8; i += 1) {
    template.push({ label: `goto-${i}`, accelerator: `Control+${i}`, click: send(`goto-tab:${i - 1}`) });
  }
  template.push({
    label: 'fullscreen',
    accelerator: 'F11',
    click: () => {
      const win = BrowserWindow.getFocusedWindow();
      if (win) win.setFullScreen(!win.isFullScreen());
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'NOVA', submenu: template }]));
}

/* ------------------------------ IPC ------------------------------ */

const fromSender = (e) => BrowserWindow.fromWebContents(e.sender);

ipcMain.on('win-minimize', (e) => fromSender(e)?.minimize());
ipcMain.on('win-toggle-maximize', (e) => {
  const win = fromSender(e);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win-close', (e) => fromSender(e)?.close());
ipcMain.on('open-incognito', () => createWindow({ incognito: true }));

// فتح روابط خارجية آمنة فقط (http/https/mailto) في التطبيق الافتراضي للنظام
ipcMain.on('open-external', (_e, url) => {
  if (typeof url !== 'string') return;
  try {
    const proto = new URL(url).protocol;
    if (['https:', 'http:', 'mailto:'].includes(proto)) shell.openExternal(url);
  } catch { /* رابط غير صالح: تجاهل */ }
});

ipcMain.handle('open-download', async (_e, filePath) => {
  if (typeof filePath !== 'string') return false;
  const dir = app.getPath('downloads');
  if (!path.resolve(filePath).startsWith(path.resolve(dir))) return false; // حماية: التنزيلات فقط
  const err = await shell.openPath(filePath);
  return err === '';
});
ipcMain.on('show-in-folder', (_e, filePath) => {
  if (typeof filePath === 'string') shell.showItemInFolder(filePath);
});
ipcMain.on('open-downloads-folder', () => shell.openPath(app.getPath('downloads')));

ipcMain.handle('clear-site-data', async () => {
  const ses = require('electron').session.defaultSession;
  await ses.clearStorageData();
  await ses.clearCache();
  return true;
});

ipcMain.handle('app-version', () => app.getVersion());

ipcMain.handle('get-adblock-stats', () => ({ blocked: adblockBlockedTotal }));

ipcMain.handle('set-adblock-enabled', (_e, enabled) => {
  adblockEnabled = !!enabled;
  return adblockEnabled;
});

/* ---------------------------- دورة الحياة ---------------------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else createWindow();
  });

  app.on('web-contents-created', (_e, contents) => attachWebContentsBehavior(contents));

  app.whenReady().then(() => {
    setupSession(require('electron').session.defaultSession);
    buildShortcutMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
