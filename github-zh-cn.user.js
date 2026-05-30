// ==UserScript==
// @name         GitHub 中文化 (GitHub Chinese Translation)
// @namespace    https://github.com/AllanCheung282
// @version      3.0.0
// @description  将 GitHub 页面正文内容翻译为简体中文，支持并行翻译加速
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
    targetLang: 'zh-CN',
    minTextLen: 20,       // 最少字符数才翻译
    concurrency: 4,       // 并行请求数（同时翻译 4 段）
    cacheHours: 4,        // 缓存时间（小时）
  };

  let enabled = GM_getValue('zhcn_on', true);
  const cache = new Map();
  const done = new WeakSet();
  let observer = null;

  // ==================== 常用 GitHub 术语本地词典 ====================
  // 这些高频词直接替换，不调 API
  const DICT = {
    'Overview': '概览',
    'Repositories': '仓库',
    'Projects': '项目',
    'Packages': '软件包',
    'Stars': '星标',
    'Followers': '关注者',
    'Following': '正在关注',
    'Contributions': '贡献',
    'Achievements': '成就',
    'Highlights': '亮点',
    'Organizations': '组织',
    'Sponsors': '赞助者',
    'Sponsoring': '赞助中',
    'Pinned': '已置顶',
    'Popular repositories': '热门仓库',
    'Trending repositories': '趋势仓库',
    'Get started': '开始使用',
    'Create repository': '创建仓库',
    'New repository': '新建仓库',
    'Import repository': '导入仓库',
    'New organization': '新建组织',
    'Settings': '设置',
    'Documentation': '文档',
    'Learn more': '了解更多',
    'View all': '查看全部',
    'Show more': '显示更多',
    'Show less': '收起',
    'Load more': '加载更多',
    'See all': '查看全部',
    'Read more': '阅读更多',
    'Copy link': '复制链接',
    'Copy path': '复制路径',
    'Copy URL': '复制链接',
    'Copy permalink': '复制永久链接',
    'Open in new tab': '新标签页打开',
    'Download': '下载',
    'Raw': '原始文件',
    'Blame': '追溯',
    'History': '历史记录',
    'Edit': '编辑',
    'Delete': '删除',
    'Rename': '重命名',
    'Fork': '复刻',
    'Star': '星标',
    'Watch': '关注',
    'Unwatch': '取消关注',
    'Issues': '议题',
    'Pull requests': '合并请求',
    'Actions': '自动化',
    'Security': '安全',
    'Insights': '洞察',
    'Wiki': '维基',
    'Discussions': '讨论',
    'Code': '代码',
    'Commits': '提交',
    'Branches': '分支',
    'Tags': '标签',
    'Releases': '发布',
    'License': '许可证',
    'README': '自述文件',
    'Contributing': '贡献指南',
    'Changelog': '更新日志',
    'Dependencies': '依赖项',
    'Dependents': '依赖者',
    'Used by': '被使用',
    'Contributors': '贡献者',
    'Environments': '环境',
    'Deployments': '部署',
    'Last commit': '最后提交',
    'Latest commit': '最新提交',
    'Merge pull request': '合并请求',
    'Closed': '已关闭',
    'Open': '开放中',
    'Merged': '已合并',
    'Draft': '草稿',
    'Review': '审查',
    'Assignees': '负责人',
    'Labels': '标签',
    'Milestones': '里程碑',
    'Linked pull requests': '关联的合并请求',
    'No description': '暂无描述',
    'No description provided': '未提供描述',
    'No results found': '未找到结果',
    'Nothing to show': '暂无内容',
    'Search or jump to…': '搜索或跳转…',
    'Type to search': '输入搜索',
    'Filter by': '筛选条件',
    'Sort by': '排序方式',
    'Recently updated': '最近更新',
    'Most stars': '最多星标',
    'Fewest stars': '最少星标',
    'Best match': '最佳匹配',
    'All repositories': '所有仓库',
    'Public': '公开',
    'Private': '私有',
    'Archived': '已归档',
    'Template': '模板',
    'Go to file': '跳转文件',
    'Add file': '添加文件',
    'Create new file': '新建文件',
    'Upload files': '上传文件',
    'Find file': '查找文件',
    'Clone': '克隆',
    'Download ZIP': '下载 ZIP',
    'Open with GitHub Desktop': '用 GitHub Desktop 打开',
    'View code': '查看代码',
    'View deployment': '查看部署',
    'Compare': '比较',
    'Compare & pull request': '比较并创建合并请求',
    'Create pull request': '创建合并请求',
    'New issue': '新建议题',
    'Submit new issue': '提交新议题',
    'Bug report': '问题报告',
    'Feature request': '功能建议',
    'Write': '撰写',
    'Preview': '预览',
    'Leave a comment': '发表评论',
    'Comment': '评论',
    'Subscribe': '订阅',
    'Unsubscribe': '取消订阅',
    'Notifications': '通知',
    'Mark as read': '标记已读',
    'Mark all as read': '全部标记已读',
    'Sign in': '登录',
    'Sign up': '注册',
    'Sign out': '退出',
    'Your profile': '个人资料',
    'Your repositories': '你的仓库',
    'Your projects': '你的项目',
    'Your stars': '你的星标',
    'Account settings': '账户设置',
    'Copilot': '智能助手',
  };

  // ==================== 日志 ====================
  function log(...a) { console.log('[GitHub中文化]', ...a); }

  // ==================== UI ====================
  GM_addStyle(`
    #gh-zhcn-btn{position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:24px;font-size:13px;cursor:pointer;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.12);transition:all 0.2s;border:1px solid #d0d7de;background:#fff;color:#24292f;}
    #gh-zhcn-btn.on{background:#0969da;color:#fff;border-color:#0969da;}
    #gh-zhcn-btn.off{background:#f6f8fa;color:#656d76;}
    #gh-zhcn-btn:hover{box-shadow:0 6px 18px rgba(0,0,0,0.18);transform:translateY(-1px);}
    [data-color-mode="dark"] #gh-zhcn-btn,[data-dark-theme] #gh-zhcn-btn{background:#21262d;color:#c9d1d9;border-color:#30363d;}
    [data-color-mode="dark"] #gh-zhcn-btn.on,[data-dark-theme] #gh-zhcn-btn.on{background:#1f6feb;color:#fff;border-color:#1f6feb;}
    [data-color-mode="dark"] #gh-zhcn-btn.off,[data-dark-theme] #gh-zhcn-btn.off{background:#161b22;color:#484f58;}
    #gh-zhcn-status{position:fixed;top:60px;right:20px;z-index:99998;background:#24292f;color:#fff;padding:6px 14px;border-radius:16px;font-size:12px;font-family:monospace;opacity:0;transition:opacity 0.3s;pointer-events:none;}
    #gh-zhcn-status.show{opacity:0.9;}
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
      enabled ? translateAll() : (() => {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:100000;background:#0969da;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;';
        t.textContent = '翻译已关闭，刷新页面恢复原文（点此关闭）';
        t.onclick = () => t.remove();
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 5000);
      })();
    };
    document.body.appendChild(btn);

    // 状态指示器
    const st = document.createElement('div');
    st.id = 'gh-zhcn-status';
    document.body.appendChild(st);
  }

  let statusTimer = null;
  function showStatus(msg) {
    const st = document.getElementById('gh-zhcn-status');
    if (!st) return;
    st.textContent = msg;
    st.className = 'show';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { st.className = ''; }, 2000);
  }

  // ==================== 判断元素类型 ====================
  function isCodeOrUI(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName.toUpperCase();
    if (['SCRIPT','STYLE','CODE','PRE','KBD','SAMP','VAR',
         'TEXTAREA','INPUT','IFRAME','SVG','MATH','CANVAS',
         'IMG','AUDIO','VIDEO','NOSCRIPT'].includes(tag)) return true;

    let p = el;
    while (p) {
      const t = (p.tagName || '').toUpperCase();
      if (['CODE','PRE','KBD','SAMP','VAR'].includes(t)) return true;
      const c = (p.className || '').toLowerCase() + ' ' + (p.id || '').toLowerCase();
      if (/highlight|blob-code|blob-num|CodeMirror|monaco|cm-|js-file-line|syntax-|react-/.test(c)) return true;
      if (/UnderlineNav|tabnav|breadcrumb|BtnGroup|dropdown|menu|octicon|avatar/.test(c)) return true;
      if (/[^-_]btn[^-_]|badge|Counter|Label|State[^-]|tooltip/.test(c) && p !== el) return true;
      p = p.parentElement;
    }
    return false;
  }

  function isContentBlock(el) {
    if (isCodeOrUI(el)) return false;
    if (done.has(el)) return false;

    const text = (el.textContent || '').trim();
    if (text.length < CONFIG.minTextLen) return false;

    // 不翻译包含块级子元素的容器
    const blockTags = new Set([
      'DIV','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE',
      'NAV','UL','OL','TABLE','FORM','FIELDSET','DETAILS',
      'P','H1','H2','H3','H4','H5','H6','LI','TR','BLOCKQUOTE','PRE',
    ]);
    for (const child of el.children) {
      if (blockTags.has(child.tagName.toUpperCase())) return false;
    }

    if (/^[\d.,:;+\-*/%=<>!|&^~@#$()[\]{}'"`\s\n]+$/.test(text)) return false;
    return true;
  }

  // ==================== 翻译引擎 ====================
  function translateViaGoogle(text) {
    return new Promise((resolve, reject) => {
      const url = 'https://translate.googleapis.com/translate_a/single' +
        '?client=gtx&sl=auto&tl=' + CONFIG.targetLang +
        '&dt=t&q=' + encodeURIComponent(text);

      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 10000,
        onload(r) {
          try {
            const d = JSON.parse(r.responseText);
            let res = '';
            if (d && d[0]) for (const p of d[0]) if (p && p[0]) res += p[0];
            resolve(res || text);
          } catch (e) { reject(e); }
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('超时')),
      });
    });
  }

  function getCached(text) {
    const e = cache.get(text);
    if (e && (Date.now() - e.time < CONFIG.cacheHours * 3600 * 1000)) return e.result;
    return null;
  }

  function setCache(text, result) {
    cache.set(text, { result, time: Date.now() });
    if (cache.size > 3000) {
      const now = Date.now();
      for (const [k, v] of cache) {
        if (now - v.time > CONFIG.cacheHours * 3600 * 1000) cache.delete(k);
      }
    }
  }

  async function translateOne(el) {
    if (!enabled || done.has(el) || isCodeOrUI(el)) return;

    const text = el.textContent.trim();
    if (text.length < CONFIG.minTextLen) { done.add(el); return; }

    // 1. 查词典
    if (DICT[text]) {
      el.textContent = DICT[text];
      done.add(el);
      return;
    }

    // 2. 查缓存
    let translated = getCached(text);
    if (!translated) {
      try {
        translated = await translateViaGoogle(text);
        if (!translated || translated === text) { done.add(el); return; }
        setCache(text, translated);
      } catch (e) {
        done.add(el);
        return;
      }
    }

    // 3. 替换
    if (el.children.length === 0) {
      el.textContent = translated;
    } else {
      // 有内联子元素 → 只翻译直接文本节点
      const textNodes = [];
      for (const c of el.childNodes) {
        if (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) textNodes.push(c);
      }
      if (textNodes.length === 1) {
        textNodes[0].textContent = translated;
      } else {
        // 多个文本节点：逐个翻译
        for (const tn of textNodes) {
          const t = tn.textContent.trim();
          if (t.length < 5) continue;
          let r = getCached(t);
          if (!r) {
            try { r = await translateViaGoogle(t); setCache(t, r); }
            catch (_) { continue; }
          }
          if (r && r !== t) tn.textContent = tn.textContent.replace(t, r);
        }
      }
    }
    done.add(el);
  }

  // ==================== 查找 + 并行翻译 ====================
  function findContentElements(root) {
    const tags = ['P','H1','H2','H3','H4','H5','H6','LI','TD','TH',
                   'DD','DT','FIGCAPTION','BLOCKQUOTE','SUMMARY','LEGEND'];
    const results = [];
    for (const tag of tags) {
      for (const el of root.getElementsByTagName(tag)) {
        if (isContentBlock(el)) results.push(el);
      }
    }
    // 也检查 div/span —— 但只取叶子元素
    for (const el of root.querySelectorAll('div, span, a')) {
      if (el.children.length === 0 && isContentBlock(el)) results.push(el);
    }
    return results;
  }

  async function translateAll(root) {
    if (!enabled) return;
    root = root || document.body;

    const elements = findContentElements(root);
    if (elements.length === 0) return;

    log('找到 ' + elements.length + ' 个内容元素');
    showStatus('翻译中… 0/' + elements.length);
    let doneCount = 0;

    // 并行翻译！
    const queue = [...elements];
    async function worker() {
      while (queue.length > 0 && enabled) {
        const el = queue.shift();
        if (!el || done.has(el)) continue;
        await translateOne(el);
        doneCount++;
        showStatus('翻译中… ' + doneCount + '/' + elements.length);
        // 小延迟防止同时发太多请求
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // 启动 N 个并行 worker
    const workers = [];
    for (let i = 0; i < CONFIG.concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    log('完成！已翻译 ' + doneCount + ' 段');
    showStatus('✅ 完成 ' + doneCount + ' 段翻译');
    setTimeout(() => {
      const st = document.getElementById('gh-zhcn-status');
      if (st) st.className = '';
    }, 3000);
  }

  // ==================== 动态监听 ====================
  function startObserver() {
    if (observer) return;
    let pendingEls = [];
    let timer = null;

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && !isCodeOrUI(node)) {
              for (const el of findContentElements(node)) {
                if (!done.has(el)) pendingEls.push(el);
              }
            }
          }
        }
      }
      if (pendingEls.length > 0 && !timer) {
        timer = setTimeout(async () => {
          timer = null;
          const items = [...new Set(pendingEls)];
          pendingEls = [];
          if (!enabled) return;
          const q = [...items];
          async function w() {
            while (q.length > 0 && enabled) {
              const el = q.shift();
              if (!el || done.has(el) || !document.body.contains(el)) continue;
              await translateOne(el);
              await new Promise((r) => setTimeout(r, 200));
            }
          }
          const ws = [];
          for (let i = 0; i < 3; i++) ws.push(w());
          await Promise.all(ws);
        }, 800);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ==================== SPA ====================
  const _push = history.pushState, _replace = history.replaceState;
  history.pushState = function (...a) { _push.apply(this, a); onNav(); };
  history.replaceState = function (...a) { _replace.apply(this, a); onNav(); };
  window.addEventListener('popstate', onNav);
  function onNav() { if (enabled) setTimeout(() => translateAll(), 2000); }

  // ==================== 启动 ====================
  function main() {
    log('v3.0 并行加速版已加载');
    if (document.body) {
      createButton();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        createButton();
        if (enabled) setTimeout(translateAll, 1500);
      });
    }
    startObserver();
    if (enabled && document.body) setTimeout(translateAll, 1500);
  }
  main();
})();
