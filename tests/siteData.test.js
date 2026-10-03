const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const storageState = {};
const context = vm.createContext({
  URL,
  console,
  chrome: {
    runtime: {
      getURL: (value) => `chrome-extension://test${value}`
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(
          keys.filter((key) => Object.hasOwn(storageState, key)).map((key) => [key, storageState[key]])
        ),
        set: async (values) => Object.assign(storageState, values)
      }
    }
  }
});

vm.runInContext(
  fs.readFileSync(path.join(root, 'scripts/vendor/text-search-engine-1.5.2.min.js'), 'utf8'),
  context
);
vm.runInContext(fs.readFileSync(path.join(root, 'scripts/siteData.js'), 'utf8'), context);

const siteData = context.XJTUSiteData;
assert.equal(siteData.DEFAULT_SITES, undefined);
assert.equal(siteData.cloneDefaults, undefined);
assert.equal(
  JSON.stringify(siteData.bookmarkGroupPath(['书签栏', '学习', '大一'])),
  '["书签","学习","大一"]'
);

assert.deepEqual(
  Array.from(siteData.bookmarkTitleKeywords('我的课程 - 在线学习平台')),
  ['课程', '在线学习', '学习']
);

const bookmarkSites = [{
  id: 'bookmark-grades',
  name: '成绩查询',
  url: 'https://ehall.xjtu.edu.cn/jwapp/sys/cjcx/index.do',
  description: '',
  keywords: ['成绩', 'cj', 'cjcx'],
  createdAt: 1
}, {
  id: 'bookmark-lms',
  name: '思源学习空间',
  url: 'https://lms.xjtu.edu.cn/',
  description: '',
  keywords: ['思源学习', 'syxx'],
  createdAt: 2
}];

assert.equal(siteData.rankSites(bookmarkSites, 'cj')[0].id, 'bookmark-grades');
assert.equal(siteData.rankSites(bookmarkSites, 'chengji')[0].id, 'bookmark-grades');
assert.equal(siteData.rankSites(bookmarkSites, 'cjcx')[0].id, 'bookmark-grades');
assert.equal(siteData.rankSites(bookmarkSites, 'syxx')[0].id, 'bookmark-lms');
assert.equal(siteData.rankSites(bookmarkSites, 'siyuanxuexi')[0].id, 'bookmark-lms');
assert.deepEqual(
  Array.from(siteData.rankSites(bookmarkSites, 'cj'), (site) => site.id),
  ['bookmark-grades']
);

const bankSite = [{
  id: 'bank',
  name: '银行服务',
  url: 'https://bank.example.com/',
  description: '',
  keywords: [],
  createdAt: 1
}];
assert.equal(siteData.rankSites(bankSite, 'yinhang')[0].id, 'bank');

const domainSite = [{
  id: 'domain',
  name: '校园入口',
  url: 'https://service.xjtu.edu.cn/path',
  description: '',
  keywords: [],
  createdAt: 1
}];
assert.equal(siteData.rankSites(domainSite, 'service')[0].id, 'domain');

const folderSites = [
  {
    id: 'folder-course-a',
    name: '大学物理资料',
    url: 'https://example.com/physics',
    description: '',
    keywords: [],
    groupPaths: [['书签', '课程资料']],
    createdAt: 1
  },
  {
    id: 'folder-course-b',
    name: '高等数学资料',
    url: 'https://example.com/math',
    description: '',
    keywords: [],
    groupPaths: [['书签', '课程资料', '大一']],
    createdAt: 2
  },
  {
    id: 'folder-other',
    name: '校园新闻',
    url: 'https://example.com/news',
    description: '',
    keywords: [],
    groupPaths: [['书签', '校园生活']],
    createdAt: 3
  }
];
assert.deepEqual(
  Array.from(siteData.rankSites(folderSites, '课程资料'), (site) => site.id).sort(),
  ['folder-course-a', 'folder-course-b']
);

(async () => {
  assert.equal(JSON.stringify(await siteData.getSites()), '[]');

  Object.keys(storageState).forEach((key) => delete storageState[key]);
  storageState[siteData.STORAGE_KEY] = [{
    id: 'legacy-builtin',
    name: '旧内置网站',
    url: 'https://old.example.com/',
    keywords: [],
    builtin: true
  }, {
    id: 'legacy-manual',
    name: '旧版手工网站',
    url: 'https://manual.example.com/',
    keywords: ['手工'],
    builtin: false
  }, {
    id: 'legacy-bookmark-without-id',
    name: '旧版书签网站',
    url: 'https://legacy-saved.example.com/',
    description: '来自书签：书签栏 / 西交网站',
    keywords: ['旧书签'],
    builtin: false
  }, {
    id: 'legacy-bookmarked-builtin',
    name: '已经收藏的网站',
    url: 'https://saved.example.com/',
    keywords: ['收藏'],
    builtin: true,
    importedFromBookmarks: true,
    sourceBookmarkIds: ['1'],
    bookmarkSources: [{ id: '1', groupPath: ['书签', '西交网站'] }],
    groupPaths: [['内置网站'], ['书签', '西交网站']]
  }];
  const migrated = await siteData.getSites();
  assert.equal(migrated.length, 2);
  const migratedBuiltin = migrated.find((site) => site.id === 'legacy-bookmarked-builtin');
  assert.equal(migratedBuiltin.builtin, false);
  assert.equal(JSON.stringify(migratedBuiltin.groupPaths), '[["书签","西交网站"]]');
  assert.ok(migrated.some((site) => site.id === 'legacy-bookmark-without-id'));
  await siteData.saveSites([...migrated, {
    id: 'attempted-manual-entry',
    name: '绕过书签的网站',
    url: 'https://manual.example.com/',
    keywords: ['手工']
  }]);
  assert.equal(storageState[siteData.STORAGE_KEY].length, 2);
  console.log('siteData tests ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
