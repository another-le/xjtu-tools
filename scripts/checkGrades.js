(function () {

    function waitForElements(callback, ...selectors) {
        const check = () => {
            const elements = selectors.map(selector => document.querySelector(selector));
            return elements.every(Boolean) ? elements : null;
        };

        const ready = check();
        if (ready) {
            callback(ready);
            return;
        }

        const observer = new MutationObserver((_, currentObserver) => {
            const loadedElements = check();
            if (loadedElements) {
                currentObserver.disconnect();
                callback(loadedElements);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function insertSelectAllButton() {
        if (document.querySelector('#selectAllBtn')) return;
        const templateButton = document.querySelector('.bh-advancedQuery-inputGroup>a');
        const parent = document.querySelector('.jqx-tabs-title-container');
        if (!templateButton || !parent) return;

        const selectAllButton = templateButton.cloneNode(false);
        selectAllButton.textContent = '全选本页';
        selectAllButton.id = 'selectAllBtn';
        selectAllButton.removeAttribute('bh-advanced-query-role');
        selectAllButton.addEventListener('click', () => {
            const tableName = getActiveGradeTableName();
            const checkboxes = Array.from(document.querySelectorAll(
                `#contenttable${tableName}-index-table .xjtu-grade-select-checkbox:not(:disabled)`
            ));
            const shouldCheck = checkboxes.some(checkbox => !checkbox.checked);
            checkboxes.forEach(checkbox => {
                if (checkbox.checked !== shouldCheck) checkbox.click();
            });
        });
        parent.appendChild(selectAllButton);
    }

    const GRADE_TABLE_NAMES = ['dqxq', 'qb'];

    function getActiveGradeTableName() {
        return GRADE_TABLE_NAMES.find(tableName => {
            const table = document.querySelector(`#${tableName}-index-table`);
            const tabPanel = table?.closest('div[role="tabpanel"]');
            return table && (!tabPanel || getComputedStyle(tabPanel).display !== 'none');
        }) || GRADE_TABLE_NAMES.find(tableName =>
            document.querySelector(`#contenttable${tableName}-index-table`)
        ) || 'dqxq';
    }

    const selectedCourseKeys = new Set();
    let draggedSemesterGroup = null;
    const selectedCourseDetails = new Map();
    let gradeDetailZIndex = 1000000;
    let excludeGeneralEducationCourses = false;

    const EXCLUDED_COURSE_CATEGORIES = new Set([
        '基础通识类选修课',
        '基础通识类核心课',
    ]);

    const TRANSCRIPT_PRINT_URL = 'https://dzpz.xjtu.edu.cn/wui/index.html?#/main/cs/app/de7bbe52b2684ad08df41d3043f07d80_Guide?mode=guide&id=29&menuId=2&_key=6pjdy6';
    const GRADE_SETTINGS_STORAGE_KEY = 'gradeHelperSettings';
    const DEFAULT_GRADE_SETTINGS = {
        rules: [
            { grade: 'A+', score: 95, gpa: 4.3 },
            { grade: 'A', score: 90, gpa: 4.0 },
            { grade: 'A-', score: 85, gpa: 3.7 },
            { grade: 'B+', score: 81, gpa: 3.3 },
            { grade: 'B', score: 78, gpa: 3.0 },
            { grade: 'B-', score: 75, gpa: 2.7 },
            { grade: 'C+', score: 72, gpa: 2.3 },
            { grade: 'C', score: 68, gpa: 2.0 },
            { grade: 'C-', score: 64, gpa: 1.7 },
            { grade: 'D', score: 60, gpa: 1.3 },
            { grade: 'F', score: 0, gpa: 0 },
        ],
        averageMode: 'credit-weighted',
        decimalPlaces: 2,
        passingScore: 60,
    };
    let gradeSettings = cloneDefaultGradeSettings();

    function cloneDefaultGradeSettings() {
        return {
            ...DEFAULT_GRADE_SETTINGS,
            rules: DEFAULT_GRADE_SETTINGS.rules.map(rule => ({ ...rule })),
        };
    }

    function normalizeGradeName(value) {
        return String(value || '').trim().normalize('NFKC').toUpperCase();
    }

    function isNumericScore(value) {
        const normalized = String(value ?? '').trim().normalize('NFKC');
        return normalized !== '' && Number.isFinite(Number(normalized));
    }

    function sanitizeGradeSettings(value) {
        if (!value || !Array.isArray(value.rules)) return cloneDefaultGradeSettings();

        const seen = new Set();
        const rules = value.rules.reduce((result, rule) => {
            const grade = normalizeGradeName(rule?.grade);
            const score = Number(rule?.score);
            const gpa = Number(rule?.gpa);
            if (!grade || isNumericScore(grade) || seen.has(grade) || !Number.isFinite(score) || score < 0 || score > 100 ||
                !Number.isFinite(gpa) || gpa < 0 || gpa > 10) return result;
            seen.add(grade);
            result.push({ grade, score, gpa });
            return result;
        }, []);

        if (!rules.length) return cloneDefaultGradeSettings();
        const decimalPlaces = Number.parseInt(value.decimalPlaces, 10);
        const passingScore = Number(value.passingScore);
        return {
            rules,
            averageMode: value.averageMode === 'arithmetic' ? 'arithmetic' : 'credit-weighted',
            decimalPlaces: Number.isInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 4
                ? decimalPlaces
                : DEFAULT_GRADE_SETTINGS.decimalPlaces,
            passingScore: Number.isFinite(passingScore) && passingScore >= 0 && passingScore <= 100
                ? passingScore
                : DEFAULT_GRADE_SETTINGS.passingScore,
        };
    }

    function loadGradeSettings() {
        return new Promise(resolve => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) {
                resolve();
                return;
            }
            try {
                chrome.storage.local.get(GRADE_SETTINGS_STORAGE_KEY, result => {
                    if (!chrome.runtime.lastError && result?.[GRADE_SETTINGS_STORAGE_KEY]) {
                        gradeSettings = sanitizeGradeSettings(result[GRADE_SETTINGS_STORAGE_KEY]);
                    }
                    resolve();
                });
            } catch (error) {
                console.warn('读取成绩统计设置失败，将使用默认设置。', error);
                resolve();
            }
        });
    }

    function persistGradeSettings(settings) {
        return new Promise(resolve => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) {
                resolve(false);
                return;
            }
            try {
                chrome.storage.local.set({ [GRADE_SETTINGS_STORAGE_KEY]: settings }, () => {
                    resolve(!chrome.runtime.lastError);
                });
            } catch (error) {
                console.warn('保存成绩统计设置失败。', error);
                resolve(false);
            }
        });
    }

    function convertSemester(str) {
        // 中文数字映射
        const map = {
            '一': '1',
            '二': '2',
        };
        // 正则匹配：四位年份 - 四位年份 + "学年" + 可选空格 + "第X学期"
        const regex = /(\d{4})-(\d{4})\s*学年\s*第([一二])学期/;
        return str.replace(regex, (match, year1, year2, semesterChinese) => {
            return `${year1}-${year2}-${map[semesterChinese]}`;
        });
    }

    //等级制成绩转换：使用用户在成绩统计设置中维护的规则
    function resolveGrade(score) {
        if (!score || isNumericScore(score)) return null;
        const grade = normalizeGradeName(score);
        const rule = gradeSettings.rules.find(item => item.grade === grade);
        return rule ? { score: rule.score, gpa: rule.gpa, grade } : null;
    }

    const GRADE_DETAIL_COLUMN_KEYS = {
        dqxq: [
            'XNXQDM_DISPLAY', 'KCH', 'KCM', 'KXH', 'KCXZDM_DISPLAY', 'KCLBDM_DISPLAY',
            'KKDWDM_DISPLAY', 'XF', 'XS', 'XH', 'DJCJLXDM_DISPLAY', 'ZCJ', 'XFJD',
            'XDFSDM_DISPLAY', 'SFZX_DISPLAY', 'CXCKDM_DISPLAY', 'SFYX_DISPLAY',
            'SFJG_DISPLAY', 'TSYYDM_DISPLAY', 'SFPJ', 'JXBID', 'DJCJMC',
            'QTCJ10_DISPLAY', 'QTCJ6_DISPLAY', 'QTCJ7_DISPLAY', 'QTCJ8_DISPLAY',
            'QTCJ9_DISPLAY', 'QTCJ2_DISPLAY', 'QTCJ3_DISPLAY', 'QTCJ4_DISPLAY',
            'QTCJ5_DISPLAY', 'QTCJ1_DISPLAY', 'JDF', 'PSCJ_DISPLAY', 'QMCJ_DISPLAY',
            'QZCJ_DISPLAY', 'SYCJ_DISPLAY', 'SJCJ_DISPLAY',
        ],
        qb: [
            'OPERATION', 'XNXQDM_DISPLAY', 'KCM', 'KCH', 'KXH', 'KCLBDM_DISPLAY',
            'KCXZDM_DISPLAY', 'XF', 'XS', 'XDFSDM_DISPLAY', 'SFZX_DISPLAY', 'ZCJ',
            'KSSJ', 'XFJD', 'JDF', 'BY8', 'BY7', 'RZLBDM', 'BY9', 'BY10', 'WID',
            'ORDERFILTER', 'BY2', 'BY1', 'BY4', 'BY3', 'BY6', 'BY5', 'SJKSRQ', 'XH',
            'JXBID', 'CXCKDM_DISPLAY', 'DJCJLXDM_DISPLAY', 'DJCJMC', 'PSCJ_DISPLAY',
            'PSCJXS', 'QZCJ_DISPLAY', 'QZCJXS', 'QMCJ_DISPLAY', 'QMCJXS',
            'SYCJ_DISPLAY', 'SJCJ_DISPLAY', 'QTCJ1_DISPLAY', 'QTCJ2_DISPLAY',
            'QTCJ3_DISPLAY', 'QTCJ4_DISPLAY', 'QTCJ5_DISPLAY', 'QTCJ6_DISPLAY',
            'QTCJ7_DISPLAY', 'QTCJ8_DISPLAY', 'QTCJ9_DISPLAY', 'QTCJ10_DISPLAY',
            'KSLXDM_DISPLAY', 'KKDWDM_DISPLAY', 'SFJG_DISPLAY', 'SFYX_DISPLAY',
            'TSYYDM_DISPLAY', 'SFPJ', 'HASFC',
        ],
    };

    const GRADE_DETAIL_FIELD_CONFIG = {
        XNXQDM_DISPLAY: { label: '学年学期', category: '课程信息' },
        KCH: { label: '课程号', category: '课程信息' },
        KCM: { label: '课程名称', category: '课程信息' },
        KXH: { label: '课序号', category: '课程信息' },
        KCXZDM_DISPLAY: { label: '课程性质', category: '课程信息' },
        KCLBDM_DISPLAY: { label: '课程类别', category: '课程信息' },
        KKDWDM_DISPLAY: { label: '开课单位', category: '课程信息' },
        XF: { label: '学分', category: '课程信息' },
        XS: { label: '学时', category: '课程信息' },
        XDFSDM_DISPLAY: { label: '修读方式', category: '课程信息' },
        SFZX_DISPLAY: { label: '修读类型', category: '课程信息' },
        CXCKDM_DISPLAY: { label: '修读记录', category: '课程信息' },
        KSLXDM_DISPLAY: { label: '考试类型', category: '课程信息' },
        SJKSRQ: { label: '考试日期', category: '课程信息' },
        DJCJLXDM_DISPLAY: { label: '成绩类型', category: '成绩构成' },
        ZCJ: { label: '总成绩', category: '成绩构成' },
        DJCJMC: { label: '等级成绩', category: '成绩构成' },
        XFJD: { label: '绩点', category: '成绩构成' },
        JDF: { label: '积点分', category: '成绩构成' },
        PSCJ_DISPLAY: { label: '平时成绩', category: '成绩构成' },
        PSCJXS: { label: '平时成绩占比', category: '成绩构成', percentage: true },
        QZCJ_DISPLAY: { label: '期中成绩', category: '成绩构成' },
        QZCJXS: { label: '期中成绩占比', category: '成绩构成', percentage: true },
        QMCJ_DISPLAY: { label: '期末成绩', category: '成绩构成' },
        QMCJXS: { label: '期末成绩占比', category: '成绩构成', percentage: true },
        SYCJ_DISPLAY: { label: '实验成绩', category: '成绩构成' },
        SJCJ_DISPLAY: { label: '实践成绩', category: '成绩构成' },
        SFYX_DISPLAY: { label: '成绩是否有效', category: '成绩状态' },
        SFJG_DISPLAY: { label: '是否及格', category: '成绩状态' },
        TSYYDM_DISPLAY: { label: '特殊原因', category: '成绩状态' },
        SFPJ: { label: '是否评教', category: '成绩状态', boolean: true },
        HASFC: { label: '是否复查', category: '成绩状态', boolean: true },
    };

    for (let index = 1; index <= 10; index += 1) {
        GRADE_DETAIL_FIELD_CONFIG[`QTCJ${index}_DISPLAY`] = {
            label: `其他成绩${index}`,
            category: '成绩构成',
        };
    }

    const DETAIL_SKIPPED_KEYS = new Set([
        'OPERATION', 'XH', 'JXBID', 'WID', 'ORDERFILTER', 'RZLBDM', 'KSSJ',
        'BY1', 'BY2', 'BY3', 'BY4', 'BY5', 'BY6', 'BY7', 'BY8', 'BY9', 'BY10',
    ]);
    const DETAIL_PROMOTED_KEYS = new Set(['XNXQDM_DISPLAY', 'KCH', 'KCM', 'ZCJ', 'XF', 'XFJD']);

    function cleanDetailValue(value) {
        const text = String(value ?? '').trim();
        return /^(null|undefined)$/i.test(text) ? '' : text;
    }

    function getCellText(cell) {
        if (!cell) return '';
        const titledElement = cell.querySelector('[title]');
        const title = titledElement?.getAttribute('title');
        if (title !== null && title !== undefined && title !== '') return cleanDetailValue(title);
        return cleanDetailValue(cell.textContent);
    }

    function getCurrentHeaderLabels(tableName) {
        return Array.from(document.querySelectorAll(`#columntable${tableName}-index-table > div`)).map(header => {
            const labelElement = header.querySelector('span');
            return cleanDetailValue(labelElement?.getAttribute('title') || labelElement?.textContent);
        });
    }

    function normalizeDetailLabel(label) {
        const raw = cleanDetailValue(label);
        return raw.replace(/_DISPLAY$/i, '').replace(/^QT(?:CJ)?(\d+)$/i, '其他成绩$1');
    }

    function getDetailCategory(label) {
        if (/成绩|绩点|积点|系数/.test(label)) return '成绩构成';
        if (/有效|及格|评教|复查|特殊原因/.test(label)) return '成绩状态';
        return '课程信息';
    }

    function formatDetailFieldValue(key, value) {
        const text = cleanDetailValue(value);
        if (!text) return '';
        const config = GRADE_DETAIL_FIELD_CONFIG[key];
        if (config?.percentage && /^-?\d+(?:\.\d+)?$/.test(text)) return `${text}%`;
        if (config?.boolean) {
            if (text === '1') return '是';
            if (text === '0') return '否';
        }
        return text;
    }

    function extractCourseDetail(row, tableName) {
        const headerLabels = getCurrentHeaderLabels(tableName);
        const columnKeys = GRADE_DETAIL_COLUMN_KEYS[tableName] || [];
        const cells = Array.from(row.children).filter(cell => cell.tagName === 'TD');
        const fields = [];

        cells.forEach((cell, index) => {
            const key = columnKeys[index] || headerLabels[index] || `field-${index}`;
            if (DETAIL_SKIPPED_KEYS.has(key)) return;
            const config = GRADE_DETAIL_FIELD_CONFIG[key];
            const label = config?.label || normalizeDetailLabel(headerLabels[index]);
            const value = formatDetailFieldValue(key, getCellText(cell));
            if (!label || !value) return;
            fields.push({
                key,
                label,
                value,
                category: config?.category || getDetailCategory(label),
            });
        });

        const fieldValue = (...identifiers) => fields.find(item =>
            identifiers.includes(item.key) || identifiers.includes(item.label)
        )?.value || '';
        const detailAnchor = row.querySelector('a[data-kch]');
        const dataset = detailAnchor?.dataset || {};
        const semester = convertSemester(cleanDetailValue(dataset.xnxqdm || fieldValue('XNXQDM_DISPLAY')));
        const code = cleanDetailValue(dataset.kch || fieldValue('KCH'));
        const name = cleanDetailValue(dataset.kcm || fieldValue('KCM'));
        const sequence = fieldValue('KXH');
        const key = [semester, code, sequence].filter(Boolean).join('::');
        const gradeName = cleanDetailValue(dataset.djcjmc || fieldValue('DJCJMC'));
        const rawScore = cleanDetailValue(dataset.zcj || fieldValue('ZCJ'));
        const totalScore = gradeName && rawScore && gradeName !== rawScore
            ? `${gradeName} (${rawScore})`
            : (gradeName || rawScore);

        return {
            key: key || `${semester}::${code}::${name}`,
            semester,
            code,
            name,
            credit: cleanDetailValue(dataset.xf || fieldValue('XF')),
            courseCategory: cleanDetailValue(fieldValue('KCLBDM_DISPLAY')),
            totalScore,
            gradePoint: cleanDetailValue(dataset.xfjd || fieldValue('XFJD')),
            fields: fields.filter(field => !DETAIL_PROMOTED_KEYS.has(field.key)),
        };
    }

    function createDetailTextElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text || '—';
        return element;
    }

    function detailFieldRank(field) {
        const fixedOrder = ['总成绩', '等级成绩', '绩点', '积点分', '平时成绩', '期中成绩', '期末成绩', '实验成绩', '实践成绩'];
        const baseLabel = field.label.replace(/系数$/, '');
        const fixedIndex = fixedOrder.indexOf(baseLabel);
        if (fixedIndex !== -1) return fixedIndex * 2 + (/系数$/.test(field.label) ? 1 : 0);
        const otherScore = field.label.match(/^其他成绩(\d+)(系数)?$/);
        if (otherScore) return 30 + Number(otherScore[1]) * 2 + (otherScore[2] ? 1 : 0);
        return 1000;
    }

    function positionGradeDetailPanel(panel) {
        const usedSlots = new Set(Array.from(document.querySelectorAll('.gh-course-detail-panel'))
            .filter(item => item !== panel)
            .map(item => Number(item.dataset.layoutSlot))
            .filter(Number.isFinite));
        let layoutSlot = 0;
        while (usedSlots.has(layoutSlot)) layoutSlot += 1;
        panel.dataset.layoutSlot = layoutSlot;
        const panelWidth = panel.offsetWidth || 420;
        const gap = 12;
        const margin = 16;
        const columns = Math.max(1, Math.floor((window.innerWidth - margin * 2 + gap) / (panelWidth + gap)));
        const column = layoutSlot % columns;
        const row = Math.floor(layoutSlot / columns);
        panel.style.left = `${margin + column * (panelWidth + gap)}px`;
        panel.style.top = `${Math.min(76 + row * 34, Math.max(16, window.innerHeight - 180))}px`;
    }

    function bringGradeDetailPanelToFront(panel) {
        gradeDetailZIndex += 1;
        panel.style.zIndex = String(gradeDetailZIndex);
    }

    function makeGradeDetailPanelDraggable(panel) {
        const header = panel.querySelector('.gh-detail-panel-header');
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', event => {
            if (event.button !== 0 || event.target.closest('button')) return;
            event.preventDefault();
            offsetX = event.clientX - panel.offsetLeft;
            offsetY = event.clientY - panel.offsetTop;

            const move = moveEvent => {
                const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
                const maxTop = Math.max(0, window.innerHeight - header.offsetHeight);
                panel.style.left = `${Math.min(Math.max(0, moveEvent.clientX - offsetX), maxLeft)}px`;
                panel.style.top = `${Math.min(Math.max(0, moveEvent.clientY - offsetY), maxTop)}px`;
            };
            const stop = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', stop);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });
    }

    function openGradeDetailPanel(detail) {
        if (!detail?.key) return;
        const existing = Array.from(document.querySelectorAll('.gh-course-detail-panel'))
            .find(panel => panel.dataset.courseKey === detail.key);
        if (existing) {
            bringGradeDetailPanelToFront(existing);
            existing.classList.remove('gh-detail-panel-pulse');
            requestAnimationFrame(() => existing.classList.add('gh-detail-panel-pulse'));
            return;
        }

        const panel = document.createElement('section');
        panel.className = 'gh-course-detail-panel';
        panel.dataset.courseKey = detail.key;
        panel.setAttribute('aria-label', `${detail.name}成绩详情`);
        panel.innerHTML = `
            <header class="gh-detail-panel-header">
                <div>
                    <span class="gh-detail-eyebrow">课程成绩详情</span>
                    <h2 class="gh-detail-course-name"></h2>
                </div>
                <button type="button" class="gh-detail-close" aria-label="关闭成绩详情">×</button>
            </header>
            <div class="gh-detail-meta">
                <span class="gh-detail-semester"></span>
                <span class="gh-detail-code"></span>
            </div>
            <div class="gh-detail-summary" aria-label="课程成绩摘要"></div>
            <div class="gh-detail-fields"></div>
            <footer class="gh-detail-footer"></footer>
        `;

        const courseName = detail.name || '未命名课程';
        const courseNameElement = panel.querySelector('.gh-detail-course-name');
        courseNameElement.textContent = courseName;
        courseNameElement.title = courseName;
        panel.querySelector('.gh-detail-semester').textContent = detail.semester || '未知学期';
        panel.querySelector('.gh-detail-code').textContent = detail.code || '无课程号';

        const summary = panel.querySelector('.gh-detail-summary');
        [['总成绩', detail.totalScore], ['绩点', detail.gradePoint], ['学分', detail.credit]].forEach(([label, value]) => {
            const item = document.createElement('div');
            item.append(
                createDetailTextElement('span', '', label),
                createDetailTextElement('strong', '', value)
            );
            summary.appendChild(item);
        });

        const fieldsContainer = panel.querySelector('.gh-detail-fields');
        ['成绩构成', '课程信息', '成绩状态'].forEach(category => {
            const fields = detail.fields
                .filter(field => field.category === category)
                .sort((a, b) => detailFieldRank(a) - detailFieldRank(b));
            if (!fields.length) return;

            const section = document.createElement('section');
            section.className = 'gh-detail-section';
            section.dataset.category = category;
            const heading = document.createElement('div');
            heading.className = 'gh-detail-section-heading';
            heading.append(
                createDetailTextElement('h3', '', category),
                createDetailTextElement('span', '', `${fields.length} 项`)
            );
            const list = document.createElement('dl');
            fields.forEach(field => {
                const fieldRow = document.createElement('div');
                fieldRow.className = 'gh-detail-field-row';
                fieldRow.append(
                    createDetailTextElement('dt', '', field.label),
                    createDetailTextElement('dd', '', field.value)
                );
                list.appendChild(fieldRow);
            });
            section.append(heading, list);
            fieldsContainer.appendChild(section);
        });

        panel.querySelector('.gh-detail-footer').textContent = `已展示 ${detail.fields.length} 项有效信息`;
        panel.querySelector('.gh-detail-close').addEventListener('click', event => {
            event.stopPropagation();
            panel.remove();
        });
        panel.addEventListener('mousedown', event => {
            event.stopPropagation();
            bringGradeDetailPanelToFront(panel);
        });
        panel.addEventListener('click', event => event.stopPropagation());
        document.body.appendChild(panel);
        bringGradeDetailPanelToFront(panel);
        positionGradeDetailPanel(panel);
        makeGradeDetailPanelDraggable(panel);
    }

    function removeSelectedCourse(row) {
        if (!row) return;
        selectedCourseDetails.delete(row.dataset.courseKey);
        row.remove();
    }

    function syncCourseCheckboxes(courseKey, checked) {
        document.querySelectorAll('.xjtu-grade-select-checkbox').forEach(checkbox => {
            if (checkbox.dataset.courseKey === courseKey) checkbox.checked = checked;
        });
    }

    function locateCourseInStats(courseKey, courseCode) {
        const row = Array.from(document.querySelectorAll('.grade-helper-panel .gh-table tbody tr'))
            .find(item => item.dataset.courseKey === courseKey || item.id === courseCode);
        if (!row) return;

        const group = row.closest('.gh-group');
        const table = group?.querySelector('.gh-table');
        const arrow = group?.querySelector('.gh-arrow');
        if (table?.style.display === 'none') {
            table.style.display = '';
            if (arrow) arrow.textContent = '▼';
        }

        const content = row.closest('.gh-content');
        if (content) {
            const contentRect = content.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const centeredTop = content.scrollTop + rowRect.top - contentRect.top
                - (content.clientHeight - row.offsetHeight) / 2;
            content.scrollTo({ top: Math.max(0, centeredTop), behavior: 'auto' });
        }

        row.classList.remove('gh-row-locate-flash');
        requestAnimationFrame(() => {
            row.classList.add('gh-row-locate-flash');
            setTimeout(() => row.classList.remove('gh-row-locate-flash'), 1200);
        });
    }

    // 在学校原始表格上只增加选择框和详情入口，不改变原有列宽与显示状态。
    function enhanceGradeTable(tableName) {
        const rows = document.querySelectorAll(`#contenttable${tableName}-index-table > table:nth-child(1) tbody > tr`);

        rows.forEach(row => {
            const firstCell = row.children[0];
            const courseCell = row.children[2];
            if (!firstCell || !courseCell) return;

            const detail = extractCourseDetail(row, tableName);
            row.dataset.gradeDetailKey = detail.key;
            firstCell.classList.add('xjtu-grade-operation-cell');

            if (!courseCell.querySelector('.xjtu-grade-detail-btn')) {
                courseCell.classList.add('xjtu-grade-course-cell');
                const detailButton = document.createElement('button');
                detailButton.type = 'button';
                detailButton.className = 'xjtu-grade-detail-btn';
                detailButton.textContent = '成绩详情';
                detailButton.title = `查看${detail.name || '该课程'}的成绩详情`;
                detailButton.addEventListener('click', event => {
                    event.stopPropagation();
                    openGradeDetailPanel(detail);
                });
                courseCell.appendChild(detailButton);
            }

            if (firstCell.querySelector('.xjtu-grade-select-checkbox')) return;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'xjtu-grade-select-checkbox';
            checkbox.id = `checkbox${detail.code}`;
            checkbox.dataset.courseKey = detail.key;
            checkbox.checked = selectedCourseKeys.has(detail.key);
            checkbox.title = '加入成绩统计';
            checkbox.setAttribute('aria-label', `将${detail.name || '该课程'}加入成绩统计`);

            const isDeferred = Array.from(row.children).some(td => /缓考/.test(td.textContent));
            if (isDeferred) {
                checkbox.disabled = true;
                checkbox.title = '缓考课程暂不参与成绩统计';
            }

            checkbox.addEventListener('change', event => {
                if (event.currentTarget.checked) {
                    if (selectedCourseKeys.has(detail.key)) {
                        syncCourseCheckboxes(detail.key, true);
                        return;
                    }
                    let score = detail.totalScore;
                    let displayGrade = null;
                    const detailAnchor = row.querySelector('a[data-kch]');
                    const rawScore = cleanDetailValue(detailAnchor?.dataset.zcj || detail.totalScore);
                    const gradeName = cleanDetailValue(detailAnchor?.dataset.djcjmc);

                    if (gradeName) {
                        displayGrade = rawScore ? `${gradeName} (${rawScore})` : gradeName;
                        score = gradeName;
                    } else if (!isNumericScore(score)) {
                        displayGrade = score;
                    }

                    addGradeRow(
                        detail.semester, detail.name, detail.credit, score,
                        detail.gradePoint, detail.code, displayGrade, detail
                    );
                    selectedCourseKeys.add(detail.key);
                    syncCourseCheckboxes(detail.key, true);
                    return;
                }

                selectedCourseKeys.delete(detail.key);
                syncCourseCheckboxes(detail.key, false);
                const gradeRow = Array.from(document.querySelectorAll('.grade-helper-panel .gh-table tbody tr'))
                    .find(item => item.dataset.courseKey === detail.key || item.id === detail.code);
                const group = gradeRow?.closest('.gh-group');
                removeSelectedCourse(gradeRow);
                if (group && !group.querySelector('tbody tr')) group.remove();
                calculateAverage();
            });

            const locateButton = document.createElement('button');
            locateButton.type = 'button';
            locateButton.className = 'xjtu-grade-locate-btn';
            locateButton.innerHTML = `
                <svg class="xjtu-grade-locate-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <circle cx="8" cy="8" r="3.25"></circle>
                    <circle class="xjtu-grade-locate-dot" cx="8" cy="8" r="0.9"></circle>
                    <path d="M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5"></path>
                </svg>`;
            locateButton.title = '在成绩统计中定位该课程';
            locateButton.setAttribute('aria-label', `在成绩统计中定位${detail.name || '该课程'}`);
            locateButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                locateCourseInStats(detail.key, detail.code);
            });

            const actions = document.createElement('span');
            actions.className = 'xjtu-grade-inline-actions';
            actions.append(checkbox, locateButton);
            firstCell.appendChild(actions);
        });
    }

    function enhanceAllGradeTables() {
        GRADE_TABLE_NAMES.forEach(enhanceGradeTable);
    }

    function observeGradeTableChanges() {
        const tabsContent = document.querySelector('.jqx-tabs-content');
        if (!tabsContent || tabsContent.dataset.gradeDetailsObserved) return;
        tabsContent.dataset.gradeDetailsObserved = 'true';
        let scheduled = false;
        const observer = new MutationObserver(mutations => {
            if (!mutations.some(mutation => mutation.type === 'childList' && mutation.addedNodes.length)) return;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                enhanceAllGradeTables();
            });
        });
        observer.observe(tabsContent, { childList: true, subtree: true });
    }

    function insertGradePanel() {
        if (document.querySelector('.grade-helper-panel')) return;
        const panel = document.createElement('div');
        panel.className = 'grade-helper-panel';
        panel.innerHTML = `
        <div class="gh-header">
            <span class="gh-header-title">成绩统计</span>
            <div class="gh-header-actions">
                <button type="button" class="gh-category-filter-btn" aria-pressed="false" title="从统计中去除基础通识类选修课和基础通识类核心课">去除通识课</button>
                <a class="gh-transcript-link" href="${TRANSCRIPT_PRINT_URL}" target="_blank" rel="noopener noreferrer" title="前往学校官网打印成绩单">打印成绩单 ↗</a>
                <button type="button" class="gh-settings-btn" aria-label="打开成绩统计设置" aria-expanded="false" title="成绩统计设置">⚙</button>
            </div>
        </div>

        <div class="gh-content">
            <div class="gh-groups"></div>
        </div>

        <div class="gh-footer">
            <div class="gh-footer-left" aria-label="所选课程汇总">
                <div class="gh-summary-item">
                    <span>总学分</span>
                    <strong class="gh-total-credits">0</strong>
                </div>
                <div class="gh-summary-item">
                    <span>平均分</span>
                    <strong class="gh-average">0.00</strong>
                </div>
                <div class="gh-summary-item">
                    <span>平均绩点</span>
                    <strong class="gpa-average">0.00</strong>
                </div>
            </div>

            <div class="gh-footer-actions">
                <span class="gh-help-icon">ⓘ<div class="gh-help-tooltip gh-rule-tooltip">
                    <div class="gh-tooltip-title">当前等级换算规则</div>
                    <div class="gh-rule-summary"></div>
                    <div class="gh-calculation-summary"></div>
                    <div class="gh-tooltip-note">点击标题栏齿轮可修改</div>
                </div></span>

                <span class="gh-help-icon">ⓘ<div class="gh-help-tooltip gh-grade-help-tooltip">
                    <b style="color:#fff;">成绩列括号说明</b><br>
                    <span style="color:#fff;">显示 &quot;A (92)&quot;：</span><br>
                    <span style="color:#ccc;">等级为 A，真实分数 92 分<br>括号内分数仅供参考</span><br>
                    <span style="color:#fff;">显示 &quot;A&quot;：</span><br>
                    <span style="color:#ccc;">仅有等级，无真实分数<br>使用设置中的换算分数计算</span>
                </div></span>

                <button class="gh-clear-btn">全部删除</button>
            </div>
        </div>

        <div class="gh-settings-overlay" hidden>
            <section class="gh-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="gh-settings-title">
                <div class="gh-settings-heading">
                    <div>
                        <h2 id="gh-settings-title">成绩统计设置</h2>
                        <p>自定义等级换算与平均值算法</p>
                    </div>
                    <button type="button" class="gh-settings-close" aria-label="关闭设置">×</button>
                </div>

                <div class="gh-settings-body">
                    <div class="gh-settings-section">
                        <div class="gh-settings-section-title">
                            <span>等级换算</span>
                            <button type="button" class="gh-add-rule-btn">＋ 添加等级</button>
                        </div>
                        <div class="gh-rule-table-wrap">
                            <table class="gh-rule-table">
                                <thead><tr><th>等级</th><th>换算分数</th><th>绩点</th><th></th></tr></thead>
                                <tbody class="gh-rule-editor"></tbody>
                            </table>
                        </div>
                    </div>

                    <div class="gh-settings-section gh-calculation-settings">
                        <div class="gh-settings-section-title"><span>平均值计算</span></div>
                        <label>
                            <span>计算方式</span>
                            <select class="gh-average-mode">
                                <option value="credit-weighted">按学分加权</option>
                                <option value="arithmetic">课程算术平均</option>
                            </select>
                        </label>
                        <label>
                            <span>保留小数位</span>
                            <input class="gh-decimal-places" type="number" min="0" max="4" step="1">
                        </label>
                        <label>
                            <span>及格分数线</span>
                            <input class="gh-passing-score" type="number" min="0" max="100" step="0.1">
                        </label>
                    </div>
                    <p class="gh-settings-status" role="status" aria-live="polite"></p>
                </div>

                <div class="gh-settings-footer">
                    <button type="button" class="gh-reset-settings-btn">恢复默认</button>
                    <div>
                        <button type="button" class="gh-cancel-settings-btn">取消</button>
                        <button type="button" class="gh-save-settings-btn">保存并重算</button>
                    </div>
                </div>
            </section>
        </div>
    `;
        document.body.appendChild(panel);
        makePanelDraggable(panel);
        renderRuleSummary();
        bindGradeSettings();
        bindCourseCategoryFilter();
    }

    function isExcludedCourseCategory(category) {
        return EXCLUDED_COURSE_CATEGORIES.has(cleanDetailValue(category).normalize('NFKC'));
    }

    function isCourseExcludedFromStats(row) {
        return excludeGeneralEducationCourses && isExcludedCourseCategory(row?.dataset.courseCategory);
    }

    function syncCourseCategoryFilterState() {
        const rows = Array.from(document.querySelectorAll('.gh-table tbody tr'));
        let excludedCount = 0;
        rows.forEach(row => {
            const excluded = isCourseExcludedFromStats(row);
            row.classList.toggle('gh-row-excluded', excluded);
            if (excluded) excludedCount += 1;
            if (excluded) {
                row.title = `课程类别“${row.dataset.courseCategory}”已暂时从统计中去除`;
            } else {
                row.title = row.classList.contains('gh-row-unmapped')
                    ? `等级“${row.dataset.grade}”尚未配置，不参与平均值计算`
                    : '';
            }
        });

        const button = document.querySelector('.gh-category-filter-btn');
        if (!button) return;
        button.classList.toggle('is-active', excludeGeneralEducationCourses);
        button.setAttribute('aria-pressed', String(excludeGeneralEducationCourses));
        button.textContent = excludeGeneralEducationCourses
            ? `加回通识课${excludedCount ? `（${excludedCount}）` : ''}`
            : '去除通识课';
        button.title = excludeGeneralEducationCourses
            ? `已去除 ${excludedCount} 门基础通识类选修课/核心课，点击加回统计`
            : '从统计中去除基础通识类选修课和基础通识类核心课';
    }

    function bindCourseCategoryFilter() {
        const button = document.querySelector('.gh-category-filter-btn');
        if (!button) return;
        button.addEventListener('click', () => {
            excludeGeneralEducationCourses = !excludeGeneralEducationCourses;
            calculateAverage();
        });
    }

    function formatRuleNumber(value) {
        return String(Number(value));
    }

    function renderRuleSummary() {
        const summary = document.querySelector('.gh-rule-summary');
        if (!summary) return;
        summary.replaceChildren();
        gradeSettings.rules.forEach(rule => {
            const item = document.createElement('div');
            item.textContent = `${rule.grade} → ${formatRuleNumber(rule.score)}（${formatRuleNumber(rule.gpa)}）`;
            summary.appendChild(item);
        });
        const calculationSummary = document.querySelector('.gh-calculation-summary');
        if (calculationSummary) {
            const mode = gradeSettings.averageMode === 'arithmetic' ? '课程算术平均' : '按学分加权';
            calculationSummary.textContent = `${mode} · 保留 ${gradeSettings.decimalPlaces} 位小数`;
        }
    }

    function createRuleEditorRow(rule) {
        const row = document.createElement('tr');
        row.className = 'gh-rule-row';

        const fields = [
            { name: 'grade', type: 'text', value: rule.grade ?? '', label: '等级名称' },
            { name: 'score', type: 'number', value: rule.score ?? '', label: '换算分数', min: 0, max: 100, step: 0.1 },
            { name: 'gpa', type: 'number', value: rule.gpa ?? '', label: '绩点', min: 0, max: 10, step: 0.01 },
        ];

        fields.forEach(field => {
            const cell = document.createElement('td');
            const input = document.createElement('input');
            input.className = `gh-rule-${field.name}`;
            input.type = field.type;
            input.value = field.value;
            input.setAttribute('aria-label', field.label);
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            if (field.step !== undefined) input.step = field.step;
            cell.appendChild(input);
            row.appendChild(cell);
        });

        const actionCell = document.createElement('td');
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'gh-remove-rule-btn';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `删除等级 ${rule.grade || ''}`);
        removeButton.addEventListener('click', () => row.remove());
        actionCell.appendChild(removeButton);
        row.appendChild(actionCell);
        return row;
    }

    function renderSettingsEditor(settings) {
        const editor = document.querySelector('.gh-rule-editor');
        if (!editor) return;
        editor.replaceChildren(...settings.rules.map(createRuleEditorRow));
        document.querySelector('.gh-average-mode').value = settings.averageMode;
        document.querySelector('.gh-decimal-places').value = settings.decimalPlaces;
        document.querySelector('.gh-passing-score').value = settings.passingScore;
        setSettingsStatus('');
    }

    function setSettingsStatus(message, isError = false) {
        const status = document.querySelector('.gh-settings-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function openGradeSettings() {
        const overlay = document.querySelector('.gh-settings-overlay');
        const button = document.querySelector('.gh-settings-btn');
        renderSettingsEditor(gradeSettings);
        overlay.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        window.requestAnimationFrame(() => overlay.classList.add('is-open'));
        overlay.querySelector('.gh-rule-grade')?.focus();
    }

    function closeGradeSettings() {
        const overlay = document.querySelector('.gh-settings-overlay');
        const button = document.querySelector('.gh-settings-btn');
        overlay.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
        setTimeout(() => {
            overlay.hidden = true;
            button.focus();
        }, 160);
    }

    function readSettingsEditor() {
        const rows = Array.from(document.querySelectorAll('.gh-rule-row'));
        document.querySelectorAll('.gh-settings-dialog .is-invalid').forEach(input => input.classList.remove('is-invalid'));
        if (!rows.length) return { error: '请至少保留一条等级换算规则。' };

        const seen = new Set();
        const rules = [];
        for (const row of rows) {
            const gradeInput = row.querySelector('.gh-rule-grade');
            const scoreInput = row.querySelector('.gh-rule-score');
            const gpaInput = row.querySelector('.gh-rule-gpa');
            const grade = normalizeGradeName(gradeInput.value);
            const score = Number(scoreInput.value);
            const gpa = Number(gpaInput.value);

            if (!grade) {
                gradeInput.classList.add('is-invalid');
                return { error: '等级名称不能为空。' };
            }
            if (isNumericScore(grade)) {
                gradeInput.classList.add('is-invalid');
                return { error: '等级名称不能是纯数字，以免和百分制成绩混淆。' };
            }
            if (seen.has(grade)) {
                gradeInput.classList.add('is-invalid');
                return { error: `等级“${grade}”重复，请合并后再保存。` };
            }
            if (scoreInput.value === '' || !Number.isFinite(score) || score < 0 || score > 100) {
                scoreInput.classList.add('is-invalid');
                return { error: `等级“${grade}”的换算分数应在 0～100 之间。` };
            }
            if (gpaInput.value === '' || !Number.isFinite(gpa) || gpa < 0 || gpa > 10) {
                gpaInput.classList.add('is-invalid');
                return { error: `等级“${grade}”的绩点应在 0～10 之间。` };
            }
            seen.add(grade);
            rules.push({ grade, score, gpa });
        }

        const decimalInput = document.querySelector('.gh-decimal-places');
        const passingInput = document.querySelector('.gh-passing-score');
        const decimalPlaces = Number(decimalInput.value);
        const passingScore = Number(passingInput.value);
        if (decimalInput.value === '' || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) {
            decimalInput.classList.add('is-invalid');
            return { error: '小数位数应为 0～4 之间的整数。' };
        }
        if (passingInput.value === '' || !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100) {
            passingInput.classList.add('is-invalid');
            return { error: '及格分数线应在 0～100 之间。' };
        }

        return {
            settings: {
                rules,
                averageMode: document.querySelector('.gh-average-mode').value,
                decimalPlaces,
                passingScore,
            },
        };
    }

    function bindGradeSettings() {
        const overlay = document.querySelector('.gh-settings-overlay');
        document.querySelector('.gh-settings-btn').addEventListener('click', openGradeSettings);
        document.querySelector('.gh-settings-close').addEventListener('click', closeGradeSettings);
        document.querySelector('.gh-cancel-settings-btn').addEventListener('click', closeGradeSettings);
        document.querySelector('.gh-add-rule-btn').addEventListener('click', () => {
            const editor = document.querySelector('.gh-rule-editor');
            const row = createRuleEditorRow({ grade: '', score: '', gpa: '' });
            editor.appendChild(row);
            row.querySelector('.gh-rule-grade').focus();
        });
        document.querySelector('.gh-reset-settings-btn').addEventListener('click', () => {
            renderSettingsEditor(cloneDefaultGradeSettings());
            setSettingsStatus('已填入默认值，点击“保存并重算”后生效。');
        });
        document.querySelector('.gh-save-settings-btn').addEventListener('click', async event => {
            const result = readSettingsEditor();
            if (result.error) {
                setSettingsStatus(result.error, true);
                document.querySelector('.gh-settings-dialog .is-invalid')?.focus();
                return;
            }

            const saveButton = event.currentTarget;
            saveButton.disabled = true;
            saveButton.textContent = '保存中…';
            const saved = await persistGradeSettings(result.settings);
            saveButton.disabled = false;
            saveButton.textContent = '保存并重算';
            if (!saved) {
                setSettingsStatus('保存失败，请刷新页面后重试。', true);
                return;
            }
            gradeSettings = sanitizeGradeSettings(result.settings);
            applyGradeSettings();
            closeGradeSettings();
        });
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeGradeSettings();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !overlay.hidden) closeGradeSettings();
        });
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
            <span class="gh-semester-drag-handle" draggable="true" title="拖动调整学期顺序" aria-label="拖动调整学期顺序">⋮⋮</span>
            <span class="gh-arrow">▼</span>
            <span class="gh-semester-name">${year}</span>
            <span class="gh-semester-stats" aria-label="本学期统计">
                <span><small>学分</small><strong class="gh-semester-credits">0</strong></span>
                <span><small>均分</small><strong class="gh-semester-score">0</strong></span>
                <span><small>均绩</small><strong class="gh-semester-gpa">0.00</strong></span>
            </span>
            <button type="button" class="gh-semester-del">删除学期</button>
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
        const delBtn = group.querySelector('.gh-semester-del');
        const dragHandle = group.querySelector('.gh-semester-drag-handle');

        title.addEventListener('click', (e) => {
            if (e.target.closest('.gh-semester-del, .gh-semester-drag-handle')) return;
            const hidden = table.style.display === 'none';
            table.style.display = hidden ? '' : 'none';
            arrow.textContent = hidden ? '▼' : '▶';
        });

        dragHandle.addEventListener('dragstart', (e) => {
            draggedSemesterGroup = group;
            group.classList.add('gh-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', year);
        });

        dragHandle.addEventListener('dragend', () => {
            group.classList.remove('gh-dragging');
            container.querySelectorAll('.gh-drag-over').forEach(item => item.classList.remove('gh-drag-over'));
            draggedSemesterGroup = null;
            calculateAverage();
        });

        if (!container.dataset.dragSortBound) {
            container.dataset.dragSortBound = 'true';
            container.addEventListener('dragover', (e) => {
                if (!draggedSemesterGroup) return;
                const target = e.target.closest('.gh-group');
                if (!target || target === draggedSemesterGroup || !container.contains(target)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                container.querySelectorAll('.gh-drag-over').forEach(item => item.classList.remove('gh-drag-over'));
                target.classList.add('gh-drag-over');
                const before = e.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2;
                container.insertBefore(draggedSemesterGroup, before ? target : target.nextSibling);
            });
            container.addEventListener('drop', (e) => {
                if (!draggedSemesterGroup) return;
                e.preventDefault();
                container.querySelectorAll('.gh-drag-over').forEach(item => item.classList.remove('gh-drag-over'));
            });
        }

        // 学期删除
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tbody = group.querySelector('tbody');
            tbody.querySelectorAll('tr').forEach(tr => {
                selectedCourseKeys.delete(tr.dataset.courseKey);
                selectedCourseDetails.delete(tr.dataset.courseKey);
                syncCourseCheckboxes(tr.dataset.courseKey, false);
            });
            group.remove();
            calculateAverage();
        });

        return group;
    }
    //插入一个成绩
    function addGradeRow(year, name, credit, score, gpa, kch, displayGrade, courseDetail) {
        // 等级制成绩转换
        const originalGrade = score && !isNumericScore(score) ? normalizeGradeName(score) : '';
        const gradeLabel = displayGrade || (originalGrade ? score : '');
        const converted = resolveGrade(score);
        if (converted) {
            score = converted.score.toString();
            gpa = converted.gpa.toString();
        } else if (originalGrade) {
            score = '';
            gpa = '—';
        }

        const group = getOrCreateGroup(year);
        const tbody = group.querySelector('tbody');
        const tr = document.createElement('tr');
        tr.id = kch
        tr.dataset.courseKey = courseDetail?.key || `${year}::${kch}`;
        tr.dataset.courseCategory = courseDetail?.courseCategory || '';
        if (courseDetail) {
            selectedCourseDetails.set(tr.dataset.courseKey, courseDetail);
        }
        if (originalGrade) tr.dataset.grade = originalGrade;
        tr.innerHTML = `
        <td>${name}</td>
        <td>${credit}</td>
        <td data-score="${score}">${gradeLabel || score}</td>
        <td>${gpa}</td>
        <td><span class="gh-row-actions"><button type="button" class="gh-row-detail">详情</button><button type="button" class="gh-row-delete">删除</button></span></td>
    `;
        updateRowState(tr);
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.gh-row-detail')) {
                openGradeDetailPanel(selectedCourseDetails.get(tr.dataset.courseKey));
                return;
            }
            if (e.target.closest('.gh-row-delete')) {
                const to_delete_ele = e.target.closest('tr');
                removeSelectedCourse(to_delete_ele);
                selectedCourseKeys.delete(to_delete_ele.dataset.courseKey);
                syncCourseCheckboxes(to_delete_ele.dataset.courseKey, false);
                // 如果这个学期下面没有课程了，就把这个学期的标题也删除了
                if (group.querySelector('tbody tr') === null) {
                    group.remove();
                }
                calculateAverage();
            }
        })
        tbody.appendChild(tr);

        calculateAverage();
    }

    function formatCredits(credits) {
        if (!Number.isFinite(credits)) return '0';
        return credits.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    function calculateStats(rows) {
        let totalCredits = 0, totalScore = 0, scoreWeight = 0, totalGpa = 0, gpaWeight = 0;
        rows.forEach(row => {
            if (isCourseExcludedFromStats(row)) return;
            const credit = parseFloat(row.children[1].textContent) || 0;
            const scoreText = row.children[2].dataset.score;
            const gpaText = row.children[3].textContent;
            const score = scoreText === '' ? NaN : Number(scoreText);
            const gpa = gpaText.trim() === '' ? NaN : Number(gpaText);
            const weight = gradeSettings.averageMode === 'arithmetic' ? 1 : credit;
            if (credit > 0) totalCredits += credit;
            if (Number.isFinite(score) && weight > 0) {
                totalScore += weight * score;
                scoreWeight += weight;
            }
            if (Number.isFinite(gpa) && weight > 0) {
                totalGpa += weight * gpa;
                gpaWeight += weight;
            }
        });
        return {
            totalCredits: formatCredits(totalCredits),
            averageScore: scoreWeight ? (totalScore / scoreWeight).toFixed(gradeSettings.decimalPlaces) : (0).toFixed(gradeSettings.decimalPlaces),
            averageGpa: gpaWeight ? (totalGpa / gpaWeight).toFixed(gradeSettings.decimalPlaces) : (0).toFixed(gradeSettings.decimalPlaces),
        };
    }

    function updateRowState(row) {
        const scoreText = row.children[2].dataset.score;
        const score = scoreText === '' ? NaN : Number(scoreText);
        const isUnmapped = Boolean(row.dataset.grade) && !Number.isFinite(score);
        row.classList.toggle('gh-row-unmapped', isUnmapped);
        row.classList.toggle('gh-row-warning', Number.isFinite(score) && score < gradeSettings.passingScore);
        row.title = isUnmapped ? `等级“${row.dataset.grade}”尚未配置，不参与平均值计算` : '';
    }

    function applyGradeSettings() {
        document.querySelectorAll('.gh-table tbody tr').forEach(row => {
            if (row.dataset.grade) {
                const converted = resolveGrade(row.dataset.grade);
                row.children[2].dataset.score = converted ? converted.score : '';
                row.children[3].textContent = converted ? converted.gpa : '—';
            }
            updateRowState(row);
        });
        renderRuleSummary();
        calculateAverage();
    }

    function updateSemesterStats(group) {
        const stats = calculateStats(group.querySelectorAll('tbody tr'));
        const credits = group.querySelector('.gh-semester-credits');
        const score = group.querySelector('.gh-semester-score');
        const gpa = group.querySelector('.gh-semester-gpa');
        if (credits) credits.textContent = stats.totalCredits;
        if (score) score.textContent = stats.averageScore;
        if (gpa) gpa.textContent = stats.averageGpa;
    }

    function calculateAverage() {
        syncCourseCategoryFilterState();
        const rows = document.querySelectorAll('.gh-table tbody tr');
        const stats = calculateStats(rows);

        document.querySelector('.gh-total-credits').textContent = stats.totalCredits;
        document.querySelector('.gh-average').textContent = stats.averageScore;
        document.querySelector('.gpa-average').textContent = stats.averageGpa;

        document.querySelectorAll('.gh-group').forEach(updateSemesterStats);
    }

    function makePanelDraggable(panel) {

        const header = panel.querySelector('.gh-header');
        let offsetX = 0;
        let offsetY = 0;
        let dragging = false;

        header.addEventListener('mousedown', e => {
            if (e.target.closest('button, a')) return;
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
                selectedCourseKeys.clear();
                selectedCourseDetails.clear();
                document.querySelectorAll('.xjtu-grade-select-checkbox').forEach(checkbox => {
                    checkbox.checked = false;
                });
                groups.classList.remove('gh-fade-out');
                calculateAverage();
            }, 250);
        });
    }

    // 页面初始化后，统一增强两张成绩表；分页、搜索和标签切换产生的新行由观察器接管。
    if (document.body) {
        waitForElements(async () => {
            await loadGradeSettings();
            insertGradePanel();
            bindClearButton();
            enhanceAllGradeTables();
            insertSelectAllButton();
            observeGradeTableChanges();
        }, '.jqx-tabs-content', '#contenttabledqxq-index-table');
    }
})();
