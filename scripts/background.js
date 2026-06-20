/**
 * background.js — Service Worker
 *
 * 职责：
 *   1. Cookie 清理（选课退出用）
 *   2. 文件下载（学习平台用）
 *   3. 选课盯盘通知（watchCourse.js）
 */

// ============================================================
//  已有功能：Cookie 清理 & 文件下载
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'removeCookies') {
    chrome.cookies.getAll({ domain: 'xkfw.xjtu.edu.cn' }, (cookies) => {
      console.log(cookies);
      cookies.forEach(cookie => {
        let url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
        chrome.cookies.remove({
          url: url,
          name: cookie.name
        }, (removed) => {
          if (removed) {
            console.log(`Successfully removed cookie: ${cookie.name}`);
          } else {
            console.log(`Failed to remove cookie: ${cookie.name}`);
          }
        });
      });
    });
  }
  else if (message.action === 'downloadPdf') {
    console.log("Received download request for URL:", message.url);
    chrome.downloads.download({
      url: message.url,
      filename: message.fileName || 'document.pdf',
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载失败:', JSON.stringify(chrome.runtime.lastError));
      } else {
        console.log('下载已开始，ID:', downloadId);
      }
    });
  }
  // ============================================================
  //  选课盯盘 — 收到发现余量的通知
  // ============================================================
  else if (message.action === 'courseSpotFound') {
    const course = message.course;
    console.log('[Background] 收到盯盘通知:', course.name);

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
});

// ============================================================
//  通知点击事件
// ============================================================

chrome.notifications.onClicked.addListener((notificationId) => {
  // 点击通知 → 打开选课页面
  chrome.tabs.create({
    url: 'https://xkfw.xjtu.edu.cn/xsxkapp/sys/xsxkapp/*default/curriculavariable.do'
  });
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    // 点击 "去选课" 按钮
    chrome.tabs.create({
      url: 'https://xkfw.xjtu.edu.cn/xsxkapp/sys/xsxkapp/*default/curriculavariable.do'
    });
  }
});
