/**
 * أدوات معالجة عناوين URL وإدخالات شريط العنوان — NOVA Browser
 * تعمل في المتصفح (window.NovaUrl) وفي Node.js (للاختبارات).
 */
(function (global) {
  'use strict';

  var DOMAIN_RE = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d{1,5})?([/?#]\S*)?$/;
  var LOCALHOST_RE = /^localhost(:\d{1,5})?([/?#]\S*)?$/i;
  var IP_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?([/?#]\S*)?$/;

  /** هل يبدو الإدخال كعنوان موقع (نطاق/آي بي/مضيف محلي) وليس عبارة بحث؟ */
  function isUrlLike(input) {
    if (!input) return false;
    var s = String(input).trim();
    if (!s || /\s/.test(s)) return false;
    if (/^(https?|nova):\/\//i.test(s)) return true;
    return DOMAIN_RE.test(s) || LOCALHOST_RE.test(s) || IP_RE.test(s);
  }

  /**
   * تطبيع إدخال شريط العنوان.
   * @param {string} raw إدخال المستخدم
   * @param {string} searchTemplate قالب البحث، مثال: https://www.google.com/search?q=%s
   * @returns {{type:'home'|'url'|'search', url:string}}
   */
  function normalizeInput(raw, searchTemplate) {
    var s = String(raw || '').trim();
    if (!s || /^nova:\/\/(home|start|newtab)$/i.test(s) || s === 'about:blank') {
      return { type: 'home', url: 'nova://home' };
    }
    if (/^nova:\/\//i.test(s)) return { type: 'home', url: 'nova://home' };

    if (/^https?:\/\//i.test(s)) {
      try {
        return { type: 'url', url: new URL(s).href };
      } catch (e) {
        /* يتابع كبحث */
      }
    }
    if (isUrlLike(s)) {
      var scheme = LOCALHOST_RE.test(s) || IP_RE.test(s) ? 'http://' : 'https://';
      try {
        return { type: 'url', url: new URL(scheme + s).href };
      } catch (e) {
        /* يتابع كبحث */
      }
    }
    var tpl = searchTemplate || 'https://www.google.com/search?q=%s';
    return { type: 'search', url: tpl.replace('%s', encodeURIComponent(s)) };
  }

  /** استخراج اسم المضيف من رابط، أو سلسلة فارغة عند الفشل */
  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  /** هل الرابط آمن (HTTPS)؟ */
  function isSecure(url) {
    try {
      return new URL(url).protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  var api = { normalizeInput: normalizeInput, isUrlLike: isUrlLike, hostnameOf: hostnameOf, isSecure: isSecure };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NovaUrl = api;
})(typeof window !== 'undefined' ? window : globalThis);
