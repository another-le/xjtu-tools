// {
//     "matches": [
//         "https://class.xjtu.edu.cn/course/*/courseware"
//     ],
//     "js": [
//         "scripts/downloadPdf.js"
//     ]
// }
function d_pdf() {
    // 获取PDF链接
    const pdfUrl = decodeURIComponent(
        document.querySelector('iframe#pdf-viewer')
            .getAttribute('ng-src')
            .match(/(?<=file=).+\.pdf/)[0]
    );

    // 使用Chrome下载API
    chrome.downloads.download({
        url: pdfUrl,
        filename: 'document.pdf', // 可以自定义文件名
        saveAs: false // true会弹出保存对话框
    });
}


function waitForElement(selector, callback) {
    // 如果元素已经存在
    const element = document.querySelector(selector);
    if (element) {
        callback(element);
        return;
    }

    // 创建观察器监听DOM变化
    const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
            callback(el);
            observer.disconnect(); // 找到后停止监听
        }
    });

    // 开始监听整个body的变化
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}


console.log("Content Script 注入成功！");
waitForElement('iframe#pdf-viewer', () => {
    d_pdf();
})