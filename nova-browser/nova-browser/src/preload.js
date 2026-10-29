/**
 * NOVA Browser — جسر آمن محدود بين واجهة المتصفح والعملية الرئيسية.
 * تعمل الواجهة داخل Sandbox مع Context Isolation؛ لا ترى Node.js إطلاقًا.
 * ملاحظة: صفحات الويب (webview) لا تحصل على هذا الجسر نهائيًا.
 */
'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('nova', {
  isIncognito: process.argv.includes('--nova-incognito'),
  platform: process.platform,

  // عناصر تحكم النافذة المخصصة
  minimize: () => ipcRenderer.send('win-minimize'),
  toggleMaximize: () => ipcRenderer.send('win-toggle-maximize'),
  close: () => ipcRenderer.send('win-close'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, s) => cb(s)),

  // نوافذ
  openIncognito: () => ipcRenderer.send('open-incognito'),
  openExternal: (url) => ipcRenderer.send('open-external', String(url)),

  // أحداث من العملية الرئيسية
  onOpenNewTab: (cb) => ipcRenderer.on('open-new-tab', (_e, url) => cb(url)),
  onSearchNewTab: (cb) => ipcRenderer.on('search-new-tab', (_e, text) => cb(text)),
  onDownloadUpdate: (cb) => ipcRenderer.on('download-update', (_e, d) => cb(d)),
  onShortcut: (cb) => ipcRenderer.on('nova-shortcut', (_e, action) => cb(action)),

  // التنزيلات
  openDownload: (p) => ipcRenderer.invoke('open-download', String(p)),
  showInFolder: (p) => ipcRenderer.send('show-in-folder', String(p)),
  openDownloadsFolder: () => ipcRenderer.send('open-downloads-folder'),

  // الخصوصية والمعلومات
  clearSiteData: () => ipcRenderer.invoke('clear-site-data'),
  getVersion: () => ipcRenderer.invoke('app-version'),

  // مانع الإعلانات
  getAdblockStats: () => ipcRenderer.invoke('get-adblock-stats'),
  setAdblockEnabled: (enabled) => ipcRenderer.invoke('set-adblock-enabled', Boolean(enabled)),

  // حجم واجهة المستخدم
  setUiZoom: (factor) => {
    try { webFrame.setZoomFactor(Math.min(1.3, Math.max(0.8, Number(factor) || 1))); } catch { /* تجاهل */ }
  }
});
