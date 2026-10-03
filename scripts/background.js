/**
 * background.js — Service Worker
 *
 * 职责：
 *   1. Cookie 清理（选课退出用）
 *   2. 文件下载（学习平台用）
 *   3. 选课盯盘通知（watchCourse.js）
 *   4. 浏览器启动或新建窗口时检查 GitHub 上的新版本
 */

importScripts('siteData.js');

const STARTUP_UPDATE_ALARM_NAME = 'xjtu-tools-startup-update-check';
const COURSE_SELECTION_URL =
  'https://xkfw.xjtu.edu.cn/xsxkapp/sys/xsxkapp/*default/curriculavariable.do';
const REMOTE_MANIFEST_API_URL =
  'https://api.github.com/repos/another-le/xjtu-tools/contents/manifest.json?ref=master';
const DISMISSED_UPDATE_VERSION_KEY = 'dismissedUpdateVersion';
const STARTUP_CHECK_DELAY_MS = 5 * 1000;
const UPDATE_CACHE_TTL_MS = 60 * 1000;
const SITE_LAUNCHER_COMMAND = 'open-site-launcher-v2';
const SITE_NAVIGATOR_ENABLED_KEY = 'siteNavigatorEnabledV1';
const SITE_DISCOVERY_SESSION_DISMISSED_KEY = 'siteDiscoverySessionDismissedV1';
const SITE_DISCOVERY_CANDIDATES_KEY = 'siteDiscoveryCandidatesV1';
const SITE_ENTRIES_KEY = 'siteNavigatorEntriesV1';
const BOOKMARK_SYNC_FOLDER_IDS_KEY = 'siteNavigatorBookmarkSyncFolderIdsV1';
const BOOKMARK_PENDING_KEY = 'siteNavigatorPendingBookmarksV1';
const BOOKMARK_GROUP_ROOT_KEY = 'siteNavigatorBookmarkGroupRootV1';

function isBrowserBookmarkRoot(name) {
  return new Set([
    '书签栏', '其他书签', '移动设备书签',
    'Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'
  ]).has(name);
}

function samePath(first, second) {
  return JSON.stringify(first || []) === JSON.stringify(second || []);
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
  const groupRoot = stored[BOOKMARK_GROUP_ROOT_KEY] || '书签';
  return {
    id: String(node.id),
    parentId: String(node.parentId || ''),
    folders,
    folderIds,
    groupPath: [groupRoot, ...folders.filter((name) => !isBrowserBookmarkRoot(name))]
  };
}

function updateSiteBookmarkSource(site, nextSource) {
  const sources = Array.isArray(site.bookmarkSources) ? [...site.bookmarkSources] : [];
  const sourceIndex = sources.findIndex((source) => String(source.id) === String(nextSource.id));
  const previousSource = sourceIndex >= 0 ? sources[sourceIndex] : null;
  if (!nextSource.syncMode && previousSource?.syncMode) {
    nextSource.syncMode = previousSource.syncMode;
  }
  if (sourceIndex >= 0) sources[sourceIndex] = nextSource;
  else sources.push(nextSource);
  site.bookmarkSources = sources;
  site.sourceBookmarkIds = [...new Set(sources.map((source) => String(source.id)))];

  const paths = Array.isArray(site.groupPaths) ? [...site.groupPaths] : [];
  const oldPath = previousSource?.groupPath;
  const oldPathStillUsed = oldPath && sources.some((source) =>
    String(source.id) !== String(nextSource.id) && samePath(source.groupPath, oldPath));
  const withoutOldPath = oldPath && !oldPathStillUsed
    ? paths.filter((path) => !samePath(path, oldPath))
    : paths;
  if (!withoutOldPath.some((path) => samePath(path, nextSource.groupPath))) {
    withoutOldPath.push(nextSource.groupPath);
  }
  site.groupPaths = withoutOldPath;
  site.updatedAt = Date.now();
}

async function syncChangedBookmarkNode(bookmarkId) {
  const [node] = await chrome.bookmarks.get(String(bookmarkId));
  if (!node) return;
  const stored = await chrome.storage.local.get(SITE_ENTRIES_KEY);
  const sites = Array.isArray(stored[SITE_ENTRIES_KEY]) ? stored[SITE_ENTRIES_KEY] : [];
  let changed = false;

  if (node.url) {
    const nextSource = await bookmarkSourceFromNode(node);
    sites.forEach((site) => {
      const linked = (site.sourceBookmarkIds || []).map(String).includes(String(node.id));
      if (!linked) return;
      site.name = node.title || site.name;
      site.url = node.url;
      updateSiteBookmarkSource(site, nextSource);
      changed = true;
    });
  } else {
    const affectedSites = sites.filter((site) => (site.bookmarkSources || []).some((source) =>
      (source.folderIds || []).map(String).includes(String(node.id))));
    for (const site of affectedSites) {
      for (const source of [...(site.bookmarkSources || [])]) {
        if (!(source.folderIds || []).map(String).includes(String(node.id))) continue;
        try {
          const [bookmark] = await chrome.bookmarks.get(String(source.id));
          if (bookmark?.url) updateSiteBookmarkSource(site, await bookmarkSourceFromNode(bookmark));
        } catch (_error) {
          // 书签可能与文件夹操作同时被移除。
        }
      }
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [SITE_ENTRIES_KEY]: sites });
}

function collectRemovedBookmarkTree(node, bookmarkIds = new Set(), folderIds = new Set()) {
  if (node.url) bookmarkIds.add(String(node.id));
  else folderIds.add(String(node.id));
  (node.children || []).forEach((child) => collectRemovedBookmarkTree(child, bookmarkIds, folderIds));
  return { bookmarkIds, folderIds };
}

async function removeBookmarkSources(removedNode) {
  const removed = collectRemovedBookmarkTree(removedNode);
  const stored = await chrome.storage.local.get([
    SITE_ENTRIES_KEY,
    BOOKMARK_SYNC_FOLDER_IDS_KEY,
    BOOKMARK_PENDING_KEY,
    BOOKMARK_GROUP_ROOT_KEY
  ]);
  const groupRoot = stored[BOOKMARK_GROUP_ROOT_KEY] || '书签';
  const sites = Array.isArray(stored[SITE_ENTRIES_KEY]) ? stored[SITE_ENTRIES_KEY] : [];
  const nextSites = [];
  sites.forEach((site) => {
    const previousSources = Array.isArray(site.bookmarkSources) ? site.bookmarkSources : [];
    const previousIds = new Set((site.sourceBookmarkIds || []).map(String));
    const removedIds = [...removed.bookmarkIds].filter((id) => previousIds.has(id));
    if (!removedIds.length) {
      nextSites.push(site);
      return;
    }
    const nextSources = previousSources.filter((source) => !removed.bookmarkIds.has(String(source.id)));
    const nextIds = [...previousIds].filter((id) => !removed.bookmarkIds.has(id));
    const removedPaths = previousSources
      .filter((source) => removed.bookmarkIds.has(String(source.id)))
      .map((source) => source.groupPath);
    site.bookmarkSources = nextSources;
    site.sourceBookmarkIds = nextIds;
    site.groupPaths = (site.groupPaths || []).filter((path) =>
      !removedPaths.some((removedPath) => samePath(path, removedPath) &&
        !nextSources.some((source) => samePath(source.groupPath, removedPath))));
    if (nextIds.length) {
      nextSites.push(site);
      return;
    }
    const legacyBookmarkOnly = !previousSources.length &&
      (site.description?.startsWith('来自书签：') || site.description === '来自浏览器书签');
    if (site.bookmarkOnly === true || legacyBookmarkOnly) return;
    delete site.importedFromBookmarks;
    delete site.bookmarkSources;
    delete site.sourceBookmarkIds;
    site.groupPaths = (site.groupPaths || []).filter((path) => path[0] !== groupRoot);
    nextSites.push(site);
  });
  const syncedIds = (stored[BOOKMARK_SYNC_FOLDER_IDS_KEY] || [])
    .map(String)
    .filter((id) => !removed.folderIds.has(id));
  const pending = (stored[BOOKMARK_PENDING_KEY] || [])
    .filter((item) => !removed.bookmarkIds.has(String(item.id)));
  await chrome.storage.local.set({
    [SITE_ENTRIES_KEY]: nextSites,
    [BOOKMARK_SYNC_FOLDER_IDS_KEY]: syncedIds,
    [BOOKMARK_PENDING_KEY]: pending
  });
  if (!pending.length) await chrome.action.setBadgeText({ text: '' });
}

function waitForBookmarkBubble(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function openPendingBookmarkPrompt(bookmarkId) {
  // 收藏气泡关闭后的前两秒高频尝试，随后逐步退避。
  const retryDelays = [0, 100, 150, 200, 300, 450, 650, 900, 1300, 2000, 3000];
  let windowId = null;
  try {
    const activeWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    windowId = activeWindow?.id;
  } catch (_error) {
    return false;
  }
  if (!windowId) return false;

  for (const delayMs of retryDelays) {
    await waitForBookmarkBubble(delayMs);
    const pendingState = await chrome.storage.local.get(BOOKMARK_PENDING_KEY);
    const stillPending = (pendingState[BOOKMARK_PENDING_KEY] || [])
      .some((item) => String(item.id) === String(bookmarkId));
    if (!stillPending) return true;

    try {
      await chrome.action.openPopup({ windowId });
      return true;
    } catch (_error) {
      // Chrome 的收藏气泡尚未关闭时会拒绝打开扩展 Popup，稍后重试。
    }
  }
  return false;
}

async function queueCreatedBookmark(node) {
  const stored = await chrome.storage.local.get([
    BOOKMARK_SYNC_FOLDER_IDS_KEY,
    BOOKMARK_PENDING_KEY,
    SITE_ENTRIES_KEY
  ]);
  const syncedFolderIds = new Set((stored[BOOKMARK_SYNC_FOLDER_IDS_KEY] || []).map(String));
  if (!syncedFolderIds.has(String(node.parentId))) return;
  if (!node.url) {
    syncedFolderIds.add(String(node.id));
    await chrome.storage.local.set({ [BOOKMARK_SYNC_FOLDER_IDS_KEY]: [...syncedFolderIds] });
    return;
  }
  const sites = Array.isArray(stored[SITE_ENTRIES_KEY]) ? stored[SITE_ENTRIES_KEY] : [];
  if (sites.some((site) => (site.sourceBookmarkIds || []).map(String).includes(String(node.id)))) return;
  const source = {
    ...await bookmarkSourceFromNode(node),
    syncMode: 'folder'
  };
  const generatedKeywords = XJTUSiteData.bookmarkTitleKeywords(node.title);
  const defaultKeywords = generatedKeywords.length
    ? generatedKeywords
    : [String(node.title || new URL(node.url).hostname).trim()].filter(Boolean);
  const urlKey = XJTUSiteData.canonicalUrlKey(node.url);
  const existing = sites.find((site) => XJTUSiteData.canonicalUrlKey(site.url) === urlKey);
  const previousKeywords = [...(existing?.keywords || [])];
  const previousKeywordKeys = new Set(previousKeywords.map((keyword) => keyword.toLocaleLowerCase('zh-CN')));
  const addedDefaultKeywords = defaultKeywords.filter((keyword) =>
    !previousKeywordKeys.has(keyword.toLocaleLowerCase('zh-CN')));
  const now = Date.now();
  if (existing) {
    existing.keywords = [...new Set([...previousKeywords, ...defaultKeywords])];
    existing.importedFromBookmarks = true;
    existing.bookmarkOnly = true;
    existing.sourceBookmarkIds = [...new Set([
      ...(existing.sourceBookmarkIds || []).map(String),
      String(node.id)
    ])];
    existing.bookmarkSources = [
      ...(existing.bookmarkSources || []).filter((item) => String(item.id) !== String(node.id)),
      source
    ];
    if (!(existing.groupPaths || []).some((path) => samePath(path, source.groupPath))) {
      existing.groupPaths = [...(existing.groupPaths || []), source.groupPath];
    }
    existing.updatedAt = now;
  } else {
    sites.push({
      id: `bookmark-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: node.title || new URL(node.url).hostname,
      url: node.url,
      description: source.folders?.length ? `来自书签：${source.folders.join(' / ')}` : '来自浏览器书签',
      keywords: defaultKeywords,
      builtin: false,
      importedFromBookmarks: true,
      bookmarkOnly: true,
      sourceBookmarkIds: [String(node.id)],
      bookmarkSources: [source],
      groupPaths: [source.groupPath],
      usageCount: 0,
      lastUsedAt: 0,
      createdAt: now,
      updatedAt: now
    });
  }
  await XJTUSiteData.saveSites(sites);
  await clearSiteDiscoveryCandidatesForUrl(node.url);
  const pending = [
    ...(stored[BOOKMARK_PENDING_KEY] || []).filter((item) => String(item.id) !== String(node.id)),
    {
      id: String(node.id),
      title: node.title || new URL(node.url).hostname,
      url: node.url,
      source,
      defaultKeywords,
      addedDefaultKeywords,
      indexedWithDefaults: true,
      createdAt: now
    }
  ];
  await chrome.storage.local.set({ [BOOKMARK_PENDING_KEY]: pending });
  await chrome.action.setBadgeBackgroundColor({ color: '#c92b37' });
  await chrome.action.setBadgeText({ text: '+' });
  await chrome.action.setTitle({ title: '新书签已加入快速访问，可确认或修改关键词' });
  await openPendingBookmarkPrompt(node.id);
}

async function syncMovedBookmarkNode(bookmarkId, parentId) {
  const [[node], stored] = await Promise.all([
    chrome.bookmarks.get(String(bookmarkId)),
    chrome.storage.local.get([SITE_ENTRIES_KEY, BOOKMARK_SYNC_FOLDER_IDS_KEY])
  ]);
  if (!node) return;

  const previousSyncedIds = (stored[BOOKMARK_SYNC_FOLDER_IDS_KEY] || []).map(String);
  // 根文件夹可能是用户明确选择的同步源。不能在移动书签时清理它，
  // 否则书签栏直属网页会在首次移动后失去双向同步。
  const syncedFolderIds = new Set(previousSyncedIds);

  if (!node.url) {
    await syncChangedBookmarkNode(bookmarkId);
    return;
  }

  const sites = Array.isArray(stored[SITE_ENTRIES_KEY]) ? stored[SITE_ENTRIES_KEY] : [];
  const isLinkedBookmark = sites.some((site) =>
    (site.sourceBookmarkIds || []).map(String).includes(String(bookmarkId)));
  const isIndividuallyLinked = sites.some((site) =>
    (site.bookmarkSources || []).some((source) =>
      String(source.id) === String(bookmarkId) && source.syncMode === 'bookmark'));
  if (syncedFolderIds.has(String(parentId))) {
    if (isLinkedBookmark) await syncChangedBookmarkNode(bookmarkId);
    else await queueCreatedBookmark(node);
    return;
  }

  if (isIndividuallyLinked) {
    await syncChangedBookmarkNode(bookmarkId);
    return;
  }

  await removeBookmarkSources(node);
}

async function deleteNavigatorSite(siteId) {
  const stored = await chrome.storage.local.get([
    SITE_ENTRIES_KEY,
    BOOKMARK_PENDING_KEY
  ]);
  const sites = Array.isArray(stored[SITE_ENTRIES_KEY]) ? stored[SITE_ENTRIES_KEY] : [];
  const target = sites.find((site) => site.id === siteId);
  if (!target) return { ok: false, error: '没有找到该网站' };

  const bookmarkIds = [...new Set([
    ...(target.sourceBookmarkIds || []).map(String),
    ...(target.bookmarkSources || []).map((source) => String(source.id))
  ])];
  if (!bookmarkIds.length) return { ok: false, error: '没有找到关联的浏览器书签' };

  const hasPermission = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (!hasPermission) return { ok: false, error: '缺少书签权限，无法同步删除' };

  const removeBookmarkIfPresent = async (bookmarkId) => {
    try {
      const matches = await chrome.bookmarks.get(bookmarkId);
      if (!matches.length) return;
    } catch (_error) {
      return;
    }
    await chrome.bookmarks.remove(bookmarkId);
  };
  const results = await Promise.allSettled(bookmarkIds.map(removeBookmarkIfPresent));
  const deletedIds = new Set(results
    .map((result, index) => result.status === 'fulfilled' ? bookmarkIds[index] : null)
    .filter(Boolean));
  const latest = await chrome.storage.local.get([SITE_ENTRIES_KEY, BOOKMARK_PENDING_KEY]);
  const latestSites = Array.isArray(latest[SITE_ENTRIES_KEY]) ? latest[SITE_ENTRIES_KEY] : [];
  const nextSites = latestSites.flatMap((site) => {
    if (site.id !== siteId) return [site];
    const remainingSources = (site.bookmarkSources || [])
      .filter((source) => !deletedIds.has(String(source.id)));
    const remainingIds = (site.sourceBookmarkIds || [])
      .map(String)
      .filter((bookmarkId) => !deletedIds.has(bookmarkId));
    if (!remainingIds.length) return [];
    const validPaths = remainingSources.map((source) => source.groupPath);
    site.bookmarkSources = remainingSources;
    site.sourceBookmarkIds = remainingIds;
    site.groupPaths = (site.groupPaths || []).filter((path) =>
      validPaths.some((validPath) => samePath(path, validPath)));
    return [site];
  });
  const pending = (latest[BOOKMARK_PENDING_KEY] || [])
    .filter((item) => !deletedIds.has(String(item.id)));
  await chrome.storage.local.set({
    [SITE_ENTRIES_KEY]: nextSites,
    [BOOKMARK_PENDING_KEY]: pending
  });
  await chrome.action.setBadgeText({ text: pending.length ? '+' : '' });
  return {
    ok: true,
    deleted: deletedIds.size,
    failed: results.length - deletedIds.size
  };
}

let cachedUpdateInfo = null;
let bookmarkImportInProgress = false;

async function clearSiteDiscoveryCandidate(tabId) {
  const stored = await chrome.storage.session.get(SITE_DISCOVERY_CANDIDATES_KEY);
  const candidates = { ...(stored[SITE_DISCOVERY_CANDIDATES_KEY] || {}) };
  delete candidates[tabId];
  await chrome.storage.session.set({ [SITE_DISCOVERY_CANDIDATES_KEY]: candidates });
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'XJTU Tools' });
  } catch (_error) {
    // 标签页可能已经关闭。
  }
}

async function clearSiteDiscoveryCandidatesForUrl(rawUrl) {
  let hostname = '';
  try { hostname = new URL(rawUrl).hostname.toLocaleLowerCase('en-US'); }
  catch (_error) { return; }

  const stored = await chrome.storage.session.get(SITE_DISCOVERY_CANDIDATES_KEY);
  const candidates = { ...(stored[SITE_DISCOVERY_CANDIDATES_KEY] || {}) };
  const matchedTabIds = Object.entries(candidates)
    .filter(([, candidate]) => candidate?.hostname === hostname)
    .map(([tabId]) => Number(tabId))
    .filter(Number.isInteger);
  if (!matchedTabIds.length) return;

  matchedTabIds.forEach((tabId) => delete candidates[tabId]);
  await chrome.storage.session.set({ [SITE_DISCOVERY_CANDIDATES_KEY]: candidates });
  await Promise.all(matchedTabIds.map(async (tabId) => {
    try {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'XJTU Tools' });
    } catch (_error) {
      // 标签页可能已经关闭。
    }
  }));
}

function isNewerVersion(candidate, current) {
  if (!/^\d+(\.\d+){0,3}$/.test(candidate)) {
    return false;
  }

  const candidateParts = candidate.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  const partCount = Math.max(candidateParts.length, currentParts.length);

  for (let index = 0; index < partCount; index += 1) {
    const candidatePart = candidateParts[index] || 0;
    const currentPart = currentParts[index] || 0;

    if (candidatePart !== currentPart) {
      return candidatePart > currentPart;
    }
  }

  return false;
}

async function getUpdateInfo(forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedUpdateInfo &&
    Date.now() - cachedUpdateInfo.checkedAt < UPDATE_CACHE_TTL_MS
  ) {
    return cachedUpdateInfo;
  }

  const response = await fetch(REMOTE_MANIFEST_API_URL, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github.raw+json'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub 返回 ${response.status}`);
  }

  const remoteManifest = await response.json();
  const currentVersion = chrome.runtime.getManifest().version;
  const latestVersion = remoteManifest.version;

  if (typeof latestVersion !== 'string') {
    throw new Error('GitHub 清单中没有有效版本号');
  }

  cachedUpdateInfo = {
    currentVersion,
    latestVersion,
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
    checkedAt: Date.now()
  };

  return cachedUpdateInfo;
}

async function getUpdateStatus(forceRefresh = false) {
  const updateInfo = await getUpdateInfo(forceRefresh);
  const stored = await chrome.storage.local.get(DISMISSED_UPDATE_VERSION_KEY);

  return {
    ...updateInfo,
    reminderDismissed:
      stored[DISMISSED_UPDATE_VERSION_KEY] === updateInfo.latestVersion
  };
}

async function checkForUpdates() {
  try {
    const updateInfo = await getUpdateStatus(true);
    if (!updateInfo.updateAvailable || updateInfo.reminderDismissed) {
      const stored = await chrome.storage.local.get(BOOKMARK_PENDING_KEY);
      chrome.action.setBadgeText({ text: (stored[BOOKMARK_PENDING_KEY] || []).length ? '+' : '' });
      return;
    }

    chrome.action.setBadgeBackgroundColor({ color: '#c72c35' });
    chrome.action.setBadgeText({ text: 'NEW' });

    try {
      const activeWindow = await chrome.windows.getLastFocused({
        windowTypes: ['normal']
      });

      if (!activeWindow?.id) {
        throw new Error('没有可用的浏览器窗口');
      }

      await chrome.action.openPopup({ windowId: activeWindow.id });
    } catch (error) {
      // 工具栏 Popup 无法展开时仅保留 NEW 徽标，不额外创建窗口打扰用户。
      console.warn('[Update] 无法自动打开工具栏 Popup:', error);
    }
  } catch (error) {
    console.warn('[Update] 检查更新失败:', error);
  }
}

function scheduleAutomaticUpdateCheck() {
  // 使用 alarms 而不是 setTimeout，避免 MV3 Service Worker 在等待期间被回收。
  // 重复用同一名称创建会替换待执行的检查，不会重复请求。
  chrome.alarms.create(STARTUP_UPDATE_ALARM_NAME, {
    when: Date.now() + STARTUP_CHECK_DELAY_MS
  });
}

chrome.runtime.onStartup.addListener(scheduleAutomaticUpdateCheck);
chrome.runtime.onInstalled.addListener(scheduleAutomaticUpdateCheck);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STARTUP_UPDATE_ALARM_NAME) {
    checkForUpdates();
  }
});
chrome.windows.onCreated.addListener((createdWindow) => {
  if (createdWindow.type !== 'normal') {
    return;
  }

  chrome.windows.getAll({ windowTypes: ['normal'] }, (normalWindows) => {
    // Chrome 进程留在后台时，关闭所有窗口后重新打开不会触发 onStartup。
    // 只在第一个普通窗口出现时补充检查，避免每次 Ctrl+N 都请求 GitHub。
    if (normalWindows.length === 1) {
      scheduleAutomaticUpdateCheck();
    }
  });
});

chrome.bookmarks.onCreated.addListener((_id, node) => {
  if (bookmarkImportInProgress) return;
  queueCreatedBookmark(node).catch((error) =>
    console.warn('[Bookmark Sync] 无法处理新增书签:', error));
});
chrome.bookmarks.onImportBegan.addListener(() => {
  bookmarkImportInProgress = true;
});
chrome.bookmarks.onImportEnded.addListener(() => {
  bookmarkImportInProgress = false;
});
chrome.bookmarks.onChanged.addListener((id) => {
  syncChangedBookmarkNode(id).catch((error) =>
    console.warn('[Bookmark Sync] 无法同步书签改动:', error));
});
chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
  syncMovedBookmarkNode(id, moveInfo.parentId).catch((error) =>
    console.warn('[Bookmark Sync] 无法同步书签移动:', error));
});
chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
  removeBookmarkSources(removeInfo.node).catch((error) =>
    console.warn('[Bookmark Sync] 无法同步书签删除:', error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  chrome.storage.session.get(SITE_DISCOVERY_CANDIDATES_KEY).then((stored) => {
    const candidate = stored[SITE_DISCOVERY_CANDIDATES_KEY]?.[tabId];
    if (!candidate) return;
    let nextHostname = '';
    try { nextHostname = new URL(changeInfo.url).hostname.toLocaleLowerCase('en-US'); }
    catch (_error) { /* 非网页地址 */ }
    if (nextHostname !== candidate.hostname) clearSiteDiscoveryCandidate(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearSiteDiscoveryCandidate(tabId);
});

// ============================================================
//  网站启动器 — 快捷键唤起
// ============================================================

async function openLauncherWindowFallback(tab) {
  // 初始值包含常见的 Windows 窗口边框与标题栏；launcher.html 载入后会
  // 上报实际 frame 尺寸并进行一次精确校准。
  const popupWidth = 666;
  const popupHeight = 573;
  let anchorWindow = null;

  try {
    anchorWindow = Number.isInteger(tab?.windowId)
      ? await chrome.windows.get(tab.windowId)
      : await chrome.windows.getLastFocused();
  } catch (error) {
    console.warn('[Launcher] 无法读取当前窗口位置，将由浏览器决定启动器位置:', error);
  }

  const createOptions = {
    url: chrome.runtime.getURL('launcher.html'),
    type: 'popup',
    width: popupWidth,
    height: popupHeight,
    focused: true
  };

  if (
    Number.isFinite(anchorWindow?.left) &&
    Number.isFinite(anchorWindow?.top) &&
    Number.isFinite(anchorWindow?.width) &&
    Number.isFinite(anchorWindow?.height)
  ) {
    createOptions.left = Math.round(anchorWindow.left + (anchorWindow.width - popupWidth) / 2);
    createOptions.top = Math.round(anchorWindow.top + (anchorWindow.height - popupHeight) / 2);
  }

  await chrome.windows.create(createOptions);
}

async function openLauncherFallback(tab) {
  if (Number.isInteger(tab?.id) && Number.isInteger(tab?.windowId)) {
    let launcherPopupAssigned = false;
    try {
      // Chrome 内部页无法注入；临时把当前标签页的工具栏 Popup 切换为启动器。
      // 这种 Popup 由浏览器承载，没有独立窗口的系统标题栏与外框。
      await chrome.action.setPopup({ tabId: tab.id, popup: 'launcher.html' });
      launcherPopupAssigned = true;
      await chrome.action.openPopup({ windowId: tab.windowId });
      await new Promise((resolve) => setTimeout(resolve, 120));
      return;
    } catch (error) {
      console.warn('[Launcher] 无法打开工具栏 Popup，改用独立窗口兜底:', error);
    } finally {
      if (launcherPopupAssigned) {
        try {
          await chrome.action.setPopup({ tabId: tab.id, popup: 'update-popup.html' });
        } catch (_restoreError) {
          // 标签页可能已经关闭。
        }
      }
    }
  }

  await openLauncherWindowFallback(tab);
}

function isInjectableWebUrl(rawUrl) {
  try {
    return ['http:', 'https:'].includes(new URL(rawUrl).protocol);
  } catch (_error) {
    return false;
  }
}

async function injectSiteLauncher(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['launcher.css']
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      'scripts/vendor/text-search-engine-1.5.2.min.js',
      'scripts/siteData.js',
      'scripts/launcher.js'
    ]
  });
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== SITE_LAUNCHER_COMMAND) return;
  const navigatorState = await chrome.storage.local.get(SITE_NAVIGATOR_ENABLED_KEY);
  if (navigatorState[SITE_NAVIGATOR_ENABLED_KEY] === false) return;

  let targetTab = tab;
  if (!Number.isInteger(targetTab?.id)) {
    [targetTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }

  const tabId = targetTab?.id;
  const canInject = Number.isInteger(tabId);

  if (!canInject) {
    await openLauncherFallback(targetTab);
    return;
  }

  try {
    await injectSiteLauncher(tabId);
    return;
  } catch (firstError) {
    // 页面刚完成导航时，第一次注入偶尔会与文档切换竞争。重新读取当前标签页，
    // 对普通网页短暂等待后再试一次，不能一次失败就误判为 Chrome 内部页。
    const currentTab = await chrome.tabs.get(tabId).catch(() => targetTab);
    if (isInjectableWebUrl(currentTab?.url)) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      try {
        await injectSiteLauncher(tabId);
        return;
      } catch (retryError) {
        console.warn('[Launcher] 普通网页二次注入仍然失败:', {
          url: currentTab.url,
          firstError: firstError.message,
          retryError: retryError.message
        });
      }
    } else {
      console.info('[Launcher] 当前标签页不允许注入，使用工具栏 Popup:', currentTab?.url);
    }
    await openLauncherFallback(currentTab);
  }
});

// ============================================================
//  已有功能：Cookie 清理 & 文件下载
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fitLauncherWindow') {
    const windowId = sender.tab?.windowId;
    const isLauncherPage = sender.url === chrome.runtime.getURL('launcher.html');
    const contentWidth = Math.min(760, Math.max(520, Number(message.contentWidth) || 660));
    const contentHeight = Math.min(620, Math.max(400, Number(message.contentHeight) || 540));
    const frameWidth = Math.min(80, Math.max(0, Number(message.frameWidth) || 0));
    const frameHeight = Math.min(100, Math.max(0, Number(message.frameHeight) || 0));

    if (!isLauncherPage || !Number.isInteger(windowId)) {
      sendResponse({ ok: false });
      return false;
    }

    chrome.windows.get(windowId)
      .then((launcherWindow) => {
        if (launcherWindow.type !== 'popup') {
          throw new Error('当前不是独立启动器窗口');
        }
        const width = Math.round(contentWidth + frameWidth);
        const height = Math.round(contentHeight + frameHeight);
        const left = Math.round((launcherWindow.left || 0) + ((launcherWindow.width || width) - width) / 2);
        const top = Math.round((launcherWindow.top || 0) + ((launcherWindow.height || height) - height) / 2);
        return chrome.windows.update(windowId, { width, height, left, top });
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === 'setSiteNavigatorEnabled') {
    if (message.enabled) {
      sendResponse({ ok: true });
      return false;
    }
    chrome.storage.session.get(SITE_DISCOVERY_CANDIDATES_KEY)
      .then(async (stored) => {
        const tabIds = Object.keys(stored[SITE_DISCOVERY_CANDIDATES_KEY] || {}).map(Number);
        await Promise.all(tabIds.map((tabId) => clearSiteDiscoveryCandidate(tabId)));
        await chrome.storage.session.remove(SITE_DISCOVERY_CANDIDATES_KEY);
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.action === 'siteDiscoveryCandidate') {
    const tabId = sender.tab?.id;
    const candidate = message.candidate;
    let candidateUrl;
    try { candidateUrl = new URL(candidate?.url); }
    catch (_error) { candidateUrl = null; }
    const candidateHostname = candidateUrl?.hostname.toLocaleLowerCase('en-US');
    if (
      !Number.isInteger(tabId) ||
      !candidateUrl ||
      !['http:', 'https:'].includes(candidateUrl.protocol) ||
      candidateHostname !== candidate?.hostname ||
      candidateHostname === 'login.xjtu.edu.cn' ||
      (candidateHostname !== 'xjtu.edu.cn' && !candidateHostname.endsWith('.xjtu.edu.cn'))
    ) {
      sendResponse({ ok: false });
      return false;
    }
    let shouldOpenPopup = false;
    Promise.all([
      chrome.storage.local.get(SITE_NAVIGATOR_ENABLED_KEY),
      chrome.storage.session.get(SITE_DISCOVERY_CANDIDATES_KEY)
    ])
      .then(([navigatorState, stored]) => {
        if (navigatorState[SITE_NAVIGATOR_ENABLED_KEY] === false) return false;
        const candidates = stored[SITE_DISCOVERY_CANDIDATES_KEY] || {};
        shouldOpenPopup = candidates[tabId]?.hostname !== candidate.hostname;
        return chrome.storage.session.set({
          [SITE_DISCOVERY_CANDIDATES_KEY]: {
            ...candidates,
            [tabId]: candidate
          }
        }).then(() => true);
      })
      .then((enabled) => enabled ? Promise.all([
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#c92b37' }),
        chrome.action.setBadgeText({ tabId, text: '+' }),
        chrome.action.setTitle({ tabId, title: `发现新网站：${candidate.hostname}` })
      ]).then(() => true) : false)
      .then(async (enabled) => {
        if (!enabled) {
          sendResponse({ ok: false, disabled: true });
          return;
        }
        let popupOpened = false;
        if (shouldOpenPopup && Number.isInteger(sender.tab?.windowId)) {
          try {
            await chrome.action.openPopup({ windowId: sender.tab.windowId });
            popupOpened = true;
          } catch (error) {
            console.warn('[Site Discovery] 无法自动打开扩展面板，已保留 + 徽标:', error);
          }
        }
        sendResponse({ ok: true, popupOpened });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.action === 'getSiteDiscoveryCandidate') {
    chrome.storage.session.get(SITE_DISCOVERY_CANDIDATES_KEY)
      .then((stored) => sendResponse({
        candidate: stored[SITE_DISCOVERY_CANDIDATES_KEY]?.[message.tabId] || null
      }))
      .catch(() => sendResponse({ candidate: null }));
    return true;
  }

  if (message.action === 'clearSiteDiscoveryCandidate') {
    const requestedTabId = Number(message.tabId);
    const tabId = Number.isInteger(requestedTabId) ? requestedTabId : sender.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false });
      return false;
    }
    clearSiteDiscoveryCandidate(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.action === 'getSiteDiscoverySessionDismissed') {
    chrome.storage.session.get(SITE_DISCOVERY_SESSION_DISMISSED_KEY)
      .then((stored) => sendResponse({
        dismissed: Boolean(stored[SITE_DISCOVERY_SESSION_DISMISSED_KEY]?.[message.hostname])
      }))
      .catch(() => sendResponse({ dismissed: false }));
    return true;
  }

  if (message.action === 'dismissSiteDiscoverySession') {
    const hostname = String(message.hostname || '').toLocaleLowerCase('en-US');
    if (hostname !== 'xjtu.edu.cn' && !hostname.endsWith('.xjtu.edu.cn')) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.storage.session.get(SITE_DISCOVERY_SESSION_DISMISSED_KEY)
      .then((stored) => chrome.storage.session.set({
        [SITE_DISCOVERY_SESSION_DISMISSED_KEY]: {
          ...(stored[SITE_DISCOVERY_SESSION_DISMISSED_KEY] || {}),
          [hostname]: true
        }
      }))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.action === 'getUpdateInfo') {
    getUpdateStatus()
      .then((updateInfo) => sendResponse({ ok: true, ...updateInfo }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === 'openNavigatorUrl') {
    try {
      const targetUrl = new URL(message.url);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        throw new Error('不支持的网址协议');
      }
      chrome.tabs.create({ url: targetUrl.href });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return false;
  }

  if (message.action === 'openNavigatorSettings') {
    const settingsUrl = new URL(chrome.runtime.getURL('settings.html'));
    if (typeof message.siteId === 'string' && message.siteId.length <= 160) {
      settingsUrl.searchParams.set('edit', message.siteId);
    }
    chrome.tabs.create({ url: settingsUrl.href });
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'deleteNavigatorSite') {
    const siteId = typeof message.siteId === 'string' ? message.siteId : '';
    deleteNavigatorSite(siteId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === 'removeCookies') {
    chrome.cookies.getAll({ domain: 'xkfw.xjtu.edu.cn' }, (cookies) => {
      cookies.forEach(cookie => {
        const url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
        chrome.cookies.remove({
          url: url,
          name: cookie.name
        });
      });
    });
  }
  else if (message.action === 'downloadPdf') {
    chrome.downloads.download({
      url: message.url,
      filename: message.fileName || 'document.pdf',
      saveAs: true
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('下载失败:', JSON.stringify(chrome.runtime.lastError));
      }
    });
  }
  // ============================================================
  //  选课盯盘 — 收到自动选课结果
  // ============================================================
  else if (message.action === 'courseSpotFound') {
    const course = message.course;

    // 弹系统通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: '🔥 选课名额出现！',
      message: `${course.name} 已有 ${course.available} 个名额可选！`,
      priority: 2,
      buttons: [
        { title: '去选课' }
      ],
      requireInteraction: true  // 通知不自动消失
    });
  }
  else if (message.action === 'courseAutoSelectResult') {
    const course = message.course;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: message.success ? '✅ 自动选课成功' : '⚠️ 自动选课失败',
      message: message.success
        ? `${course.name} 已成功选上。`
        : `${course.name}：${message.message || '请打开选课页面查看详情。'}`,
      priority: 2,
      requireInteraction: !message.success
    });
  }
});

// ============================================================
//  通知点击事件
// ============================================================

chrome.notifications.onClicked.addListener(() => {
  // 点击通知 → 打开选课页面
  chrome.tabs.create({ url: COURSE_SELECTION_URL });
});

chrome.notifications.onButtonClicked.addListener((_notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    // 点击 "去选课" 按钮
    chrome.tabs.create({ url: COURSE_SELECTION_URL });
  }
});
