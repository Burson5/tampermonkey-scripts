// ==UserScript==
// @name         parks2-info-replace
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  替换页面上的个人信息，并在localStorage中保存替换数据
// @author       You
// @match        https://parks2.bandainamco-am.co.jp/member_mypage.html
// @license      MIT
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 初始防闪烁处理 ====================
    // 在最开始注入样式，将目标元素设为透明
    (function injectHidingStyle() {
        const style = document.createElement('style');
        style.id = 'hide-member-info-initial';
        style.textContent = `
            .block-mypage-member-info-value { 
                opacity: 0 !important; 
                transition: opacity 0.3s ease-in-out; 
            }
        `;
        // 由于是 document-start，可能 head 还没出来，直接挂到 documentElement 上
        if (document.documentElement) {
            document.documentElement.appendChild(style);
        } else {
            const observer = new MutationObserver(() => {
                if (document.documentElement) {
                    document.documentElement.appendChild(style);
                    observer.disconnect();
                }
            });
            observer.observe(document, { childList: true, subtree: true });
        }
    })();

    // ==================== 配置区域 ====================

    // 默认替换规则：标签 -> 替换值
    const DEFAULT_REPLACEMENTS = {
        '氏名（漢字）': '山田 太郎',
        '氏名（カナ）': 'ヤマダ タロウ',
        '生年月日': '1990/01/01',
        '性別': '男性',
        '郵便番号': '100-0001',
        '都道府県': '東京都',
        '市区町村': '千代田区千代田',
        '丁目・番地': '1-1-1',
        '電話番号': '09012345678'
    };

    // 需要替换的标签列表（按顺序排列）
    const TARGET_LABELS = [
        '氏名（漢字）',
        '氏名（カナ）',
        '生年月日',
        '性別',
        '郵便番号',
        '都道府県',
        '市区町村',
        '丁目・番地',
        '電話番号'
    ];

    // 性别选项
    const GENDER_OPTIONS = [
        '男性',
        '女性',
        'あてはまらない',
        '回答しない/非表示'
    ];

    // localStorage 键名
    const STORAGE_KEY = 'personal_info_replacements';

    // ==================== 数据管理 ====================

    /**
     * 从 localStorage 加载替换规则
     */
    function loadReplacements() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.error('[信息替换] 读取 localStorage 失败:', e);
        }
        return { ...DEFAULT_REPLACEMENTS };
    }

    /**
     * 保存替换规则到 localStorage
     */
    function saveReplacements(replacements) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(replacements));
            console.log('[信息替换] 已保存到 localStorage');
            return true;
        } catch (e) {
            console.error('[信息替换] 保存到 localStorage 失败:', e);
            return false;
        }
    }

    /**
     * 重置为页面当前显示的数据
     */
    function resetReplacements() {
        const pageData = extractCurrentDataFromPage();
        // 如果页面没有数据（比如不在个人信息页），则使用默认配置
        const newData = Object.keys(pageData).length > 0 ? pageData : { ...DEFAULT_REPLACEMENTS };
        saveReplacements(newData);
        console.log('[信息替换] 已根据页面数据重置初始值');
        return newData;
    }

    /**
     * 从页面提取当前显示的数据
     */
    function extractCurrentDataFromPage() {
        const extracted = {};
        const dts = document.querySelectorAll('dt.block-mypage-member-info-label');
        dts.forEach(dt => {
            const labelText = dt.textContent.trim();
            if (TARGET_LABELS.includes(labelText)) {
                const dd = dt.nextElementSibling;
                if (dd && dd.classList.contains('block-mypage-member-info-value')) {
                    // 优先从已保存的原始值属性中提取，否则提取当前文本
                    if (dd.hasAttribute('data-original-value')) {
                        extracted[labelText] = dd.getAttribute('data-original-value');
                    } else if (labelText === '性別') {
                        const span = dd.querySelector('span');
                        extracted[labelText] = span ? span.textContent.trim() : dd.textContent.trim();
                    } else {
                        extracted[labelText] = dd.textContent.trim();
                    }
                }
            }
        });
        return extracted;
    }

    // ==================== 核心替换逻辑 ====================

    /**
     * 针对你提供的 HTML 结构，精确替换会员信息
     */
    function replaceMemberInfo(replacements) {
        // 查找包含特定标签文本的 dt 元素
        const dts = document.querySelectorAll('dt.block-mypage-member-info-label');
        dts.forEach(dt => {
            const labelText = dt.textContent.trim();

            // 为“氏名（漢字）”添加双击打开设置面板的功能
            if (labelText === '氏名（漢字）') {
                if (!dt.hasAttribute('data-has-dblclick')) {
                    dt.style.cursor = 'pointer';
                    dt.title = '双击打开替换设置';
                    dt.addEventListener('dblclick', (e) => {
                        e.preventDefault();
                        createSettingsPanel();
                    });
                    dt.setAttribute('data-has-dblclick', 'true');
                }
            }

            // 如果是我们需要替换的标签
            if (TARGET_LABELS.includes(labelText)) {
                const dd = dt.nextElementSibling;
                if (dd && dd.classList.contains('block-mypage-member-info-value')) {
                    // 核心：在任何替换发生前，如果尚未保存原始值，则保存它
                    if (!dd.hasAttribute('data-original-value')) {
                        // 提取原始文本（包含 span 内的内容）
                        const originalVal = (labelText === '性別' && dd.querySelector('span')) 
                            ? dd.querySelector('span').textContent.trim() 
                            : dd.textContent.trim();
                        dd.setAttribute('data-original-value', originalVal);
                    }

                    const replacement = replacements[labelText];
                    // 仅当替换值不为空时执行替换
                    if (replacement !== undefined && replacement.trim() !== '') {
                        // 替换 dd 的内容，如果标签是 性別，保持 span 结构（如果有的话）
                        if (labelText === '性別') {
                            const span = dd.querySelector('span');
                            if (span) {
                                span.textContent = replacement;
                            } else {
                                dd.textContent = replacement;
                            }
                        } else {
                            dd.textContent = replacement;
                        }
                    }
                }
            }
        });
    }

    // ==================== 动态内容监听 ====================

    /**
     * 使用 MutationObserver 监听 DOM 变化，处理动态加载的内容
     */
    function setupMutationObserver(replacements) {
        const observer = new MutationObserver((mutations) => {
            // 延迟执行，确保动态内容已渲染
            setTimeout(() => {
                applyReplacements();
            }, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        return observer;
    }

    // ==================== 用户界面 ====================

    /**
     * 创建设置面板
     */
    function createSettingsPanel() {
        // 移除已存在的面板
        const existing = document.getElementById('personal-info-replacer-panel');
        if (existing) existing.remove();

        const replacements = loadReplacements();

        const panel = document.createElement('div');
        panel.id = 'personal-info-replacer-panel';
        panel.innerHTML = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 2px solid #333;
                border-radius: 8px;
                padding: 20px;
                z-index: 999999;
                width: 400px;
                max-height: 80vh;
                overflow-y: auto;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                font-family: sans-serif;
            ">
                <h3 style="margin-top:0;border-bottom:1px solid #ccc;padding-bottom:10px;text-align:center;">
                    🔒 个人信息替换设置
                </h3>
                <div style="margin-bottom:15px;">
                    <p style="font-size:12px;color:#666;margin-bottom:10px;">请设置各项个人信息的替换内容：</p>
                    <div id="replacer-fields-container">
                        ${TARGET_LABELS.map(label => {
                            if (label === '性別') {
                                return `
                                    <div style="margin-bottom:10px; display: flex; align-items: center;">
                                        <label style="width: 120px; font-size: 13px; font-weight: bold;">${label}:</label>
                                        <select class="field-input" data-label="${label}" style="flex: 1; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
                                            ${GENDER_OPTIONS.map(opt => `<option value="${opt}" ${replacements[label] === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                                        </select>
                                    </div>
                                `;
                            } else {
                                return `
                                    <div style="margin-bottom:10px; display: flex; align-items: center;">
                                        <label style="width: 120px; font-size: 13px; font-weight: bold;">${label}:</label>
                                        <input type="text" class="field-input" data-label="${label}" value="${escapeHtml(replacements[label] || '')}" 
                                            placeholder="可放空"
                                            style="flex: 1; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
                                    </div>
                                `;
                            }
                        }).join('')}
                    </div>
                </div>
                <div style="text-align:center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
                    <button id="save-rules-btn" style="padding:8px 25px;margin-right:10px;cursor:pointer;background:#4caf50;color:white;border:none;border-radius:4px;font-weight:bold;">保存并应用</button>
                    <button id="reset-rules-btn" style="padding:8px 15px;margin-right:10px;cursor:pointer;background:#2196f3;color:white;border:none;border-radius:4px;">重置当前页面数据</button>
                    <button id="close-panel-btn" style="padding:8px 15px;cursor:pointer;background:#9e9e9e;color:white;border:none;border-radius:4px;">取消</button>
                </div>
            </div>
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 999998;
            " id="replacer-overlay"></div>
        `;

        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('close-panel-btn').addEventListener('click', () => panel.remove());
        document.getElementById('replacer-overlay').addEventListener('click', () => panel.remove());

        document.getElementById('save-rules-btn').addEventListener('click', () => {
            const newReplacements = {};
            document.querySelectorAll('.field-input').forEach(input => {
                const label = input.dataset.label;
                newReplacements[label] = input.value.trim();
            });
            saveReplacements(newReplacements);
            applyReplacements();
            panel.remove();
            alert('设置已保存并应用');
        });

        document.getElementById('reset-rules-btn').addEventListener('click', () => {
            if (confirm('确定要从当前页面提取数据作为初始值吗？\n(这会覆盖当前的设置)')) {
                resetReplacements();
                panel.remove();
                createSettingsPanel();
                // 提取后不需要立即 apply，因为提取的就是当前页面的值
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== 主流程 ====================

    /**
     * 应用替换
     */
    function applyReplacements() {
        const replacements = loadReplacements();
        replaceMemberInfo(replacements);
        
        // 首次替换完成后，移除隐藏样式，使内容显示出来
        const style = document.getElementById('hide-member-info-initial');
        if (style) {
            // 使用 setTimeout 确保 DOM 已经更新完毕再显示，增加一点平滑感
            setTimeout(() => {
                style.remove();
            }, 50);
        }
    }

    /**
     * 初始化
     */
    function init() {
        // 首次运行时初始化 localStorage
        if (!localStorage.getItem(STORAGE_KEY)) {
            saveReplacements({ ...DEFAULT_REPLACEMENTS });
        }

        // 立即执行替换
        applyReplacements();

        // 设置 MutationObserver 处理动态内容
        setupMutationObserver(loadReplacements());

        // 注册油猴菜单命令
        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('🔧 打开替换设置', createSettingsPanel);
            GM_registerMenuCommand('🔄 立即重新替换', applyReplacements);
        }

        console.log('[信息替换] 脚本已加载，当前规则:', loadReplacements());
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();