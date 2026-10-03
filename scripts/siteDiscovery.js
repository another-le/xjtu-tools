(() => {
  if (window.top !== window) return;

  const { NAVIGATOR_ENABLED_KEY, DISCOVERY_ENABLED_KEY, DISCOVERY_IGNORED_HOSTS_KEY } = XJTUSiteData;
  const hostname = location.hostname.toLocaleLowerCase('en-US');
  if (hostname !== 'xjtu.edu.cn' && !hostname.endsWith('.xjtu.edu.cn')) return;
  if (hostname === 'login.xjtu.edu.cn') {
    chrome.runtime.sendMessage({ action: 'clearSiteDiscoveryCandidate' });
    return;
  }

  function pageName() {
    const title = document.title.replace(/[\s_-]*(西安交通大学|XJTU).*$/i, '').trim();
    return (title || hostname).slice(0, 40);
  }

  async function shouldNotify() {
    const [preferences, sessionState, sites] = await Promise.all([
      chrome.storage.local.get([NAVIGATOR_ENABLED_KEY, DISCOVERY_ENABLED_KEY, DISCOVERY_IGNORED_HOSTS_KEY]),
      chrome.runtime.sendMessage({ action: 'getSiteDiscoverySessionDismissed', hostname }),
      XJTUSiteData.getSites()
    ]);
    if (preferences[NAVIGATOR_ENABLED_KEY] === false || preferences[DISCOVERY_ENABLED_KEY] === false) return false;
    if ((preferences[DISCOVERY_IGNORED_HOSTS_KEY] || []).includes(hostname)) return false;
    if (sessionState?.dismissed) return false;
    return !sites.some((site) => {
      try { return new URL(site.url).hostname.toLocaleLowerCase('en-US') === hostname; }
      catch (_error) { return false; }
    });
  }

  shouldNotify()
    .then((notify) => {
      if (!notify) return;
      chrome.runtime.sendMessage({
        action: 'siteDiscoveryCandidate',
        candidate: {
          hostname,
          name: pageName(),
          url: XJTUSiteData.canonicalUrlKey(location.href),
          suggestedKeywords: XJTUSiteData.bookmarkTitleKeywords(pageName()).join('，')
        }
      });
    })
    .catch((error) => console.warn('[Site Discovery] 检查新网站失败:', error));
})();
