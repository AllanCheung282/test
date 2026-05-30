// ==UserScript==
// @name         GitHub 中文化 (GitHub Chinese Translation)
// @namespace    https://github.com/AllanCheung282
// @version      4.0.0
// @description  使用 Google 整页翻译引擎将 GitHub 翻译为简体中文
// @author       AllanCheung282
// @match        https://github.com/*
// @match        https://gist.github.com/*
// @match        https://docs.github.com/*
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// ==/UserScript==

/* globals GM_getValue, GM_setValue, GM_addStyle */

(function () {
  'use strict';

  // ==================== 状态 ====================
  let enabled = GM_getValue('zhcn_on', true);

  // ==================== UI 按钮 ====================
  GM_addStyle(`
    #gh-zhcn-btn{position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:24px;font-size:13px;cursor:pointer;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.12);transition:all 0.2s;border:1px solid #d0d7de;background:#fff;color:#24292f;}
    #gh-zhcn-btn.on{background:#0969da;color:#fff;border-color:#0969da;}
    #gh-zhcn-btn.off{background:#f6f8fa;color:#656d76;}
    #gh-zhcn-btn:hover{box-shadow:0 6px 18px rgba(0,0,0,0.18);transform:translateY(-1px);}
    [data-color-mode="dark"] #gh-zhcn-btn,[data-dark-theme] #gh-zhcn-btn{background:#21262d;color:#c9d1d9;border-color:#30363d;}
    [data-color-mode="dark"] #gh-zhcn-btn.on,[data-dark-theme] #gh-zhcn-btn.on{background:#1f6feb;color:#fff;border-color:#1f6feb;}
    [data-color-mode="dark"] #gh-zhcn-btn.off,[data-dark-theme] #gh-zhcn-btn.off{background:#161b22;color:#484f58;}

    /* 隐藏 Google 翻译顶部横幅 */
    .skiptranslate > iframe, body > iframe[src*="translate"], iframe[id*=":"] { display: none !important; }
    body { top: 0 !important; }
  `);

  function createButton() {
    const btn = document.createElement('div');
    btn.id = 'gh-zhcn-btn';
    btn.title = '点击切换 GitHub 中文化翻译';
    function r() {
      btn.className = enabled ? 'on' : 'off';
      btn.innerHTML = (enabled ? '🌐' : '🌍') + ' <span>' + (enabled ? '中文 ON' : '中文 OFF') + '</span>';
    }
    r();
    btn.onclick = () => {
      enabled = !enabled;
      GM_setValue('zhcn_on', enabled);
      r();
      if (enabled) {
        doTranslate();
      } else {
        restorePage();
      }
    };
    document.body.appendChild(btn);
  }

  // ==================== Google 整页翻译引擎 ====================
  function googleTranslateInit() {
    // 添加 Google Translate 回调
    window.googleTranslateElementInit = function () {
      new google.translate.TranslateElement(
        {
          pageLanguage: 'auto',
          includedLanguages: 'zh-CN',
          layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
          autoDisplay: false,
        },
        'gh-zhcn-translate-element'
      );

      // 初始化后自动翻译
      if (enabled) {
        setTimeout(triggerGoogleTranslate, 500);
      }
    };
  }

  function triggerGoogleTranslate() {
    // 通过设置 cookie 触发自动翻译
    // Google Translate 使用 googtrans cookie 来记住语言选择
    const d = new Date();
    d.setTime(d.getTime() + 365 * 24 * 60 * 60 * 1000);
    document.cookie = 'googtrans=/auto/zh-CN;expires=' + d.toUTCString() + ';path=/';

    // 尝试触发翻译
    try {
      const select = document.querySelector('.goog-te-combo');
      if (select) {
        select.value = 'zh-CN';
        select.dispatchEvent(new Event('change'));
      }
    } catch (_) {}

    // 如果 Google 翻译还没加载好，等待后重试
    setTimeout(() => {
      try {
        const select = document.querySelector('.goog-te-combo');
        if (select) {
          select.value = 'zh-CN';
          select.dispatchEvent(new Event('change'));
        }
      } catch (_) {}
    }, 2000);
  }

  function doTranslate() {
    // 检查 Google 翻译是否已加载
    const select = document.querySelector('.goog-te-combo');
    if (select) {
      select.value = 'zh-CN';
      select.dispatchEvent(new Event('change'));
    } else {
      // 重新设置 cookie 并刷新（Google 翻译在页面加载时读取 cookie）
      const d = new Date();
      d.setTime(d.getTime() + 365 * 24 * 60 * 60 * 1000);
      document.cookie = 'googtrans=/auto/zh-CN;expires=' + d.toUTCString() + ';path=/';
      location.reload();
    }
  }

  function restorePage() {
    // 清除翻译 cookie 并刷新
    document.cookie = 'googtrans=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
    location.reload();
  }

  // ==================== 加载 Google 翻译脚本 ====================
  function loadGoogleTranslate() {
    // 创建隐藏容器
    const div = document.createElement('div');
    div.id = 'gh-zhcn-translate-element';
    div.style.display = 'none';
    document.body.appendChild(div);

    // 设置自动翻译 cookie（在页面加载前设置）
    if (enabled) {
      const d = new Date();
      d.setTime(d.getTime() + 365 * 24 * 60 * 60 * 1000);
      document.cookie = 'googtrans=/auto/zh-CN;expires=' + d.toUTCString() + ';path=/';
    }

    // 加载 Google 翻译引擎
    googleTranslateInit();
    const script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    document.head.appendChild(script);
  }

  // ==================== SPA 导航后重新翻译 ====================
  function watchNavigation() {
    const _push = history.pushState, _replace = history.replaceState;
    history.pushState = function (...a) { _push.apply(this, a); onNav(); };
    history.replaceState = function (...a) { _replace.apply(this, a); onNav(); };
    window.addEventListener('popstate', onNav);
  }

  function onNav() {
    if (!enabled) return;
    // SPA 页面切换后，等待渲染完再触发翻译
    setTimeout(() => {
      try {
        const select = document.querySelector('.goog-te-combo');
        if (select && select.value !== 'zh-CN') {
          select.value = 'zh-CN';
          select.dispatchEvent(new Event('change'));
        }
      } catch (_) {}
    }, 2000);
  }

  // ==================== 初始化 ====================
  function init() {
    console.log('[GitHub中文化] v4.0 Google 整页翻译引擎');

    if (document.body) {
      createButton();
      loadGoogleTranslate();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        createButton();
        loadGoogleTranslate();
      });
    }

    watchNavigation();
  }

  init();
})();
