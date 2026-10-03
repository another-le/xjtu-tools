const REPOSITORY_URL = 'https://github.com/another-le/xjtu-tools';
const DISMISSED_UPDATE_VERSION_KEY = 'dismissedUpdateVersion';
const BOOKMARK_PENDING_KEY = 'siteNavigatorPendingBookmarksV1';
const BOOKMARK_SYNC_FOLDER_IDS_KEY = 'siteNavigatorBookmarkSyncFolderIdsV1';
const BOOKMARK_GROUP_ROOT_KEY = 'siteNavigatorBookmarkGroupRootV1';

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
  bookmarkFaviconFallback: document.querySelector('#bookmarkFaviconFallback'),
  bookmarkFolderPath: document.querySelector('#bookmarkFolderPath'),
  bookmarkTitle: document.querySelector('#bookmarkTitle'),
  bookmarkKeywords: document.querySelector('#bookmarkKeywords'),
  bookmarkError: document.querySelector('#bookmarkError'),
  bookmarkDefaultButton: document.querySelector('#bookmarkDefaultButton'),
  bookmarkAcceptButton: document.querySelector('#bookmarkAcceptButton'),
  siteDiscovery: document.querySelector('#siteDiscovery'),
  discoveryHostname: document.querySelector('#discoveryHostname'),
  discoveryFaviconFallback: document.querySelector('#discoveryFaviconFallback'),
  discoveryQuestion: document.querySelector('#discoveryQuestion'),
  discoveryForm: document.querySelector('#discoveryForm'),
  discoveryBookmarkFolder: document.querySelector('#discoveryBookmarkFolder'),
  discoveryName: document.querySelector('#discoveryName'),
  discoveryKeywords: document.querySelector('#discoveryKeywords'),
  discoveryError: document.querySelector('#discoveryError'),
  discoveryLaterButton: document.querySelector('#discoveryLaterButton'),
  discoveryIgnoreButton: document.querySelector('#discoveryIgnoreButton'),
  discoveryAddButton: document.querySelector('#discoveryAddButton'),
  discoveryCancelButton: document.querySelector('#discoveryCancelButton'),
  discoverySaveButton: document.querySelector('#discoverySaveButton')
};

let currentUpdateInfo = null;
let discoveryCandidate = null;
let discoveryTabId = null;
let pendingBookmark = null;
let discoveryBookmarkFolders = [];

function parsePopupKeywords(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[,，、;；\n]+/)
    .map((keyword) => keyword.trim().replace(/\s+/g, ' '))
    .filter((keyword) => {
      const normalized = keyword.toLocaleLowerCase('zh-CN');
      if (!keyword || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

async function bookmarkSourceFromNode(node) {
  const folders = [];
  const folderIds = [];
  let parentId = node.parentId;
  while (parentId) {
    const [parent] = await chrome.bookmarks.get(String(parentId));
    if (!parent) break;
    if (parent.title) {
      folders.unshift(parent.title);
      folderIds.unshift(String(parent.id));
    }
    parentId = parent.parentId;
  }
  const stored = await chrome.storage.local.get(BOOKMARK_GROUP_ROOT_KEY);
  const groupPath = XJTUSiteData.bookmarkGroupPath(folders);
  groupPath[0] = stored[BOOKMARK_GROUP_ROOT_KEY] || '书签';
  return {
    id: String(node.id),
    parentId: String(node.parentId || ''),
    folders,
    folderIds,
    groupPath
  };
}

function syncedBookmarkFolders(tree, syncedFolderIds) {
  const output = [];
  const visit = (nodes, parentTitles = []) => nodes.forEach((node) => {
    if (node.url) return;
    const titles = node.title ? [...parentTitles, node.title] : parentTitles;
    if (node.title && syncedFolderIds.has(String(node.id))) {
      output.push({
        id: String(node.id),
        label: titles.join(' / ')
      });
    }
    visit(node.children || [], titles);
  });
  visit(tree);
  return output.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

async function ensureDiscoveryBookmark() {
  const folderId = String(elements.discoveryBookmarkFolder.value || '');
  if (!discoveryBookmarkFolders.some((folder) => folder.id === folderId)) {
    throw new Error('请选择一个已导入的书签文件夹');
  }
  const matches = await chrome.bookmarks.search({ url: discoveryCandidate.url });
  const existing = matches.find((node) =>
    node.url === discoveryCandidate.url && String(node.parentId) === folderId);
  if (existing) {
    const name = elements.discoveryName.value.trim();
    return name && name !== existing.title
      ? chrome.bookmarks.update(existing.id, { title: name })
      : existing;
  }
  return chrome.bookmarks.create({
    parentId: folderId,
    title: elements.discoveryName.value.trim(),
    url: discoveryCandidate.url
  });
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
  const keywords = useDefaultKeywords
    ? defaultKeywords
    : parsePopupKeywords(elements.bookmarkKeywords.value);
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
  pendingBookmark = (stored[BOOKMARK_PENDING_KEY] || [])[0] || null;
  if (!pendingBookmark) return false;
  elements.bookmarkFolderPath.textContent = `已收藏到 · ${pendingBookmark.source?.groupPath?.join(' / ') || '书签'}`;
  elements.bookmarkTitle.textContent = pendingBookmark.title;
  const fallbackKeywords = XJTUSiteData.bookmarkTitleKeywords(pendingBookmark.title);
  const defaultKeywords = pendingBookmark.defaultKeywords?.length
    ? pendingBookmark.defaultKeywords
    : (fallbackKeywords.length ? fallbackKeywords : [pendingBookmark.title].filter(Boolean));
  elements.bookmarkKeywords.value = defaultKeywords.join('，');
  const favicon = document.createElement('img');
  favicon.src = XJTUSiteData.faviconUrl(pendingBookmark.url, 32);
  favicon.alt = '';
  favicon.addEventListener('error', () => favicon.remove());
  elements.bookmarkFaviconFallback.append(favicon);
  elements.bookmarkSync.hidden = false;
  if (pendingBookmark.indexedWithDefaults) await resolvePendingBookmark();
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

async function clearDiscoveryCandidate() {
  if (!Number.isInteger(discoveryTabId)) return;
  await chrome.runtime.sendMessage({
    action: 'clearSiteDiscoveryCandidate',
    tabId: discoveryTabId
  });
}

async function dismissDiscoveryForSession() {
  if (!discoveryCandidate) return;
  await chrome.runtime.sendMessage({
    action: 'dismissSiteDiscoverySession',
    hostname: discoveryCandidate.hostname
  });
  await clearDiscoveryCandidate();
  window.close();
}

async function ignoreDiscoveryHost() {
  if (!discoveryCandidate) return;
  const stored = await chrome.storage.local.get(XJTUSiteData.DISCOVERY_IGNORED_HOSTS_KEY);
  const ignored = [...new Set([
    ...(stored[XJTUSiteData.DISCOVERY_IGNORED_HOSTS_KEY] || []),
    discoveryCandidate.hostname
  ])];
  await chrome.storage.local.set({ [XJTUSiteData.DISCOVERY_IGNORED_HOSTS_KEY]: ignored });
  await clearDiscoveryCandidate();
  window.close();
}

async function openDiscoveryForm() {
  elements.discoveryQuestion.hidden = true;
  elements.discoveryForm.hidden = false;
  elements.discoverySaveButton.disabled = true;
  elements.discoveryBookmarkFolder.replaceChildren(new Option('正在读取已导入的文件夹…', ''));
  elements.discoveryBookmarkFolder.disabled = true;
  let hasPermission = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (!hasPermission) {
    hasPermission = await chrome.permissions.request({ permissions: ['bookmarks'] });
  }
  if (!hasPermission) {
    elements.discoveryBookmarkFolder.replaceChildren(new Option('未获得书签权限', ''));
    elements.discoveryError.textContent = '需要书签权限才能继续';
    return;
  }
  try {
    const [tree, syncState, matches] = await Promise.all([
      chrome.bookmarks.getTree(),
      chrome.storage.local.get(BOOKMARK_SYNC_FOLDER_IDS_KEY),
      chrome.bookmarks.search({ url: discoveryCandidate.url })
    ]);
    const syncedFolderIds = new Set((syncState[BOOKMARK_SYNC_FOLDER_IDS_KEY] || []).map(String));
    discoveryBookmarkFolders = syncedBookmarkFolders(tree, syncedFolderIds);
    elements.discoveryBookmarkFolder.replaceChildren();
    discoveryBookmarkFolders.forEach((folder) => {
      elements.discoveryBookmarkFolder.append(new Option(folder.label, folder.id));
    });
    if (!discoveryBookmarkFolders.length) {
      elements.discoveryBookmarkFolder.append(new Option('尚未导入书签文件夹', ''));
      elements.discoveryError.textContent = '请先在设置页导入一个书签文件夹作为搜索源';
      return;
    }
    const existing = matches.find((node) =>
      node.url === discoveryCandidate.url && syncedFolderIds.has(String(node.parentId)));
    if (existing) elements.discoveryBookmarkFolder.value = String(existing.parentId);
    elements.discoveryBookmarkFolder.disabled = false;
    elements.discoverySaveButton.disabled = false;
  } catch (error) {
    elements.discoveryBookmarkFolder.replaceChildren(new Option('无法读取书签文件夹', ''));
    elements.discoveryError.textContent = error.message;
    return;
  }
  elements.discoveryName.focus();
}

function closeDiscoveryForm() {
  elements.discoveryQuestion.hidden = false;
  elements.discoveryForm.hidden = true;
  elements.discoverySaveButton.disabled = false;
  elements.discoveryBookmarkFolder.disabled = false;
  discoveryBookmarkFolders = [];
  elements.discoveryError.textContent = '';
}

async function saveDiscoveredSite() {
  if (!discoveryCandidate) return;
  const name = elements.discoveryName.value.trim();
  const keywords = parsePopupKeywords(elements.discoveryKeywords.value);
  if (!name) {
    elements.discoveryError.textContent = '请填写网站名称';
    elements.discoveryName.focus();
    return;
  }
  if (!keywords.length) {
    elements.discoveryError.textContent = '请至少填写一个搜索词';
    elements.discoveryKeywords.focus();
    return;
  }

  let hasBookmarkPermission = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (!hasBookmarkPermission) {
    hasBookmarkPermission = await chrome.permissions.request({ permissions: ['bookmarks'] });
  }
  if (!hasBookmarkPermission) {
    elements.discoveryError.textContent = '需要书签权限才能收藏并添加网站';
    return;
  }

  let bookmark;
  let source;
  try {
    bookmark = await ensureDiscoveryBookmark();
    source = await bookmarkSourceFromNode(bookmark);
    source.syncMode = 'folder';
  } catch (error) {
    elements.discoveryError.textContent = `收藏失败：${error.message}`;
    return;
  }

  const sites = await XJTUSiteData.getSites();
  const urlKey = XJTUSiteData.canonicalUrlKey(discoveryCandidate.url);
  const existing = sites.find((site) => XJTUSiteData.canonicalUrlKey(site.url) === urlKey);
  if (existing) {
    existing.keywords = [...new Set([...(existing.keywords || []), ...keywords])];
    existing.importedFromBookmarks = true;
    existing.sourceBookmarkIds = [...new Set([
      ...(existing.sourceBookmarkIds || []).map(String),
      String(bookmark.id)
    ])];
    existing.bookmarkSources = [
      ...(existing.bookmarkSources || []).filter((item) => String(item.id) !== String(bookmark.id)),
      source
    ];
    if (!(existing.groupPaths || []).some((path) => JSON.stringify(path) === JSON.stringify(source.groupPath))) {
      existing.groupPaths = [...(existing.groupPaths || []), source.groupPath];
    }
    existing.updatedAt = Date.now();
  } else {
    const now = Date.now();
    sites.push({
      id: `discovered-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      url: discoveryCandidate.url,
      description: `西交网站 · ${discoveryCandidate.hostname}`,
      keywords,
      builtin: false,
      importedFromBookmarks: true,
      bookmarkOnly: true,
      sourceBookmarkIds: [String(bookmark.id)],
      bookmarkSources: [source],
      groupPaths: [source.groupPath],
      usageCount: 0,
      lastUsedAt: 0,
      createdAt: now,
      updatedAt: now
    });
  }
  const syncState = await chrome.storage.local.get([BOOKMARK_SYNC_FOLDER_IDS_KEY, BOOKMARK_PENDING_KEY]);
  const syncedFolderIds = new Set((syncState[BOOKMARK_SYNC_FOLDER_IDS_KEY] || []).map(String));
  const pending = (syncState[BOOKMARK_PENDING_KEY] || [])
    .filter((item) => String(item.id) !== String(bookmark.id));
  await chrome.storage.local.set({
    [XJTUSiteData.STORAGE_KEY]: sites,
    [BOOKMARK_SYNC_FOLDER_IDS_KEY]: [...syncedFolderIds],
    [BOOKMARK_PENDING_KEY]: pending
  });
  await chrome.action.setBadgeText({ text: pending.length ? '+' : '' });
  await clearDiscoveryCandidate();
  window.close();
}

async function loadDiscoveryCandidate() {
  const enabled = await loadNavigatorState();
  if (!enabled) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) return;
  discoveryTabId = tab.id;
  const response = await chrome.runtime.sendMessage({
    action: 'getSiteDiscoveryCandidate',
    tabId: tab.id
  });
  if (!response?.candidate) return;

  discoveryCandidate = response.candidate;
  elements.discoveryHostname.textContent = discoveryCandidate.hostname;
  elements.discoveryName.value = discoveryCandidate.name;
  elements.discoveryKeywords.value = XJTUSiteData
    .bookmarkTitleKeywords(discoveryCandidate.name)
    .join('，');
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
elements.discoveryLaterButton.addEventListener('click', dismissDiscoveryForSession);
elements.discoveryIgnoreButton.addEventListener('click', ignoreDiscoveryHost);
elements.discoveryAddButton.addEventListener('click', openDiscoveryForm);
elements.discoveryCancelButton.addEventListener('click', closeDiscoveryForm);
elements.discoverySaveButton.addEventListener('click', saveDiscoveredSite);
elements.discoveryForm.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveDiscoveredSite();
  }
});
elements.bookmarkDefaultButton.addEventListener('click', () => acceptPendingBookmark(true));
elements.bookmarkAcceptButton.addEventListener('click', () => acceptPendingBookmark(false));
elements.bookmarkKeywords.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    acceptPendingBookmark(false);
  }
});

checkForUpdates();
loadPendingBookmark()
  .then((hasPendingBookmark) => hasPendingBookmark ? null : loadDiscoveryCandidate())
  .catch((error) => console.warn('[Popup] 无法读取待处理项目:', error));
