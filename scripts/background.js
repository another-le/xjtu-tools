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
            filename: message.filename || 'document.pdf',
            saveAs: true  // true 会弹出保存对话框
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('下载失败:', chrome.runtime.lastError);
            } else {
                console.log('下载已开始，ID:', downloadId);
            }
        });
    }
});
