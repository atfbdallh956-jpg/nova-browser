/**
 * اختبار دخان (Smoke Test) — لا يُستخدم في الإنتاج.
 * يفتح واجهة NOVA في Electron حقيقي (وضع headless)، يتحقق من إنشاء التبويبات
 * والتنقل وعمل جسر preload، ثم يلتقط لقطة شاشة إلى tests/smoke.png
 *
 * التشغيل:
 *   npx electron --no-sandbox --disable-gpu --ozone-platform=headless tests/smoke-main.js
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
// بيانات مستخدم مؤقتة نظيفة كي لا تتداخل الجلسات بين تشغيلات الاختبار
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'nova-smoke-')));

const results = { errors: [] };

async function run() {
  const win = new BrowserWindow({
    width: 1280, height: 820, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true,
      backgroundThrottling: false
    }
  });
  win.show();
  win.focus();
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) results.errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => results.errors.push('render gone: ' + d.reason));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  results.bridgeExposed = await win.webContents.executeJavaScript('typeof window.nova === "object" && !!window.nova.clearSiteData');
  results.nodeBlocked = await win.webContents.executeJavaScript('typeof window.require === "undefined" && typeof window.process === "undefined"');
  results.initialTabs = await win.webContents.executeJavaScript('document.querySelectorAll(".tab").length');
  results.homeVisible = await win.webContents.executeJavaScript('!document.getElementById("home-page").hidden');
  results.shortcuts = await win.webContents.executeJavaScript('document.querySelectorAll(".shortcut").length');

  // إنشاء تبويب ثانٍ ثم التنقل إلى موقع حقيقي
  await win.webContents.executeJavaScript('document.getElementById("new-tab-btn").click()');
  await new Promise((r) => setTimeout(r, 300));
  results.tabsAfterNew = await win.webContents.executeJavaScript('document.querySelectorAll(".tab").length');

  await win.webContents.executeJavaScript(`
    const i = document.getElementById('omnibox');
    i.focus(); i.value = 'example.com';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  `);
  await new Promise((r) => setTimeout(r, 7000));
  results.omniboxAfterNav = await win.webContents.executeJavaScript('document.getElementById("omnibox").value');
  results.activeTabTitle = await win.webContents.executeJavaScript(
    'document.querySelector(".tab.active .title")?.textContent || ""');
  results.errorPageShown = await win.webContents.executeJavaScript('!document.getElementById("error-page").hidden');
  results.diag = await win.webContents.executeJavaScript(`(() => {
    const wv = document.querySelector('webview.active');
    const r = wv ? wv.getBoundingClientRect() : null;
    return {
      visibility: document.visibilityState,
      wvRect: r ? [Math.round(r.width), Math.round(r.height)] : null,
      wvUrl: wv && wv.getURL ? wv.getURL() : null,
      wvTitle: wv && wv.getTitle ? wv.getTitle() : null,
      searchOpacity: getComputedStyle(document.getElementById('home-search')).opacity,
      searchRect: (() => { const b = document.getElementById('home-search').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()
    };
  })()`);
  // بيئة الاختبار بلا مزامنة إطارات: عطّل الحركات كي تُلتقط الحالة النهائية
  await win.webContents.executeJavaScript('document.body.classList.add("reduced-motion")');
  await new Promise((r) => setTimeout(r, 1200));

  results.tabTitlesAtCapture = await win.webContents.executeJavaScript(
    '[...document.querySelectorAll(".tab .title")].map(t => t.textContent)');
  // التقاط إطار محرك العرض نفسه (صفحة الويب) مباشرة من محتواه
  const guests = require('electron').webContents.getAllWebContents()
    .filter((c) => c.getType() === 'webview');
  results.guestCount = guests.length;
  const guest = guests.find((c) => c.getURL().includes('example.com')) || guests[0];
  if (guest) {
    const gimg = await guest.capturePage();
    fs.writeFileSync(path.join(__dirname, 'smoke-guest.png'), gimg.toPNG());
    results.guestCapture = { url: guest.getURL(), size: gimg.getSize() };
  }

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
  results.screenshot = 'tests/smoke.png';

  // الرجوع للرئيسية والتقاط لقطة ثانية
  await win.webContents.executeJavaScript('document.getElementById("home-btn").click()');
  await new Promise((r) => setTimeout(r, 2200));
  const img2 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'smoke-home.png'), img2.toPNG());
  results.homeScreenshot = 'tests/smoke-home.png';
  results.homeVisibleAfterBtn = await win.webContents.executeJavaScript('!document.getElementById("home-page").hidden');

  console.log('SMOKE_RESULTS ' + JSON.stringify(results, null, 2));
  const ok = results.bridgeExposed && results.nodeBlocked && results.initialTabs >= 1 &&
    results.tabsAfterNew === results.initialTabs + 1 && results.errors.length === 0;
  console.log(ok ? 'SMOKE_OK' : 'SMOKE_CHECK');
  app.exit(ok ? 0 : 2);
}

app.whenReady().then(() => run().catch((e) => { console.error('SMOKE_FAIL', e); app.exit(1); }));
setTimeout(() => { console.error('SMOKE_TIMEOUT'); app.exit(3); }, 60000);
