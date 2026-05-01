// ==UserScript==
// @name         outlook-info-replace
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  重定向验证页面到邮箱首页，自动替换邮件正文中的敏感文本
// @author       burson5@qq.com
// @match        https://account.live.com/proofs/Add*
// @match        https://outlook.live.com/mail/*
// @license      MIT
// @grant        GM_registerMenuCommand
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
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.error('[Outlook替换] 读取 localStorage 失败:', e);
        }
        return JSON.parse(JSON.stringify(DEFAULT_REPLACEMENTS));
    }

    function saveReplacements(replacements) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(replacements));
            console.log('[Outlook替换] 已保存到 localStorage');
            return true;
        } catch (e) {
            console.error('[Outlook替换] 保存到 localStorage 失败:', e);
            return false;
        }
    }

    // ==================== 3. 核心文本替换 ====================

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
        const entries = Object.entries(replacements).filter(([k]) => k && k.trim());
        if (entries.length === 0) return;

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
            for (const [keyword, replacement] of entries) {
                const lowerText = text.toLowerCase();
                const lowerKeyword = keyword.toLowerCase();
                if (lowerText.includes(lowerKeyword)) {
                    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(escaped, 'gi');
                    text = text.replace(regex, replacement);
                    modified = true;
                }
            }
            if (modified) {
                node.textContent = text;
            }
        }
    }

    // ==================== 4. URL 路径变化监听 ====================

    let urlCheckTimer = null;
    const URL_CHECK_MS = 300;

    function onUrlChanged() {
        console.log('[Outlook替换] 检测到URL变化:', location.href);
        clearTimeout(urlCheckTimer);
        urlCheckTimer = setTimeout(() => {
            applyReplacements();
        }, URL_CHECK_MS);
    }

    function setupUrlChangeListener() {
        const originalPushState = history.pushState;
        history.pushState = function() {
            originalPushState.apply(this, arguments);
            onUrlChanged();
        };

        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            onUrlChanged();
        };

        window.addEventListener('popstate', onUrlChanged);
        window.addEventListener('hashchange', onUrlChanged);
    }

    // ==================== 5. DOM 异步内容兜底监听 ====================

    let domDebounceTimer = null;
    const DOM_DEBOUNCE_MS = 600;
    let domObserver = null;

    function setupDomContentObserver() {
        const target = document.body || document.documentElement;
        if (!target) {
            setTimeout(setupDomContentObserver, 100);
            return;
        }

        domObserver = new MutationObserver((mutations) => {
            const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
            if (!hasAddedNodes) return;

            clearTimeout(domDebounceTimer);
            domDebounceTimer = setTimeout(() => {
                applyReplacements();
            }, DOM_DEBOUNCE_MS);
        });

        domObserver.observe(target, {
            childList: true,
            subtree: true
        });
    }

    // ==================== 6. 配置弹窗 ====================

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

        const fieldsHtml = entries.map(([keyword, replacement]) => `
            <div class="outlook-replacer-row" style="margin-bottom:10px;padding:8px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#888;min-width:24px;">原始</span>
                    <input type="text" class="ol-field-keyword" value="${escapeHtml(keyword)}" placeholder="原始文字" style="flex:1;min-width:100px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
                    <button class="ol-paste-btn" style="padding:6px 10px;cursor:pointer;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:13px;white-space:nowrap;">📋</button>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#888;min-width:24px;">替换</span>
                    <input type="text" class="ol-field-replacement" value="${escapeHtml(replacement)}" placeholder="替换为" style="flex:1;min-width:100px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
                    <button class="ol-paste-btn" style="padding:6px 10px;cursor:pointer;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:13px;white-space:nowrap;">📋</button>
                    <button class="ol-row-del-btn" style="padding:6px 10px;cursor:pointer;background:#e74c3c;color:white;border:none;border-radius:4px;font-size:13px;white-space:nowrap;">✕</button>
                </div>
            </div>
        `).join('');

        const panel = document.createElement('div');
        panel.id = 'outlook-replacer-panel';
        panel.innerHTML = `
            <div style="
                position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                background:white;border:2px solid #333;border-radius:8px;
                padding:16px;z-index:999999;width:calc(100vw - 16px);max-width:560px;max-height:85vh;
                overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);
                font-family:sans-serif;box-sizing:border-box;
            ">
                <h3 style="margin-top:0;border-bottom:1px solid #ccc;padding-bottom:10px;text-align:center;font-size:16px;">
                    Outlook 邮件文本替换设置
                </h3>
                <p style="font-size:12px;color:#666;margin-bottom:10px;">
                    不区分大小写，将邮件正文中所有"原始文字"替换为"替换为"。
                </p>
                <div id="outlook-replacer-fields">
                    ${fieldsHtml || '<p style="color:#999;text-align:center;">暂无替换规则，请添加</p>'}
                </div>
                <div style="text-align:center;margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                    <button id="ol-add-row-btn" style="padding:8px 20px;cursor:pointer;background:#3498db;color:white;border:none;border-radius:4px;font-size:14px;">＋ 添加规则</button>
                    <button id="ol-parks2-preset-btn" style="padding:8px 16px;cursor:pointer;background:#ff9800;color:white;border:none;border-radius:4px;font-size:14px;display:none;">parks2规则</button>
                </div>
                <div style="text-align:center;margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
                    <button id="ol-save-btn" style="padding:10px 28px;margin-right:8px;cursor:pointer;background:#4caf50;color:white;border:none;border-radius:4px;font-weight:bold;font-size:14px;">保存并应用</button>
                    <button id="ol-close-btn" style="padding:10px 18px;cursor:pointer;background:#9e9e9e;color:white;border:none;border-radius:4px;font-size:14px;">取消</button>
                </div>
            </div>
            <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999998;" id="ol-overlay"></div>
        `;

        document.body.appendChild(panel);

        const closePanel = () => panel.remove();
        document.getElementById('ol-close-btn').addEventListener('click', closePanel);
        document.getElementById('ol-overlay').addEventListener('click', closePanel);

        function addRowToContainer(keywordValue, replacementValue) {
            const container = document.getElementById('outlook-replacer-fields');
            const noRuleHint = container.querySelector('p');
            if (noRuleHint) noRuleHint.remove();

            const row = document.createElement('div');
            row.className = 'outlook-replacer-row';
            row.style.cssText = 'margin-bottom:10px;padding:8px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;';
            row.innerHTML = `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#888;min-width:24px;">原始</span>
                    <input type="text" class="ol-field-keyword" value="${escapeHtml(keywordValue || '')}" placeholder="原始文字" style="flex:1;min-width:100px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
                    <button class="ol-paste-btn" style="padding:6px 10px;cursor:pointer;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:13px;white-space:nowrap;">📋</button>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#888;min-width:24px;">替换</span>
                    <input type="text" class="ol-field-replacement" value="${escapeHtml(replacementValue || '')}" placeholder="替换为" style="flex:1;min-width:100px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:14px;">
                    <button class="ol-paste-btn" style="padding:6px 10px;cursor:pointer;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:13px;white-space:nowrap;">📋</button>
                    <button class="ol-row-del-btn" style="padding:6px 10px;cursor:pointer;background:#e74c3c;color:white;border:none;border-radius:4px;font-size:13px;white-space:nowrap;">✕</button>
                </div>
            `;
            container.appendChild(row);
            row.querySelector('.ol-row-del-btn').addEventListener('click', () => row.remove());
            row.querySelectorAll('.ol-paste-btn').forEach(pbtn => {
                pbtn.addEventListener('click', async (e) => {
                    const input = e.target.parentElement.querySelector('input');
                    if (!input) return;
                    try {
                        const text = await navigator.clipboard.readText();
                        if (text) input.value = text;
                    } catch {
                        input.focus();
                        input.select();
                    }
                });
            });
        }

        document.getElementById('ol-add-row-btn').addEventListener('click', () => {
            addRowToContainer('', '');
        });

        document.getElementById('ol-parks2-preset-btn').addEventListener('click', () => {
            addRowToContainer('氏名：', '氏名：\u3000');
        });

        panel.querySelectorAll('.ol-row-del-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.outlook-replacer-row').remove();
            });
        });

        panel.querySelectorAll('.ol-paste-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const input = e.target.parentElement.querySelector('input');
                if (!input) return;
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) input.value = text;
                } catch {
                    input.focus();
                    input.select();
                }
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

    function setupSettingsTriggerButton() {
        const tryBind = () => {
            const container = document.querySelector('.mectrl_company');
            if (container && !container.hasAttribute('data-outlook-btn-inserted')) {
                const btn = document.createElement('button');
                btn.textContent = '📧';
                btn.title = '打开文本替换设置';
                btn.style.cssText = 'cursor:pointer;border:none;background:transparent;font-size:16px;padding:4px 8px;border-radius:4px;';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    createSettingsPanel();
                });
                container.appendChild(btn);
                container.setAttribute('data-outlook-btn-inserted', 'true');
                console.log('[Outlook替换] 已插入设置按钮');
                return true;
            }
            return !!container;
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

    // ==================== 7. 主流程 ====================

    function applyReplacements() {
        const replacements = loadReplacements();
        if (Object.keys(replacements).length > 0) {
            replaceTextInDocument(replacements);
        }
    }

    function init() {
        setupUrlChangeListener();
        setupDomContentObserver();
        setupSettingsTriggerButton();

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
