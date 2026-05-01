// ==UserScript==
// @name         outlook-info-replace
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  重定向验证页面到邮箱首页，自动替换邮件正文中的敏感文本
// @author       burson5@qq.com
// @match        https://account.live.com/proofs/Add*
// @match        https://outlook.live.com/mail/*
// @license      MIT
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'outlook_text_replacements';
    const REDIRECT_SOURCE = 'https://account.live.com/proofs/Add';
    const REDIRECT_TARGET = 'https://outlook.live.com/mail/0/';

    const DEFAULT_REPLACEMENTS = {};

    // ==================== 1. 重定向逻辑 ====================

    if (window.location.href.startsWith(REDIRECT_SOURCE)) {
        window.location.replace(REDIRECT_TARGET);
        return;
    }

    // ==================== 2. 数据管理 ====================

    function loadReplacements() {
        try {
            const stored = GM_getValue(STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.error('[Outlook替换] 读取存储失败:', e);
        }
        return JSON.parse(JSON.stringify(DEFAULT_REPLACEMENTS));
    }

    function saveReplacements(replacements) {
        try {
            GM_setValue(STORAGE_KEY, JSON.stringify(replacements));
            console.log('[Outlook替换] 已保存替换规则');
            return true;
        } catch (e) {
            console.error('[Outlook替换] 保存失败:', e);
            return false;
        }
    }

    // ==================== 3. 核心文本替换 ====================

    function buildReplaceRegexes(replacements) {
        const regexes = [];
        for (const [keyword, replacement] of Object.entries(replacements)) {
            if (!keyword || !keyword.trim()) continue;
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regexes.push({ regex: new RegExp(escaped, 'gi'), replacement });
        }
        return regexes;
    }

    function isSkippableElement(el) {
        if (!el || !el.tagName) return false;
        const tag = el.tagName.toLowerCase();
        return tag === 'script' || tag === 'style' || tag === 'noscript'
            || tag === 'textarea' || tag === 'input' || tag === 'select'
            || tag === 'option' || tag === 'code' || tag === 'pre';
    }

    function isInsidePanel(node) {
        let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (el) {
            if (el.id === 'outlook-replacer-panel') return true;
            el = el.parentElement;
        }
        return false;
    }

    function replaceTextInDocument(replacements) {
        const regexes = buildReplaceRegexes(replacements);
        if (regexes.length === 0) return;

        const walker = document.createTreeWalker(
            document.body || document.documentElement,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    const parent = node.parentElement;
                    if (!parent || !parent.tagName) return NodeFilter.FILTER_REJECT;
                    if (isSkippableElement(parent)) return NodeFilter.FILTER_REJECT;
                    if (isInsidePanel(node)) return NodeFilter.FILTER_REJECT;
                    if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const nodesToReplace = [];
        let textNode;
        while ((textNode = walker.nextNode())) {
            nodesToReplace.push(textNode);
        }

        for (const node of nodesToReplace) {
            let text = node.textContent;
            let modified = false;
            for (const { regex, replacement } of regexes) {
                if (regex.test(text)) {
                    text = text.replace(regex, replacement);
                    modified = true;
                }
            }
            if (modified) {
                node.textContent = text;
            }
        }
    }

    // ==================== 4. 动态内容监听 ====================

    let observer = null;
    let pendingRafId = null;

    function setupMutationObserver() {
        const target = document.documentElement || document.body || document;

        observer = new MutationObserver((mutations) => {
            const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
            if (!hasAddedNodes) return;

            if (pendingRafId) cancelAnimationFrame(pendingRafId);
            pendingRafId = requestAnimationFrame(() => {
                applyReplacements();
                pendingRafId = null;
            });
        });

        observer.observe(target, {
            childList: true,
            subtree: true
        });
    }

    // ==================== 5. 配置弹窗 ====================

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function createSettingsPanel() {
        const existing = document.getElementById('outlook-replacer-panel');
        if (existing) existing.remove();

        const replacements = loadReplacements();
        const entries = Object.entries(replacements);

        const fieldsHtml = entries.map(([keyword, replacement], idx) => `
            <div class="outlook-replacer-row" style="margin-bottom:8px;display:flex;align-items:center;gap:8px;">
                <input type="text" class="ol-field-keyword" value="${escapeHtml(keyword)}" placeholder="原始文字" style="flex:1;padding:5px;border:1px solid #ccc;border-radius:4px;">
                <span style="color:#666;">→</span>
                <input type="text" class="ol-field-replacement" value="${escapeHtml(replacement)}" placeholder="替换为" style="flex:1;padding:5px;border:1px solid #ccc;border-radius:4px;">
                <button class="ol-row-del-btn" style="padding:5px 8px;cursor:pointer;background:#e74c3c;color:white;border:none;border-radius:4px;font-size:12px;">✕</button>
            </div>
        `).join('');

        const panel = document.createElement('div');
        panel.id = 'outlook-replacer-panel';
        panel.innerHTML = `
            <div style="
                position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                background:white;border:2px solid #333;border-radius:8px;
                padding:20px;z-index:999999;width:520px;max-height:80vh;
                overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);
                font-family:sans-serif;
            ">
                <h3 style="margin-top:0;border-bottom:1px solid #ccc;padding-bottom:10px;text-align:center;">
                    Outlook 邮件文本替换设置
                </h3>
                <p style="font-size:12px;color:#666;margin-bottom:10px;">
                    匹配规则不区分大小写，将邮件正文中的"原始文字"替换为"替换为"。
                </p>
                <div id="outlook-replacer-fields">
                    ${fieldsHtml || '<p style="color:#999;text-align:center;">暂无替换规则，请添加</p>'}
                </div>
                <div style="text-align:center;margin-top:10px;">
                    <button id="ol-add-row-btn" style="padding:6px 16px;cursor:pointer;background:#3498db;color:white;border:none;border-radius:4px;font-size:13px;">＋ 添加规则</button>
                </div>
                <div style="text-align:center;margin-top:20px;padding-top:15px;border-top:1px solid #eee;">
                    <button id="ol-save-btn" style="padding:8px 25px;margin-right:10px;cursor:pointer;background:#4caf50;color:white;border:none;border-radius:4px;font-weight:bold;">保存并应用</button>
                    <button id="ol-close-btn" style="padding:8px 15px;cursor:pointer;background:#9e9e9e;color:white;border:none;border-radius:4px;">取消</button>
                </div>
            </div>
            <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999998;" id="ol-overlay"></div>
        `;

        document.body.appendChild(panel);

        const closePanel = () => panel.remove();
        document.getElementById('ol-close-btn').addEventListener('click', closePanel);
        document.getElementById('ol-overlay').addEventListener('click', closePanel);

        document.getElementById('ol-add-row-btn').addEventListener('click', () => {
            const container = document.getElementById('outlook-replacer-fields');
            const noRuleHint = container.querySelector('p');
            if (noRuleHint) noRuleHint.remove();

            const row = document.createElement('div');
            row.className = 'outlook-replacer-row';
            row.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;gap:8px;';
            row.innerHTML = `
                <input type="text" class="ol-field-keyword" placeholder="原始文字" style="flex:1;padding:5px;border:1px solid #ccc;border-radius:4px;">
                <span style="color:#666;">→</span>
                <input type="text" class="ol-field-replacement" placeholder="替换为" style="flex:1;padding:5px;border:1px solid #ccc;border-radius:4px;">
                <button class="ol-row-del-btn" style="padding:5px 8px;cursor:pointer;background:#e74c3c;color:white;border:none;border-radius:4px;font-size:12px;">✕</button>
            `;
            container.appendChild(row);
            row.querySelector('.ol-row-del-btn').addEventListener('click', () => row.remove());
        });

        panel.querySelectorAll('.ol-row-del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.outlook-replacer-row').remove();
            });
        });

        document.getElementById('ol-save-btn').addEventListener('click', () => {
            const newReplacements = {};
            const rows = document.querySelectorAll('.outlook-replacer-row');
            rows.forEach(row => {
                const keywordInput = row.querySelector('.ol-field-keyword');
                const replacementInput = row.querySelector('.ol-field-replacement');
                if (keywordInput && keywordInput.value.trim()) {
                    newReplacements[keywordInput.value.trim()] = replacementInput ? replacementInput.value : '';
                }
            });
            saveReplacements(newReplacements);
            applyReplacements();
            closePanel();
        });
    }

    function setupHeaderPictureDblClick() {
        const tryBind = () => {
            const pictureEl = document.querySelector('#mectrl_headerPicture');
            if (pictureEl && !pictureEl.hasAttribute('data-outlook-dblclick')) {
                pictureEl.style.cursor = 'pointer';
                pictureEl.title = '双击打开文本替换设置';
                pictureEl.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    createSettingsPanel();
                });
                pictureEl.setAttribute('data-outlook-dblclick', 'true');
                console.log('[Outlook替换] 已绑定头像双击事件');
                return true;
            }
            return !!pictureEl;
        };

        if (!tryBind()) {
            const bindObserver = new MutationObserver(() => {
                if (tryBind()) {
                    bindObserver.disconnect();
                }
            });
            bindObserver.observe(document.documentElement || document, {
                childList: true,
                subtree: true
            });
            setTimeout(() => bindObserver.disconnect(), 30000);
        }
    }

    // ==================== 6. 主流程 ====================

    function applyReplacements() {
        const replacements = loadReplacements();
        if (Object.keys(replacements).length > 0) {
            replaceTextInDocument(replacements);
        }
    }

    function init() {
        setupHeaderPictureDblClick();

        const existing = loadReplacements();
        if (Object.keys(existing).length === 0) {
            saveReplacements(DEFAULT_REPLACEMENTS);
        }
        applyReplacements();

        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('📧 打开文本替换设置', createSettingsPanel);
            GM_registerMenuCommand('🔄 立即重新替换', applyReplacements);
        }

        console.log('[Outlook替换] 脚本初始化完成，当前规则:', loadReplacements());
    }

    setupMutationObserver();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
