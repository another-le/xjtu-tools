console.log("inject.js 已进入页面上下文");
(function waitForJqx() {
    console.log('当前域名:', location.hostname);
    // 雨课堂逻辑
    if (location.hostname.includes('yuketang')) {
        console.log('[MAIN] 启用雨课堂防暂停');

        // 伪造可见性
        Object.defineProperty(document, 'hidden', {
            get: () => false
        });
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible'
        });

        document.hasFocus = () => true;

        // 阻止 visibility 监听
        const stop = e => e.stopImmediatePropagation();
        document.addEventListener('visibilitychange', stop, true);
        window.addEventListener('blur', stop, true);

        // 改进的播放控制
        let isTabHidden = false;
        let userPaused = false;

        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('[MAIN] 标签页隐藏，准备保持播放');
                isTabHidden = true;
            } else {
                console.log('[MAIN] 标签页可见');
                isTabHidden = false;
            }
        });

        // 监听用户的手动暂停
        document.addEventListener('play', (e) => {
            if (e.target.tagName === 'VIDEO') {
                console.log('[MAIN] 视频开始播放');
                userPaused = false;
            }
        }, true);

        document.addEventListener('pause', (e) => {
            if (e.target.tagName === 'VIDEO') {
                console.log('[MAIN] 视频暂停（用户操作）');
                userPaused = true;
            }
        }, true);

        // 监听播放按钮点击
        document.addEventListener('click', (e) => {
            // 检查是否点击了暂停按钮
            const target = e.target.closest('button, [role="button"]');
            if (target && (target.textContent.includes('暂停') || target.className.includes('pause'))) {
                console.log('[MAIN] 检测到用户点击暂停');
                userPaused = true;
            }
        }, true);

        // 智能播放控制
        setInterval(() => {
            // 只在标签页隐藏时且不是用户手动暂停时才强制播放
            if (isTabHidden && !userPaused) {
                document.querySelectorAll('video').forEach(v => {
                    if (v.paused) {
                        console.log('[MAIN] 标签页隐藏中，保持视频播放');
                        v.play().catch(() => { });
                    }
                });
            }
        }, 1000);


    }
    // 本科教务表格逻辑
    else if (location.hostname.includes('ehall.xjtu')) {
        //找 jqx jQuery 实例
        function findJqxJquery() {
            for (const v of Object.values(window)) {
                if (v?.fn?.jqxListBox) {
                    return v;
                }
            }
            return null;
        }

        const real$ = findJqxJquery();
        if (!real$) {
            // jqx 还没加载，1s 后重试
            setTimeout(waitForJqx, 1000);
            return;
        }
        if (!real$) {
            console.warn("找不到 jqx jQuery 实例，无法绑定 select");
            return;
        }
        console.log("找到 jqx jQuery 实例:", real$);
        //委托绑定 select 事件
        real$(document).on(
            "select",
            '[id^="innerListBoxjqxWidget"]',
            function (e) {
                const item = e.args?.item;

                if (!item) return;

                const label = item.label;
                const value = item.value;

                //回传给 content.js
                window.postMessage({
                    type: "JQX_SELECT_EVENT",
                    label,
                    value
                }, "*");
            }
        );
    }
})();
