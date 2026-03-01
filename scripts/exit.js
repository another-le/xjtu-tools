// 对于直接关闭了标签页而没有正确退出选课的情形下使用
console.log("Exit script loaded");
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
waitForElement('header.cv-page-header>img', () => {
    if (document.querySelector('.cv-page-header>nav>button') || document.querySelector('#courseBtn')) return;
    let exit_btn = document.createElement('button')
    exit_btn.innerText = '退出选课';
    exit_btn.classList.add('cv-btn')
    exit_btn.classList.add('cv-mb-8')
    exit_btn.type = 'button'
    let parent_div = document.querySelector('.cv-page-header>nav')
    exit_btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'removeCookies' });
        setTimeout(() => {
            location.reload();
        }, 300);
    });
    parent_div.appendChild(exit_btn)
})