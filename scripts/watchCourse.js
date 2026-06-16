console.log('[选课盯盘] 🟢 脚本已加载(', new Date().toLocaleTimeString(), ')');

/**
 * watchCourse.js — 选课盯盘功能
 *
 * 工作方式：
 *   1. 课程行旁加 "盯住" 按钮，教学班卡片旁加小眼睛 👁️
 *   2. 点击后先查当前余量，有余量则提示，满了才加入盯盘
 *   3. 后台按 API 路径分组查询，发现余量从 0→>0 时通知
 *   4. 关闭页面前弹窗确认
 */

const CONFIG = {
  BASE_URL: 'https://xkfw.xjtu.edu.cn',
  CHECK_INTERVAL: 30000,
  // tab 类型 → API 路径（从 xsxkpub.js 源码确认）
  API_MAP: {
    TJKC:  '/xsxkapp/sys/xsxkapp/elective/recommendedCourse.do',
    FANKC: '/xsxkapp/sys/xsxkapp/elective/programCourse.do',
    FAWKC: '/xsxkapp/sys/xsxkapp/elective/programCourse.do',
    XGXK:  '/xsxkapp/sys/xsxkapp/elective/publicCourse.do',
    SYKC:  '/xsxkapp/sys/xsxkapp/elective/testCourse.do',
  },
  DEFAULT_API: '/xsxkapp/sys/xsxkapp/elective/recommendedCourse.do',
};

// ======================== 状态 ========================
let watchedCourses = [];
let checkTimer = null;
let watchPanel = null;
let watchPanelVisible = false;
let removedStack = [];

// ======================== 日志 ========================
function log(...args) { console.log('[选课盯盘]', ...args); }
function warn(...args) { console.warn('[选课盯盘]', ...args); }
function error(...args) { console.error('[选课盯盘]', ...args); }

// ======================== 工具 ========================
function getToken() {
  try { return sessionStorage.getItem('token') || ''; } catch (e) { return ''; }
}

function saveToStorage() {
  return new Promise(r => chrome.storage.local.set({ watchedCourses }, r));
}
function loadFromStorage() {
  return new Promise(r => chrome.storage.local.get(['watchedCourses'], res => {
    watchedCourses = res.watchedCourses || []; r();
  }));
}
function saveRemovedStack() {
  return new Promise(r => chrome.storage.local.set({ removedStack }, r));
}
function loadRemovedStack() {
  return new Promise(r => chrome.storage.local.get(['removedStack'], res => {
    removedStack = res.removedStack || []; r();
  }));
}

// ======================== 参数 ========================
function getCourseParams() {
  const p = { studentCode: '', electiveBatchCode: '', campus: '1', isMajor: '1',
    teachingClassType: 'TJKC', checkConflict: '2', queryContent: '' };
  try {
    const stu = JSON.parse(sessionStorage.getItem('studentInfo') || '{}');
    if (stu.code) p.studentCode = stu.code;
    if (stu.campus) p.campus = stu.campus;
  } catch (e) {}
  try {
    const batch = JSON.parse(sessionStorage.getItem('currentBatch') || '{}');
    if (batch.code) p.electiveBatchCode = batch.code;
  } catch (e) {}
  const t = sessionStorage.getItem('teachingClassType');
  if (t) p.teachingClassType = t;
  return p;
}

function getCurrentApiPath() {
  const tab = document.querySelector('#cvPageHeadTab li.cv-active a');
  if (!tab) return CONFIG.DEFAULT_API;
  return CONFIG.API_MAP[tab.getAttribute('teachingclasstype')] || CONFIG.DEFAULT_API;
}

// ======================== API ========================
async function fetchCourses(apiPath) {
  const token = getToken();
  if (!token) { log('⚠️ 无 token'); return null; }

  const params = getCourseParams();
  const querySetting = JSON.stringify({
    data: {
      studentCode: params.studentCode, campus: params.campus,
      electiveBatchCode: params.electiveBatchCode, isMajor: params.isMajor,
      teachingClassType: params.teachingClassType, checkConflict: params.checkConflict,
      queryContent: params.queryContent
    },
    pageSize: '100', pageNumber: '0', order: ''
  });
  const body = new URLSearchParams({ querySetting }).toString();
  const path = apiPath || CONFIG.DEFAULT_API;
  const url = CONFIG.BASE_URL + path;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'token': token,
        'Referer': location.href
      },
      body
    });
    if (!resp.ok) { warn('HTTP', resp.status); return null; }
    const text = await resp.text();
    if (!text || text.trim().startsWith('<')) { warn('返回 HTML'); return null; }
    return JSON.parse(text);
  } catch (err) { error(err.message); return null; }
}

function parseCourseList(apiData) {
  if (!apiData) return [];
  if (Array.isArray(apiData)) return apiData;
  if (apiData.dataList) return apiData.dataList;
  if (apiData.data?.list) return apiData.data.list;
  if (apiData.rows) return apiData.rows;
  if (apiData.datas) return apiData.datas;
  return [];
}

function getCourseNumber(item) {
  return item.courseNumber || item.kch || item.courseNum || '';
}

function getCourseAvailability(item) {
  // 情况1：有 tcList（如推荐课程）
  if (item.tcList && Array.isArray(item.tcList) && item.tcList.length > 0) {
    let totalCap = 0, totalSel = 0;
    const classes = item.tcList.map((tc) => {
      const cap = parseInt(tc.classCapacity || 0);
      const sel = parseInt(tc.numberOfSelected || 0);
      const fv = parseInt(tc.numberOfFirstVolunteer || 0);
      totalCap += cap; totalSel += sel;
      return {
        teachingClassID: tc.teachingClassID, teacher: tc.teacherName || '',
        capacity: cap, selected: sel, firstVol: fv,
        isFull: tc.isFull === '1', available: Math.max(0, cap - sel)
      };
    });
    return { available: Math.max(0, totalCap - totalSel), tcList: classes };
  }

  // 情况2：没有 tcList，但自身就是教学班（如基础通识类平铺结构）
  const cap = parseInt(item.classCapacity || 0);
  const sel = parseInt(item.numberOfSelected || 0);
  if (cap > 0) {
    return {
      available: Math.max(0, cap - sel),
      tcList: [{
        teachingClassID: item.teachingClassID || '',
        teacher: item.teacherName || '',
        capacity: cap, selected: sel,
        firstVol: parseInt(item.numberOfFirstVolunteer || 0),
        isFull: item.isFull === '1', available: Math.max(0, cap - sel)
      }]
    };
  }

  return { available: 0, tcList: [] };
}

// ======================== 盯盘检查 ========================
async function checkWatchedCourses() {
  if (watchedCourses.length === 0) {
    log('⏹️ 盯盘列表为空');
    stopMonitoring();
    return;
  }

  log('🔍 检查 ' + watchedCourses.length + ' 门盯住课程...');

  // 按 API 路径分组
  const groups = {};
  for (const c of watchedCourses) {
    const p = c.apiPath || CONFIG.DEFAULT_API;
    if (!groups[p]) groups[p] = [];
    groups[p].push(c);
  }

  let changes = [];

  for (const [apiPath, courses] of Object.entries(groups)) {
    const apiData = await fetchCourses(apiPath);
    const list = parseCourseList(apiData);
    if (list.length === 0) {
      log('⚠️ ' + apiPath + ' 无数据');
      continue;
    }

    for (const course of courses) {
      let found;
      if (course.type === 'teacher') {
        // 教师级：同时匹配课程号和教学班 ID（因为同一门课可能有多行）
        found = list.find(item =>
          getCourseNumber(item) === course.courseNumber &&
          (item.teachingClassID === course.teachingClassID ||
           (item.tcList && item.tcList.some(t => t.teachingClassID === course.teachingClassID)))
        );
      } else {
        found = list.find(item => getCourseNumber(item) === course.courseNumber);
      }
      if (!found) {
        log('  - ' + course.name + ': 未找到');
        continue;
      }

      let currentAvailable = 0;
      if (course.type === 'teacher') {
        // 先试 tcList 内查找
        let tc = found.tcList?.find(t => t.teachingClassID === course.teachingClassID);
        // 没找到则看 item 自身是不是就是那个教学班
        if (!tc && found.teachingClassID === course.teachingClassID) {
          tc = {
            classCapacity: found.classCapacity,
            numberOfSelected: found.numberOfSelected
          };
        }
        if (tc) currentAvailable = Math.max(0, parseInt(tc.classCapacity||0) - parseInt(tc.numberOfSelected||0));
        else { log('  - ' + course.name + ': 未找到教学班'); continue; }
      } else {
        currentAvailable = getCourseAvailability(found).available;
      }

      log('  - ' + course.name + ': 上次=' + course.lastAvailable + ' 当前=' + currentAvailable);

      if (currentAvailable !== course.lastAvailable) {
        if (course.lastAvailable === 0 && currentAvailable > 0) {
          changes.push({ courseNumber: course.courseNumber, name: course.name, available: currentAvailable });
          notifySpotFound(course, currentAvailable);
          // 发现余量后刷新页面，让用户看到最新数据
          setTimeout(() => location.reload(), 300);
        }
        course.lastAvailable = currentAvailable;
        course.lastChecked = Date.now();
      }
    }
  }

  await saveToStorage();
  if (changes.length > 0) log('🎉 ' + changes.length + ' 门课出现名额！');
}

// ======================== 通知 ========================
function notifySpotFound(course, available) {
  chrome.runtime.sendMessage({
    action: 'courseSpotFound',
    course: { courseNumber: course.courseNumber, name: course.name, available }
  });
}

// ======================== 监控启停 ========================
function startMonitoring() {
  if (checkTimer) return;
  log('▶️ 启动盯盘');
  checkWatchedCourses();
  checkTimer = setInterval(checkWatchedCourses, CONFIG.CHECK_INTERVAL);
}

function stopMonitoring() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; log('⏹️ 盯盘停止'); }
}

function isMonitoring() { return checkTimer !== null; }

// ======================== 按钮注入 ========================
function injectWatchButtons() {
  // 1. 课程级按钮
  document.querySelectorAll('#recommendBody .cv-row, #cvCanSelectProgramCourse .cv-row, ' +
    '#cvCanSelectUnProgramCourse .cv-row, #cvCanSelectPublicCourse .cv-row')
    .forEach(addButtonToRow);

  // 2. 教学班卡片教师级按钮
  document.querySelectorAll('[class*="course-card"]').forEach(addTeacherWatchBtn);

  // 3. 通识类平铺教师按钮
  document.querySelectorAll('#cvCanSelectPublicCourse .cv-row:not([data-wi])')
    .forEach(addPublicTeacherBtn);
}

function addButtonToRow(row) {
  if (row.querySelector('.watch-btn')) return;
  const num = row.getAttribute('coursenumber');
  const nameEl = row.querySelector('.cv-course');
  if (!num || !nameEl) return;

  const name = nameEl.textContent.trim();
  const watching = watchedCourses.some(c => c.courseNumber === num);

  const btn = document.createElement('span');
  btn.className = 'watch-btn';
  btn.textContent = watching ? '👁️盯住中' : '👁️盯住';
  btn.style.cssText = 'cursor:pointer;font-size:12px;margin-left:auto;margin-right:50px;' +
    'padding:1px 6px;border-radius:4px;border:1px solid ' + (watching ? '#047ADC' : '#ccc') + ';' +
    'background:' + (watching ? '#E8F4FD' : '#f5f5f5') + ';' +
    'color:' + (watching ? '#047ADC' : '#666') + ';user-select:none;white-space:nowrap;display:inline-block;line-height:1.8;';
  btn.dataset.watching = watching ? 'true' : 'false';
  btn.onmouseenter = () => { btn.style.borderColor = '#047ADC'; btn.style.color = '#047ADC'; };
  btn.onmouseleave = () => { if (btn.dataset.watching !== 'true') { btn.style.borderColor = '#ccc'; btn.style.color = '#666'; } };
  btn.onclick = async (e) => { e.stopPropagation(); await toggleWatch(btn, num, name); };

  nameEl.parentNode.appendChild(btn);
}

function addTeacherWatchBtn(card) {
  if (card.querySelector('.watch-btn-teacher')) return;
  const tcid = card.id ? card.id.replace('_courseDiv', '') : '';
  const tel = card.querySelector('.cv-info-title');
  const row = card.closest('[coursenumber]');
  if (!tcid || !tel || !row) return;

  const cnum = row.getAttribute('coursenumber');
  const cname = (row.querySelector('.cv-course')||{}).textContent || '';
  const tname = tel.title || tel.textContent.trim();
  const watching = watchedCourses.some(c => c.type === 'teacher' && c.teachingClassID === tcid);

  const eye = document.createElement('span');
  eye.className = 'watch-btn-teacher';
  eye.textContent = '👁️';
  eye.title = watching ? '已盯住 ' + tname : '盯住 ' + tname;
  eye.style.cssText = 'cursor:pointer;font-size:14px;margin-left:6px;' +
    'opacity:' + (watching ? '1' : '0.4') + ';transition:opacity .15s;display:inline-block;line-height:1;';
  eye.dataset.watching = watching ? 'true' : 'false';
  eye.onmouseenter = () => { eye.style.opacity = '1'; };
  eye.onmouseleave = () => { if (eye.dataset.watching !== 'true') eye.style.opacity = '0.4'; };
  eye.onclick = async (e) => { e.stopPropagation(); await toggleTeacherWatch(eye, tcid, cnum, cname, tname); };
  tel.parentNode.insertBefore(eye, tel.nextSibling);
}

function addPublicTeacherBtn(row) {
  if (row.dataset.wi) return;
  row.dataset.wi = '1';
  const tc = row.querySelector('.cv-teacher-col');
  const nc = row.querySelector('.cv-title-col');
  const sb = row.querySelector('.cv-setting-col .cv-choice');
  const dl = row.querySelector('.cv-detail');
  if (!tc || !nc || !sb) return;

  const tcid = sb.getAttribute('tcid');
  const cnum = (dl ? dl.getAttribute('data-num') : null) || sb.getAttribute('number');
  const cname = nc.textContent.trim();
  const tname = tc.textContent.trim();
  if (!tcid || !cnum) return;

  const watching = watchedCourses.some(c => c.type === 'teacher' && c.teachingClassID === tcid);
  const eye = document.createElement('span');
  eye.className = 'watch-btn-teacher';
  eye.textContent = '👁️';
  eye.title = watching ? '已盯住 ' + tname : '盯住 ' + tname;
  eye.style.cssText = 'cursor:pointer;font-size:13px;margin-left:4px;' +
    'opacity:' + (watching ? '1' : '0.35') + ';transition:opacity .15s;';
  eye.dataset.watching = watching ? 'true' : 'false';
  eye.onmouseenter = () => { eye.style.opacity = '1'; };
  eye.onmouseleave = () => { if (eye.dataset.watching !== 'true') eye.style.opacity = '0.35'; };
  eye.onclick = async (e) => { e.stopPropagation(); await toggleTeacherWatch(eye, tcid, cnum, cname, tname); };
  tc.appendChild(eye);
}

// ======================== 核心操作 ========================
async function toggleWatch(btn, courseNumber, courseName) {
  if (btn.dataset.watching === 'true') {
    watchedCourses = watchedCourses.filter(c => c.courseNumber !== courseNumber);
    await saveToStorage();
    btn.textContent = '👁️盯住'; btn.style.background = '#f5f5f5'; btn.style.borderColor = '#ccc'; btn.style.color = '#666';
    btn.dataset.watching = 'false';
    log('❌ 取消盯住: ' + courseName);
    refreshWatchPanel();
    if (watchedCourses.length === 0) stopMonitoring();
    return;
  }

  // 先查余量
  const apiData = await fetchCourses(getCurrentApiPath());
  const list = parseCourseList(apiData);
  const found = list.find(item => getCourseNumber(item) === courseNumber);

  if (found) {
    const { available, tcList } = getCourseAvailability(found);
    if (available > 0) {
      let msg = '「' + courseName + '」当前还有名额，无需盯盘 🟢';
      if (tcList && tcList.length > 1) {
        msg += '\n共 ' + tcList.length + ' 个班，有余位的班：';
        tcList.filter(t => t.available > 0).slice(0, 3).forEach(t => {
          msg += '\n  · ' + t.teacher + '（余 ' + t.available + '/' + t.capacity + '）';
        });
      } else {
        msg += '\n直接选课即可';
      }
      showTip(msg, 'info');
      return;
    }
  }

  watchedCourses.push({
    _id: Date.now() + Math.random().toString(36).slice(2,6),
    type: 'course', apiPath: getCurrentApiPath(),
    courseNumber, name: courseName, lastAvailable: 0,
    lastChecked: Date.now(), addedAt: Date.now()
  });
  await saveToStorage();
  btn.textContent = '👁️盯住中'; btn.style.background = '#E8F4FD'; btn.style.borderColor = '#047ADC'; btn.style.color = '#047ADC';
  btn.dataset.watching = 'true';
  log('✅ 开始盯住: ' + courseName);
  refreshWatchPanel();
  if (watchedCourses.length === 1) startMonitoring();
}

async function toggleTeacherWatch(btn, tcid, courseNumber, courseName, teacherName) {
  const label = courseName + ' - ' + teacherName;
  if (btn.dataset.watching === 'true') {
    watchedCourses = watchedCourses.filter(c => !(c.type === 'teacher' && c.teachingClassID === tcid));
    await saveToStorage();
    btn.dataset.watching = 'false'; btn.style.opacity = '0.4'; btn.title = '盯住 ' + teacherName;
    log('❌ 取消盯住教师: ' + label);
    refreshWatchPanel();
    if (watchedCourses.length === 0) stopMonitoring();
    return;
  }

  const apiData = await fetchCourses(getCurrentApiPath());
  const list = parseCourseList(apiData);
  // 教师级：同时匹配课程号和教学班 ID（因为同一门课可能有多行）
  let course = list.find(c =>
    getCourseNumber(c) === courseNumber &&
    (c.teachingClassID === tcid || (c.tcList && c.tcList.some(t => t.teachingClassID === tcid)))
  );
  let available = 0;
  if (course?.tcList) {
    const tc = course.tcList.find(t => t.teachingClassID === tcid);
    if (tc) available = Math.max(0, parseInt(tc.classCapacity||0) - parseInt(tc.numberOfSelected||0));
  } else if (course) {
    available = Math.max(0, parseInt(course.classCapacity||0) - parseInt(course.numberOfSelected||0));
  }
  if (available > 0) {
    log('✅ ' + label + ' 有余量 ' + available);
    showTip('「' + label + '」当前还有 ' + available + ' 个名额，不用盯', 'info');
        return;
  }

  watchedCourses.push({
    _id: Date.now() + Math.random().toString(36).slice(2,6),
    type: 'teacher', apiPath: getCurrentApiPath(),
    courseNumber, teachingClassID: tcid, teacherName, name: label,
    lastAvailable: 0, lastChecked: Date.now(), addedAt: Date.now()
  });
  await saveToStorage();
  btn.dataset.watching = 'true'; btn.style.opacity = '1'; btn.title = '已盯住 ' + teacherName;
  log('✅ 开始盯住教师: ' + label);
  refreshWatchPanel();
  if (watchedCourses.length === 1) startMonitoring();
}

// ======================== 页面关闭拦截 ========================
function handleBeforeUnload(e) {
  if (watchedCourses.length > 0) { e.preventDefault(); e.returnValue = ''; }
}

// ======================== 提示条 ========================
function showTip(msg, type) {
  const colors = { info: { bg: '#E8F4FD', border: '#047ADC', text: '#1a1a1a' } };
  const c = colors[type] || colors.info;
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;top:60px;right:20px;z-index:999999;max-width:420px;min-width:280px;' +
    'background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:10px;padding:14px 18px;' +
    'font-size:13px;line-height:1.6;color:' + c.text + ';box-shadow:0 4px 20px rgba(0,0,0,.12);' +
    'white-space:pre-line;transition:opacity .3s,transform .3s;opacity:0;transform:translateY(-10px);';
  tip.textContent = msg;

  const close = document.createElement('span');
  close.textContent = '✕';
  close.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;font-size:14px;color:#888;line-height:1;';
  close.onclick = () => tip.remove();
  tip.appendChild(close);
  document.body.appendChild(tip);
  requestAnimationFrame(() => { tip.style.opacity = '1'; tip.style.transform = 'translateY(0)'; });
  setTimeout(() => { tip.style.opacity = '0'; tip.style.transform = 'translateY(-10px)'; setTimeout(() => tip.remove(), 300); }, 2500);
}

// ======================== 清除全部 ========================
async function clearAllWatches() {
  watchedCourses = []; removedStack = [];
  await saveToStorage(); await saveRemovedStack();
  stopMonitoring();
  document.querySelectorAll('.watch-btn, .watch-btn-teacher').forEach(btn => {
    if (btn.classList.contains('watch-btn')) {
      btn.textContent = '👁️盯住'; btn.style.background = '#f5f5f5'; btn.style.borderColor = '#ccc'; btn.style.color = '#666';
      btn.dataset.watching = 'false';
    } else {
      btn.style.opacity = '0.4'; btn.dataset.watching = 'false';
      btn.title = btn.title.replace('已盯住', '盯住');
    }
  });
  refreshWatchPanel();
  log('已清除全部');
}

// ======================== 盯盘面板 ========================
function createWatchPanel() {
  if (watchPanel) return;
  watchPanel = document.createElement('div');
  watchPanel.id = 'xjtu-watch-panel';
  watchPanel.style.cssText = 'position:fixed;bottom:60px;left:16px;z-index:99999;width:320px;max-height:360px;' +
    'background:#fff;border:1px solid #e2e1dc;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.12);' +
    'font-family:sans-serif;font-size:13px;display:none;overflow:hidden;flex-direction:column;';
  watchPanel.innerHTML =
    '<div id="watch-panel-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #eeedea;background:#f7f6f3;font-weight:600;cursor:move;">' +
      '<span>📋 盯盘列表</span><span id="watch-panel-count" style="font-size:12px;color:#888;font-weight:400;"></span>' +
    '</div>' +
    '<div id="watch-panel-body" style="flex:1;overflow-y:auto;padding:8px 0;"></div>' +
    '<div style="padding:8px 16px;border-top:1px solid #eeedea;"><button id="watch-panel-clear" style="flex:1;width:100%;padding:6px;border:1px solid #e2e1dc;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;color:#dc2626;">清除全部</button></div>';
  document.body.appendChild(watchPanel);
  watchPanel.querySelector('#watch-panel-clear').onclick = clearAllWatches;

  // 面板拖拽
  const hdr = watchPanel.querySelector('#watch-panel-header');
  (function() {
    let d = false, sx, sy, ox, oy;
    hdr.onmousedown = function(e) { if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') return; d = true; sx = e.clientX; sy = e.clientY; ox = watchPanel.offsetLeft; oy = watchPanel.offsetTop; watchPanel.style.transition = 'none'; };
    document.onmousemove = function(e) { if (!d) return; watchPanel.style.left = (ox + e.clientX - sx) + 'px'; watchPanel.style.top = (oy + e.clientY - sy) + 'px'; watchPanel.style.right = 'auto'; watchPanel.style.bottom = 'auto'; };
    document.onmouseup = function() { d = false; watchPanel.style.transition = ''; };
  })();

  // 浮动按钮
  const toggle = document.createElement('div');
  toggle.id = 'xjtu-watch-toggle';
  toggle.innerHTML = '📋 <span style="font-size:11px;font-weight:400;">盯盘</span>';
  toggle.title = '点击切换盯盘面板';
  toggle.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:99999;padding:8px 14px;border-radius:20px;' +
    'background:#1a1a2e;color:#fff;display:flex;align-items:center;gap:4px;cursor:pointer;font-size:14px;' +
    'box-shadow:0 2px 12px rgba(0,0,0,.25);user-select:none;';
  toggle.onmouseenter = function() { toggle.style.boxShadow = '0 4px 20px rgba(0,0,0,.35)'; };
  toggle.onmouseleave = function() { toggle.style.boxShadow = '0 2px 12px rgba(0,0,0,.25)'; };
  toggle.onclick = function() {
    watchPanelVisible = !watchPanelVisible;
    watchPanel.style.display = watchPanelVisible ? 'flex' : 'none';
    if (watchPanelVisible) refreshWatchPanel();
  };
  // 按钮拖拽
  (function() {
    let d = false, sx, sy, ox, oy;
    toggle.onmousedown = function(e) { d = true; sx = e.clientX; sy = e.clientY; ox = toggle.offsetLeft; oy = toggle.offsetTop; toggle.style.cursor = 'grabbing'; toggle.style.transition = 'none'; };
    document.addEventListener('mousemove', function(e) { if (!d) return; toggle.style.left = (ox + e.clientX - sx) + 'px'; toggle.style.top = (oy + e.clientY - sy) + 'px'; toggle.style.right = 'auto'; toggle.style.bottom = 'auto'; });
    document.addEventListener('mouseup', function() { if (d) { d = false; toggle.style.cursor = ''; toggle.style.transition = ''; } });
  })();
  document.body.appendChild(toggle);
}

function refreshWatchPanel() {
  if (!watchPanel) return;
  const body = watchPanel.querySelector('#watch-panel-body');
  const count = watchPanel.querySelector('#watch-panel-count');
  count.textContent = watchedCourses.length ? watchedCourses.length + ' 盯住' : '';

  if (watchedCourses.length === 0 && (!removedStack || removedStack.length === 0)) {
    body.innerHTML = '<div style="padding:24px 16px;text-align:center;color:#b0afab;font-size:12px;">暂无盯盘课程</div>';
    return;
  }

  let html = '';
  watchedCourses.forEach(c => {
    const isT = c.type === 'teacher';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid #f0efec;">' +
      '<div style="flex:1;min-width:0;"><div style="font-weight:500;font-size:13px;">' + c.name + '</div>' +
      '<div style="font-size:11px;color:#888;">' + (isT ? '👨‍🏫 ' : '📚 ') + (isT ? c.teacherName : '所有教师') +
      '<span style="margin-left:6px;color:' + (c.lastAvailable > 0 ? '#0d9488' : '#b0afab') + ';">余' + c.lastAvailable + '</span></div></div>' +
      '<button data-id="' + c._id + '" style="flex-shrink:0;padding:2px 10px;font-size:12px;border:1px solid #e2e1dc;border-radius:6px;background:#fff;cursor:pointer;color:#dc2626;">删除</button></div>';
  });

  if (removedStack && removedStack.length > 0) {
    html += '<div style="padding:6px 16px 4px;font-size:11px;color:#b0afab;border-top:1px dashed #eeedea;margin-top:4px;">最近取消（' + removedStack.length + '）</div>';
    removedStack.forEach(item => {
      const isT = item.type === 'teacher';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 16px;opacity:0.45;">' +
        '<div style="flex:1;min-width:0;"><div style="font-weight:500;font-size:13px;text-decoration:line-through;">' + item.name + '</div>' +
        '<div style="font-size:11px;color:#888;">' + (isT ? '👨‍🏫 ' : '📚 ') + (isT ? item.teacherName : '所有教师') + '</div></div>' +
        '<button data-rid="' + item._id + '" style="flex-shrink:0;padding:2px 10px;font-size:12px;border:1px solid #047ADC;border-radius:6px;background:#E8F4FD;color:#047ADC;cursor:pointer;font-weight:500;">重新盯住</button></div>';
    });
    html += '<div style="padding:4px 16px 8px;text-align:right;"><button id="watch-clear-removed" style="font-size:11px;border:none;background:none;color:#b0afab;cursor:pointer;">清空记录</button></div>';
  }

  body.innerHTML = html;

  body.querySelectorAll('button[data-id]').forEach(btn => {
    btn.onclick = async function() {
      const c = watchedCourses.find(w => w._id === btn.dataset.id);
      if (!c) return;
      removeWatchFromPage(c);
      removedStack.unshift({ _id: c._id, type: c.type, courseNumber: c.courseNumber, teachingClassID: c.teachingClassID, teacherName: c.teacherName, name: c.name });
      if (removedStack.length > 20) removedStack.pop();
      watchedCourses = watchedCourses.filter(w => w._id !== c._id);
      await saveToStorage(); await saveRemovedStack();
      if (watchedCourses.length === 0) stopMonitoring();
      refreshWatchPanel();
    };
  });

  body.querySelectorAll('button[data-rid]').forEach(btn => {
    btn.onclick = async function() {
      const idx = removedStack.findIndex(r => r._id === btn.dataset.rid);
      if (idx === -1) return;
      const item = removedStack[idx];
      removedStack.splice(idx, 1);

      const apiData = await fetchCourses(getCurrentApiPath());
      const list = parseCourseList(apiData);
      let available = 0;
      if (item.type === 'teacher') {
        let course = list.find(c => getCourseNumber(c) === item.courseNumber &&
          (c.teachingClassID === item.teachingClassID ||
           (c.tcList && c.tcList.some(t => t.teachingClassID === item.teachingClassID))));
        if (course?.tcList) {
          const tc = course.tcList.find(t => t.teachingClassID === item.teachingClassID);
          if (tc) available = Math.max(0, parseInt(tc.classCapacity||0) - parseInt(tc.numberOfSelected||0));
        } else if (course) {
          available = Math.max(0, parseInt(course.classCapacity||0) - parseInt(course.numberOfSelected||0));
        }
      } else {
        const course = list.find(c => getCourseNumber(c) === item.courseNumber);
        if (course?.tcList) available = course.tcList.reduce((s, t) => s + Math.max(0, parseInt(t.classCapacity||0) - parseInt(t.numberOfSelected||0)), 0);
      }
      if (available > 0) { showTip('「' + item.name + '」当前还有 ' + available + ' 个名额，无需盯盘', 'info'); await saveRemovedStack(); refreshWatchPanel(); return; }

      watchedCourses.push({ _id: item._id, type: item.type, courseNumber: item.courseNumber, teachingClassID: item.teachingClassID, teacherName: item.teacherName, name: item.name, lastAvailable: 0, lastChecked: Date.now(), addedAt: Date.now() });
      await saveToStorage(); await saveRemovedStack();
      if (item.type === 'teacher') {
        document.querySelectorAll('.watch-btn-teacher').forEach(el => { if (el.closest('[id]')?.id?.replace('_courseDiv', '') === item.teachingClassID) { el.dataset.watching = 'true'; el.style.opacity = '1'; el.title = '已盯住 ' + item.teacherName; } });
      } else {
        document.querySelectorAll('.watch-btn').forEach(el => { if (el.closest('[coursenumber]')?.getAttribute('coursenumber') === item.courseNumber) { el.textContent = '👁️盯住中'; el.style.background = '#E8F4FD'; el.style.borderColor = '#047ADC'; el.style.color = '#047ADC'; el.dataset.watching = 'true'; } });
      }
      if (watchedCourses.length === 1) startMonitoring();
      refreshWatchPanel();
    };
  });

  const cb = body.querySelector('#watch-clear-removed');
  if (cb) cb.onclick = async function() { removedStack = []; await saveRemovedStack(); refreshWatchPanel(); };
}

function removeWatchFromPage(c) {
  if (c.type === 'teacher') {
    document.querySelectorAll('.watch-btn-teacher').forEach(el => {
      if (el.closest('[id]')?.id?.replace('_courseDiv', '') === c.teachingClassID) { el.style.opacity = '0.4'; el.dataset.watching = 'false'; el.title = '盯住 ' + c.teacherName; }
    });
  } else {
    document.querySelectorAll('.watch-btn').forEach(el => {
      if (el.closest('[coursenumber]')?.getAttribute('coursenumber') === c.courseNumber) { el.textContent = '👁️盯住'; el.style.background = '#f5f5f5'; el.style.borderColor = '#ccc'; el.style.color = '#666'; el.dataset.watching = 'false'; }
    });
  }
}

// ======================== 初始化 ========================
async function init() {
  log('🚀 选课盯盘加载');
  await Promise.all([loadFromStorage(), loadRemovedStack()]);
  log('📂 已加载 ' + watchedCourses.length + ' 个盯住课程，' + removedStack.length + ' 条记录');

  createWatchPanel();
  refreshWatchPanel();
  injectWatchButtons();

  let mt = null;
  const ob = new MutationObserver(() => { if (mt) clearTimeout(mt); mt = setTimeout(injectWatchButtons, 100); });
  ob.observe(document.body, { childList: true, subtree: true });
  setInterval(injectWatchButtons, 5000);

  if (watchedCourses.length > 0) { log('🔄 恢复盯盘'); startMonitoring(); }

  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('pagehide', () => { if (isMonitoring()) { log('📴 页面卸载，盯盘停止'); stopMonitoring(); } });
  log('✅ 选课盯盘初始化完成');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
