(() => {
  const STORAGE_KEY = 'siteNavigatorEntriesV1';
  const NAVIGATOR_ENABLED_KEY = 'siteNavigatorEnabledV1';
  const DISCOVERY_ENABLED_KEY = 'siteDiscoveryEnabledV1';
  const DISCOVERY_IGNORED_HOSTS_KEY = 'siteDiscoveryIgnoredHostsV1';
  const DISCOVERY_SESSION_DISMISSED_KEY = 'siteDiscoverySessionDismissedV1';
  const RANKING_MIGRATION_KEY = 'siteNavigatorFrecencyMigrationV1';
  const SEARCH_CHANNEL_MIGRATION_KEY = 'siteNavigatorSearchChannelsV2';
  const GROUP_PATH_MIGRATION_KEY = 'siteNavigatorGroupPathsV1';
  const BOOKMARK_ONLY_MIGRATION_KEY = 'siteNavigatorBookmarkOnlyV1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const VISIT_HISTORY_LIMIT = 32;
  const QUERY_HISTORY_LIMIT = 24;
  const FUZZY_MAPPING_CACHE_LIMIT = 512;
  const fuzzyMappingCache = new Map();
  const PINYIN_SOURCE_FALLBACKS = new Map([
    ['行', 'hang']
  ]);

  function parseKeywords(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
    const seen = new Set();
    return source
      .map((keyword) => String(keyword || '').trim().replace(/\s+/g, ' '))
      .filter((keyword) => {
        const normalized = keyword.toLocaleLowerCase('zh-CN');
        if (!keyword || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
  }

  function normalizeGroupPath(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((part) => String(part || '').trim().replace(/[\\/]+/g, ''))
      .filter(Boolean)
      .slice(0, 8);
  }

  function bookmarkGroupPath(folders = []) {
    const browserRootFolders = new Set([
      '书签栏', '其他书签', '移动设备书签',
      'Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'
    ]);
    return ['书签', ...normalizeGroupPath(folders).filter((folder) => !browserRootFolders.has(folder))];
  }

  function bookmarkTitleKeywords(value) {
    const title = String(value || '').normalize('NFKC').trim();
    if (!title) return [];
    const concepts = [
      '成绩', '绩点', '课程', '选课', '退课', '课表', '考试', '评教', '作业', '课件',
      '学习', '直播', '教务', '图书', '文献', '论文', '邮箱', '办事', '申请', '审批',
      '证明', '缴费', '预约', '通知', '校历', '就业', '招聘', '科研', '宿舍', '校园', '管理'
    ];
    const noiseOnly = new Set(['我的', '个人', '首页', '主页', '官网', '网站', '平台', '系统', '门户', '中心']);
    const candidates = [];
    const add = (rawKeyword) => {
      const keyword = String(rawKeyword || '').replace(/\s+/g, ' ').trim();
      if (!keyword || noiseOnly.has(keyword) || !/[\p{L}\p{N}]/u.test(keyword)) return;
      if (keyword.length > 32) return;
      if (!candidates.some((item) => item.toLocaleLowerCase('zh-CN') === keyword.toLocaleLowerCase('zh-CN'))) {
        candidates.push(keyword);
      }
    };

    title.split(/[|｜/\\\-–—_:：·•]+/).forEach((part) => {
      part.trim().split(/\s+/).forEach((segment) => {
        if (!segment) return;
        const concise = segment
          .replace(/^(?:西安交通大学|西交|XJTU|我的|个人|用户)\s*/iu, '')
          .replace(/\s*(?:官方网站|官网|首页|主页|网站|平台|系统|门户|中心)$/u, '')
          .trim();
        add(concise);
      });
    });
    concepts.forEach((concept) => {
      if (title.includes(concept)) add(concept);
    });
    return candidates.slice(0, 8);
  }

  function faviconUrl(pageUrl, size = 32) {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.href;
  }

  function canonicalUrlKey(value) {
    try {
      const url = new URL(value);
      url.hash = '';
      [...url.searchParams.keys()].forEach((key) => {
        const normalized = key.toLocaleLowerCase('en-US');
        if (
          normalized.startsWith('utm_') ||
          ['fbclid', 'gclid', 'spm', 'token', 'access_token', 'ticket', 'code', 'state', 'session', 'sessionid', 'auth'].includes(normalized)
        ) {
          url.searchParams.delete(key);
        }
      });
      url.searchParams.sort();
      if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
      return url.href;
    } catch (_error) {
      return String(value || '').trim();
    }
  }

  function isBookmarkBackedSite(site) {
    return Boolean(
      site?.importedFromBookmarks ||
      site?.sourceBookmarkIds?.length ||
      site?.bookmarkSources?.length ||
      site?.description?.startsWith('来自书签：') ||
      site?.description === '来自浏览器书签'
    );
  }

  async function getSites() {
    const stored = await chrome.storage.local.get([
      STORAGE_KEY,
      RANKING_MIGRATION_KEY,
      SEARCH_CHANNEL_MIGRATION_KEY,
      GROUP_PATH_MIGRATION_KEY,
      BOOKMARK_ONLY_MIGRATION_KEY
    ]);
    if (Array.isArray(stored[STORAGE_KEY])) {
      let sites = stored[STORAGE_KEY];
      let changed = false;
      if (!stored[RANKING_MIGRATION_KEY]) {
        sites.forEach((site) => {
          delete site.pinned;
        });
        changed = true;
      }
      if (!stored[SEARCH_CHANNEL_MIGRATION_KEY]) {
        sites.forEach((site) => {
          const imported = site.importedFromBookmarks || site.sourceBookmarkIds?.length ||
            site.description?.startsWith('来自书签：') || site.description === '来自浏览器书签';
          if (!imported && !site.builtin) return;
          try {
            const hostname = new URL(site.url).hostname.toLocaleLowerCase('en-US');
            const generatedDomainKeywords = new Set([
              hostname,
              hostname.split('.')[0]
            ]);
            const previous = site.keywords || [];
            const next = previous.filter((keyword) => !generatedDomainKeywords.has(keyword.toLocaleLowerCase('en-US')));
            if (next.length !== previous.length) {
              site.keywords = next;
              changed = true;
            }
          } catch (_error) {
            // 忽略历史数据中的无效网址。
          }
        });
      }
      if (!stored[GROUP_PATH_MIGRATION_KEY]) {
        sites.forEach((site) => {
          const existingPaths = Array.isArray(site.groupPaths)
            ? site.groupPaths.map(normalizeGroupPath).filter((path) => path.length)
            : [];
          if (existingPaths.length) {
            site.groupPaths = existingPaths;
            return;
          }
          if (
            site.importedFromBookmarks ||
            site.sourceBookmarkIds?.length ||
            site.description?.startsWith('来自书签：') ||
            site.description === '来自浏览器书签'
          ) {
            const folderText = site.description?.startsWith('来自书签：')
              ? site.description.slice('来自书签：'.length)
              : '';
            const folders = folderText ? folderText.split('/').map((folder) => folder.trim()) : [];
            site.groupPaths = [bookmarkGroupPath(folders)];
          } else {
            site.groupPaths = [];
          }
          changed = true;
        });
      }
      if (
        !stored[BOOKMARK_ONLY_MIGRATION_KEY] ||
        sites.some((site) => site.builtin || !isBookmarkBackedSite(site))
      ) {
        sites = sites.flatMap((site) => {
          if (!isBookmarkBackedSite(site)) return [];
          if (!site.builtin) return [site];
          const sourcePaths = (site.bookmarkSources || [])
            .map((source) => normalizeGroupPath(source.groupPath))
            .filter((path) => path.length);
          const groupPaths = [...(site.groupPaths || []), ...sourcePaths]
            .map(normalizeGroupPath)
            .filter((path) => path.length && path[0] !== '内置网站');
          return [{
            ...site,
            builtin: false,
            importedFromBookmarks: true,
            bookmarkOnly: true,
            groupPaths: groupPaths.filter((path, index) =>
              groupPaths.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) === index)
          }];
        });
        changed = true;
      }
      if (
        changed ||
        !stored[RANKING_MIGRATION_KEY] ||
        !stored[SEARCH_CHANNEL_MIGRATION_KEY] ||
        !stored[GROUP_PATH_MIGRATION_KEY] ||
        !stored[BOOKMARK_ONLY_MIGRATION_KEY]
      ) {
        await chrome.storage.local.set({
          [STORAGE_KEY]: sites,
          [RANKING_MIGRATION_KEY]: true,
          [SEARCH_CHANNEL_MIGRATION_KEY]: true,
          [GROUP_PATH_MIGRATION_KEY]: true,
          [BOOKMARK_ONLY_MIGRATION_KEY]: true
        });
      }
      return sites;
    }

    const defaults = [];
    await chrome.storage.local.set({
      [STORAGE_KEY]: defaults,
      [RANKING_MIGRATION_KEY]: true,
      [SEARCH_CHANNEL_MIGRATION_KEY]: true,
      [GROUP_PATH_MIGRATION_KEY]: true,
      [BOOKMARK_ONLY_MIGRATION_KEY]: true
    });
    return defaults;
  }

  async function saveSites(sites) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: sites.filter(isBookmarkBackedSite)
    });
  }

  function normalizedSearchQuery(rawQuery) {
    return String(rawQuery || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('zh-CN');
  }

  function fuzzyEngine() {
    return globalThis._TEXT_SEARCH_ENGINE_ || null;
  }

  function fuzzyBoundaryMapping(source) {
    const engine = fuzzyEngine();
    if (!engine) return null;
    if (fuzzyMappingCache.has(source)) return fuzzyMappingCache.get(source);
    const mapping = engine.extractBoundaryMapping(source);
    fuzzyMappingCache.set(source, mapping);
    if (fuzzyMappingCache.size > FUZZY_MAPPING_CACHE_LIMIT) {
      fuzzyMappingCache.delete(fuzzyMappingCache.keys().next().value);
    }
    return mapping;
  }

  function fuzzySourceVariants(source) {
    const variants = [source];
    PINYIN_SOURCE_FALLBACKS.forEach((pinyin, character) => {
      if (source.includes(character)) variants.push(source.replaceAll(character, pinyin));
    });
    return variants;
  }

  function fuzzyMatchQuality(source, query) {
    const engine = fuzzyEngine();
    if (!engine || !source || query.length < 2 || !/[a-z]/i.test(query)) return 0;

    for (const variant of fuzzySourceVariants(source)) {
      const mapping = fuzzyBoundaryMapping(variant);
      const ranges = engine.searchSentenceByBoundaryMapping(mapping, query).hitRanges;
      if (!ranges?.length) continue;
      const first = ranges[0][0];
      const last = ranges[ranges.length - 1][1];
      const span = Math.max(1, last - first + 1);
      const hitLength = ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
      const compactness = Math.min(1, hitLength / span);
      const continuity = 1 / ranges.length;
      const startBonus = 1 / (1 + first * 0.2);
      return 0.55 + compactness * 0.25 + continuity * 0.15 + startBonus * 0.05;
    }
    return 0;
  }

  function decayScore(timestamp, halfLifeDays, now) {
    const time = Number(timestamp);
    if (!Number.isFinite(time) || time <= 0) return 0;
    const age = Math.max(0, now - time);
    return Math.pow(0.5, age / (halfLifeDays * DAY_MS));
  }

  function frecencyScore(site, now = Date.now()) {
    const history = Array.isArray(site.visitHistory)
      ? site.visitHistory.filter((timestamp) => Number.isFinite(Number(timestamp))).slice(-VISIT_HISTORY_LIMIT)
      : [];
    const decayedVisits = history.length
      ? history.reduce((sum, timestamp) => sum + 8 * decayScore(timestamp, 21, now), 0)
      : 8 * decayScore(site.lastUsedAt, 21, now);
    const frequency = Math.log1p(Math.max(0, Number(site.usageCount) || 0)) * 3.5;
    const recentUse = 4 * decayScore(site.lastUsedAt, 7, now);
    return decayedVisits + frequency + recentUse;
  }

  function queryAffinityScore(site, normalizedQuery, now) {
    if (!normalizedQuery || !site.queryHistory || typeof site.queryHistory !== 'object') return 0;
    const queryTokens = new Set(normalizedQuery.split(/\s+/).filter(Boolean));
    let score = 0;

    Object.entries(site.queryHistory).forEach(([storedQuery, usage]) => {
      if (!usage || typeof usage !== 'object') return;
      let similarity = 0;
      if (storedQuery === normalizedQuery) similarity = 1;
      else if (storedQuery.includes(normalizedQuery)) similarity = 0.58;
      else {
        const storedTokens = storedQuery.split(/\s+/).filter(Boolean);
        const overlap = storedTokens.filter((token) => queryTokens.has(token)).length;
        if (overlap) similarity = 0.32 * overlap / Math.max(storedTokens.length, queryTokens.size);
      }
      if (!similarity) return;
      const count = Math.max(0, Number(usage.count) || 0);
      const recency = decayScore(usage.lastUsedAt, 30, now);
      score += similarity * (Math.log1p(count) * 8 + recency * 12);
    });

    return Math.min(score, 38);
  }

  function rankSites(sites, rawQuery) {
    const query = String(rawQuery || '').trim().toLocaleLowerCase('zh-CN');
    const now = Date.now();
    if (!query) {
      return [...sites].sort((a, b) =>
        frecencyScore(b, now) - frecencyScore(a, now) ||
        (b.lastUsedAt || 0) - (a.lastUsedAt || 0) ||
        (b.usageCount || 0) - (a.usageCount || 0) ||
        (a.createdAt || 0) - (b.createdAt || 0)
      );
    }

    const normalizedQuery = normalizedSearchQuery(query);
    const tokens = [...new Set([normalizedQuery, ...normalizedQuery.split(/\s+/)].filter(Boolean))];

    return sites
      .map((site) => {
        const name = site.name.toLocaleLowerCase('zh-CN');
        const description = (site.description || '').toLocaleLowerCase('zh-CN');
        const keywords = (site.keywords || []).map((item) => item.toLocaleLowerCase('zh-CN'));
        const folderNames = [...new Set((site.groupPaths || [])
          .flatMap((path) => Array.isArray(path) ? path : [])
          .map((item) => String(item || '').trim().toLocaleLowerCase('zh-CN'))
          .filter(Boolean))];
        let url;
        try { url = new URL(site.url); }
        catch (_error) { url = null; }
        const hostname = url?.hostname.toLocaleLowerCase('zh-CN') || '';
        const urlText = url?.href.toLocaleLowerCase('zh-CN') || '';
        let score = 0;

        tokens.forEach((token) => {
          let nameScore = 0;
          if (name === token) nameScore = 120;
          else if (name.startsWith(token)) nameScore = 70;
          else if (name.includes(token)) nameScore = 48;

          const keywordScore = keywords.reduce((best, keyword) => {
            if (keyword === token) return Math.max(best, 100);
            if (keyword.startsWith(token)) return Math.max(best, 62);
            if (keyword.includes(token)) return Math.max(best, 38);
            return best;
          }, 0);

          const folderScore = folderNames.reduce((best, folderName) => {
            if (folderName === token) return Math.max(best, 54);
            if (folderName.startsWith(token)) return Math.max(best, 36);
            if (folderName.includes(token)) return Math.max(best, 24);
            return best;
          }, 0);

          let urlScore = 0;
          if (urlText === token) urlScore = 76;
          else if (hostname === token) urlScore = 68;
          else if (hostname.split('.').includes(token)) urlScore = 56;
          else if (hostname.startsWith(token)) urlScore = 46;
          else if (hostname.includes(token)) urlScore = 34;
          else if (token.length >= 4 && urlText.includes(token)) urlScore = 18;
          const descriptionScore = description.includes(token) ? 22 : 0;
          const directScore = nameScore + keywordScore + folderScore + urlScore + descriptionScore;
          score += directScore;

          if (directScore === 0) {
            const nameFuzzyScore = fuzzyMatchQuality(name, token) * 64;
            const keywordFuzzyScore = keywords.reduce((best, keyword) =>
              Math.max(best, fuzzyMatchQuality(keyword, token) * 58), 0);
            const folderFuzzyScore = folderNames.reduce((best, folderName) =>
              Math.max(best, fuzzyMatchQuality(folderName, token) * 48), 0);
            const fuzzyScore = Math.max(nameFuzzyScore, keywordFuzzyScore, folderFuzzyScore);
            if (fuzzyScore >= 50) score += fuzzyScore;
          }
        });

        if (score > 0) {
          const behaviorScore = Math.min(frecencyScore(site, now) * 0.55, 24);
          score += behaviorScore + queryAffinityScore(site, normalizedQuery, now);
        }
        return { site, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.site.lastUsedAt || 0) - (a.site.lastUsedAt || 0))
      .map((item) => item.site);
  }

  async function recordSiteUse(siteId, rawQuery = '') {
    const sites = await getSites();
    const target = sites.find((site) => site.id === siteId);
    if (!target) return;
    const now = Date.now();
    target.usageCount = (target.usageCount || 0) + 1;
    target.lastUsedAt = now;
    target.visitHistory = [
      ...(Array.isArray(target.visitHistory) ? target.visitHistory : []),
      now
    ].slice(-VISIT_HISTORY_LIMIT);

    const normalizedQuery = normalizedSearchQuery(rawQuery);
    if (normalizedQuery) {
      const queryHistory = target.queryHistory && typeof target.queryHistory === 'object'
        ? { ...target.queryHistory }
        : {};
      const previous = queryHistory[normalizedQuery] || {};
      queryHistory[normalizedQuery] = {
        count: (Number(previous.count) || 0) + 1,
        lastUsedAt: now
      };
      target.queryHistory = Object.fromEntries(Object.entries(queryHistory)
        .sort(([, a], [, b]) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0))
        .slice(0, QUERY_HISTORY_LIMIT));
    }
    await saveSites(sites);
  }

  globalThis.XJTUSiteData = {
    STORAGE_KEY,
    NAVIGATOR_ENABLED_KEY,
    DISCOVERY_ENABLED_KEY,
    DISCOVERY_IGNORED_HOSTS_KEY,
    DISCOVERY_SESSION_DISMISSED_KEY,
    canonicalUrlKey,
    bookmarkTitleKeywords,
    bookmarkGroupPath,
    frecencyScore,
    faviconUrl,
    getSites,
    parseKeywords,
    rankSites,
    recordSiteUse,
    saveSites
  };
})();
