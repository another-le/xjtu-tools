function teachingEvaluation() {
    let flag = document.querySelector('.card.bqA')
    if (flag && flag.innerText === '已评教') {
        alert('您已评教，请勿重复提交！')
        return;
    };
    const containers = document.querySelectorAll('#txwj-index-card>div>div>.bh-clearfix>.kc-js-right>div>div:last-child')
    for (let i = 0; i < containers.length; i++) {
        containers[i].classList.add('active')
    }
    const a = document.querySelectorAll("#txwj-index-card > div> div > div.sc-panel-content.bh-clearfix.bh-mv-8.wjzb-card-jskc > div:nth-child(2) > div > label:nth-child(1)")
    for (let i = 0; i < a.length; i++) {
        a[i].click()
    }
    document.querySelector("textarea.bh-txt-input__txtarea").value = '无'//这里可以更改你想给老师的建议
    document.querySelector("[data-action='提交']").click()
}

// 监听元素出现
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
waitForElement('#txwj-index-card>div', () => {
    const container = document.querySelector('.jsfkxx')
    const btn = document.createElement('button')
    btn.innerText = "一键评教"
    container.appendChild(btn)
    btn.addEventListener('click', () => {
        teachingEvaluation();
    })
})