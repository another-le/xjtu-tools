console.log("inject.js 已进入页面上下文");
(function waitForJqx() {

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
})();
