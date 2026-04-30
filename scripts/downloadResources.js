// 下载内容：严格遵守原版权方的使用条款，仅供个人学习和研究使用，不得用于商业用途。

function d_pdf(dom) {
    // 获取PDF链接
    const pdfUrl = decodeURIComponent(
        dom.getAttribute('ng-src')
            .match(/(?<=file=).+\.pdf/)[0]
    );
    console.log('PDF URL:', pdfUrl);
    // 发送消息给背景脚本，触发下载
    chrome.runtime.sendMessage({
        action: 'downloadPdf',
        url: pdfUrl,
        fileName: document.querySelector('div.header span[tipsy="upload.name"]').title
    });
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
    waitForElement('.file-previewer div.ng-scope[class*=container]', (parent_dom) => {
        let fileExtension = document.querySelector('div.header span[ng-bind="upload.name|fileExtension"]').innerText;
        let a = document.createElement('a');
        a.innerHTML = '下载';
        if (!['.pdf', '.mp4', '.pptx', '.docx'].includes(fileExtension)) return;
        if (fileExtension === '.pdf') {
            waitForElement('#pdf-viewer', (element) => {
                console.log('Angular 编译完成！');
                a.addEventListener('click', () => d_pdf(element));
            }, 'pdf')
        }
        else if (fileExtension === '.mp4') {
            waitForElement('.file-previewer div.ng-scope[class*=container] video', (element) => {
                a.addEventListener('click', () => {
                    let videoSrc = element.src
                    if (videoSrc.startsWith('/')) {
                        videoSrc = window.location.origin + videoSrc;
                    }
                    console.log('在新标签页打开:', videoSrc);
                    // 直接在新标签页打开
                    window.open(videoSrc, '_blank');
                })
            })
        }
        else if (fileExtension === '.pptx' || fileExtension === '.docx') {
            waitForElement('#pdf-viewer', (element) => {
                //https://lms.xjtu.edu.cn/files/previewer/551481/1%E7%AC%AC%E4%B8%80%E7%AB%A0(%E7%AC%AC3%E8%8A%82).pptx#/
                let number = element.src.match(/id=(\d+)/)[1];
                let title = document.querySelector('span.title>span[original-title]').getAttribute('title');
                let pptxUrl = `${window.location.origin}/files/previewer/${number}/${encodeURIComponent(title)}.pptx`;

                // 创建隐藏iframe
                let iframe = document.createElement("iframe");
                iframe.style.display = "none";
                iframe.src = pptxUrl;
                document.body.appendChild(iframe);

                iframe.onload = () => {
                    console.log("previewer页面已加载");
                    // 等待pdf-viewer出现
                    let doc = iframe.contentDocument || iframe.contentWindow.document;
                    waitForElement('#pdf-viewer', (element) => {
                        console.log('Angular 编译完成！');
                        a.addEventListener('click', () => d_pdf(element));
                    }, 'pdf', doc)
                };
            }, 'pdf')
            // 设置a标签样式
            Object.assign(a.style, {
                lineHeight: '32px',
                marginLeft: '10px'
            });
            // 如果a标签存在了，需要删除后再添加，不然会有多个下载按钮
            let existingDownloadLink = document.querySelector('.file-preview-actions a[innerHTML="下载"]');
            if (existingDownloadLink) {
                existingDownloadLink.remove();
            }
            document.querySelector('.file-preview-actions').appendChild(a);
            return;
        }
        document.querySelector('.toolbar-buttons').appendChild(a);
    });
}
// 关闭方式是直接点击右上角的叉号，所以监听这个元素的属性<div class="reveal-modal-bg" style="display: block;"></div>
// 当点击关闭按钮时，.reveal-modal-bg的display会变成none
// 所以如果display变成了block，就说明又打开了一个新的预览窗口（或者说是第一次打开预览窗口），这时就调用monitor函数

waitForElement('.reveal-modal-bg', (el) => {
    monitor();
}, 'display');