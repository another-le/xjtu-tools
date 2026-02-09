console.log("Content Script 注入成功！");
(function inject() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/inject.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
})();
//列宽问题为什么总是对不齐？是因为表格有一个列宽调整功能，它内部的计算才是真正决定列宽的因素，必须把这个函数给禁掉才可以。
//jqx切换后会尽量让用户看到切换前看到的数据
(function () {

    //等待某元素加载完成函数
    function waitForElements(callback, disconnect = true, isdeleted = false, deletedElement = null, ...selectors) {
        const check = () => {
            const elements = [];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (!el) return null;
                elements.push(el);
            }
            return elements;
        };
        let targetElement;
        if (!isdeleted) {
            const ready = check();
            if (ready) {
                callback(ready);
                return;
            }
        }
        else {
            targetElement = typeof deletedElement === 'string'
                ? document.querySelector(deletedElement)
                : target;
        }
        const observer = new MutationObserver((mutations, obs) => {
            // console.log(mutations);

            let elementDeleted = false;
            if (isdeleted) {
                // console.log(mutations)
                mutations.forEach((mutation) => {
                    for (const removedNode of mutation.removedNodes) {
                        // 检查被移除的节点是否就是目标元素，或者是目标元素的父节点
                        if (removedNode === targetElement ||
                            removedNode.contains?.(targetElement)) {
                            elementDeleted = true;
                        }
                    }
                })
            }
            else elementDeleted = true;
            if (elementDeleted) {
                const ready = check();
                if (ready) {
                    if (disconnect) obs.disconnect();
                    callback(ready);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,  // 添加这行才能检测属性变化
            attributeFilter: ['style'] //只监听特定属性
        });
    }

    function fixed_columns() {
        //have_btn 为true表示已经有按钮了，反之则为没有按钮
        let have_btn = document.querySelector('#btn') ? true : false;
        const copy_butn = document.querySelector('.bh-advancedQuery-inputGroup>a').cloneNode(false);
        const select_all_btn = copy_butn.cloneNode(false);
        const parent = document.querySelector('.jqx-tabs-title-container');
        if (!have_btn) {
            //创建一个“固定前三列”的按钮
            copy_butn.innerHTML = '固定前三列'
            copy_butn.id = 'btn';
            copy_butn.removeAttribute('bh-advanced-query-role');
            parent.appendChild(copy_butn)
        }
        //创建一个选择全部行的按钮
        select_all_btn.innerHTML = '全选'
        select_all_btn.id = 'selectAllBtn'
        select_all_btn.removeAttribute('bh-advanced-query-role')
        parent.appendChild(select_all_btn)
        select_all_btn.addEventListener('click', () => {
            let all_checked = document.querySelectorAll(copy_parent_div + ' tbody input[id^=checkbox]:not(:checked)')
            if (all_checked.length)
                document.querySelectorAll(copy_parent_div + ' tbody input[id^=checkbox]:not(:checked)').forEach((ele) => {
                    ele.click();
                })
            else {
                document.querySelectorAll(copy_parent_div + ' tbody input[id^=checkbox]:checked').forEach((ele) => {
                    ele.click();
                })
            }
        })
        function copy_butn_callback(e) {
            if (e.target.tagName === 'A') {
                let id = '#fixed_columns' + pannel_num;
                // is_fixed 为true表示已经固定了，反之则表示没有固定
                let is_fixed = document.querySelector(id).style.display === 'block' ? true : false;
                //如果固定了
                if (is_fixed) {
                    document.querySelector(id).style.display = 'none';
                    return;
                }
                //如果没有固定则固定
                document.querySelector(id).style.display = 'block';
            }
        }
        // copy_butn.removeEventListener('click', copy_butn_callback)
        copy_butn.addEventListener('click', copy_butn_callback);
    }
    //find的回调函数
    function find_callback(el, index) {
        if (el.style.display != 'none' && index === 1) {
            headerSelector = '#columntableqb-index-table'
            bodySelector = '#tableqb-index-table'
            copy_parent_div = '#contentqb-index-table'
            dragBarSelector = '#jqxScrollThumbhorizontalScrollBarqb-index-table'
            pager = "#pagerqb-index-table"
            exclude_array = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
            pannel_num = 1;
        }
        else if (el.style.display != 'none' && index === 0) {
            headerSelector = "#columntabledqxq-index-table";
            bodySelector = "#contenttabledqxq-index-table";
            copy_parent_div = "#contentdqxq-index-table";
            dragBarSelector = "#jqxScrollThumbhorizontalScrollBardqxq-index-table";
            pager = "#pagerdqxq-index-table"
            exclude_array = [9];
            pannel_num = 0;
        }
        return el.style.display != 'none'
    }

    //计算宽度，并且让所有列显示
    function cal_width(exclude_array) {
        const header_columns = document.querySelectorAll(headerSelector + '>div')
        const columns_nums = header_columns.length;
        const body_columns = document.querySelectorAll(bodySelector + ` tbody td:nth-child(-n+${columns_nums})`)
        let width_array = [];
        let sum_width = 0;
        header_columns.forEach((ele, index) => {
            current_width = parseInt(ele.style.width.match(/\d+/)[0]);
            if (!exclude_array.includes(index)) {
                let span_ele = ele.querySelector('span');
                ele.style.display = 'block';
                if (span_ele.innerText.includes('SY') && !span_ele.innerText.includes('实验'))
                    span_ele.innerText += '（实验成绩）'
                if (span_ele.innerText.includes('QT') && !span_ele.innerText.includes('其他'))
                    span_ele.innerText += `（其他成绩${span_ele.innerText.match(/\d+/)}）`
                sum_width = sum_width + current_width;
            }
            else ele.style.display = 'none'
            width_array.push(current_width)
            ele.style.left = (sum_width - width_array[index]) + 'px';
        })
        body_columns.forEach((ele, index) => {
            if (exclude_array.includes(index % header_columns.length)) {
                ele.style.display = 'none';
                return;
            };
            ele.style.display = 'table-cell';
            ele.style.width = width_array[index] + 'px';
            ele.style.minWidth = ele.style.maxWidth
        })
        document.querySelector(headerSelector).parentElement.style.width = sum_width + 'px'
        return sum_width;
    }
    //让拖动条可以拖拽到扩展列
    function hookTableDrag(body, dragBar, header = null) {
        if (hooked) return;
        hooked = true;

        console.log("[table drag hook] start hooking");

        let dragging = false;
        let width = cal_width(exclude_array);
        const processed = new Map();

        function doubleValueOnce(el, prop, signal) {
            const val = el.style[prop];
            if (!val) return;

            if (processed.get(el) === val) return; // 已处理过
            const num = parseFloat(val);
            if (isNaN(num)) return;

            const unit = val.replace(num, "") || "px";
            const newVal = num * 16 + unit;
            el.style[prop] = newVal;
            el.style['width'] = width + 'px';//宽度也要跟着一起变
            //如果signal为true，则需要多处理一步（标题栏的第一栏）
            if (signal)
                el.querySelector('div').style['marginLeft'] = -num * 16 + 'px';
            processed.set(el, newVal);
        }

        // MutationObserver 监听 style 改变
        const styleObserver = new MutationObserver((mutations) => {
            if (!dragging) return;
            // console.log(mutations);
            mutations.forEach((m) => {
                if (m.type === "attributes" && m.attributeName === "style") {
                    if (header && m.target === header)
                        doubleValueOnce(header, "marginLeft", pannel_num === 1);
                    if (m.target === body) doubleValueOnce(body, "left", false);
                }
            });
        });
        if (header)
            styleObserver.observe(header, { attributes: true, attributeFilter: ["style"] });
        styleObserver.observe(body, { attributes: true, attributeFilter: ["style"] });

        // 拖动事件
        const onMouseDown = () => {
            dragging = true;
            processed.clear();
        };
        const onMouseUp = () => {
            dragging = false;
            processed.clear();
        };

        dragBar.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mouseup", onMouseUp);

        console.log("[table drag hook] active");
    }
    //页数切换前后计算
    function calculateNewRange(
        selected_rows,           // 切换前每页条数
        to_select_rows,          // 切换后每页条数
        current_page_min_rows,   // 切换前当前页第一条序号
        current_page_max_rows,   // 切换前当前页最后一条序号
        totalRows                // 总数据条数（可选，用于边界检查）
    ) {
        // 1. 计算当前是第几页（基于切换前的配置）
        const currentPage = Math.ceil(current_page_min_rows / selected_rows);

        // 2. 计算当前页第一条在总数据中的位置（0-based索引）
        const firstItemPosition = (currentPage - 1) * selected_rows;

        // 3. 计算切换后的页码
        const newPage = Math.floor(firstItemPosition / to_select_rows) + 1;

        // 4. 计算切换后的显示范围
        const afterMin = (newPage - 1) * to_select_rows + 1;

        // 如果有总行数，进行边界检查
        let afterMax;
        if (totalRows) {
            afterMax = Math.min(newPage * to_select_rows, totalRows);
        } else {
            afterMax = newPage * to_select_rows;
        }

        return {
            newPage: newPage,                    // 切换后的页码
            afterMin: afterMin,                  // 切换后第一条的序号
            afterMax: afterMax,                  // 切换后最后一条的序号
            totalRows: totalRows,                // 总行数（如果提供）
        };
    }
    //上一页，下一页的按钮的回调函数
    function switch_btns_callback(e) {
        if (e && e.target.tagName !== 'I')
            return;
        hooked = false;
        waitForElements((elements) => {
            record = document.querySelector(pager + " .bh-pull-left>span").innerText;
            current_page_max_rows = parseInt(record.match(/(?<=-)\d+/))
            current_page_min_rows = parseInt(record.match(/\d+(?=-)/))
            hookTableDrag(...elements);
            copy_three_columns(true);
        }, true, true, bodySelector + '>tbody', bodySelector, dragBarSelector)
    }
    function switch_pannel() {
        //给切换页数添加监听事件
        const switch_btns = document.querySelector(pager + " .bh-pull-left")
        switch_btns.removeEventListener('click', switch_btns_callback)
        switch_btns.addEventListener('click', switch_btns_callback)
    }

    let selected_rows, record, sum_rows, current_page_max_rows, current_page_min_rows;
    function selector_numbers_addEvent(f) {
        // 31-40 总记录数 47 总页数 5
        // 右侧选中的每页条数
        selected_rows = parseInt(document.querySelectorAll('[id^="dropdownlistContentjqxWidget"]')[pannel_num].innerText);
        // 31-40 总记录数 47
        record = document.querySelector(pager + " .bh-pull-left>span").innerText;
        // 总记录数（47）
        sum_rows = parseInt(record.match(/(?<=数 )\d+/)[0])
        // 40
        current_page_max_rows = parseInt(record.match(/(?<=-)\d+/))
        // 31
        current_page_min_rows = parseInt(record.match(/\d+(?=-)/))
        if (f)
            //接收页面回传消息
            window.addEventListener("message", (event) => {
                // 只处理来自页面自身的消息
                if (event.source !== window) return;

                if (event.data?.type === "JQX_SELECT_EVENT") {
                    console.log("扩展收到 jqx select:", event.data.label, event.data.value);
                    let to_select_rows = parseInt(event.data.value)
                    if (to_select_rows > 1000) return;
                    //如果两次切换的数字是一样的，就不用麻烦了;
                    // if (selected_rows === to_select_rows)
                    //     return;
                    afterclick_info = calculateNewRange(selected_rows, to_select_rows, current_page_min_rows, current_page_max_rows, sum_rows);
                    hooked = false;
                    //如果前后切换两次此页的记录不变，这时候他其实也是请求了，但是这时候不能走添加路线，也不走删除路线！是不用动横向的拖拉条的删除路线！
                    // if (afterclick_info.afterMin === current_page_min_rows && afterclick_info.afterMax === current_page_max_rows) {
                    //     waitForElements((elements) => {
                    //         cal_width(exclude_array);
                    //         copy_three_columns(true);
                    //     }, true, true, bodySelector + ` tbody>tr:nth-child(${afterclick_info.afterMax - afterclick_info.afterMin + 1})`, bodySelector, dragBarSelector, bodySelector + ` tbody>tr:nth-child(${afterclick_info.afterMax - afterclick_info.afterMin + 1})`);
                    // }
                    //添加路线
                    if (afterclick_info.afterMax - afterclick_info.afterMin > current_page_max_rows - current_page_min_rows) {
                        waitForElements((elements) => {
                            //第三个参数其实不是header，要去掉
                            elements[2] = null;
                            hookTableDrag(...elements);
                            copy_three_columns(true);
                        }, true, false, null, bodySelector, dragBarSelector, bodySelector + ` tbody>tr:nth-child(${afterclick_info.afterMax - afterclick_info.afterMin + 1})`);
                    }
                    // 删除路线
                    else {
                        waitForElements((elements) => {
                            //第三个参数其实不是header，要去掉
                            elements[2] = null;
                            hookTableDrag(...elements);
                            copy_three_columns(true);
                        }, true, true, bodySelector + ` tbody>tr:nth-child(${current_page_max_rows - current_page_min_rows + 1})`, bodySelector, dragBarSelector, bodySelector + ` tbody>tr:nth-child(${afterclick_info.afterMax - afterclick_info.afterMin + 1})`);
                    }
                    selected_rows = to_select_rows
                    record = document.querySelector(pager + " .bh-pull-left>span").innerText;
                    current_page_max_rows = parseInt(record.match(/(?<=-)\d+/))
                    current_page_min_rows = parseInt(record.match(/\d+(?=-)/))
                }
            });
    }

    //处理搜索框情况下，添加监听事件
    function search_btn_addEvent() {
        const search_btn = document.querySelector('a[bh-advanced-query-role=easySearchBtn]')
        const clear_search_btn = document.querySelector('a[bh-advanced-query-role=clearBtn]')
        const advanced_clear_search_btn = document.querySelector('a[bh-advanced-query-role=advancedClose]')
        const search_input = document.querySelector('div.bh-advancedQuery-quick-search-wrap>input')
        const advanced_search = document.querySelector('a[bh-advanced-query-role=advancedSearchBtn]')
        const advanced_search_input = document.querySelector('input[bh-advanced-query-role=advancedInput]')
        let search_btn_addEvent_callback = () => {
            hooked = false;
            waitForElements((elements) => {
                document.querySelector(pager + ' div.bh-pull-left>input').readOnly = true
                hookTableDrag(...elements);
                copy_three_columns(true);
                switch_pannel();
                selector_numbers_addEvent(false);
            }, true, true, bodySelector, bodySelector, dragBarSelector, headerSelector)
        }
        search_input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')
                search_btn_addEvent_callback()
        })
        advanced_search_input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')
                search_btn_addEvent_callback()
        })
        search_btn.addEventListener('click', search_btn_addEvent_callback)
        clear_search_btn.addEventListener('click', search_btn_addEvent_callback)
        advanced_clear_search_btn.addEventListener('click', search_btn_addEvent_callback)
        advanced_search.addEventListener('click', search_btn_addEvent_callback)
    }

    let hooked = false; // 确保 hook 只执行一次
    //表示现在是哪个板块
    let pannel_num = 0;
    let headerSelector = "#columntabledqxq-index-table";
    let bodySelector = "#contenttabledqxq-index-table";
    //复制前三列用到的父元素
    let copy_parent_div = "#contentdqxq-index-table"
    let dragBarSelector = "#jqxScrollThumbhorizontalScrollBardqxq-index-table";
    let pager = "#pagerdqxq-index-table"
    let exclude_array = [9];
    let selected_subjects = []

    //添加方框
    function addCheckbox() {
        // 添加方框
        let x = pannel_num == 0 ? 'dqxq' : 'qb'
        let checkbox_places = document.querySelectorAll(`#contenttable${x}-index-table` + '>table:nth-child(1) tr>td:nth-child(1)')
        if (!checkbox_places[0].querySelector('input') && checkbox_places[0].children.length)
            checkbox_places.forEach((ele) => {
                const checkbox = document.createElement('input')
                checkbox.type = 'checkbox'
                checkbox.style.position = 'absolute'
                checkbox.style.left = '65px'
                checkbox.id = 'checkbox' + ele.children[0].dataset.kch
                checkbox.checked = selected_subjects.includes(ele.children[0].dataset.kch)
                ele.addEventListener('change', (e) => {
                    let current_row_info = e.target.previousElementSibling
                    // console.log(current_row_info)
                    if (e.target.checked) {
                        addGradeRow(current_row_info.dataset.xnxqdm, current_row_info.dataset.kcm, current_row_info.dataset.xf, current_row_info.dataset.zcj, current_row_info.dataset.xfjd, current_row_info.dataset.kch)
                        selected_subjects.push(current_row_info.dataset.kch)
                    }
                    else {
                        const index = selected_subjects.indexOf(current_row_info.dataset.kch);
                        if (index !== -1) {
                            selected_subjects.splice(index, 1);
                            document.querySelector(`.grade-helper-panel #${current_row_info.dataset.kch}`).remove()
                            calculateAverage();
                        }
                    }
                })
                ele.appendChild(checkbox)
            })
    }

    //复制前三列，插到指定位置
    function copy_three_columns(isSwitch = false) {
        //isSwitch为true表示当前盘上已经复制过了，但是里面的内容不对，需要删除了，重新来一遍
        const pannel = Array.from(document.querySelectorAll('div[role=tabpanel]'))
            .find(find_callback)
        //复制前三列
        const element = document.querySelector('#fixed_columns' + pannel_num)
        if (isSwitch)
            element.remove();
        if (element && !isSwitch) return;
        const parent_div = pannel.querySelector(copy_parent_div).cloneNode(true);
        parent_div.removeAttribute('style');
        parent_div.querySelectorAll('div[role]:nth-child(n+4)').forEach((ele) => ele.remove());
        parent_div.querySelectorAll('tbody>tr>td:nth-child(n+4)').forEach((ele) => ele.remove());
        if (pannel_num === 1) {
            //如果是没有符合条件的数据的情况下，这里是不能删除的
            let temp = parent_div.querySelector('#pinnedtableqb-index-table')
            if (temp)
                temp.remove()
        }
        parent_div.style.cssText = 'position: absolute;left: 18px; width: 300px;z-index:1000';
        parent_div.querySelectorAll('[id]').forEach((ele) => ele.removeAttribute('id'));
        parent_div.id = 'fixed_columns' + pannel_num
        parent_div.querySelectorAll('td').forEach(ele => ele.style.visibility = 'visible')
        parent_div.querySelector('table').style.left = '0px'
        parent_div.querySelector('.jqx-widget-header>div').style.marginLeft = '0px'
        parent_div.querySelector('.jqx-widget-header>div>div').style.marginLeft = '0px'
        //先设置为none，按钮用于调整此选项
        parent_div.style.display = 'none';
        //插到指定位置
        console.log("调整了前三列，个数为：", parent_div.querySelectorAll("tr").length)
        document.querySelectorAll('.bh-mt-8>section')[pannel_num].prepend(parent_div);
        addCheckbox();
    }

    function insertGradePanel() {
        if (document.querySelector('.grade-helper-panel')) return;
        const panel = document.createElement('div');
        panel.className = 'grade-helper-panel';
        panel.innerHTML = `
         <div class="gh-header">成绩统计</div>

        <div class="gh-content">
            <div class="gh-groups"></div>

            <div class="gh-footer">
                <div class="gh-footer-left">
                    平均分：<span class="gh-average">0</span>
                    平均绩点：<span class="gpa-average">0.00</span>
                </div>

                <button class="gh-clear-btn">全部删除</button>
            </div>
        </div>
    `;
        document.body.appendChild(panel);
        makePanelDraggable(panel);
    }

    function getOrCreateGroup(year) {

        const container = document.querySelector('.gh-groups');

        let group = container.querySelector(`[data-year="${year}"]`);
        if (group) return group;

        group = document.createElement('div');
        group.className = 'gh-group';
        group.dataset.year = year;

        group.innerHTML = `
        <div class="gh-group-title">
            <span class="gh-arrow">▼</span>
            ${year}
        </div>

        <table class="gh-table">
            <thead>
                <tr>
                    <th>课程名</th>
                    <th>学分</th>
                    <th>成绩</th>
                    <th>绩点</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
    `;

        container.appendChild(group);

        // 折叠事件
        const title = group.querySelector('.gh-group-title');
        const table = group.querySelector('.gh-table');
        const arrow = group.querySelector('.gh-arrow');

        title.addEventListener('click', () => {
            const hidden = table.style.display === 'none';

            table.style.display = hidden ? '' : 'none';
            arrow.textContent = hidden ? '▼' : '▶';
        });

        return group;
    }

    function addGradeRow(year, name, credit, score, gpa, kch) {

        const group = getOrCreateGroup(year);
        const tbody = group.querySelector('tbody');

        const tr = document.createElement('tr');
        tr.id = kch
        tr.innerHTML = `
        <td>${name}</td>
        <td>${credit}</td>
        <td>${score}</td>
        <td>${gpa}</td>
        <td><a>删除</a></td>
    `;
        tr.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') {
                let to_delete_ele = e.target.closest('tr')
                to_delete_ele.remove()
                const index = selected_subjects.indexOf(to_delete_ele.id);
                if (index !== -1) {
                    selected_subjects.splice(index, 1);
                    // if (document.querySelector('#checkbox' + to_delete_ele.id))
                    document.querySelector('#checkbox' + to_delete_ele.id).checked = false;
                    calculateAverage();
                }
            }
        })
        tbody.appendChild(tr);

        calculateAverage();
    }

    function calculateAverage() {

        const rows = document.querySelectorAll('.gh-table tbody tr');

        let totalScore = 0;
        let totalCredit = 0;
        let totalGpa = 0;

        rows.forEach(row => {
            const credit = parseFloat(row.children[1].textContent);
            const score = parseFloat(row.children[2].textContent);
            const gpa = parseFloat(row.children[3].textContent);
            totalScore += credit * score;
            totalGpa += credit * gpa;
            totalCredit += credit;
        });

        const avg = totalCredit ? (totalScore / totalCredit).toFixed(2) : 0;
        const gpa_avg = totalCredit ? (totalGpa / totalCredit).toFixed(2) : 0;

        document.querySelector('.gh-average').textContent = avg;
        document.querySelector('.gpa-average').textContent = gpa_avg
    }

    function makePanelDraggable(panel) {

        const header = panel.querySelector('.gh-header');
        let offsetX = 0;
        let offsetY = 0;
        let dragging = false;

        header.addEventListener('mousedown', e => {
            dragging = true;

            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;

            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });

        function move(e) {
            if (!dragging) return;

            panel.style.left = e.clientX - offsetX + 'px';
            panel.style.top = e.clientY - offsetY + 'px';
        }

        function stop() {
            dragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        }
    }

    //全部删除逻辑
    function bindClearButton() {
        const btn = document.querySelector('.gh-clear-btn');
        const panel = document.querySelector('.grade-helper-panel');
        const groups = document.querySelector('.gh-groups');
        btn.addEventListener('click', () => {
            if (!groups.children.length) return;
            // 震动动画
            panel.classList.add('gh-shake');
            setTimeout(() => {
                panel.classList.remove('gh-shake');
            }, 350);
            // 内容渐隐
            groups.classList.add('gh-fade-out');
            setTimeout(() => {
                // 清空数据
                groups.innerHTML = '';
                selected_subjects = [];
                document.querySelectorAll('td>input').forEach(ele => {
                    ele.checked = false;
                })
                groups.classList.remove('gh-fade-out');
                calculateAverage();
            }, 250);
        });
    }

    //全局监听
    function full_mutations() {
        //现在有一个问题：就是当我切换页数的时候，它竟然时不时调用一下表头的style函数，将我的操作给“取消”掉。所以我必须全局监控一下表头的属性变化，当它想给我表头取消掉的时候，我要再次调用一下我的一系列函数。
        // 创建 MutationObserver 实例
        const observer = new MutationObserver((mutations) => {
            // console.log(mutations);
            // 过滤并输出 style 属性相关的 mutations
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' &&
                    mutation.attributeName === 'style' && mutation.oldValue === 'z-index: 330; position: absolute; height: 100%; width: 100px; display: block; left: 1500px;') {
                    console.log("属性变化了");
                    hooked = false;
                    waitForElements((elements) => {
                        hookTableDrag(...elements);
                        copy_three_columns(true);
                    }, true, false, null, bodySelector, dragBarSelector)
                }
            }
            );
        });

        // 配置观察选项（监听 DOM 元素的 style 属性变化）
        const observerConfig = {
            attributes: true,               // 监听属性变化
            attributeOldValue: true,        // 记录属性旧值
            attributeFilter: ['style'],     // 仅监听 style 属性
            subtree: true                 // 监听子元素
        };

        // 开始观察
        const element = document.querySelector('.jqx-tabs-content');
        if (element) {
            observer.observe(element, observerConfig);
            console.log('开始监听元素 style 属性变化');
        } else {
            console.error('未找到要监听的元素');
        }
    }

    //页面刚打开
    if (document.body) {
        // body 已存在，可以安全挂载 MutationObserver
        waitForElements((elements) => {
            insertGradePanel();
            bindClearButton();
            search_btn_addEvent();
            document.querySelector(pager + ' div.bh-pull-left>input').readOnly = true
            full_mutations()
            //扩展所有列，处理拖动条
            hookTableDrag(...elements);
            //复制前三列
            copy_three_columns();
            //处理钉住前三列的按钮
            fixed_columns();
            //给切换按钮添加监听事件
            const btns = document.querySelectorAll('.jqx-tabs-title-container>li');
            btns.forEach((btn) => {
                function onTabClick() {
                    hooked = false;
                    Array.from(document.querySelectorAll('div[role=tabpanel]'))
                        .find(find_callback)
                    waitForElements((elements) => {
                        document.querySelector(pager + ' div.bh-pull-left>input').readOnly = true
                        hookTableDrag(...elements);
                        copy_three_columns();
                        // fixed_columns();
                        switch_pannel();
                        selector_numbers_addEvent(false);
                    }, true, false, null, bodySelector, dragBarSelector, headerSelector);
                }
                btn.removeEventListener('click', onTabClick);
                btn.addEventListener('click', onTabClick);
            })
            switch_pannel();
            selector_numbers_addEvent(true);
        }, true, false, null, bodySelector, dragBarSelector, headerSelector);
    }
})();