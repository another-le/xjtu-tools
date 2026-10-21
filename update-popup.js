const REPOSITORY_URL = 'https://github.com/another-le/xjtu-tools';
const DISMISSED_UPDATE_VERSION_KEY = 'dismissedUpdateVersion';
const BOOKMARK_PENDING_KEY = 'siteNavigatorPendingBookmarksV1';

const elements = {
  statusIndicator: document.querySelector('#statusIndicator'),
  statusTitle: document.querySelector('#statusTitle'),
  statusCopy: document.querySelector('#statusCopy'),
  headerVersion: document.querySelector('#headerVersion'),
  currentVersion: document.querySelector('#currentVersion'),
  latestVersion: document.querySelector('#latestVersion'),
  updateButton: document.querySelector('#updateButton'),
  reminderOption: document.querySelector('#reminderOption'),
  dismissReminder: document.querySelector('#dismissReminder'),
  reminderHint: document.querySelector('#reminderHint'),
  retryButton: document.querySelector('#retryButton'),
  repositoryButton: document.querySelector('#repositoryButton'),
  navigatorEnabled: document.querySelector('#navigatorEnabled'),
  navigatorStateText: document.querySelector('#navigatorStateText'),
  bookmarkSync: document.querySelector('#bookmarkSync'),
  bookmarkSyncTitle: document.querySelector('#bookmarkSyncTitle'),
  bookmarkFaviconFallback: document.querySelector('#bookmarkFaviconFallback'),
  bookmarkFolderPath: document.querySelector('#bookmarkFolderPath'),
  bookmarkTitle: document.querySelector('#bookmarkTitle'),
  bookmarkKeywordEditor: document.querySelector('#bookmarkKeywordEditor'),
  bookmarkKeywordTokens: document.querySelector('#bookmarkKeywordTokens'),
  bookmarkKeywords: document.querySelector('#bookmarkKeywords'),
  bookmarkError: document.querySelector('#bookmarkError'),
  bookmarkSkipButton: document.querySelector('#bookmarkSkipButton'),
  bookmarkDefaultButton: document.querySelector('#bookmarkDefaultButton'),
  bookmarkAcceptButton: document.querySelector('#bookmarkAcceptButton'),
  siteDiscovery: document.querySelector('#siteDiscovery'),
  discoveryHostname: document.querySelector('#discoveryHostname'),
  discoveryFaviconFallback: document.querySelector('#discoveryFaviconFallback')
};

let currentUpdateInfo = null;
let discoveryCandidate = null;
let pendingBookmark = null;
let pendingKeywords = [];

function addPendingKeyword(rawKeyword) {
  const keyword = String(rawKeyword || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!keyword) return false;
  const normalized = keyword.toLocaleLowerCase('zh-CN');
  if (pendingKeywords.some((item) => item.toLocaleLowerCase('zh-CN') === normalized)) return false;
  pendingKeywords.push(keyword);
  return true;
}

function renderPendingKeywords() {
  elements.bookmarkKeywordTokens.replaceChildren();
  pendingKeywords.forEach((keyword, index) => {
    const token = document.createElement('span');
    token.className = 'bookmark-keyword-token';
    const text = document.createElement('span');
    text.textContent = keyword;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除关键词 ${keyword}`);
    remove.addEventListener('click', () => {
      pendingKeywords.splice(index, 1);
      renderPendingKeywords();
      elements.bookmarkKeywords.focus();
    });
    token.append(text, remove);
    elements.bookmarkKeywordTokens.append(token);
  });
}

function commitPendingKeyword() {
  const added = addPendingKeyword(elements.bookmarkKeywords.value);
  elements.bookmarkKeywords.value = '';
  if (added) renderPendingKeywords();
}

async function resolvePendingBookmark() {
  if (!pendingBookmark) return;
  const stored = await chrome.storage.local.get(BOOKMARK_PENDING_KEY);
  const pending = (stored[BOOKMARK_PENDING_KEY] || [])
    .filter((item) => String(item.id) !== String(pendingBookmark.id));
  await chrome.storage.local.set({ [BOOKMARK_PENDING_KEY]: pending });
  await chrome.action.setBadgeText({ text: pending.length ? '+' : '' });
  await chrome.action.setTitle({ title: pending.length
    ? `还有 ${pending.length} 个新书签等待处理`
    : 'XJTU Tools' });
}

async function acceptPendingBookmark(useDefaultKeywords = false) {
  if (!pendingBookmark) return;
  const fallbackKeywords = XJTUSiteData.bookmarkTitleKeywords(pendingBookmark.title);
  const defaultKeywords = pendingBookmark.defaultKeywords?.length
    ? pendingBookmark.defaultKeywords
    : (fallbackKeywords.length ? fallbackKeywords : [pendingBookmark.title].filter(Boolean));
  if (!useDefaultKeywords) commitPendingKeyword();
  const keywords = useDefaultKeywords ? defaultKeywords : [...pendingKeywords];
  if (!keywords.length) {
    elements.bookmarkError.textContent = '请至少填写一个搜索词';
    elements.bookmarkKeywords.focus();
    return;
  }
  const sites = await XJTUSiteData.getSites();
  const bookmarkUrlKey = XJTUSiteData.canonicalUrlKey(pendingBookmark.url);
  const existing = sites.find((site) => XJTUSiteData.canonicalUrlKey(site.url) === bookmarkUrlKey);
  const source = pendingBookmark.source;
  const now = Date.now();
  if (existing) {
    const generatedByThisBookmark = new Set((pendingBookmark.addedDefaultKeywords || [])
      .map((keyword) => keyword.toLocaleLowerCase('zh-CN')));
    const preservedKeywords = useDefaultKeywords
      ? (existing.keywords || [])
      : (existing.keywords || []).filter((keyword) =>
        !generatedByThisBookmark.has(keyword.toLocaleLowerCase('zh-CN')));
    existing.keywords = [...new Set([...preservedKeywords, ...keywords])];
    existing.importedFromBookmarks = true;
    existing.sourceBookmarkIds = [...new Set([
      ...(existing.sourceBookmarkIds || []).map(String),
      String(pendingBookmark.id)
    ])];
    existing.bookmarkSources = [
      ...(existing.bookmarkSources || []).filter((item) => String(item.id) !== String(pendingBookmark.id)),
      source
    ];
    if (!(existing.groupPaths || []).some((path) => JSON.stringify(path) === JSON.stringify(source.groupPath))) {
      existing.groupPaths = [...(existing.groupPaths || []), source.groupPath];
    }
    existing.updatedAt = now;
  } else {
    sites.push({
      id: `bookmark-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: pendingBookmark.title,
      url: pendingBookmark.url,
      description: source.folders?.length ? `来自书签：${source.folders.join(' / ')}` : '来自浏览器书签',
      keywords,
      builtin: false,
      importedFromBookmarks: true,
      bookmarkOnly: true,
      sourceBookmarkIds: [String(pendingBookmark.id)],
      bookmarkSources: [source],
      groupPaths: [source.groupPath],
      usageCount: 0,
      lastUsedAt: 0,
      createdAt: now,
      updatedAt: now
    });
  }
  await XJTUSiteData.saveSites(sites);
  await resolvePendingBookmark();
  window.close();
}

async function loadPendingBookmark() {
  const stored = await chrome.storage.local.get(BOOKMARK_PENDING_KEY);
  const pending = stored[BOOKMARK_PENDING_KEY] || [];
  const requestedId = new URLSearchParams(window.location.search).get('bookmarkId');
  pendingBookmark = pending.find((item) => String(item.id) === requestedId) || pending[pending.length - 1] || null;
  if (!pendingBookmark) return false;
  elements.bookmarkSyncTitle.textContent = pendingBookmark.indexedWithDefaults
    ? '新书签已加入快速访问'
    : '新书签：设置搜索词以加入快速访问';
  elements.bookmarkSkipButton.textContent = pendingBookmark.indexedWithDefaults ? '稍后修改' : '稍后设置';
  elements.bookmarkFolderPath.textContent = `已收藏到 · ${pendingBookmark.source?.groupPath?.join(' / ') || '书签'}`;
  elements.bookmarkTitle.textContent = pendingBookmark.title;
  const fallbackKeywords = XJTUSiteData.bookmarkTitleKeywords(pendingBookmark.title);
  const defaultKeywords = pendingBookmark.defaultKeywords?.length
    ? pendingBookmark.defaultKeywords
    : (fallbackKeywords.length ? fallbackKeywords : [pendingBookmark.title].filter(Boolean));
  pendingKeywords = [];
  defaultKeywords.forEach(addPendingKeyword);
  elements.bookmarkKeywords.value = '';
  renderPendingKeywords();
  const favicon = document.createElement('img');
  favicon.src = XJTUSiteData.faviconUrl(pendingBookmark.url, 32);
  favicon.alt = '';
  favicon.addEventListener('error', () => favicon.remove());
  elements.bookmarkFaviconFallback.append(favicon);
  elements.bookmarkSync.hidden = false;
  window.setTimeout(() => elements.bookmarkKeywords.focus(), 30);
  return true;
}

async function loadNavigatorState() {
  const stored = await chrome.storage.local.get(XJTUSiteData.NAVIGATOR_ENABLED_KEY);
  const enabled = stored[XJTUSiteData.NAVIGATOR_ENABLED_KEY] !== false;
  elements.navigatorEnabled.checked = enabled;
  elements.navigatorStateText.textContent = enabled
    ? '快捷键与新网站发现已开启'
    : '快捷键与新网站发现已关闭';
  if (!enabled) elements.siteDiscovery.hidden = true;
  return enabled;
}

async function loadDiscoveryCandidate() {
  const enabled = await loadNavigatorState();
  if (!enabled) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) return;
  const response = await chrome.runtime.sendMessage({
    action: 'getSiteDiscoveryCandidate',
    tabId: tab.id
  });
  if (!response?.candidate) return;

  discoveryCandidate = response.candidate;
  elements.discoveryHostname.textContent = discoveryCandidate.hostname;
  const favicon = document.createElement('img');
  favicon.src = XJTUSiteData.faviconUrl(discoveryCandidate.url, 32);
  favicon.alt = '';
  favicon.addEventListener('error', () => favicon.remove());
  elements.discoveryFaviconFallback.append(favicon);
  elements.siteDiscovery.hidden = false;
}

async function readDismissedVersion() {
  const stored = await chrome.storage.local.get(DISMISSED_UPDATE_VERSION_KEY);
  return stored[DISMISSED_UPDATE_VERSION_KEY];
}

function setState(state) {
  elements.statusIndicator.className = `status-indicator ${state}`;
}

function openRepository() {
  chrome.tabs.create({ url: REPOSITORY_URL });
  window.close();
}

function showError(message) {
  setState('has-error');
  elements.statusTitle.textContent = '检查失败';
  elements.statusCopy.textContent = message;
  elements.updateButton.hidden = true;
  elements.reminderOption.hidden = true;
  elements.retryButton.hidden = false;
}

function renderUpdateInfo(info) {
  currentUpdateInfo = info;
  elements.headerVersion.textContent = `v${info.currentVersion}`;
  elements.currentVersion.textContent = `v${info.currentVersion}`;
  elements.latestVersion.textContent = `v${info.latestVersion}`;
  elements.retryButton.hidden = true;

  if (info.updateAvailable) {
    setState('has-update');
    elements.statusTitle.textContent = '发现新版本';
    elements.statusCopy.textContent = info.reminderDismissed
      ? `已关闭 v${info.latestVersion} 的自动提醒，仍可随时手动更新。`
      : '新版已发布，下载 ZIP 覆盖原文件即可更新。';
    elements.updateButton.hidden = false;
    elements.reminderOption.hidden = false;
    elements.dismissReminder.checked = info.reminderDismissed;
    elements.reminderHint.textContent = `仅忽略 v${info.latestVersion}，下一版本仍会提醒`;
    return;
  }

  setState('is-current');
  elements.statusTitle.textContent = '已是最新版本';
  elements.statusCopy.textContent = '当前安装版本与 GitHub 主分支一致。';
  elements.updateButton.hidden = true;
  elements.reminderOption.hidden = true;
}

function checkForUpdates() {
  setState('is-loading');
  elements.statusTitle.textContent = '正在检查更新';
  elements.statusCopy.textContent = '正在读取 GitHub 上的版本信息…';
  elements.updateButton.hidden = true;
  elements.reminderOption.hidden = true;
  elements.retryButton.hidden = true;

  chrome.runtime.sendMessage({ action: 'getUpdateInfo' }, async (response) => {
    if (chrome.runtime.lastError) {
      showError('扩展后台暂时没有响应，请稍后重试。');
      return;
    }
    if (!response?.ok) {
      showError(response?.error || 'GitHub 版本信息读取失败，请检查网络。');
      return;
    }

    try {
      const dismissedVersion = await readDismissedVersion();
      renderUpdateInfo({ ...response, reminderDismissed: dismissedVersion === response.latestVersion });
    } catch (error) {
      showError(`无法读取提醒设置：${error.message}`);
    }
  });
}

async function setReminderDismissed(dismissed) {
  if (!currentUpdateInfo) return;
  elements.reminderOption.classList.add('is-saving');
  try {
    if (dismissed) {
      await chrome.storage.local.set({ [DISMISSED_UPDATE_VERSION_KEY]: currentUpdateInfo.latestVersion });
    } else {
      await chrome.storage.local.remove(DISMISSED_UPDATE_VERSION_KEY);
    }
    const pendingState = await chrome.storage.local.get(BOOKMARK_PENDING_KEY);
    chrome.action.setBadgeText({
      text: (pendingState[BOOKMARK_PENDING_KEY] || []).length ? '+' : (dismissed ? '' : 'NEW')
    });
    renderUpdateInfo({ ...currentUpdateInfo, reminderDismissed: dismissed });
  } catch (error) {
    elements.dismissReminder.checked = !dismissed;
    elements.reminderHint.textContent = `保存失败：${error.message}`;
  } finally {
    elements.reminderOption.classList.remove('is-saving');
  }
}

elements.updateButton.addEventListener('click', openRepository);
elements.repositoryButton.addEventListener('click', openRepository);
elements.retryButton.addEventListener('click', checkForUpdates);
elements.dismissReminder.addEventListener('change', (event) => setReminderDismissed(event.target.checked));
elements.navigatorEnabled.addEventListener('change', async () => {
  const enabled = elements.navigatorEnabled.checked;
  await chrome.storage.local.set({ [XJTUSiteData.NAVIGATOR_ENABLED_KEY]: enabled });
  await chrome.runtime.sendMessage({ action: 'setSiteNavigatorEnabled', enabled });
  elements.navigatorStateText.textContent = enabled
    ? '快捷键与新网站发现已开启'
    : '快捷键与新网站发现已关闭';
  if (!enabled) elements.siteDiscovery.hidden = true;
});
elements.bookmarkDefaultButton.addEventListener('click', () => acceptPendingBookmark(true));
elements.bookmarkAcceptButton.addEventListener('click', () => acceptPendingBookmark(false));
elements.bookmarkSkipButton.addEventListener('click', async () => {
  if (!pendingBookmark) return;
  const stored = await chrome.storage.local.get(BOOKMARK_PENDING_KEY);
  const pending = stored[BOOKMARK_PENDING_KEY] || [];
  const item = pending.find((entry) => String(entry.id) === String(pendingBookmark.id));
  if (item) {
    item.deferred = true;
    await chrome.storage.local.set({ [BOOKMARK_PENDING_KEY]: pending });
  }
  window.close();
});
elements.bookmarkKeywordEditor.addEventListener('click', () => elements.bookmarkKeywords.focus());
elements.bookmarkKeywords.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitPendingKeyword();
  } else if (event.key === 'Backspace' && !elements.bookmarkKeywords.value && pendingKeywords.length) {
    pendingKeywords.pop();
    renderPendingKeywords();
  }
});

checkForUpdates();
loadPendingBookmark()
  .then((hasPendingBookmark) => hasPendingBookmark ? null : loadDiscoveryCandidate())
  .catch((error) => console.warn('[Popup] 无法读取待处理项目:', error));
