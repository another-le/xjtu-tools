// 下载内容：严格遵守原版权方的使用条款，仅供个人学习和研究使用，不得用于商业用途。

function getUploadId(dom) {
    // 从 iframe src 提取 upload_id（PPTX/PDF 用）
    // src 格式: .../pdf-viewer?file=...&upload_id=551516&...
    if (dom?.src?.includes('upload_id=')) {
        return dom.src.match(/upload_id=(\d+)/)?.[1];
    }
    return null;
}

// 三种文件类型（PDF / PPTX&DOCX / MP4）统一下载方式：
// 取 upload_id → 拼 /api/uploads/{id}/blob → <a download> 强制下载
function downloadBlob(id, fileName) {
    const url = `${window.location.origin}/api/uploads/${id}/blob`;
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


function waitForElement(selector, callback, mode = null, parent = document.body) {
    function isCompiled() {
        const element = parent.querySelector(selector);
        if (!element) return false;
        if (mode === 'pdf') {
            const ngSrc = element.getAttribute('ng-src');
            // 检查是否还是模板语法
            return ngSrc && !ngSrc.includes('[[') && !ngSrc.includes('{{');
        }
        if (mode === 'display') {
            return getComputedStyle(element).display === 'block';
        }
        else return true;
    }

    // 如果已经编译好了
    if (isCompiled()) {
        callback(parent.querySelector(selector));
        return;
    }

    // 创建观察器
    const observer = new MutationObserver((mutations) => {
        if (mode === 'display') {
            const target = parent.querySelector(selector);
            if (!target) return;
            const relevantMutation = mutations.find(m => m.target === target && m.attributeName === 'style');
            if (!relevantMutation) return;
            if (isCompiled()) callback(target);
        } else {
            if (isCompiled()) {
                observer.disconnect();
                callback(parent.querySelector(selector));
            }
        }
    });
    if (mode === 'pdf')
        observer.observe(parent, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['ng-src']  // 只监听 ng-src 属性变化
        });
    else if (mode === 'display') {
        observer.observe(parent, {
            childList: true,
            subtree: true,
            attributes: true,
            // attributeOldValue: true,
            attributeFilter: ['style']
        });
    }
    else {
        observer.observe(parent, {
            childList: true,
            subtree: true,
        });
    }
}

console.log("downloadResources Script 注入成功！");
// .file-previewer div.ng-scope[class*=container]
function monitor() {
    // 全局去重：移除已有的下载按钮
    document.querySelectorAll('.toolbar-buttons a, .file-preview-actions a').forEach(el => {
        if (el.innerHTML === '下载' || el.textContent === '下载') el.remove();
    });

    waitForElement('.file-previewer div.ng-scope[class*=container]', (parent_dom) => {
        let fileExtension = document.querySelector('div.header span[ng-bind="upload.name|fileExtension"]').innerText;
        let fileName = document.querySelector('div.header span[tipsy="upload.name"]').title;
        let a = document.createElement('a');
        a.innerHTML = '下载';
        if (!['.pdf', '.mp4', '.pptx', '.docx'].includes(fileExtension)) return;

        if (fileExtension === '.pdf' || fileExtension === '.pptx' || fileExtension === '.docx') {
            waitForElement('#pdf-viewer', (element) => {
                let id = getUploadId(element);
                if (!id) return;
                a.addEventListener('click', () => downloadBlob(id, fileName));
                if (fileExtension === '.pdf') {
                    document.querySelector('.toolbar-buttons').appendChild(a);
                } else {
                    Object.assign(a.style, { lineHeight: '32px', marginLeft: '10px' });
                    document.querySelector('.file-preview-actions').appendChild(a);
                }
            }, 'pdf')
        }
        else if (fileExtension === '.mp4') {
            waitForElement('video[id^=undefined]', (video) => {
                let src = video?.getAttribute('src') || video?.src || '';
                let id = src.match(/\/api\/uploads\/video\/(\d+)/)?.[1];
                if (!id) return;
                a.addEventListener('click', () => downloadBlob(id, fileName));
                Object.assign(a.style, { lineHeight: '32px', marginLeft: '10px' });
                document.querySelector('.file-preview-actions').appendChild(a);
            })
        }
    });
}
// 关闭方式是直接点击右上角的叉号，所以监听这个元素的属性<div class="reveal-modal-bg" style="display: block;"></div>
// 当点击关闭按钮时，.reveal-modal-bg的display会变成none
// 所以如果display变成了block，就说明又打开了一个新的预览窗口（或者说是第一次打开预览窗口），这时就调用monitor函数

waitForElement('.reveal-modal-bg', (el) => {
    monitor();
}, 'display');