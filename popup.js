const REPOSITORY_URL = 'https://github.com/another-le/xjtu-tools';
const BOOKMARK_FOLDER_KEYWORD_MIGRATION_KEY = 'bookmarkFolderKeywordCleanupV1';
const BOOKMARK_GROUP_ROOT_KEY = 'siteNavigatorBookmarkGroupRootV1';
const BOOKMARK_GROUP_RENAMES_KEY = 'siteNavigatorBookmarkGroupRenamesV1';
const BOOKMARK_SYNC_FOLDER_IDS_KEY = 'siteNavigatorBookmarkSyncFolderIdsV1';
const BOOKMARK_PENDING_KEY = 'siteNavigatorPendingBookmarksV1';
const BOOKMARK_INDEX_REPAIR_KEY = 'siteNavigatorBookmarkIndexRepairV1';

const elements = {
  shortcutButton: document.querySelector('#shortcutButton'),
  shortcutLabel: document.querySelector('#shortcutLabel'),
  siteCount: document.querySelector('#siteCount'),
  activeGroupLabel: document.querySelector('#activeGroupLabel'),
  groupTree: document.querySelector('#groupTree'),
  filterInput: document.querySelector('#filterInput'),
  siteList: document.querySelector('#siteList'),
  bulkActions: document.querySelector('#bulkActions'),
  selectedSiteCount: document.querySelector('#selectedSiteCount'),
  clearSiteSelectionButton: document.querySelector('#clearSiteSelectionButton'),
  deleteSelectedSitesButton: document.querySelector('#deleteSelectedSitesButton'),
  selectAllSites: document.querySelector('#selectAllSites'),
  importBookmarksButton: document.querySelector('#importBookmarksButton'),
  repositoryButton: document.querySelector('#repositoryButton'),
  updateStateButton: document.querySelector('#updateStateButton'),
  updateDot: document.querySelector('#updateDot'),
  updateStateText: document.querySelector('#updateStateText'),
  siteDiscoveryEnabled: document.querySelector('#siteDiscoveryEnabled'),
  clearIgnoredHostsButton: document.querySelector('#clearIgnoredHostsButton'),
  ignoredHostsCount: document.querySelector('#ignoredHostsCount'),
  editorLayer: document.querySelector('#editorLayer'),
  siteForm: document.querySelector('#siteForm'),
  editorTitle: document.querySelector('#editorTitle'),
  editorSubtitle: document.querySelector('#editorSubtitle'),
  bookmarkSourceNotice: document.querySelector('#bookmarkSourceNotice'),
  closeEditorButton: document.querySelector('#closeEditorButton'),
  cancelEditorButton: document.querySelector('#cancelEditorButton'),
  siteId: document.querySelector('#siteId'),
  siteName: document.querySelector('#siteName'),
  siteUrl: document.querySelector('#siteUrl'),
  siteKeywords: document.querySelector('#siteKeywords'),
  keywordEditor: document.querySelector('#keywordEditor'),
  keywordTokens: document.querySelector('#keywordTokens'),
  keywordSuggestions: document.querySelector('#keywordSuggestions'),
  siteDescription: document.querySelector('#siteDescription'),
  formError: document.querySelector('#formError'),
  bookmarkLayer: document.querySelector('#bookmarkLayer'),
  closeBookmarkButton: document.querySelector('#closeBookmarkButton'),
  cancelBookmarkButton: document.querySelector('#cancelBookmarkButton'),
  bookmarkFilterInput: document.querySelector('#bookmarkFilterInput'),
  selectAllBookmarks: document.querySelector('#selectAllBookmarks'),
  bookmarkSelectionCount: document.querySelector('#bookmarkSelectionCount'),
  bookmarkList: document.querySelector('#bookmarkList'),
  confirmBookmarkButton: document.querySelector('#confirmBookmarkButton'),
  toast: document.querySelector('#toast')
};

let sites = [];
let updateInfo = null;
let allBookmarks = [];
let bookmarkTree = [];
let expandedBookmarkFolderIds = new Set();
let selectedBookmarkIds = new Set();
let selectedBookmarkFolderIds = new Set();
let selectedSiteIds = new Set();
let selectedGroupKey = 'all';
let expandedGroupKeys = new Set();
let groupTreeInitialized = false;
let bookmarkGroupRoot = '书签';
let bookmarkGroupRenames = [];
let bookmarkFolderStats = new Map();
let toastTimer = null;
let editorKeywords = [];

function keywordUsageMap() {
  const usage = new Map();
  sites.forEach((site) => {
    (site.keywords || []).forEach((keyword) => {
      usage.set(keyword, (usage.get(keyword) || 0) + 1);
    });
  });
  return usage;
}

function selectedKeywordSet() {
  return new Set(editorKeywords.map((keyword) => keyword.toLocaleLowerCase('zh-CN')));
}

function addEditorKeyword(rawKeyword) {
  const keyword = String(rawKeyword || '').trim();
  if (!keyword) return false;
  const normalized = keyword.toLocaleLowerCase('zh-CN');
  if (selectedKeywordSet().has(normalized)) return false;
  editorKeywords.push(keyword.slice(0, 40));
  renderEditorKeywords();
  return true;
}

function removeEditorKeyword(index) {
  editorKeywords.splice(index, 1);
  renderEditorKeywords();
  renderKeywordSuggestions();
}

function startEditorKeywordEdit(index, token) {
  const originalKeyword = editorKeywords[index];
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'keyword-token-input';
  input.value = originalKeyword;
  input.maxLength = 40;
  input.setAttribute('aria-label', `修改搜索词 ${originalKeyword}`);
  token.classList.add('is-editing');
  token.replaceChildren(input);

  let settled = false;
  const finish = (save) => {
    if (settled) return;
    settled = true;
    const nextKeyword = input.value.trim();
    if (save && nextKeyword) {
      const duplicateIndex = editorKeywords.findIndex((keyword, candidateIndex) =>
        candidateIndex !== index &&
        keyword.toLocaleLowerCase('zh-CN') === nextKeyword.toLocaleLowerCase('zh-CN'));
      if (duplicateIndex >= 0) editorKeywords.splice(index, 1);
      else editorKeywords[index] = nextKeyword;
    }
    renderEditorKeywords();
    renderKeywordSuggestions();
  };

  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
}

function renderEditorKeywords() {
  const knownKeywords = keywordUsageMap();
  elements.keywordTokens.replaceChildren();
  editorKeywords.forEach((keyword, index) => {
    const token = document.createElement('span');
    const isNew = !knownKeywords.has(keyword);
    token.className = `keyword-token${isNew ? ' is-new' : ''}`;
    const text = document.createElement('button');
    text.type = 'button';
    text.className = 'keyword-token-edit';
    text.textContent = keyword;
    text.title = '点击修改搜索词';
    text.setAttribute('aria-label', `修改搜索词 ${keyword}`);
    text.addEventListener('click', (event) => {
      event.stopPropagation();
      startEditorKeywordEdit(index, token);
    });
    token.append(text);
    if (isNew) {
      const badge = document.createElement('span');
      badge.className = 'keyword-token-new';
      badge.textContent = '新';
      token.append(badge);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'keyword-token-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除搜索词 ${keyword}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeEditorKeyword(index);
    });
    token.append(remove);
    elements.keywordTokens.append(token);
  });
}

function renderKeywordSuggestions() {
  const query = elements.siteKeywords.value.trim().toLocaleLowerCase('zh-CN');
  elements.keywordSuggestions.replaceChildren();
  if (!query) {
    elements.keywordSuggestions.hidden = true;
    elements.siteKeywords.setAttribute('aria-expanded', 'false');
    return;
  }

  const selected = selectedKeywordSet();
  const usage = keywordUsageMap();
  const suggestions = [...usage.entries()]
    .filter(([keyword]) => !selected.has(keyword.toLocaleLowerCase('zh-CN')))
    .filter(([keyword]) => keyword.toLocaleLowerCase('zh-CN').includes(query))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 12);

  suggestions.forEach(([keyword, count]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'keyword-suggestion';
    option.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.textContent = keyword;
    const meta = document.createElement('small');
    meta.textContent = `${count} 个网站使用`;
    option.append(name, meta);
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => {
      addEditorKeyword(keyword);
      elements.siteKeywords.value = '';
      renderKeywordSuggestions();
      elements.siteKeywords.focus();
    });
    elements.keywordSuggestions.append(option);
  });

  const exactKnown = [...usage.keys()].some((keyword) => keyword.toLocaleLowerCase('zh-CN') === query);
  if (query && !exactKnown && !selected.has(query)) {
    const createHint = document.createElement('div');
    createHint.className = 'keyword-create-hint';
    createHint.innerHTML = '<span>按 Enter 创建新搜索词</span>';
    const value = document.createElement('b');
    value.textContent = elements.siteKeywords.value.trim();
    createHint.append(value);
    elements.keywordSuggestions.append(createHint);
  }

  const hasContent = elements.keywordSuggestions.childElementCount > 0;
  elements.keywordSuggestions.hidden = !hasContent;
  elements.siteKeywords.setAttribute('aria-expanded', String(hasContent));
}

function commitKeywordDraft() {
  const drafts = elements.siteKeywords.value.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean);
  drafts.forEach(addEditorKeyword);
  elements.siteKeywords.value = '';
  renderKeywordSuggestions();
}

async function loadDiscoverySettings() {
  const stored = await chrome.storage.local.get([
    XJTUSiteData.DISCOVERY_ENABLED_KEY,
    XJTUSiteData.DISCOVERY_IGNORED_HOSTS_KEY
  ]);
  const ignoredHosts = stored[XJTUSiteData.DISCOVERY_IGNORED_HOSTS_KEY] || [];
  elements.siteDiscoveryEnabled.checked = stored[XJTUSiteData.DISCOVERY_ENABLED_KEY] !== false;
  elements.ignoredHostsCount.textContent = ignoredHosts.length;
  elements.clearIgnoredHostsButton.hidden = ignoredHosts.length === 0;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2200);
}

function siteInitial(site) {
  return site.name.replace(/^(西安交通大学|西交)/, '').trim().slice(0, 1).toUpperCase() || 'X';
}

function createMiniButton(label, title, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `mini-button ${className}`.trim();
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

function createSiteIcon(site) {
  const icon = document.createElement('span');
  icon.className = 'site-icon';
  icon.textContent = siteInitial(site);
  const image = document.createElement('img');
  image.src = XJTUSiteData.faviconUrl(site.url, 32);
  image.alt = '';
  image.addEventListener('error', () => image.remove());
  icon.append(image);
  return icon;
}

async function visitSite(site) {
  await XJTUSiteData.recordSiteUse(site.id);
  sites = await XJTUSiteData.getSites();
  renderSites();
  chrome.tabs.create({ url: site.url });
}

function visibleSites() {
  const groupedSites = sites.filter(siteMatchesSelectedGroup);
  const query = elements.filterInput.value.trim();
  return query ? XJTUSiteData.rankSites(groupedSites, query) : [...groupedSites].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'zh-CN')
  );
}

function groupPathKey(path) {
  return `path:${JSON.stringify(path)}`;
}

function groupPathFromKey(key) {
  if (!key.startsWith('path:')) return [];
  try { return JSON.parse(key.slice(5)); }
  catch (_error) { return []; }
}

function siteGroupPaths(site) {
  return Array.isArray(site.groupPaths)
    ? site.groupPaths.filter((path) => Array.isArray(path) && path.length)
    : [];
}

function pathStartsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

function replaceGroupPathPrefix(path, from, to) {
  return pathStartsWith(path, from) ? [...to, ...path.slice(from.length)] : [...path];
}

function applyBookmarkGroupRenames(path) {
  let result = [...path];
  const visited = new Set();
  for (let index = 0; index < 8; index += 1) {
    const signature = JSON.stringify(result);
    if (visited.has(signature)) break;
    visited.add(signature);
    const rule = [...bookmarkGroupRenames]
      .filter((item) => pathStartsWith(result, item.from))
      .sort((a, b) => b.from.length - a.from.length)[0];
    if (!rule) break;
    const next = replaceGroupPathPrefix(result, rule.from, rule.to);
    if (JSON.stringify(next) === signature) break;
    result = next;
  }
  return result;
}

function siteMatchesSelectedGroup(site) {
  if (selectedGroupKey === 'all') return true;
  const paths = siteGroupPaths(site);
  const selectedPath = groupPathFromKey(selectedGroupKey);
  return paths.some((path) => pathStartsWith(path, selectedPath));
}

function selectedGroupLabel() {
  if (selectedGroupKey === 'all') return '全部网站';
  return groupPathFromKey(selectedGroupKey).join(' / ') || '全部网站';
}

function buildGroupTree() {
  const root = { children: new Map(), siteIds: new Set() };
  const addPath = (path, siteId = null) => {
    let node = root;
    path.forEach((name, index) => {
      if (!node.children.has(name)) {
        const nodePath = path.slice(0, index + 1);
        node.children.set(name, { name, path: nodePath, children: new Map(), siteIds: new Set() });
      }
      node = node.children.get(name);
      if (siteId) node.siteIds.add(siteId);
    });
  };
  sites.forEach((site) => {
    siteGroupPaths(site).forEach((path) => {
      addPath(path, site.id);
    });
  });
  bookmarkFolderStats.forEach((_stats, key) => addPath(groupPathFromKey(key)));
  return root;
}

function browserBookmarkRootFolder(name) {
  return new Set([
    '书签栏', '其他书签', '移动设备书签',
    'Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'
  ]).has(name);
}

function bookmarkGroupDetails(bookmark) {
  const segments = (bookmark.folders || []).map((name, index) => ({
    name,
    id: bookmark.folderIds?.[index]
  })).filter((segment) => !browserBookmarkRootFolder(segment.name));
  const rawPath = [bookmarkGroupRoot, ...segments.map((segment) => segment.name)];
  return {
    path: applyBookmarkGroupRenames(rawPath),
    folderIds: segments.map((segment) => String(segment.id || '')).filter(Boolean)
  };
}

async function refreshBookmarkFolderStats() {
  const hasPermission = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (!hasPermission) {
    bookmarkFolderStats = new Map();
    renderGroupTree();
    return;
  }
  try {
    const nextBookmarkFolderStats = new Map();
    const [tree, syncSettings] = await Promise.all([
      chrome.bookmarks.getTree(),
      chrome.storage.local.get([
        BOOKMARK_SYNC_FOLDER_IDS_KEY,
        BOOKMARK_PENDING_KEY,
        BOOKMARK_INDEX_REPAIR_KEY
      ])
    ]);
    const normalized = normalizeBookmarkTree(tree);
    const browserRootIds = new Set((tree[0]?.children || [])
      .filter((node) => !node.url && browserBookmarkRootFolder(node.title))
      .map((node) => String(node.id)));
    // 浏览器根文件夹也可以由用户明确选为同步源，例如直接同步“书签栏”
    // 下的网页。迁移逻辑仍不会自动加入根文件夹，避免旧数据把整棵书签树
    // 误判为同步来源。
    const syncedFolderIds = new Set((syncSettings[BOOKMARK_SYNC_FOLDER_IDS_KEY] || [])
      .map(String));
    const needsSyncFolderMigration = syncedFolderIds.size === 0;
    const allBrowserBookmarks = bookmarksInNodes(normalized, []);
    const bookmarksById = new Map(allBrowserBookmarks.map((bookmark) => [String(bookmark.id), bookmark]));
    const bookmarksByUrl = new Map();
    allBrowserBookmarks.forEach((bookmark) => {
      const key = XJTUSiteData.canonicalUrlKey(bookmark.url);
      if (!bookmarksByUrl.has(key)) bookmarksByUrl.set(key, []);
      bookmarksByUrl.get(key).push(bookmark);
    });
    let sourcesMigrated = false;
    sites.forEach((site) => {
      const existingSources = Array.isArray(site.bookmarkSources) ? site.bookmarkSources : [];
      existingSources.forEach((source) => {
        if (needsSyncFolderMigration && source.parentId && !browserRootIds.has(String(source.parentId))) {
          syncedFolderIds.add(String(source.parentId));
        }
      });
      const knownSourceIds = new Set(existingSources.map((source) => String(source.id)));
      const missingSources = (site.sourceBookmarkIds || [])
        .map(String)
        .filter((id) => !knownSourceIds.has(id) && bookmarksById.has(id))
        .map((id) => {
          const bookmark = bookmarksById.get(id);
          const details = bookmarkGroupDetails(bookmark);
          if (needsSyncFolderMigration && bookmark.parentId && !browserRootIds.has(String(bookmark.parentId))) {
            syncedFolderIds.add(String(bookmark.parentId));
          }
          return {
            id,
            parentId: String(bookmark.parentId || ''),
            folders: [...bookmark.folders],
            folderIds: [...bookmark.folderIds],
            groupPath: [...details.path],
            syncMode: (bookmark.folderIds || []).some((folderId) => syncedFolderIds.has(String(folderId)))
              ? 'folder'
              : 'bookmark'
          };
        });
      if (missingSources.length) {
        site.bookmarkSources = [...existingSources, ...missingSources];
        sourcesMigrated = true;
      }
      const legacyBookmark = site.description?.startsWith('来自书签：') ||
        site.description === '来自浏览器书签';
      if (!site.sourceBookmarkIds?.length && legacyBookmark) {
        const matches = bookmarksByUrl.get(XJTUSiteData.canonicalUrlKey(site.url)) || [];
        if (matches.length) {
          const recoveredSources = matches.map((bookmark) => {
            const details = bookmarkGroupDetails(bookmark);
            return {
              id: String(bookmark.id),
              parentId: String(bookmark.parentId || ''),
              folders: [...bookmark.folders],
              folderIds: [...bookmark.folderIds],
              groupPath: [...details.path],
              syncMode: (bookmark.folderIds || []).some((folderId) => syncedFolderIds.has(String(folderId)))
                ? 'folder'
                : 'bookmark'
            };
          });
          site.importedFromBookmarks = true;
          site.bookmarkOnly = true;
          site.sourceBookmarkIds = recoveredSources.map((source) => source.id);
          site.bookmarkSources = recoveredSources;
          site.groupPaths = recoveredSources.map((source) => source.groupPath);
          recoveredSources.forEach((source) => {
            if (needsSyncFolderMigration && source.parentId && !browserRootIds.has(String(source.parentId))) {
              syncedFolderIds.add(String(source.parentId));
            }
          });
          sourcesMigrated = true;
        }
      }
    });
    sites = sites.flatMap((site) => {
      const previousSources = Array.isArray(site.bookmarkSources) ? site.bookmarkSources : [];
      if (!previousSources.length) return [site];
      const validSources = previousSources.filter((source) =>
        source.syncMode === 'bookmark' ||
        syncedFolderIds.has(String(source.parentId || '')) ||
        (source.folderIds || []).some((folderId) => syncedFolderIds.has(String(folderId))));
      if (validSources.length === previousSources.length) return [site];

      const validIds = new Set(validSources.map((source) => String(source.id)));
      const removedPaths = previousSources
        .filter((source) => !validIds.has(String(source.id)))
        .map((source) => source.groupPath);
      site.bookmarkSources = validSources;
      site.sourceBookmarkIds = (site.sourceBookmarkIds || [])
        .map(String)
        .filter((bookmarkId) => validIds.has(bookmarkId));
      site.groupPaths = (site.groupPaths || []).filter((path) =>
        !removedPaths.some((removedPath) => sameGroupPath(path, removedPath) &&
          !validSources.some((source) => sameGroupPath(source.groupPath, removedPath))));
      sourcesMigrated = true;
      return validSources.length ? [site] : [];
    });
    const bookmarks = allBrowserBookmarks.filter((bookmark) =>
      (bookmark.folderIds || []).some((folderId) => syncedFolderIds.has(String(folderId))));
    let importedIds = new Set(sites.flatMap((site) => site.sourceBookmarkIds || []).map(String));
    let repairedCount = 0;
    if (!syncSettings[BOOKMARK_INDEX_REPAIR_KEY] && syncedFolderIds.size) {
      const pendingIds = new Set((syncSettings[BOOKMARK_PENDING_KEY] || []).map((item) => String(item.id)));
      const now = Date.now();
      bookmarks.forEach((bookmark, index) => {
        const bookmarkId = String(bookmark.id);
        if (importedIds.has(bookmarkId) || pendingIds.has(bookmarkId)) return;
        const details = bookmarkGroupDetails(bookmark);
        const source = {
          id: bookmarkId,
          parentId: String(bookmark.parentId || ''),
          folders: [...bookmark.folders],
          folderIds: [...bookmark.folderIds],
          groupPath: [...details.path],
          syncMode: 'folder'
        };
        const urlKey = XJTUSiteData.canonicalUrlKey(bookmark.url);
        const existing = sites.find((site) => XJTUSiteData.canonicalUrlKey(site.url) === urlKey);
        if (existing) {
          existing.importedFromBookmarks = true;
          existing.bookmarkOnly = true;
          existing.sourceBookmarkIds = [...new Set([...(existing.sourceBookmarkIds || []).map(String), bookmarkId])];
          existing.bookmarkSources = [
            ...(existing.bookmarkSources || []).filter((item) => String(item.id) !== bookmarkId),
            source
          ];
          if (!(existing.groupPaths || []).some((path) => sameGroupPath(path, details.path))) {
            existing.groupPaths = [...(existing.groupPaths || []), details.path];
          }
        } else {
          sites.push({
            id: `bookmark-recovered-${now}-${index}`,
            name: bookmark.title || new URL(bookmark.url).hostname,
            url: bookmark.url,
            description: bookmark.folders.length
              ? `来自书签：${bookmark.folders.join(' / ')}`
              : '来自浏览器书签',
            keywords: XJTUSiteData.bookmarkTitleKeywords(bookmark.title),
            builtin: false,
            importedFromBookmarks: true,
            bookmarkOnly: true,
            sourceBookmarkIds: [bookmarkId],
            bookmarkSources: [source],
            groupPaths: [details.path],
            usageCount: 0,
            lastUsedAt: 0,
            createdAt: now + index,
            updatedAt: now + index
          });
        }
        importedIds.add(bookmarkId);
        repairedCount += 1;
        sourcesMigrated = true;
      });
    }
    if (sourcesMigrated) await XJTUSiteData.saveSites(sites);
    await chrome.storage.local.set({
      [BOOKMARK_SYNC_FOLDER_IDS_KEY]: [...syncedFolderIds],
      [BOOKMARK_INDEX_REPAIR_KEY]: true
    });
    if (repairedCount) showToast(`已从同步书签中恢复 ${repairedCount} 个网站`);
    bookmarks.forEach((bookmark) => {
      const details = bookmarkGroupDetails(bookmark);
      details.path.forEach((_part, index) => {
        const path = details.path.slice(0, index + 1);
        const key = groupPathKey(path);
        const current = nextBookmarkFolderStats.get(key) || { total: 0, folderIds: new Set() };
        current.total += 1;
        if (index > 0 && details.folderIds[index - 1]) current.folderIds.add(details.folderIds[index - 1]);
        nextBookmarkFolderStats.set(key, current);
      });
    });
    bookmarkFolderStats = nextBookmarkFolderStats;
  } catch (_error) {
    bookmarkFolderStats = new Map();
  }
  renderGroupTree();
}

function sortedGroupNodes(nodes) {
  const priority = new Map([['书签', 0]]);
  return [...nodes.values()].sort((a, b) =>
    (priority.get(a.name) ?? 10) - (priority.get(b.name) ?? 10) ||
    a.name.localeCompare(b.name, 'zh-CN'));
}

function selectGroup(key) {
  selectedGroupKey = key;
  selectedSiteIds.clear();
  renderGroupTree();
  renderSites();
}

async function renameGroup(oldPath, nextName) {
  const cleanName = String(nextName || '').trim().replace(/[\\/]+/g, '');
  if (!cleanName || cleanName === oldPath.at(-1)) {
    renderGroupTree();
    return;
  }
  const nextPath = [...oldPath.slice(0, -1), cleanName];
  let bookmarkFoldersUpdated = 0;
  let bookmarkFoldersFailed = 0;
  const syncedFolderIds = oldPath.length > 1
    ? [...(bookmarkFolderStats.get(groupPathKey(oldPath))?.folderIds || [])]
    : [];
  if (syncedFolderIds.length) {
    const results = await Promise.allSettled(
      syncedFolderIds.map((folderId) => chrome.bookmarks.update(folderId, { title: cleanName }))
    );
    bookmarkFoldersUpdated = results.filter((result) => result.status === 'fulfilled').length;
    bookmarkFoldersFailed = results.length - bookmarkFoldersUpdated;
  }
  sites.forEach((site) => {
    const paths = siteGroupPaths(site).map((path) =>
      pathStartsWith(path, oldPath) ? [...nextPath, ...path.slice(oldPath.length)] : path);
    site.groupPaths = paths.filter((path, index) =>
      paths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) === index);
    site.bookmarkSources = (site.bookmarkSources || []).map((source) => {
      const nextSource = { ...source };
      if (pathStartsWith(source.groupPath || [], oldPath)) {
        nextSource.groupPath = replaceGroupPathPrefix(source.groupPath, oldPath, nextPath);
      }
      if (syncedFolderIds.some((folderId) => (source.folderIds || []).map(String).includes(folderId))) {
        nextSource.folders = (source.folders || []).map((folder, index) =>
          syncedFolderIds.includes(String(source.folderIds?.[index])) ? cleanName : folder);
      }
      return nextSource;
    });
  });

  const selectedPath = groupPathFromKey(selectedGroupKey);
  if (pathStartsWith(selectedPath, oldPath)) {
    selectedGroupKey = groupPathKey([...nextPath, ...selectedPath.slice(oldPath.length)]);
  }
  const renamedExpandedKeys = new Set();
  expandedGroupKeys.forEach((key) => {
    const path = groupPathFromKey(key);
    renamedExpandedKeys.add(pathStartsWith(path, oldPath)
      ? groupPathKey([...nextPath, ...path.slice(oldPath.length)])
      : key);
  });
  expandedGroupKeys = renamedExpandedKeys;
  const renamingBookmarkGroup = oldPath[0] === bookmarkGroupRoot;
  if (renamingBookmarkGroup) {
    bookmarkGroupRenames = bookmarkGroupRenames.map((rule) => ({
      from: oldPath.length === 1
        ? replaceGroupPathPrefix(rule.from, oldPath, nextPath)
        : [...rule.from],
      to: replaceGroupPathPrefix(rule.to, oldPath, nextPath)
    }));
    if (oldPath.length > 1) {
      bookmarkGroupRenames = bookmarkGroupRenames.filter((rule) =>
        JSON.stringify(rule.from) !== JSON.stringify(oldPath));
      bookmarkGroupRenames.push({ from: [...oldPath], to: [...nextPath] });
    }
    const latestRenameRules = new Map();
    bookmarkGroupRenames.forEach((rule) => {
      if (JSON.stringify(rule.from) !== JSON.stringify(rule.to)) {
        latestRenameRules.set(JSON.stringify(rule.from), rule);
      }
    });
    bookmarkGroupRenames = [...latestRenameRules.values()];
  }
  if (oldPath.length === 1 && renamingBookmarkGroup) {
    bookmarkGroupRoot = cleanName;
  }
  await chrome.storage.local.set({
    [BOOKMARK_GROUP_ROOT_KEY]: bookmarkGroupRoot,
    [BOOKMARK_GROUP_RENAMES_KEY]: bookmarkGroupRenames
  });
  await persistSites();
  await refreshBookmarkFolderStats();
  if (bookmarkFoldersFailed) {
    showToast(`分组已改名，但有 ${bookmarkFoldersFailed} 个书签文件夹同步失败`);
  } else if (bookmarkFoldersUpdated) {
    showToast(`分组与 ${bookmarkFoldersUpdated} 个书签文件夹已同步改名`);
  } else {
    showToast(`分组已重命名为“${cleanName}”`);
  }
}

async function stopBookmarkGroupSync(groupPath) {
  const groupLabel = groupPath.join(' / ');
  const confirmed = window.confirm(
    `停止同步“${groupLabel}”吗？\n\n该分组中的网站将退出搜索源，浏览器里的原书签不会被删除。`
  );
  if (!confirmed) return;

  const stored = await chrome.storage.local.get([
    BOOKMARK_SYNC_FOLDER_IDS_KEY,
    BOOKMARK_PENDING_KEY
  ]);
  const targetFolderIds = new Set();
  bookmarkFolderStats.forEach((stats, key) => {
    const candidatePath = groupPathFromKey(key);
    if (!pathStartsWith(candidatePath, groupPath)) return;
    stats.folderIds.forEach((folderId) => targetFolderIds.add(String(folderId)));
  });
  if (groupPath.length === 1 && groupPath[0] === bookmarkGroupRoot) {
    (stored[BOOKMARK_SYNC_FOLDER_IDS_KEY] || []).forEach((folderId) =>
      targetFolderIds.add(String(folderId)));
  }
  if (!targetFolderIds.size) {
    showToast('没有找到对应的书签文件夹');
    return;
  }

  const nextSites = [];
  sites.forEach((site) => {
    const previousSources = Array.isArray(site.bookmarkSources) ? site.bookmarkSources : [];
    const removedSources = previousSources.filter((source) =>
      (source.folderIds || []).some((folderId) => targetFolderIds.has(String(folderId))));
    if (!removedSources.length) {
      nextSites.push(site);
      return;
    }

    const removedSourceIds = new Set(removedSources.map((source) => String(source.id)));
    const remainingSources = previousSources.filter((source) => !removedSourceIds.has(String(source.id)));
    site.bookmarkSources = remainingSources;
    site.sourceBookmarkIds = (site.sourceBookmarkIds || [])
      .map(String)
      .filter((bookmarkId) => !removedSourceIds.has(bookmarkId));
    const removedPaths = removedSources.map((source) => source.groupPath);
    site.groupPaths = (site.groupPaths || []).filter((path) =>
      !removedPaths.some((removedPath) => sameGroupPath(path, removedPath) &&
        !remainingSources.some((source) => sameGroupPath(source.groupPath, removedPath))));

    if (site.sourceBookmarkIds.length) {
      nextSites.push(site);
      return;
    }
    const legacyBookmarkOnly = site.description?.startsWith('来自书签：') ||
      site.description === '来自浏览器书签';
    if (site.bookmarkOnly === true || legacyBookmarkOnly) return;
    delete site.importedFromBookmarks;
    delete site.bookmarkSources;
    delete site.sourceBookmarkIds;
    nextSites.push(site);
  });

  const syncedFolderIds = (stored[BOOKMARK_SYNC_FOLDER_IDS_KEY] || [])
    .map(String)
    .filter((folderId) => !targetFolderIds.has(folderId));
  const pendingBookmarks = (stored[BOOKMARK_PENDING_KEY] || []).filter((item) =>
    !(item.source?.folderIds || []).some((folderId) => targetFolderIds.has(String(folderId))));
  bookmarkGroupRenames = bookmarkGroupRenames.filter((rule) =>
    !pathStartsWith(rule.from, groupPath) && !pathStartsWith(rule.to, groupPath));
  sites = nextSites;
  selectedSiteIds.clear();
  if (pathStartsWith(groupPathFromKey(selectedGroupKey), groupPath)) selectedGroupKey = 'all';
  await Promise.all([
    XJTUSiteData.saveSites(sites),
    chrome.storage.local.set({
      [BOOKMARK_SYNC_FOLDER_IDS_KEY]: syncedFolderIds,
      [BOOKMARK_PENDING_KEY]: pendingBookmarks,
      [BOOKMARK_GROUP_RENAMES_KEY]: bookmarkGroupRenames
    }),
    chrome.action.setBadgeText({ text: pendingBookmarks.length ? '+' : '' })
  ]);
  await refreshBookmarkFolderStats();
  renderSites();
  showToast(`已停止同步“${groupLabel}”，浏览器书签保持不变`);
}

function sameGroupPath(first, second) {
  return JSON.stringify(first || []) === JSON.stringify(second || []);
}

function startGroupRename(row, node) {
  const main = row.querySelector('.group-tree-main');
  const input = document.createElement('input');
  input.className = 'group-tree-editor';
  input.value = node.name;
  input.maxLength = 40;
  input.setAttribute('aria-label', `重命名${node.name}`);
  main.replaceWith(input);
  row.querySelector('.group-tree-rename').hidden = true;
  row.querySelector('.group-tree-unlink').hidden = true;
  let settled = false;
  const finish = (save) => {
    if (settled) return;
    settled = true;
    if (save) renameGroup(node.path, input.value);
    else renderGroupTree();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
}

function createGroupRow({ key, label, count, depth = 0, node = null, icon = 'folder' }) {
  const row = document.createElement('div');
  row.className = `group-tree-row${selectedGroupKey === key ? ' is-active' : ''}`;
  row.style.setProperty('--group-depth', depth);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `group-tree-toggle${expandedGroupKeys.has(key) ? ' is-expanded' : ''}`;
  toggle.textContent = '›';
  const hasChildren = Boolean(node?.children.size);
  toggle.disabled = !hasChildren;
  toggle.setAttribute('aria-label', expandedGroupKeys.has(key) ? '折叠分组' : '展开分组');
  toggle.addEventListener('click', () => {
    if (expandedGroupKeys.has(key)) expandedGroupKeys.delete(key);
    else expandedGroupKeys.add(key);
    renderGroupTree();
  });

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'group-tree-main';
  main.title = node ? node.path.join(' / ') : label;
  const iconElement = document.createElement('span');
  iconElement.className = icon === 'folder' ? 'group-folder-icon' : 'group-special-icon';
  if (icon !== 'folder') iconElement.textContent = icon;
  iconElement.setAttribute('aria-hidden', 'true');
  const labelElement = document.createElement('span');
  labelElement.className = 'group-tree-label';
  labelElement.textContent = label;
  const countElement = document.createElement('span');
  countElement.className = 'group-tree-count';
  const bookmarkStats = bookmarkFolderStats.get(key);
  countElement.textContent = bookmarkStats
    ? bookmarkStats.total
    : count;
  if (bookmarkStats) countElement.title = '书签文件夹内总数';
  main.append(iconElement, labelElement, countElement);
  main.addEventListener('click', () => selectGroup(key));
  const renameAllowed = Boolean(node);
  const unlinkAllowed = Boolean(node && bookmarkStats);

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'group-tree-rename';
  rename.textContent = '✎';
  rename.title = '重命名分组';
  rename.setAttribute('aria-label', `重命名${label}`);
  rename.hidden = !renameAllowed;
  if (renameAllowed) rename.addEventListener('click', () => startGroupRename(row, node));

  const unlink = document.createElement('button');
  unlink.type = 'button';
  unlink.className = 'group-tree-unlink';
  unlink.textContent = '⊘';
  unlink.title = '停止同步，保留浏览器书签';
  unlink.setAttribute('aria-label', `停止同步${label}`);
  unlink.hidden = !unlinkAllowed;
  if (unlinkAllowed) unlink.addEventListener('click', () => stopBookmarkGroupSync(node.path));

  row.append(toggle, main, rename, unlink);
  return row;
}

function renderGroupTree() {
  const tree = buildGroupTree();
  const validKeys = new Set(['all']);
  const collectKeys = (nodes) => nodes.forEach((node) => {
    validKeys.add(groupPathKey(node.path));
    collectKeys([...node.children.values()]);
  });
  collectKeys([...tree.children.values()]);
  if (!validKeys.has(selectedGroupKey)) selectedGroupKey = 'all';

  const rootNodes = sortedGroupNodes(tree.children);
  if (!groupTreeInitialized) {
    rootNodes.forEach((node) => expandedGroupKeys.add(groupPathKey(node.path)));
    groupTreeInitialized = true;
  }

  elements.groupTree.replaceChildren();
  elements.groupTree.append(
    createGroupRow({ key: 'all', label: '全部网站', count: sites.length, icon: '◎' })
  );

  const renderNodes = (nodes, depth) => {
    sortedGroupNodes(nodes).forEach((node) => {
      const key = groupPathKey(node.path);
      elements.groupTree.append(createGroupRow({
        key,
        label: node.name,
        count: node.siteIds.size,
        depth,
        node
      }));
      if (expandedGroupKeys.has(key)) renderNodes(node.children, depth + 1);
    });
  };
  renderNodes(tree.children, 0);
}

function updateSiteSelectionState(filtered) {
  const existingIds = new Set(sites.map((site) => site.id));
  selectedSiteIds.forEach((siteId) => {
    if (!existingIds.has(siteId)) selectedSiteIds.delete(siteId);
  });

  const visibleSelectedCount = filtered.filter((site) => selectedSiteIds.has(site.id)).length;
  elements.selectAllSites.checked = filtered.length > 0 && visibleSelectedCount === filtered.length;
  elements.selectAllSites.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < filtered.length;
  elements.selectAllSites.disabled = filtered.length === 0;
  elements.selectedSiteCount.textContent = selectedSiteIds.size;
  elements.bulkActions.hidden = selectedSiteIds.size === 0;
  elements.deleteSelectedSitesButton.disabled = selectedSiteIds.size === 0;
}

function renderSites() {
  const filtered = visibleSites();
  elements.siteCount.textContent = sites.filter(siteMatchesSelectedGroup).length;
  elements.activeGroupLabel.textContent = selectedGroupLabel();
  elements.siteList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = sites.length
      ? '没有匹配项\n可以换一个搜索词'
      : '尚未建立搜索源\n请先选择一个书签文件夹进行导入';
    elements.siteList.append(empty);
    updateSiteSelectionState(filtered);
    return;
  }

  filtered.forEach((site) => {
    const row = document.createElement('article');
    row.className = 'site-item';
    row.classList.toggle('is-selected', selectedSiteIds.has(site.id));

    const selection = document.createElement('label');
    selection.className = 'site-select';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedSiteIds.has(site.id);
    checkbox.setAttribute('aria-label', `选择${site.name}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedSiteIds.add(site.id);
      else selectedSiteIds.delete(site.id);
      renderSites();
    });
    selection.append(checkbox);

    const icon = createSiteIcon(site);

    const copy = document.createElement('div');
    copy.className = 'site-copy';
    const titleRow = document.createElement('div');
    titleRow.className = 'site-title-row';
    const title = document.createElement('strong');
    title.textContent = site.name;
    title.title = site.url;
    titleRow.append(title);
    const keywords = document.createElement('div');
    keywords.className = 'keyword-line';
    const keywordLabel = document.createElement('span');
    keywordLabel.className = 'keyword-label';
    keywordLabel.textContent = '搜索词';
    keywords.append(keywordLabel);
    (site.keywords || []).forEach((keyword) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'keyword-chip';
      chip.textContent = keyword;
      chip.title = `筛选“${keyword}”`;
      chip.addEventListener('click', () => {
        elements.filterInput.value = keyword;
        renderSites();
      });
      keywords.append(chip);
    });
    const siteUrl = document.createElement('div');
    siteUrl.className = 'site-url';
    siteUrl.textContent = site.url;
    copy.append(titleRow, siteUrl, keywords);

    const actions = document.createElement('div');
    actions.className = 'site-actions';
    const openButton = createMiniButton('↗', '打开网站', 'is-open');
    const editButton = createMiniButton('✎', '编辑');
    const deleteButton = createMiniButton('×', '删除');
    openButton.addEventListener('click', () => visitSite(site));
    editButton.addEventListener('click', () => openEditor(site));
    deleteButton.addEventListener('click', () => deleteSite(site.id));
    actions.append(openButton, editButton, deleteButton);
    row.append(selection, icon, copy, actions);
    elements.siteList.append(row);
  });
  updateSiteSelectionState(filtered);
}

async function persistSites() {
  await XJTUSiteData.saveSites(sites);
  renderGroupTree();
  renderSites();
}

async function cleanLegacyBookmarkFolderKeywords(loadedSites) {
  const migrationState = await chrome.storage.local.get(BOOKMARK_FOLDER_KEYWORD_MIGRATION_KEY);
  if (migrationState[BOOKMARK_FOLDER_KEYWORD_MIGRATION_KEY]) return;

  let changed = false;
  loadedSites.forEach((site) => {
    const prefix = '来自书签：';
    if (!site.description?.startsWith(prefix)) return;
    const folderNames = new Set(site.description
      .slice(prefix.length)
      .split('/')
      .map((name) => name.trim())
      .filter(Boolean));
    const generatedFolderKeywords = XJTUSiteData.parseKeywords([...folderNames]);
    generatedFolderKeywords.forEach((keyword) => folderNames.add(keyword));
    const previous = site.keywords || [];
    const next = previous.filter((keyword) => keyword === site.name || !folderNames.has(keyword));
    if (next.length !== previous.length) {
      site.keywords = next;
      site.updatedAt = Date.now();
      changed = true;
    }
  });
  if (changed) await XJTUSiteData.saveSites(loadedSites);
  await chrome.storage.local.set({ [BOOKMARK_FOLDER_KEYWORD_MIGRATION_KEY]: true });
}

function wasImportedFromBookmarks(site) {
  return Boolean(
    site.importedFromBookmarks ||
    site.sourceBookmarkIds?.length ||
    site.description?.startsWith('来自书签：') ||
    site.description === '来自浏览器书签'
  );
}

async function sourceBookmarkIdsForSites(targetSites) {
  const importedSites = targetSites.filter(wasImportedFromBookmarks);
  if (!importedSites.length) return [];

  const knownIds = new Set(importedSites.flatMap((site) => site.sourceBookmarkIds || []).map(String));
  const legacyUrlKeys = new Set(importedSites
    .filter((site) => !site.sourceBookmarkIds?.length)
    .map((site) => XJTUSiteData.canonicalUrlKey(site.url)));
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  const collectBookmarks = (nodes) => nodes.forEach((node) => {
    if (node.url) bookmarks.push(node);
    if (node.children) collectBookmarks(node.children);
  });
  collectBookmarks(tree);

  return bookmarks
    .filter((bookmark) => knownIds.has(String(bookmark.id)) || legacyUrlKeys.has(XJTUSiteData.canonicalUrlKey(bookmark.url)))
    .map((bookmark) => String(bookmark.id));
}

async function maybeDeleteSourceBookmarks(targetSites) {
  const importedSites = targetSites.filter(wasImportedFromBookmarks);
  if (!importedSites.length) return { deleted: 0, failed: 0 };

  const importedLabel = importedSites.length === 1
    ? '这个网站'
    : `其中 ${importedSites.length} 个网站`;
  const shouldDelete = window.confirm(
    `${importedLabel}是从浏览器书签导入的。\n\n是否同时删除书签中的对应条目？\n\n确定：同时删除书签\n取消：仅从网站词典删除`
  );
  if (!shouldDelete) return { deleted: 0, failed: 0 };

  let hasPermission = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (!hasPermission) {
    hasPermission = await chrome.permissions.request({ permissions: ['bookmarks'] });
  }
  if (!hasPermission) return { deleted: 0, failed: 0, permissionDenied: true };

  let bookmarkIds;
  try {
    bookmarkIds = await sourceBookmarkIdsForSites(importedSites);
  } catch (_error) {
    return { deleted: 0, failed: 0, lookupFailed: true };
  }
  if (!bookmarkIds.length) return { deleted: 0, failed: 0 };

  const results = await Promise.allSettled(bookmarkIds.map((bookmarkId) => chrome.bookmarks.remove(bookmarkId)));
  return {
    deleted: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length
  };
}

function deletionToast(siteCount, bookmarkResult) {
  const siteMessage = siteCount === 1 ? '已从词典删除' : `已删除 ${siteCount} 个网站`;
  if (bookmarkResult.permissionDenied) return `${siteMessage}，未获得权限，浏览器书签未删除`;
  if (bookmarkResult.lookupFailed) return `${siteMessage}，但未能读取浏览器书签`;
  if (bookmarkResult.failed) return `${siteMessage}，但有 ${bookmarkResult.failed} 条书签未能删除`;
  if (bookmarkResult.deleted) return `${siteMessage}，并删除 ${bookmarkResult.deleted} 条浏览器书签`;
  return siteMessage;
}

async function deleteSite(siteId) {
  const site = sites.find((item) => item.id === siteId);
  if (!site || !window.confirm(`确定从词典中删除“${site.name}”吗？`)) return;
  const bookmarkResult = await maybeDeleteSourceBookmarks([site]);
  sites = sites.filter((item) => item.id !== siteId);
  selectedSiteIds.delete(siteId);
  await persistSites();
  showToast(deletionToast(1, bookmarkResult));
}

async function deleteSelectedSites() {
  const selectedSites = sites.filter((site) => selectedSiteIds.has(site.id));
  if (!selectedSites.length) return;
  if (!window.confirm(`确定删除选中的 ${selectedSites.length} 个网站吗？`)) return;

  const bookmarkResult = await maybeDeleteSourceBookmarks(selectedSites);
  sites = sites.filter((site) => !selectedSiteIds.has(site.id));
  selectedSiteIds.clear();
  await persistSites();
  showToast(deletionToast(selectedSites.length, bookmarkResult));
}

function openEditor(site, options = {}) {
  if (!site?.id) {
    showToast('请先从浏览器书签导入网站');
    return;
  }
  const bookmarkBacked = wasImportedFromBookmarks(site);
  elements.editorTitle.textContent = '编辑网站';
  elements.editorSubtitle.textContent = bookmarkBacked
    ? '修改名称或网址会同步到浏览器书签；搜索词仅用于快速定位。'
    : '一个网站可以设置多个搜索词。';
  elements.bookmarkSourceNotice.hidden = !bookmarkBacked;
  elements.siteId.value = site.id;
  elements.siteName.value = site.name || '';
  elements.siteUrl.value = site.url || '';
  elements.siteName.readOnly = false;
  elements.siteUrl.readOnly = false;
  editorKeywords = [...(site.keywords || [])];
  elements.siteKeywords.value = '';
  renderEditorKeywords();
  elements.keywordSuggestions.hidden = true;
  elements.siteKeywords.setAttribute('aria-expanded', 'false');
  elements.siteDescription.value = site.description || '';
  elements.formError.textContent = '';
  elements.editorLayer.hidden = false;
  window.setTimeout(() => {
    if (options.focusKeywords || bookmarkBacked) elements.siteKeywords.focus();
    else elements.siteName.focus();
  }, 30);
}

function openRequestedSiteEditor() {
  const siteId = new URLSearchParams(location.search).get('edit');
  if (!siteId) return;
  history.replaceState(null, '', location.pathname);
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    showToast('没有找到要编辑的网站');
    return;
  }
  openEditor(site, { focusKeywords: true });
}

function closeEditor() {
  elements.editorLayer.hidden = true;
  elements.siteForm.reset();
  editorKeywords = [];
  elements.keywordTokens.replaceChildren();
  elements.keywordSuggestions.hidden = true;
}

function normalizedUrl(value) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 http 或 https 网址');
  return parsed.href;
}

async function syncSiteDetailsToBookmarks(site, name, url) {
  let hasPermission = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (!hasPermission) {
    hasPermission = await chrome.permissions.request({ permissions: ['bookmarks'] });
  }
  if (!hasPermission) return { updated: 0, failed: 0, permissionDenied: true };

  let bookmarkIds;
  try {
    bookmarkIds = await sourceBookmarkIdsForSites([site]);
  } catch (_error) {
    return { updated: 0, failed: 0, lookupFailed: true };
  }
  if (!bookmarkIds.length) return { updated: 0, failed: 0, missingSource: true };

  const results = await Promise.allSettled(bookmarkIds.map((bookmarkId) =>
    chrome.bookmarks.update(bookmarkId, { title: name, url })));
  return {
    updated: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length
  };
}

elements.siteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = elements.siteId.value;
  const existing = sites.find((site) => site.id === id);
  if (!existing) {
    elements.formError.textContent = '网站不存在，请从浏览器书签重新导入';
    return;
  }
  commitKeywordDraft();
  const keywords = [...editorKeywords];
  if (!keywords.length) {
    elements.formError.textContent = '请至少填写一个搜索词';
    return;
  }

  const name = elements.siteName.value.trim();
  let url;
  try {
    url = normalizedUrl(elements.siteUrl.value.trim());
  } catch (_error) {
    elements.formError.textContent = '请输入有效的网址';
    return;
  }
  if (!name) {
    elements.formError.textContent = '请输入网站名称';
    return;
  }

  let previousUrl = existing.url;
  try { previousUrl = normalizedUrl(existing.url); }
  catch (_error) { /* 历史无效网址需要通过本次保存修正。 */ }
  const detailsChanged = name !== existing.name || url !== previousUrl;
  let bookmarkSync = null;
  if (detailsChanged && wasImportedFromBookmarks(existing)) {
    bookmarkSync = await syncSiteDetailsToBookmarks(existing, name, url);
    if (bookmarkSync.permissionDenied) {
      elements.formError.textContent = '需要书签权限才能同步名称和网址';
      return;
    }
    if (bookmarkSync.lookupFailed) {
      elements.formError.textContent = '暂时无法读取关联书签，请稍后重试';
      return;
    }
    if (bookmarkSync.missingSource || !bookmarkSync.updated) {
      elements.formError.textContent = '没有找到关联书签，请重新导入该书签';
      return;
    }
  }
  const now = Date.now();
  const entry = {
    ...existing,
    id,
    name,
    url,
    keywords,
    description: elements.siteDescription.value.trim(),
    builtin: false,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    usageCount: existing.usageCount || 0,
    lastUsedAt: existing.lastUsedAt || 0
  };
  Object.assign(existing, entry);
  await persistSites();
  closeEditor();
  if (bookmarkSync?.failed) {
    showToast(`已保存并同步 ${bookmarkSync.updated} 条书签，${bookmarkSync.failed} 条失败`);
  } else if (bookmarkSync?.updated) {
    showToast(`已保存并同步 ${bookmarkSync.updated} 条书签`);
  } else {
    showToast('搜索信息已更新');
  }
});

function normalizeBookmarkTree(nodes, folders = [], folderIds = []) {
  const output = [];
  nodes.forEach((node) => {
    if (node.url) {
      if (/^https?:/i.test(node.url)) {
        output.push({
          type: 'bookmark',
          id: node.id,
          title: node.title || new URL(node.url).hostname,
          url: node.url,
          folders,
          folderIds,
          parentId: node.parentId
        });
      }
      return;
    }

    const nextFolders = node.title ? [...folders, node.title] : folders;
    const nextFolderIds = node.title ? [...folderIds, String(node.id)] : folderIds;
    const children = normalizeBookmarkTree(node.children || [], nextFolders, nextFolderIds);
    if (!node.title) {
      output.push(...children);
    } else if (children.length) {
      output.push({ type: 'folder', id: node.id, title: node.title, folders, folderIds, children });
    }
  });
  return output;
}

function bookmarksInNodes(nodes, output = []) {
  nodes.forEach((node) => {
    if (node.type === 'bookmark') output.push(node);
    else bookmarksInNodes(node.children, output);
  });
  return output;
}

function bookmarkFoldersInNodes(nodes, output = []) {
  nodes.forEach((node) => {
    if (node.type !== 'folder') return;
    output.push(node);
    bookmarkFoldersInNodes(node.children, output);
  });
  return output;
}

function filterBookmarkTree(nodes, query) {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const searchable = node.type === 'bookmark'
      ? `${node.title} ${node.url} ${node.folders.join(' ')}`
      : `${node.title} ${node.folders.join(' ')}`;
    const ownMatch = searchable.toLocaleLowerCase('zh-CN').includes(query);
    if (node.type === 'bookmark') return ownMatch ? [node] : [];
    if (ownMatch) return [node];
    const children = filterBookmarkTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function visibleBookmarkTree() {
  const query = elements.bookmarkFilterInput.value.trim().toLocaleLowerCase('zh-CN');
  return filterBookmarkTree(bookmarkTree, query);
}

function visibleBookmarks() {
  return bookmarksInNodes(visibleBookmarkTree(), []);
}

function updateBookmarkSelectionState() {
  const current = visibleBookmarks();
  const currentFolders = bookmarkFoldersInNodes(visibleBookmarkTree(), []);
  const selectedVisible = current.filter((item) => selectedBookmarkIds.has(item.id)).length;
  elements.selectAllBookmarks.checked = current.length > 0 && selectedVisible === current.length;
  elements.selectAllBookmarks.indeterminate = selectedVisible > 0 && selectedVisible < current.length;
  const selectedVisibleFolders = currentFolders.filter((folder) => selectedBookmarkFolderIds.has(String(folder.id))).length;
  if (!selectedVisibleFolders && selectedVisible) elements.selectAllBookmarks.indeterminate = true;
  elements.bookmarkSelectionCount.textContent =
    `已选 ${selectedBookmarkFolderIds.size} 个文件夹 · ${selectedBookmarkIds.size} 个书签`;
  elements.confirmBookmarkButton.disabled = selectedBookmarkIds.size === 0;
}

function renderBookmarkNodes(nodes, container, depth = 0, forceExpanded = false) {
  nodes.forEach((node) => {
    if (node.type === 'folder') {
      const descendantBookmarks = bookmarksInNodes(node.children, []);
      const selectedCount = descendantBookmarks.filter((item) => selectedBookmarkIds.has(item.id)).length;
      const expanded = forceExpanded || expandedBookmarkFolderIds.has(node.id);
      const row = document.createElement('div');
      row.className = 'bookmark-folder';
      row.style.paddingLeft = `${8 + depth * 22}px`;

      const expander = document.createElement('button');
      expander.type = 'button';
      expander.className = `bookmark-expander${expanded ? ' is-expanded' : ''}`;
      expander.textContent = '›';
      expander.setAttribute('aria-label', expanded ? '折叠文件夹' : '展开文件夹');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = descendantBookmarks.length > 0 && selectedCount === descendantBookmarks.length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < descendantBookmarks.length;
      checkbox.addEventListener('change', () => {
        const descendantFolders = bookmarkFoldersInNodes([node], []);
        descendantBookmarks.forEach((bookmark) => {
          if (checkbox.checked) selectedBookmarkIds.add(bookmark.id);
          else selectedBookmarkIds.delete(bookmark.id);
        });
        descendantFolders.forEach((folder) => {
          if (checkbox.checked) selectedBookmarkFolderIds.add(String(folder.id));
          else selectedBookmarkFolderIds.delete(String(folder.id));
        });
        renderBookmarks();
      });

      const folderIcon = document.createElement('span');
      folderIcon.className = 'bookmark-folder-icon';
      folderIcon.setAttribute('aria-hidden', 'true');
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'bookmark-folder-title';
      title.textContent = node.title;
      const count = document.createElement('span');
      count.className = 'bookmark-folder-count';
      count.textContent = `${descendantBookmarks.length}`;

      const toggleFolder = () => {
        if (expandedBookmarkFolderIds.has(node.id)) expandedBookmarkFolderIds.delete(node.id);
        else expandedBookmarkFolderIds.add(node.id);
        renderBookmarks();
      };
      expander.addEventListener('click', toggleFolder);
      title.addEventListener('click', toggleFolder);
      row.append(expander, checkbox, folderIcon, title, count);
      container.append(row);

      if (expanded) renderBookmarkNodes(node.children, container, depth + 1, forceExpanded);
      return;
    }

    const bookmark = node;
    const label = document.createElement('label');
    label.className = `bookmark-item${selectedBookmarkIds.has(bookmark.id) ? ' is-included' : ''}`;
    label.style.paddingLeft = `${35 + depth * 22}px`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedBookmarkIds.has(bookmark.id);
    checkbox.setAttribute('aria-label', `选择书签 ${bookmark.title}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedBookmarkIds.add(bookmark.id);
      } else {
        selectedBookmarkIds.delete(bookmark.id);
        // 从已整组选中的文件夹中排除一个书签后，祖先文件夹不再算整组选择。
        (bookmark.folderIds || []).forEach((folderId) =>
          selectedBookmarkFolderIds.delete(String(folderId)));
      }
      renderBookmarks();
    });
    const favicon = document.createElement('img');
    favicon.className = 'bookmark-favicon';
    favicon.src = XJTUSiteData.faviconUrl(bookmark.url, 32);
    favicon.alt = '';
    const copy = document.createElement('span');
    copy.className = 'bookmark-item-copy';
    const title = document.createElement('strong');
    title.textContent = bookmark.title;
    const path = document.createElement('small');
    const queryActive = Boolean(elements.bookmarkFilterInput.value.trim());
    path.textContent = queryActive
      ? `${bookmark.folders.join(' / ') || '未分类'} · ${new URL(bookmark.url).hostname}`
      : new URL(bookmark.url).hostname;
    copy.append(title, path);
    label.append(checkbox, favicon, copy);
    container.append(label);
  });
}

function renderBookmarks() {
  const tree = visibleBookmarkTree();
  const queryActive = Boolean(elements.bookmarkFilterInput.value.trim());
  elements.bookmarkList.replaceChildren();
  if (!tree.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = '没有找到可导入的网页书签';
    elements.bookmarkList.append(empty);
  } else {
    renderBookmarkNodes(tree, elements.bookmarkList, 0, queryActive);
  }
  updateBookmarkSelectionState();
}

async function openBookmarkImporter() {
  try {
    const granted = await chrome.permissions.request({ permissions: ['bookmarks'] });
    if (!granted) {
      showToast('未获得书签读取权限');
      return;
    }
    const tree = await chrome.bookmarks.getTree();
    bookmarkTree = normalizeBookmarkTree(tree);
    allBookmarks = bookmarksInNodes(bookmarkTree, []);
    expandedBookmarkFolderIds = new Set(bookmarkTree
      .filter((node) => node.type === 'folder')
      .map((node) => node.id));
    selectedBookmarkIds = new Set();
    selectedBookmarkFolderIds = new Set();
    elements.bookmarkFilterInput.value = '';
    elements.bookmarkLayer.hidden = false;
    renderBookmarks();
    elements.bookmarkFilterInput.focus();
  } catch (error) {
    showToast(`书签读取失败：${error.message}`);
  }
}

function closeBookmarkImporter() {
  elements.bookmarkLayer.hidden = true;
  selectedBookmarkIds.clear();
  selectedBookmarkFolderIds.clear();
}

async function importSelectedBookmarks() {
  const selected = allBookmarks.filter((item) => selectedBookmarkIds.has(item.id));
  let added = 0;
  let merged = 0;
  const now = Date.now();
  const syncSettings = await chrome.storage.local.get(BOOKMARK_SYNC_FOLDER_IDS_KEY);
  const syncedFolderIds = new Set((syncSettings[BOOKMARK_SYNC_FOLDER_IDS_KEY] || []).map(String));
  selectedBookmarkFolderIds.forEach((folderId) => syncedFolderIds.add(String(folderId)));

  selected.forEach((bookmark, index) => {
    const parsedUrl = new URL(bookmark.url);
    const keywords = XJTUSiteData.bookmarkTitleKeywords(bookmark.title);
    const groupDetails = bookmarkGroupDetails(bookmark);
    const groupPath = groupDetails.path;
    const bookmarkSource = {
      id: String(bookmark.id),
      parentId: String(bookmark.parentId || ''),
      folders: [...bookmark.folders],
      folderIds: [...bookmark.folderIds],
      groupPath: [...groupPath],
      syncMode: (bookmark.folderIds || []).some((folderId) =>
        selectedBookmarkFolderIds.has(String(folderId))) ? 'folder' : 'bookmark'
    };
    const bookmarkUrlKey = XJTUSiteData.canonicalUrlKey(parsedUrl.href);
    const existing = sites.find((site) => XJTUSiteData.canonicalUrlKey(site.url) === bookmarkUrlKey);
    if (existing) {
      existing.keywords = [...new Set([...(existing.keywords || []), ...keywords])];
      existing.importedFromBookmarks = true;
      existing.sourceBookmarkIds = [...new Set([...(existing.sourceBookmarkIds || []).map(String), String(bookmark.id)])];
      existing.bookmarkSources = [
        ...(existing.bookmarkSources || []).filter((source) => String(source.id) !== String(bookmark.id)),
        bookmarkSource
      ];
      const groupPaths = [...(existing.groupPaths || []), groupPath];
      existing.groupPaths = groupPaths.filter((path, pathIndex) =>
        groupPaths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) === pathIndex);
      existing.updatedAt = now;
      merged += 1;
    } else {
      sites.push({
        id: `bookmark-${now}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        name: bookmark.title || parsedUrl.hostname,
        url: parsedUrl.href,
        description: bookmark.folders.length ? `来自书签：${bookmark.folders.join(' / ')}` : '来自浏览器书签',
        keywords,
        builtin: false,
        importedFromBookmarks: true,
        bookmarkOnly: true,
        sourceBookmarkIds: [String(bookmark.id)],
        bookmarkSources: [bookmarkSource],
        groupPaths: [groupPath],
        usageCount: 0,
        lastUsedAt: 0,
        createdAt: now + index,
        updatedAt: now + index
      });
      added += 1;
    }
  });

  await chrome.storage.local.set({ [BOOKMARK_SYNC_FOLDER_IDS_KEY]: [...syncedFolderIds] });
  await persistSites();
  await refreshBookmarkFolderStats();
  closeBookmarkImporter();
  showToast(`已导入 ${added} 个，合并 ${merged} 个重复网站`);
}

async function loadShortcut() {
  const commands = await chrome.commands.getAll();
  const command = commands.find((item) => item.name === 'open-site-launcher-v2');
  elements.shortcutLabel.textContent = command?.shortcut || '设置快捷键';
}

async function loadGroupSettings() {
  const stored = await chrome.storage.local.get([
    BOOKMARK_GROUP_ROOT_KEY,
    BOOKMARK_GROUP_RENAMES_KEY
  ]);
  bookmarkGroupRoot = stored[BOOKMARK_GROUP_ROOT_KEY] || '书签';
  bookmarkGroupRenames = Array.isArray(stored[BOOKMARK_GROUP_RENAMES_KEY])
    ? stored[BOOKMARK_GROUP_RENAMES_KEY].filter((rule) =>
      Array.isArray(rule?.from) && rule.from.length &&
      Array.isArray(rule?.to) && rule.to.length)
    : [];
}

function checkForUpdates() {
  elements.updateDot.className = 'update-dot is-loading';
  elements.updateStateText.textContent = '检查版本…';
  chrome.runtime.sendMessage({ action: 'getUpdateInfo' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      elements.updateDot.className = 'update-dot has-error';
      elements.updateStateText.textContent = '版本检查失败';
      return;
    }
    updateInfo = response;
    elements.updateDot.className = `update-dot ${response.updateAvailable ? 'has-update' : 'is-current'}`;
    elements.updateStateText.textContent = response.updateAvailable
      ? `发现 v${response.latestVersion}`
      : `v${response.currentVersion} 已是最新`;
  });
}

elements.filterInput.addEventListener('input', renderSites);
elements.selectAllSites.addEventListener('change', () => {
  visibleSites().forEach((site) => {
    if (elements.selectAllSites.checked) selectedSiteIds.add(site.id);
    else selectedSiteIds.delete(site.id);
  });
  renderSites();
});
elements.clearSiteSelectionButton.addEventListener('click', () => {
  selectedSiteIds.clear();
  renderSites();
});
elements.deleteSelectedSitesButton.addEventListener('click', deleteSelectedSites);
elements.keywordEditor.addEventListener('click', () => elements.siteKeywords.focus());
elements.siteKeywords.addEventListener('focus', renderKeywordSuggestions);
elements.siteKeywords.addEventListener('input', () => {
  if (!elements.siteKeywords.matches(':focus')) return;
  const value = elements.siteKeywords.value;
  if (/[,，、;；]/.test(value)) commitKeywordDraft();
  else renderKeywordSuggestions();
});
elements.siteKeywords.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitKeywordDraft();
  } else if (event.key === 'Backspace' && !elements.siteKeywords.value && editorKeywords.length) {
    removeEditorKeyword(editorKeywords.length - 1);
  } else if (event.key === 'Escape') {
    if (!elements.keywordSuggestions.hidden) event.stopPropagation();
    elements.keywordSuggestions.hidden = true;
    elements.siteKeywords.setAttribute('aria-expanded', 'false');
  }
});
elements.siteKeywords.addEventListener('blur', () => {
  window.setTimeout(() => {
    elements.keywordSuggestions.hidden = true;
    elements.siteKeywords.setAttribute('aria-expanded', 'false');
  }, 100);
});
elements.closeEditorButton.addEventListener('click', closeEditor);
elements.cancelEditorButton.addEventListener('click', closeEditor);
elements.importBookmarksButton.addEventListener('click', openBookmarkImporter);
elements.closeBookmarkButton.addEventListener('click', closeBookmarkImporter);
elements.cancelBookmarkButton.addEventListener('click', closeBookmarkImporter);
elements.bookmarkFilterInput.addEventListener('input', renderBookmarks);
elements.selectAllBookmarks.addEventListener('change', () => {
  visibleBookmarks().forEach((item) => {
    if (elements.selectAllBookmarks.checked) selectedBookmarkIds.add(item.id);
    else selectedBookmarkIds.delete(item.id);
  });
  bookmarkFoldersInNodes(visibleBookmarkTree(), []).forEach((folder) => {
    if (elements.selectAllBookmarks.checked) selectedBookmarkFolderIds.add(String(folder.id));
    else selectedBookmarkFolderIds.delete(String(folder.id));
  });
  renderBookmarks();
});
elements.confirmBookmarkButton.addEventListener('click', importSelectedBookmarks);
elements.repositoryButton.addEventListener('click', () => chrome.tabs.create({ url: REPOSITORY_URL }));
elements.shortcutButton.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
elements.updateStateButton.addEventListener('click', () => {
  if (updateInfo?.updateAvailable) chrome.tabs.create({ url: REPOSITORY_URL });
  else checkForUpdates();
});
elements.siteDiscoveryEnabled.addEventListener('change', async () => {
  await chrome.storage.local.set({
    [XJTUSiteData.DISCOVERY_ENABLED_KEY]: elements.siteDiscoveryEnabled.checked
  });
  showToast(elements.siteDiscoveryEnabled.checked ? '新网站提示已启用' : '新网站提示已关闭');
});
elements.clearIgnoredHostsButton.addEventListener('click', async () => {
  await chrome.storage.local.remove(XJTUSiteData.DISCOVERY_IGNORED_HOSTS_KEY);
  await chrome.storage.session.remove(XJTUSiteData.DISCOVERY_SESSION_DISMISSED_KEY);
  await loadDiscoverySettings();
  showToast('已恢复所有网站的添加提示');
});
elements.editorLayer.addEventListener('click', (event) => {
  if (event.target === elements.editorLayer) closeEditor();
});
elements.bookmarkLayer.addEventListener('click', (event) => {
  if (event.target === elements.bookmarkLayer) closeBookmarkImporter();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!elements.editorLayer.hidden) closeEditor();
  if (!elements.bookmarkLayer.hidden) closeBookmarkImporter();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[XJTUSiteData.STORAGE_KEY]) return;
  XJTUSiteData.getSites().then(async (loadedSites) => {
    sites = loadedSites;
    renderGroupTree();
    renderSites();
    await refreshBookmarkFolderStats();
  }).catch(() => {});
});

Promise.all([XJTUSiteData.getSites(), loadShortcut(), loadDiscoverySettings(), loadGroupSettings()])
  .then(async ([loadedSites]) => {
    await cleanLegacyBookmarkFolderKeywords(loadedSites);
    sites = loadedSites;
    renderGroupTree();
    renderSites();
    await refreshBookmarkFolderStats();
    openRequestedSiteEditor();
  })
  .catch((error) => showToast(`设置加载失败：${error.message}`));
checkForUpdates();
