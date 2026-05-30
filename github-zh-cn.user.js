// ==UserScript==
// @name         GitHub 中文化 (GitHub Chinese Translation)
// @namespace    https://github.com/AllanCheung282
// @version      1.0.0
// @description  将 GitHub 页面内容翻译为简体中文，支持动态加载内容
// @author       AllanCheung282
// @match        https://github.com/*
// @match        https://gist.github.com/*
// @match        https://docs.github.com/*
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

/* globals GM_getValue, GM_setValue, GM_xmlhttpRequest, GM_addStyle */

(function () {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    // 目标语言：zh-CN = 简体中文
    targetLang: 'zh-CN',
    // 翻译 API 延迟（毫秒），避免请求过快被封
    throttleDelay: 800,
    // 批量翻译的最大字符数（Google API 限制约 5000 字符）
    batchMaxChars: 4000,
    // 是否翻译代码块（默认不翻译）
    translateCode: false,
    // 缓存过期时间（毫秒），默认 1 小时
    cacheTTL: 60 * 60 * 1000,
    // 翻译按钮位置
    buttonPosition: { bottom: '20px', right: '20px' },
  };

  // ==================== 状态管理 ====================
  let translationEnabled = GM_getValue('zhcn_enabled', true);
  let translationCache = new Map();
  let pendingNodes = [];
  let throttleTimer = null;
  let observer = null;
  let translatedTextNodes = new WeakSet();

  // ==================== UI：浮动按钮 ====================
  function createToggleButton() {
    // 样式注入
    GM_addStyle(`
      #gh-zhcn-toggle {
        position: fixed;
        bottom: ${CONFIG.buttonPosition.bottom};
        right: ${CONFIG.buttonPosition.right};
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border: 1px solid #d0d7de;
        border-radius: 24px;
        background: #ffffff;
        color: #24292f;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        transition: all 0.2s ease;
        user-select: none;
      }
      #gh-zhcn-toggle:hover {
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
        transform: translateY(-1px);
      }
      #gh-zhcn-toggle.enabled {
        background: #0969da;
        color: #ffffff;
        border-color: #0969da;
      }
      #gh-zhcn-toggle.disabled {
        background: #f6f8fa;
        color: #656d76;
      }
      #gh-zhcn-toggle .icon {
        font-size: 16px;
      }
      /* 暗色模式适配 */
      [data-color-mode="dark"] #gh-zhcn-toggle,
      [data-dark-theme] #gh-zhcn-toggle {
        background: #21262d;
        color: #c9d1d9;
        border-color: #30363d;
      }
      [data-color-mode="dark"] #gh-zhcn-toggle.enabled,
      [data-dark-theme] #gh-zhcn-toggle.enabled {
        background: #1f6feb;
        color: #ffffff;
        border-color: #1f6feb;
      }
      [data-color-mode="dark"] #gh-zhcn-toggle.disabled,
      [data-dark-theme] #gh-zhcn-toggle.disabled {
        background: #161b22;
        color: #484f58;
      }
    `);

    const btn = document.createElement('div');
    btn.id = 'gh-zhcn-toggle';
    btn.title = '点击切换 GitHub 中文化翻译';
    updateButtonState(btn);
    btn.addEventListener('click', () => {
      translationEnabled = !translationEnabled;
      GM_setValue('zhcn_enabled', translationEnabled);
      updateButtonState(btn);
      if (translationEnabled) {
        translateEntirePage();
      } else {
        restoreOriginalText();
      }
    });
    document.body.appendChild(btn);
  }

  function updateButtonState(btn) {
    btn.className = translationEnabled ? 'enabled' : 'disabled';
    btn.innerHTML = `<span class="icon">${translationEnabled ? '🌐' : '🌍'}</span>
      <span>${translationEnabled ? '中文翻译 ON' : '中文翻译 OFF'}</span>`;
  }

  // ==================== 文本提取 ====================
  /**
   * 判断元素是否应该跳过翻译
   */
  function shouldSkipElement(element) {
    if (!element) return true;

    const tag = element.tagName ? element.tagName.toUpperCase() : '';

    // 跳过这些标签
    const skipTags = new Set([
      'SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
      'NOSCRIPT', 'TEXTAREA', 'INPUT', 'IFRAME', 'SVG', 'MATH',
      'CANVAS', 'IMG', 'AUDIO', 'VIDEO',
    ]);
    if (skipTags.has(tag)) return true;

    // 跳过代码相关的 class
    const cls = element.className || '';
    const parentCls = (element.parentElement && element.parentElement.className) || '';
    const combined = cls + ' ' + parentCls;
    const skipPatterns = [
      'highlight', 'blob-code', 'blob-num', 'line-number',
      'CodeMirror', 'monaco-', 'cm-', 'token', 'language-',
      'commit-sha', 'sha-block', 'sha-', 'user-select-contain',
      'email', 'url', 'css-truncate-target',
    ];
    for (const pattern of skipPatterns) {
      if (combined.toLowerCase().includes(pattern.toLowerCase())) return true;
    }

    // 跳过纯数字/哈希/路径的内容
    const text = (element.textContent || '').trim();
    if (!text) return true;
    // 纯数字、SHA 哈希、UUID 等
    if (/^[0-9a-f]{7,40}$/i.test(text)) return true;
    // 纯路径
    if (/^(\/[\w.-]+)+$/.test(text)) return true;
    // 纯数字/符号
    if (/^[\d.,:;+\-*/%=<>!|&^~@#$()[\]{}'"`\s]+$/.test(text)) return true;

    return false;
  }

  /**
   * 判断文本节点的父元素是否在跳过范围内
   */
  function isTextNodeInSkipArea(textNode) {
    let parent = textNode.parentElement;
    while (parent) {
      if (shouldSkipElement(parent)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  /**
   * 获取所有需要翻译的文本节点
   */
  function getTranslatableTextNodes(root = document.body) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // 跳过已翻译的节点
          if (translatedTextNodes.has(node)) return NodeFilter.FILTER_REJECT;
          // 跳过空白节点
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          // 跳过代码/特殊区域的节点
          if (isTextNodeInSkipArea(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }
    return nodes;
  }

  // ==================== 翻译引擎 ====================
  /**
   * 调用 Google Translate API（免费端点）
   */
  function translateText(text) {
    return new Promise((resolve, reject) => {
      const url =
        'https://translate.googleapis.com/translate_a/single' +
        '?client=gtx' +
        '&sl=auto' +
        '&tl=' + CONFIG.targetLang +
        '&dt=t' +
        '&q=' + encodeURIComponent(text);

      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 10000,
        onload: (resp) => {
          try {
            const result = JSON.parse(resp.responseText);
            // Google 返回格式: [[["翻译文本", "原文", ...]], ...]
            let translated = '';
            if (result && result[0]) {
              for (const part of result[0]) {
                if (part && part[0]) {
                  translated += part[0];
                }
              }
            }
            resolve(translated || text);
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  /**
   * 带缓存的翻译
   */
  async function translateWithCache(text) {
    const trimmed = text.trim();
    if (!trimmed) return text;

    // 检查缓存
    const cached = translationCache.get(trimmed);
    if (cached && Date.now() - cached.time < CONFIG.cacheTTL) {
      return text.replace(trimmed, cached.translated);
    }

    try {
      const translated = await translateText(trimmed);
      // 存入缓存
      translationCache.set(trimmed, { translated, time: Date.now() });
      // 定期清理过期缓存
      if (translationCache.size > 5000) {
        cleanCache();
      }
      return text.replace(trimmed, translated);
    } catch (e) {
      console.warn('[GitHub中文化] 翻译失败:', e.message);
      return text; // 失败时返回原文
    }
  }

  function cleanCache() {
    const now = Date.now();
    for (const [key, val] of translationCache) {
      if (now - val.time > CONFIG.cacheTTL) {
        translationCache.delete(key);
      }
    }
  }

  /**
   * 分批翻译文本节点列表
   */
  async function translateNodesInBatch(nodes) {
    // 收集需要翻译的文本
    const textsToTranslate = [];
    const nodeMap = []; // 映射：翻译后的文本 → 节点

    for (const node of nodes) {
      const text = node.textContent.trim();
      if (text && !translationCache.has(text)) {
        textsToTranslate.push(text);
        nodeMap.push({ node, text });
      }
    }

    // 去重
    const uniqueTexts = [...new Set(textsToTranslate)];

    if (uniqueTexts.length === 0) {
      // 全部命中缓存，直接替换
      applyCachedTranslations(nodes);
      return;
    }

    // 分批请求（合并多个短文本为一个请求以提高效率）
    const batches = [];
    let currentBatch = '';
    for (const text of uniqueTexts) {
      if (currentBatch.length + text.length > CONFIG.batchMaxChars && currentBatch) {
        batches.push(currentBatch);
        currentBatch = '';
      }
      // 用特殊分隔符连接多个文本块
      if (currentBatch) currentBatch += '\n|||SPLIT|||\n';
      currentBatch += text;
    }
    if (currentBatch) batches.push(currentBatch);

    // 逐批翻译
    for (const batch of batches) {
      try {
        const translated = await translateText(batch);
        // 拆分为单独的翻译结果
        const parts = batch.split('\n|||SPLIT|||\n');
        const translatedParts = translated.split('\n|||SPLIT|||\n');

        for (let i = 0; i < parts.length; i++) {
          const original = parts[i].trim();
          const result = (translatedParts[i] || original).trim();
          if (result && result !== original) {
            translationCache.set(original, { translated: result, time: Date.now() });
          }
        }
      } catch (e) {
        console.warn('[GitHub中文化] 批量翻译失败:', e.message);
      }

      // 请求节流
      await new Promise((r) => setTimeout(r, CONFIG.throttleDelay));
    }

    // 应用翻译
    applyCachedTranslations(nodes);
  }

  function applyCachedTranslations(nodes) {
    for (const node of nodes) {
      const originalText = node.textContent;
      const trimmed = originalText.trim();
      if (!trimmed) continue;

      // 先检查精确匹配
      const exactCached = translationCache.get(trimmed);
      if (exactCached && exactCached.translated !== trimmed) {
        node.textContent = originalText.replace(trimmed, exactCached.translated);
        translatedTextNodes.add(node);
        continue;
      }

      // 再检查原文本身
      const selfCached = translationCache.get(originalText);
      if (selfCached && selfCached.translated !== originalText) {
        node.textContent = selfCached.translated;
        translatedTextNodes.add(node);
        continue;
      }

      // 逐个短句尝试替换
      let result = originalText;
      let hasChange = false;
      for (const [src, cached] of translationCache) {
        if (src.length > 3 && result.includes(src)) {
          result = result.replace(src, cached.translated);
          hasChange = true;
        }
      }
      if (hasChange) {
        node.textContent = result;
        translatedTextNodes.add(node);
      }
    }
  }

  // ==================== 页面翻译 ====================
  async function translateEntirePage() {
    const nodes = getTranslatableTextNodes();
    if (nodes.length === 0) return;

    console.log(`[GitHub中文化] 发现 ${nodes.length} 个待翻译文本节点`);
    await translateNodesInBatch(nodes);
  }

  /**
   * 恢复原始文本（关闭翻译时）
   */
  function restoreOriginalText() {
    // 由于我们使用替换方式，恢复原始文本比较复杂
    // 最简单的方式：刷新页面
    // 更好的方式：提示用户刷新
    const existing = document.getElementById('gh-zhcn-refresh-tip');
    if (existing) return;

    const tip = document.createElement('div');
    tip.id = 'gh-zhcn-refresh-tip';
    tip.style.cssText = `
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      z-index: 100000; background: #0969da; color: #fff; padding: 10px 20px;
      border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      cursor: pointer; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    tip.textContent = '已关闭翻译，刷新页面即可恢复原文（点击关闭）';
    tip.addEventListener('click', () => tip.remove());
    document.body.appendChild(tip);
    setTimeout(() => { if (tip.parentNode) tip.remove(); }, 5000);
  }

  // ==================== 动态内容监听 ====================
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      // 收集新增的需要翻译的文本节点
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              pendingNodes.push(...getTranslatableTextNodes(node));
            } else if (node.nodeType === Node.TEXT_NODE) {
              if (
                node.textContent &&
                node.textContent.trim() &&
                !isTextNodeInSkipArea(node) &&
                !translatedTextNodes.has(node)
              ) {
                pendingNodes.push(node);
              }
            }
          }
        }
      }

      // 节流处理
      if (pendingNodes.length > 0 && !throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          const nodes = [...new Set(pendingNodes)]; // 去重
          pendingNodes = [];
          if (translationEnabled && nodes.length > 0) {
            translateNodesInBatch(nodes);
          }
        }, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ==================== 页面导航监听（SPA） ====================
  function watchNavigation() {
    // GitHub 使用 History API 进行 SPA 导航
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    function handleNavigation() {
      if (translationEnabled) {
        // 延迟等待页面渲染
        setTimeout(() => {
          translateEntirePage();
        }, 1500);
      }
    }

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      handleNavigation();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      handleNavigation();
    };

    // 监听 popstate（浏览器前进/后退）
    window.addEventListener('popstate', () => {
      if (translationEnabled) {
        setTimeout(() => translateEntirePage(), 1500);
      }
    });
  }

  // ==================== 初始化 ====================
  function init() {
    console.log('[GitHub中文化] v' + GM_info.script.version + ' 已加载');

    // 创建切换按钮
    if (document.body) {
      createToggleButton();
    } else {
      // 如果 body 还没加载，等待 DOMContentLoaded
      document.addEventListener('DOMContentLoaded', () => {
        createToggleButton();
        if (translationEnabled) {
          setTimeout(() => translateEntirePage(), 1200);
        }
      });
    }

    // 启动动态内容监听
    startObserver();

    // 监听 SPA 导航
    watchNavigation();

    // 初次翻译
    if (translationEnabled && document.body) {
      setTimeout(() => translateEntirePage(), 1200);
    }
  }

  // ==================== 启动 ====================
  init();
})();
