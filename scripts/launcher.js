(() => {
  const ROOT_ID = 'xjtu-tools-site-launcher';
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const isStandalone = location.protocol === 'chrome-extension:' && location.pathname.endsWith('/launcher.html');

  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'XJTU Tools 网站启动器');

  const backdrop = document.createElement('button');
  backdrop.className = 'xjtu-launcher-backdrop';
  backdrop.type = 'button';
  backdrop.tabIndex = -1;
  backdrop.setAttribute('aria-label', '关闭启动器');

  const panel = document.createElement('div');
  panel.className = 'xjtu-launcher-panel';

  const brand = document.createElement('button');
  brand.className = 'xjtu-launcher-brand';
  brand.type = 'button';
  brand.textContent = '↗';
  brand.title = '管理网站词典';
  brand.setAttribute('aria-label', '管理网站词典');

  const searchWrap = document.createElement('div');
  searchWrap.className = 'xjtu-launcher-search';

  const input = document.createElement('input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = '搜索网站，或输入你想做的事';
  input.setAttribute('aria-label', '搜索网站');
  const searchGlyph = document.createElement('span');
  searchGlyph.className = 'xjtu-launcher-search-glyph';
  searchGlyph.textContent = '⌕';
  searchGlyph.setAttribute('aria-hidden', 'true');
  searchWrap.append(input, searchGlyph);

  const resultList = document.createElement('div');
  resultList.className = 'xjtu-launcher-results';
  resultList.setAttribute('role', 'listbox');

  const footer = document.createElement('footer');
  footer.className = 'xjtu-launcher-footer';
  const footerSummary = document.createElement('span');
  footerSummary.className = 'xjtu-launcher-summary';
  const footerKeys = document.createElement('span');
  footerKeys.className = 'xjtu-launcher-keys';
  footerKeys.innerHTML = '<kbd>↑↓</kbd> 选择　<kbd>Enter</kbd> 打开　<kbd>Esc</kbd> 关闭';
  footer.append(footerSummary, footerKeys);

  if (isStandalone) {
    searchWrap.append(brand);
    panel.append(searchWrap, resultList, footer);
  } else {
    panel.append(brand, searchWrap, resultList, footer);
  }
  root.append(backdrop, panel);
  // 独立启动器必须挂在 body 内，才能命中 .xjtu-launcher-page 下的专用样式。
  // 普通网页注入仍挂在 html 下，避免受页面自身布局规则干扰。
  (isStandalone ? document.body : document.documentElement).append(root);

  if (isStandalone) {
    // Chrome 的 popup 外框尺寸会随系统缩放和标题栏高度变化，让后台根据
    // 实际 inner/outer 差值把内容区精确校准到普通网页浮层的 660 × 540。
    chrome.runtime.sendMessage({
      action: 'fitLauncherWindow',
      contentWidth: 660,
      contentHeight: 540,
      frameWidth: Math.max(0, window.outerWidth - window.innerWidth),
      frameHeight: Math.max(0, window.outerHeight - window.innerHeight)
    });
  }

  let sites = [];
  let results = [];
  let activeIndex = 0;

  function closeLauncher() {
    if (root.classList.contains('is-closing')) return;
    root.classList.add('is-closing');
    window.setTimeout(() => {
      root.remove();
      if (isStandalone) window.close();
    }, 120);
  }

  function siteInitial(site) {
    const text = site.name.replace(/^(西安交通大学|西交)/, '').trim();
    return text.slice(0, 1).toUpperCase() || 'X';
  }

  function domainFor(site) {
    try {
      return new URL(site.url).hostname;
    } catch (_error) {
      return site.url;
    }
  }

  function appendHighlighted(container, text, rawQuery) {
    const query = rawQuery.trim();
    if (!query) {
      container.textContent = text;
      return;
    }

    const index = text.toLocaleLowerCase('zh-CN').indexOf(query.toLocaleLowerCase('zh-CN'));
    if (index < 0) {
      container.textContent = text;
      return;
    }

    container.append(document.createTextNode(text.slice(0, index)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(index, index + query.length);
    container.append(mark, document.createTextNode(text.slice(index + query.length)));
  }

  function matchingKeyword(site, rawQuery) {
    const query = rawQuery.trim().toLocaleLowerCase('zh-CN');
    if (!query) return '';
    return (site.keywords || []).find((keyword) => {
      const normalized = keyword.toLocaleLowerCase('zh-CN');
      return normalized.includes(query);
    }) || '';
  }

  async function openSite(site) {
    await XJTUSiteData.recordSiteUse(site.id, input.value);
    chrome.runtime.sendMessage({ action: 'openNavigatorUrl', url: site.url });
    closeLauncher();
  }

  function editSiteKeywords(site) {
    chrome.runtime.sendMessage({ action: 'openNavigatorSettings', siteId: site.id });
    closeLauncher();
  }

  async function deleteSite(site) {
    const confirmed = window.confirm(
      `确定删除“${site.name}”吗？\n\n对应的浏览器书签也会一并删除，此操作无法撤销。`
    );
    if (!confirmed) {
      input.focus();
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'deleteNavigatorSite',
      siteId: site.id
    });
    if (!response?.ok) {
      window.alert(response?.error || '删除失败，请稍后重试。');
      input.focus();
      return;
    }
    sites = await XJTUSiteData.getSites();
    render();
    if (response.failed) {
      window.alert(`已删除 ${response.deleted} 条，另有 ${response.failed} 条书签未能删除。`);
    }
    input.focus();
  }

  function setActive(nextIndex) {
    if (!results.length) return;
    activeIndex = (nextIndex + results.length) % results.length;
    resultList.querySelectorAll('.xjtu-launcher-result').forEach((element, index) => {
      const isActive = index === activeIndex;
      element.classList.toggle('is-active', isActive);
      element.setAttribute('aria-selected', String(isActive));
      if (isActive) element.scrollIntoView({ block: 'nearest' });
    });
  }

  function render() {
    const rankedSites = XJTUSiteData.rankSites(sites, input.value);
    results = rankedSites.slice(0, 8);
    activeIndex = 0;
    resultList.replaceChildren();
    const query = input.value.trim();
    footerSummary.textContent = query
      ? `${rankedSites.length} 个与“${query}”相关的网站`
      : `${sites.length} 个网站 · 输入搜索词快速定位`;

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'xjtu-launcher-empty';
      empty.innerHTML = '<strong>没有匹配的网站</strong><span>可先收藏到浏览器书签并导入，或补充搜索词</span>';
      resultList.append(empty);
      return;
    }

    results.forEach((site, index) => {
      const row = document.createElement('div');
      row.className = `xjtu-launcher-result${index === 0 ? ' is-active' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === 0));
      row.setAttribute('aria-label', `${site.name}，点击打开网站`);

      const icon = document.createElement('span');
      icon.className = 'xjtu-launcher-site-icon';
      icon.textContent = siteInitial(site);
      const favicon = document.createElement('img');
      favicon.src = XJTUSiteData.faviconUrl(site.url, 32);
      favicon.alt = '';
      favicon.addEventListener('error', () => favicon.remove());
      icon.append(favicon);

      const copy = document.createElement('span');
      copy.className = 'xjtu-launcher-site-copy';
      const title = document.createElement('strong');
      appendHighlighted(title, site.name, query);
      const meta = document.createElement('small');
      const keyword = matchingKeyword(site, query);
      if (keyword && !site.name.toLocaleLowerCase('zh-CN').includes(query.toLocaleLowerCase('zh-CN'))) {
        const keywordMark = document.createElement('mark');
        keywordMark.textContent = keyword;
        meta.append(keywordMark, document.createTextNode(' · '));
      }
      meta.append(document.createTextNode(`${domainFor(site)} · ${site.description || '自定义网站'}`));
      copy.append(title, meta);

      const shortcut = document.createElement('span');
      shortcut.className = 'xjtu-launcher-shortcut';
      shortcut.textContent = `Ctrl+${index + 1}`;

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'xjtu-launcher-edit';
      editButton.textContent = '✎';
      editButton.title = '添加或修改搜索词';
      editButton.setAttribute('aria-label', `编辑 ${site.name} 的搜索词`);
      editButton.addEventListener('click', (event) => {
        event.stopPropagation();
        editSiteKeywords(site);
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'xjtu-launcher-delete';
      deleteButton.textContent = '×';
      deleteButton.title = '删除网站及对应书签';
      deleteButton.setAttribute('aria-label', `删除 ${site.name}`);
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteSite(site);
      });

      const actions = document.createElement('span');
      actions.className = 'xjtu-launcher-result-actions';
      actions.append(editButton, deleteButton);

      row.append(icon, copy, actions, shortcut);
      row.addEventListener('mouseenter', () => setActive(index));
      row.addEventListener('click', () => openSite(site));
      resultList.append(row);
    });
  }

  input.addEventListener('input', render);
  root.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.target instanceof Element && event.target.closest('.xjtu-launcher-result-actions')) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLauncher();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      openSite(results[activeIndex]);
    } else if (event.ctrlKey && /^[1-8]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (results[index]) {
        event.preventDefault();
        openSite(results[index]);
      }
    }
  });

  backdrop.addEventListener('click', closeLauncher);
  if (isStandalone) {
    // 独立兜底窗口只应在用户持续操作它时存在；切回网页后立即收起，
    // 避免窗口残留在普通网页上，造成“HTTP 页面也只能用小窗”的错觉。
    window.addEventListener('blur', closeLauncher, { once: true });
  }
  brand.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openNavigatorSettings' });
    closeLauncher();
  });

  XJTUSiteData.getSites().then((loadedSites) => {
    sites = loadedSites;
    render();
    window.requestAnimationFrame(() => {
      root.classList.add('is-visible');
      input.focus();
    });
  });
})();
