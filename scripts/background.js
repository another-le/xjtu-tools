/**
 * background.js — Service Worker
 *
 * 职责：
 *   1. Cookie 清理（选课退出用）
 *   2. 文件下载（学习平台用）
 *   3. 选课盯盘通知（watchCourse.js）
 *   4. 浏览器启动或新建窗口时检查 GitHub 上的新版本
 */

const STARTUP_UPDATE_ALARM_NAME = 'xjtu-tools-startup-update-check';
const COURSE_SELECTION_URL =
  'https://xkfw.xjtu.edu.cn/xsxkapp/sys/xsxkapp/*default/curriculavariable.do';
const REMOTE_MANIFEST_API_URL =
  'https://api.github.com/repos/another-le/xjtu-tools/contents/manifest.json?ref=master';
const DISMISSED_UPDATE_VERSION_KEY = 'dismissedUpdateVersion';
const STARTUP_CHECK_DELAY_MS = 5 * 1000;
const UPDATE_CACHE_TTL_MS = 60 * 1000;

let cachedUpdateInfo = null;

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
      chrome.action.setBadgeText({ text: '' });
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

// ============================================================
//  已有功能：Cookie 清理 & 文件下载
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getUpdateInfo') {
    getUpdateStatus()
      .then((updateInfo) => sendResponse({ ok: true, ...updateInfo }))
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
