const REPOSITORY_URL = 'https://github.com/another-le/xjtu-tools';
const DISMISSED_UPDATE_VERSION_KEY = 'dismissedUpdateVersion';

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
  repositoryButton: document.querySelector('#repositoryButton')
};

let currentUpdateInfo = null;

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
  chrome.action.setBadgeText({ text: '' });
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
      renderUpdateInfo({
        ...response,
        reminderDismissed: dismissedVersion === response.latestVersion
      });
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
      await chrome.storage.local.set({
        [DISMISSED_UPDATE_VERSION_KEY]: currentUpdateInfo.latestVersion
      });
    } else {
      await chrome.storage.local.remove(DISMISSED_UPDATE_VERSION_KEY);
    }

    chrome.action.setBadgeText({ text: dismissed ? '' : 'NEW' });
    renderUpdateInfo({
      ...currentUpdateInfo,
      reminderDismissed: dismissed
    });
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
elements.dismissReminder.addEventListener('change', (event) => {
  setReminderDismissed(event.target.checked);
});

checkForUpdates();
