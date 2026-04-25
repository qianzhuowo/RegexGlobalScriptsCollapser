(function () {
  'use strict';

  const MODULE_NAME = 'st-regex-global-scripts-collapser';

  // 组名显示
  const UNGROUPED_GROUP_NAME = '未分组';

  // 分组 key 分隔符（尽量选一个用户不太会输入的）
  const GROUP_KEY_SEP = '\u001F';

  // 本插件用于标记“已收纳”的 class（收起整个 block 区域）
  const COLLAPSED_CLASS = 'st-rgs-collapsed';

  // 分组展示模式 class
  const GROUPING_CLASS = 'st-rgs-grouping';
  const HIDDEN_CLASS = 'st-rgs-hidden';
  const NEW_GROUP_HIGHLIGHT_CLASS = 'st-rgs-new-group';
  const NEW_GROUP_ATTENTION_HIGHLIGHT_CLASS = 'st-rgs-new-group-attention';
  const NEW_ITEM_HIGHLIGHT_CLASS = 'st-rgs-new-item';

  // 折叠时用于识别“插件 header / 需要保留的原生元素”
  const COLLAPSE_HEADER_DATA_KEY = 'stRgsHeader';
  const COLLAPSE_PRESERVE_DATA_KEY = 'stRgsPreserveOnCollapse';

  // 使用说明弹窗（全局复用一个）
  const HELP_MODAL_ID = 'st-rgs-help-modal';
  const QUICK_GROUPING_MODAL_ID = 'st-rgs-quick-grouping-modal';
  const SEARCH_HIDDEN_CLASS = 'st-rgs-search-hidden';
  const SEARCH_BAR_ID = 'st-rgs-search-bar';
  const SEARCH_INPUT_ID = 'st-rgs-search-input';
  const SEARCH_CLEAR_ID = 'st-rgs-search-clear';
  const REGEX_PAGE_HIDE_WRAPPER_ID = 'st-rgs-regex-hide-settings-anchor';
  const REGEX_PAGE_HIDE_BUTTON_ID = 'st-rgs-regex-hide-settings-trigger';
  const REGEX_PAGE_QUICK_GROUPING_BUTTON_ID = 'st-rgs-regex-quick-grouping-trigger';
  const REGEX_PAGE_HIDE_MENU_ID = 'st-rgs-regex-hide-settings-menu';
  const REGEX_PAGE_FORCE_HIDDEN_CLASS = 'st-rgs-force-hidden';
  const REGEX_PAGE_HIDE_STORAGE_KEY = `${MODULE_NAME}:regexPageHiddenTargets`;
  const QUICK_GROUPING_SCOPE_ORDER = ['global', 'preset', 'scoped'];
  const REGEX_PAGE_HIDE_TARGETS = [
    {
      key: 'open_regex_editor',
      selector: '#open_regex_editor',
      label: '隐藏“新建全局正则”',
      category: 'toolbar',
    },
    {
      key: 'open_preset_editor', selector: '#open_preset_editor', label: '隐藏“新建预设正则”', category: 'toolbar' },
    {
      key: 'open_scoped_editor', selector: '#open_scoped_editor', label: '隐藏“新建局部正则”', category: 'toolbar' },
    { key: 'import_regex', selector: '#import_regex', label: '隐藏“导入正则”', category: 'toolbar' },
    {
      key: 'regex_bulk_edit',
      selector: 'label[for="regex_bulk_edit"]',
      label: '隐藏“批量编辑”',
      category: 'toolbar',
    },
    { key: 'open_regex_debugger', selector: '#open_regex_debugger', label: '隐藏“调试工具”', category: 'toolbar' },
    { key: 'regex_presets_block', selector: '#regex_presets_block', label: '隐藏正则预设区域', category: 'block' },
  ];

  let sharedSearchQuery = '';
  const sharedSearchListeners = new Set();
  let quickGroupingActiveScope = 'global';
  let quickGroupingRenderToken = 0;
  const quickGroupingDraftState = {
    filter: '',
    group1: '',
    group2: '',
    format1: 'bracket',
    format2: 'bracket',
  };
  const quickGroupingSelections = { global: [], preset: [], scoped: [] };
  let regexPageHideObserver = null;
  let regexPageHideDocHandlersBound = false;
  const GROUP_STATE_DEBUG_ENABLED = true;

  function log(...args) {
    console.log(`[${MODULE_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${MODULE_NAME}]`, ...args);
  }

  function debug(...args) {
    if (!GROUP_STATE_DEBUG_ENABLED) return;
    console.log(`[${MODULE_NAME}][debug]`, ...args);
  }

  function summarizeRegexScriptState(script) {
    return {
      id: String(script?.id ?? ''),
      name: String(script?.scriptName ?? ''),
      disabled: !!script?.disabled,
    };
  }

  function summarizeRegexScriptStates(scripts) {
    return (Array.isArray(scripts) ? scripts : []).map((script) => summarizeRegexScriptState(script));
  }

  function debugGroupState(label, payload) {
    if (!GROUP_STATE_DEBUG_ENABLED) return;

    const title = `[${MODULE_NAME}][group-debug] ${label}`;
    try {
      if (console.groupCollapsed) {
        console.groupCollapsed(title);
        console.log(payload);
        console.trace?.('trace');
        console.groupEnd();
        return;
      }
    } catch {
      // ignore
    }

    console.log(title, payload);
  }

  function schedule(fn) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => fn());
    } else {
      setTimeout(fn, 16);
    }
  }

  function getCtx() {
    return window.SillyTavern?.getContext?.();
  }

  function loadBool(key, fallback = false) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return fallback;
      return v === '1' || v === 'true';
    } catch {
      return fallback;
    }
  }

  function saveBool(key, value) {
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // ignore
    }
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }

  function normalizeHideConfig(rawConfig) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const normalized = {};

    for (const target of REGEX_PAGE_HIDE_TARGETS) {
      normalized[target.key] = !!source[target.key];
    }

    return normalized;
  }

  function loadHideConfig() {
    return normalizeHideConfig(loadJson(REGEX_PAGE_HIDE_STORAGE_KEY, {}));
  }

  function hashString(input) {
    const str = String(input ?? '');
    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
  }

  function saveHideConfig(config) {
    saveJson(REGEX_PAGE_HIDE_STORAGE_KEY, normalizeHideConfig(config));
  }

  function arrayShallowEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function flashElement(el, className, durationMs = 1600) {
    if (!el?.classList || !className) return;

    const token = `${Date.now()}-${Math.random()}`;
    el.dataset.stRgsFlashToken = token;

    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);

    setTimeout(() => {
      if (el.dataset.stRgsFlashToken !== token) return;
      el.classList.remove(className);
    }, durationMs);
  }

  function toastInfo(message) {
    try {
      if (window.toastr?.info) {
        window.toastr.info(message);
        return;
      }
    } catch {
      // ignore
    }
    log(message);
  }

  function toastSuccess(message) {
    try {
      if (window.toastr?.success) {
        window.toastr.success(message);
        return;
      }
    } catch {
      // ignore
    }
    log(message);
  }

  function toastError(message) {
    try {
      if (window.toastr?.error) {
        window.toastr.error(message);
        return;
      }
    } catch {
      // ignore
    }
    warn(message);
  }

  function uniqStrings(values) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const key = String(value ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  let regexEnginePromise = null;

  async function importRegexEngine() {
    if (!regexEnginePromise) {
      regexEnginePromise = eval('import("/scripts/extensions/regex/engine.js")').catch((err) => {
        warn('Regex engine import failed', err);
        return null;
      });
    }

    return regexEnginePromise;
  }

  function getCtxEventTypes(ctx = getCtx()) {
    return ctx?.eventTypes || ctx?.event_types || {};
  }

  function getRegexScopeType(scope, SCRIPT_TYPES) {
    switch (scope) {
      case 'global': return SCRIPT_TYPES.GLOBAL;
      case 'preset': return SCRIPT_TYPES.PRESET;
      case 'scoped': return SCRIPT_TYPES.SCOPED;
      default: return SCRIPT_TYPES.GLOBAL;
    }
  }

  function normalizeGroupRenameInput(input) {
    const value = String(input ?? '').trim();
    if (!value) throw new Error('分组名称不能为空');
    if (value === UNGROUPED_GROUP_NAME) throw new Error(`不能使用“${UNGROUPED_GROUP_NAME}”作为分组名`);
    if (value.includes(GROUP_KEY_SEP)) throw new Error('分组名称包含非法字符');
    if (/[【】-]/.test(value)) throw new Error('分组名称不能包含 “【】” 或 “-”');
    return value;
  }

  function parseGroupNameSegments(name) {
    let rest = String(name ?? '').trim();
    const segments = [];

    for (let depth = 0; depth < 2; depth++) {
      if (!rest) break;

      if (rest.startsWith('【')) {
        const end = rest.indexOf('】');
        if (end > 1) {
          segments.push({ type: 'bracket', value: rest.slice(1, end).trim() });
          rest = rest.slice(end + 1).trimStart();
          continue;
        }
      }

      const hyphenIndex = rest.indexOf('-');
      if (hyphenIndex > 0) {
        segments.push({ type: 'hyphen', value: rest.slice(0, hyphenIndex).trim() });
        rest = rest.slice(hyphenIndex + 1).trimStart();
        continue;
      }

      break;
    }

    return { segments, rest };
  }

  function buildGroupedScriptName(segments, rest) {
    const prefix = (Array.isArray(segments) ? segments : [])
      .filter((segment) => segment && segment.value)
      .map((segment) => (segment.type === 'bracket' ? `【${segment.value}】` : `${segment.value}-`))
      .join('');
    return `${prefix}${String(rest ?? '')}`.trim();
  }

  function getScriptGroupKeysFromName(name, { subgroupEnabled = true } = {}) {
    const { segments } = parseGroupNameSegments(name);
    const groupValues = (Array.isArray(segments) ? segments : [])
      .map((segment) => String(segment?.value || '').trim())
      .filter(Boolean);
    const group1 = groupValues[0] || UNGROUPED_GROUP_NAME;
    const group2 = subgroupEnabled ? (groupValues[1] || '') : '';
    const keys = [makeGroupKey(group1)];
    if (group2) keys.push(makeGroupKey(group1, group2));
    return { group1, group2, keys };
  }

  function resolveItemGroupContext(itemEl, { subgroupEnabled = true } = {}) {
    const group1FromDataset = String(itemEl?.dataset?.stRgsGroup1 || '');
    const group2FromDataset = String(itemEl?.dataset?.stRgsGroup2 || '');
    if (group1FromDataset) {
      const keys = [makeGroupKey(group1FromDataset)];
      if (subgroupEnabled && group2FromDataset) keys.push(makeGroupKey(group1FromDataset, group2FromDataset));
      return { group1: group1FromDataset, group2: subgroupEnabled ? group2FromDataset : '', keys };
    }

    const rawName = String(itemEl?.dataset?.stRgsRawScriptName || '');
    return getScriptGroupKeysFromName(rawName, { subgroupEnabled });
  }

  function findPreferredGroupSnapshotState(snapshotState, groupKeys, scriptId) {
    const targetId = String(scriptId || '');
    if (!targetId) return undefined;

    const orderedKeys = sortGroupKeysBySpecificity(groupKeys);
    for (const key of orderedKeys) {
      const snapshot = snapshotState?.[key];
      if (!snapshot || typeof snapshot !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(snapshot, targetId)) {
        return !!snapshot[targetId];
      }
    }

    return undefined;
  }

  function getActiveDisabledGroupKeys(groupState, groupKeys) {
    return (Array.isArray(groupKeys) ? groupKeys : []).filter((key) => !!groupState?.[key]);
  }

  function isForcedDisabledByAnyGroup(groupState, groupKeys) {
    return getActiveDisabledGroupKeys(groupState, groupKeys).length > 0;
  }

  function isForcedDisabledByOtherGroups(groupState, groupKeys, excludingKey) {
    return getActiveDisabledGroupKeys(groupState, groupKeys).some((key) => key !== excludingKey);
  }

  function sortGroupKeysBySpecificity(groupKeys) {
    return (Array.isArray(groupKeys) ? groupKeys.slice() : []).sort((a, b) => {
      const aDepth = String(a).split(GROUP_KEY_SEP).length;
      const bDepth = String(b).split(GROUP_KEY_SEP).length;
      return bDepth - aDepth;
    });
  }

  function renameGroupedScriptName(name, { level, group1, group2, newName }) {
    const parsed = parseGroupNameSegments(name);
    if (level === 1) {
      if (parsed.segments[0]?.value !== group1) return null;
      parsed.segments[0] = { ...parsed.segments[0], value: newName };
      return buildGroupedScriptName(parsed.segments, parsed.rest);
    }

    if (level === 2) {
      if (parsed.segments[0]?.value !== group1 || parsed.segments[1]?.value !== group2) return null;
      parsed.segments[1] = { ...parsed.segments[1], value: newName };
      return buildGroupedScriptName(parsed.segments, parsed.rest);
    }

    return null;
  }

  async function triggerRegexUiRefresh() {
    const ctx = getCtx();
    const eventTypes = getCtxEventTypes(ctx);
    ctx?.saveSettingsDebounced?.();
    ctx?.eventSource?.emit?.(eventTypes.PRESET_CHANGED);
    ctx?.eventSource?.emit?.(eventTypes.SETTINGS_LOADED);
    ctx?.reloadCurrentChat?.();
  }

  let popupModulePromise = null;

  async function importPopupModule() {
    if (!popupModulePromise) {
      popupModulePromise = eval('import("/scripts/popup.js")').catch((err) => {
        warn('Popup module import failed', err);
        return null;
      });
    }

    return popupModulePromise;
  }

  let scriptRuntimePromise = null;

  async function importScriptRuntime() {
    if (!scriptRuntimePromise) {
      scriptRuntimePromise = eval('import("/script.js")').catch((err) => {
        warn('script runtime import failed', err);
        return null;
      });
    }

    return scriptRuntimePromise;
  }

  let groupChatsModulePromise = null;

  async function importGroupChatsModule() {
    if (!groupChatsModulePromise) {
      groupChatsModulePromise = eval('import("/scripts/group-chats.js")').catch((err) => {
        warn('group-chats module import failed', err);
        return null;
      });
    }

    return groupChatsModulePromise;
  }

  async function confirmWithNativePopup(message) {
    const popupModule = await importPopupModule();
    if (popupModule?.callGenericPopup && popupModule?.POPUP_TYPE?.CONFIRM) {
      try {
        return !!(await popupModule.callGenericPopup(message, popupModule.POPUP_TYPE.CONFIRM));
      } catch (err) {
        warn('native confirm popup failed, fallback to window.confirm', err);
      }
    }

    try {
      return !!window.confirm(String(message ?? ''));
    } catch {
      return false;
    }
  }

  async function showNativeInputPopup(message, defaultValue = '') {
    const popupModule = await importPopupModule();
    if (popupModule?.Popup?.show?.input) {
      try {
        return await popupModule.Popup.show.input(String(message ?? ''), String(defaultValue ?? ''));
      } catch (err) {
        warn('native input popup failed, fallback to window.prompt', err);
      }
    }

    try {
      return window.prompt(String(message ?? ''), String(defaultValue ?? ''));
    } catch {
      return null;
    }
  }

  function sanitizeFileName(name) {
    return String(name ?? '')
      .replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  function downloadJsonFile(data, fileName) {
    const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function ensureScopedMoveAllowed() {
    const scriptRuntime = await importScriptRuntime();
    const groupChatsModule = await importGroupChatsModule();

    if (!scriptRuntime) {
      throw new Error('无法获取酒馆运行时');
    }

    if (scriptRuntime.this_chid === undefined) {
      throw new Error('No character selected.');
    }

    if (groupChatsModule?.selected_group) {
      throw new Error('Cannot edit scoped scripts in group chats.');
    }

    return {
      scriptRuntime,
      character: scriptRuntime.characters?.[scriptRuntime.this_chid],
    };
  }

  async function ensurePresetMoveAllowed(engine) {
    const apiId = engine?.getCurrentPresetAPI?.();
    const presetName = engine?.getCurrentPresetName?.();
    if (!apiId || !presetName) {
      throw new Error('当前没有可用的预设目标');
    }
    return { apiId, presetName };
  }

  async function persistScriptsForScope(engine, scope, scripts) {
    const scriptType = getRegexScopeType(scope, engine.SCRIPT_TYPES);
    await engine.saveScriptsByType(scripts, scriptType);

    if (scope === 'scoped') {
      const { character } = await ensureScopedMoveAllowed();
      engine.allowScopedScripts?.(character);
      return;
    }

    if (scope === 'preset') {
      const { apiId, presetName } = await ensurePresetMoveAllowed(engine);
      engine.allowPresetScripts?.(apiId, presetName);
    }
  }

  function getScopeLabel(scope) {
    switch (scope) {
      case 'global': return '全局';
      case 'preset': return '预设';
      case 'scoped': return '局部';
      default: return String(scope || '未知');
    }
  }

  function normalizeSearchText(input) {
    const base = String(input ?? '').trim();
    const normalized = typeof base.normalize === 'function' ? base.normalize('NFKC') : base;
    return normalized.toLocaleLowerCase();
  }

  function compactSearchText(input) {
    return normalizeSearchText(input).replace(/[\s\-‐‑‒–—―_./\\|【】\[\]()（）{}「」『』"'`~!@#$%^&*+=:;?,，。！？：；、<>《》]/g, '');
  }

  function fuzzyMatches(text, query) {
    const normalizedQuery = compactSearchText(query);
    if (!normalizedQuery) return true;

    const normalizedText = compactSearchText(text);
    if (!normalizedText) return false;
    if (normalizedText.includes(normalizedQuery)) return true;

    let fromIndex = 0;
    for (const ch of normalizedQuery) {
      fromIndex = normalizedText.indexOf(ch, fromIndex);
      if (fromIndex < 0) return false;
      fromIndex += 1;
    }

    return true;
  }

  function getSharedSearchQuery() {
    return sharedSearchQuery;
  }

  function subscribeSharedSearch(listener) {
    if (typeof listener !== 'function') return () => {};
    sharedSearchListeners.add(listener);
    listener(sharedSearchQuery);
    return () => sharedSearchListeners.delete(listener);
  }

  function setSharedSearchQuery(nextQuery) {
    const next = String(nextQuery ?? '');
    if (next === sharedSearchQuery) return;
    sharedSearchQuery = next;

    for (const listener of Array.from(sharedSearchListeners)) {
      try {
        listener(sharedSearchQuery);
      } catch (err) {
        warn('shared search listener failed', err);
      }
    }
  }

  function ensureSearchBar() {
    const globalBlockEl = document.getElementById('global_scripts_block');
    if (!globalBlockEl) return false;

    let searchBarEl = document.getElementById(SEARCH_BAR_ID);
    if (!searchBarEl) {
      searchBarEl = document.createElement('div');
      searchBarEl.id = SEARCH_BAR_ID;
      searchBarEl.className = 'st-rgs-search-bar flex-container flexGap10 alignItemsCenter';
      searchBarEl.innerHTML = `
        <span class="fa-solid fa-magnifying-glass st-rgs-search-icon" aria-hidden="true"></span>
        <input id="${SEARCH_INPUT_ID}" class="text_pole st-rgs-search-input flex1" type="text" placeholder="搜索全局 / 预设 / 局部正则名称（支持模糊搜索）" autocomplete="off">
        <button type="button" class="menu_button interactable st-rgs-icon-btn st-rgs-search-clear" id="${SEARCH_CLEAR_ID}" title="清空搜索" aria-label="清空搜索">✕</button>
      `;

      const inputEl = searchBarEl.querySelector(`#${SEARCH_INPUT_ID}`);
      const clearBtn = searchBarEl.querySelector(`#${SEARCH_CLEAR_ID}`);

      inputEl?.addEventListener('input', () => {
        setSharedSearchQuery(inputEl.value);
        if (clearBtn) clearBtn.disabled = !normalizeSearchText(inputEl.value);
      });

      clearBtn?.addEventListener('click', () => {
        if (!inputEl) return;
        inputEl.value = '';
        clearBtn.disabled = true;
        setSharedSearchQuery('');
        inputEl.focus();
      });
    }

    if (searchBarEl.parentElement !== globalBlockEl.parentElement || searchBarEl.nextElementSibling !== globalBlockEl) {
      globalBlockEl.insertAdjacentElement('beforebegin', searchBarEl);
    }

    const inputEl = searchBarEl.querySelector(`#${SEARCH_INPUT_ID}`);
    const clearBtn = searchBarEl.querySelector(`#${SEARCH_CLEAR_ID}`);
    if (inputEl && inputEl.value !== sharedSearchQuery) inputEl.value = sharedSearchQuery;
    if (clearBtn) clearBtn.disabled = !normalizeSearchText(sharedSearchQuery);
    return true;
  }

  function getRegexActionToolbarEl() {
    return document.getElementById('open_regex_editor')?.closest?.('.flex-container') || null;
  }

  function getRegexActionSeparatorEl(toolbarEl = getRegexActionToolbarEl()) {
    let prevEl = toolbarEl?.previousElementSibling || null;
    while (prevEl && prevEl.tagName === 'BR') prevEl = prevEl.previousElementSibling;
    return prevEl?.tagName === 'HR' ? prevEl : null;
  }

  function resolveRegexHideTargetEl(target) {
    if (!target?.selector) return null;
    return document.querySelector(target.selector);
  }

  function syncRegexHideMenuInputs() {
    const menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID);
    if (!menuEl) return;

    const config = loadHideConfig();
    for (const target of REGEX_PAGE_HIDE_TARGETS) {
      const inputEl = menuEl.querySelector(`[data-st-rgs-hide-target="${target.key}"]`);
      const optionEl = menuEl.querySelector(`[data-st-rgs-hide-option="${target.key}"]`);
      if (!inputEl) continue;
      inputEl.checked = !!config[target.key];
      optionEl?.setAttribute('aria-checked', config[target.key] ? 'true' : 'false');
    }
  }

  function setRegexHideTargetEnabled(targetKey, enabled) {
    if (!targetKey) return;

    const config = loadHideConfig();
    if (!Object.prototype.hasOwnProperty.call(config, targetKey)) return;

    config[targetKey] = !!enabled;
    saveHideConfig(config);
    syncRegexHideMenuInputs();
    applyRegexPageHideConfig();
  }

  function toggleRegexHideTarget(targetKey) {
    const config = loadHideConfig();
    setRegexHideTargetEnabled(targetKey, !config[targetKey]);
  }

  function setRegexHideMenuOpen(open) {
    const menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID);
    const triggerEl = document.getElementById(REGEX_PAGE_HIDE_BUTTON_ID);
    if (!menuEl || !triggerEl) return;

    if (open) {
      syncRegexHideMenuInputs();
      positionRegexHideMenu(menuEl, triggerEl);
    }

    menuEl.classList.toggle('st-rgs-hidden', !open);
    triggerEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeRegexHideMenu() {
    setRegexHideMenuOpen(false);
  }

  function positionRegexHideMenu(menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID), triggerEl = document.getElementById(REGEX_PAGE_HIDE_BUTTON_ID)) {
    if (!menuEl || !triggerEl) return;

    const wasHidden = menuEl.classList.contains('st-rgs-hidden');
    const previousVisibility = menuEl.style.visibility;

    if (wasHidden) {
      menuEl.classList.remove('st-rgs-hidden');
      menuEl.style.visibility = 'hidden';
    }

    menuEl.style.left = '0px';
    menuEl.style.top = '0px';

    const triggerRect = triggerEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const screenPadding = 8;
    const gap = 6;

    let left = triggerRect.right - menuRect.width;
    left = Math.min(left, Math.max(screenPadding, viewportWidth - menuRect.width - screenPadding));
    left = Math.max(screenPadding, left);

    let top = triggerRect.bottom + gap;
    if (top + menuRect.height > viewportHeight - screenPadding) {
      const topAbove = triggerRect.top - menuRect.height - gap;
      top = topAbove >= screenPadding ? topAbove : Math.max(screenPadding, viewportHeight - menuRect.height - screenPadding);
    }

    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;

    if (wasHidden) {
      menuEl.classList.add('st-rgs-hidden');
      menuEl.style.visibility = previousVisibility;
    } else {
      menuEl.style.visibility = previousVisibility || '';
    }
  }

  function applyRegexPageHideConfig() {
    const config = loadHideConfig();
    let visibleToolbarTargetCount = 0;

    for (const target of REGEX_PAGE_HIDE_TARGETS) {
      const targetEl = resolveRegexHideTargetEl(target);
      if (!targetEl) continue;

      const shouldHide = !!config[target.key];
      targetEl.classList.toggle(REGEX_PAGE_FORCE_HIDDEN_CLASS, shouldHide);

      if (target.category === 'toolbar' && !shouldHide) {
        visibleToolbarTargetCount += 1;
      }
    }

    const separatorEl = getRegexActionSeparatorEl();
    if (separatorEl) {
      separatorEl.classList.toggle(REGEX_PAGE_FORCE_HIDDEN_CLASS, visibleToolbarTargetCount < 1);
    }
  }

  function ensureRegexHideDocHandlers() {
    if (regexPageHideDocHandlersBound) return;
    regexPageHideDocHandlersBound = true;

    document.addEventListener(
      'click',
      (e) => {
        const menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID);
        const triggerEl = document.getElementById(REGEX_PAGE_HIDE_BUTTON_ID);
        if (!menuEl || !triggerEl || menuEl.classList.contains('st-rgs-hidden')) return;

        const inMenu = e.target?.closest?.(`#${REGEX_PAGE_HIDE_MENU_ID}`);
        const inTrigger = e.target?.closest?.(`#${REGEX_PAGE_HIDE_BUTTON_ID}`);
        if (inMenu || inTrigger) return;

        closeRegexHideMenu();
      },
      true
    );

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') closeRegexHideMenu();
      },
      true
    );

    window.addEventListener(
      'resize',
      () => {
        const menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID);
        if (!menuEl || menuEl.classList.contains('st-rgs-hidden')) return;
        positionRegexHideMenu(menuEl);
      },
      true
    );
  }

  function ensureRegexHideControls() {
    const toolbarEl = getRegexActionToolbarEl();
    if (!toolbarEl) {
      applyRegexPageHideConfig();
      return false;
    }

    let wrapperEl = document.getElementById(REGEX_PAGE_HIDE_WRAPPER_ID);
    if (!wrapperEl || wrapperEl.parentElement !== toolbarEl) {
      wrapperEl?.remove?.();

      wrapperEl = document.createElement('div');
      wrapperEl.id = REGEX_PAGE_HIDE_WRAPPER_ID;
      wrapperEl.className = 'st-rgs-native-hide-anchor';
      wrapperEl.innerHTML = `
        <div id="${REGEX_PAGE_HIDE_BUTTON_ID}" class="menu_button menu_button_icon interactable" title="隐藏设置" tabindex="0" role="button" aria-haspopup="true" aria-expanded="false">
          <i class="fa-solid fa-eye-slash"></i>
          <small>隐藏设置</small>
        </div>
        <div id="${REGEX_PAGE_QUICK_GROUPING_BUTTON_ID}" class="menu_button menu_button_icon interactable" title="快捷分组" tabindex="0" role="button">
          <i class="fa-solid fa-layer-group"></i>
          <small>快捷分组</small>
        </div>
      `;

      toolbarEl.appendChild(wrapperEl);

      let menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID);
      if (!menuEl) {
        menuEl = document.createElement('div');
        menuEl.className = 'st-rgs-native-hide-menu st-rgs-hidden';
        menuEl.id = REGEX_PAGE_HIDE_MENU_ID;
        menuEl.setAttribute('role', 'menu');
        menuEl.innerHTML = `
          <div class="st-rgs-native-hide-title">隐藏以下区域</div>
          ${REGEX_PAGE_HIDE_TARGETS.map(
            (target) => `
              <div class="checkbox flex-container alignItemsCenter st-rgs-native-hide-toggle" data-st-rgs-hide-option="${target.key}" role="menuitemcheckbox" aria-checked="false" tabindex="0">
                <input type="checkbox" data-st-rgs-hide-target="${target.key}" tabindex="-1" aria-hidden="true">
                <span>${target.label}</span>
              </div>
            `
          ).join('')}
        `;
        document.body.appendChild(menuEl);
      }

      const triggerEl = wrapperEl.querySelector(`#${REGEX_PAGE_HIDE_BUTTON_ID}`);
      const quickGroupingBtn = wrapperEl.querySelector(`#${REGEX_PAGE_QUICK_GROUPING_BUTTON_ID}`);
      menuEl = document.getElementById(REGEX_PAGE_HIDE_MENU_ID);

      const toggleMenu = () => {
        const nextOpen = menuEl?.classList.contains('st-rgs-hidden');
        setRegexHideMenuOpen(!!nextOpen);
      };

      triggerEl?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
      });

      triggerEl?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
      });

      quickGroupingBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeRegexHideMenu();
        openQuickGroupingModal();
      });

      quickGroupingBtn?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        closeRegexHideMenu();
        openQuickGroupingModal();
      });

      const stopMenuEvent = (e) => e.stopPropagation();
      menuEl?.addEventListener('pointerdown', stopMenuEvent);
      menuEl?.addEventListener('mousedown', stopMenuEvent);
      menuEl?.addEventListener('mouseup', stopMenuEvent);
      menuEl?.addEventListener('click', (e) => e.stopPropagation());
      menuEl?.addEventListener('click', (e) => {
        const optionEl = e.target?.closest?.('[data-st-rgs-hide-option]');
        if (!optionEl) return;

        e.preventDefault();
        e.stopPropagation();
        toggleRegexHideTarget(optionEl.dataset.stRgsHideOption);
      });
      menuEl?.addEventListener('keydown', (e) => {
        const optionEl = e.target?.closest?.('[data-st-rgs-hide-option]');
        if (!optionEl) {
          e.stopPropagation();
          return;
        }

        if (e.key !== 'Enter' && e.key !== ' ') {
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        toggleRegexHideTarget(optionEl.dataset.stRgsHideOption);
      });
      menuEl?.addEventListener('change', (e) => {
        const inputEl = e.target?.closest?.('input[data-st-rgs-hide-target]');
        if (!inputEl) return;
        e.stopPropagation();
        setRegexHideTargetEnabled(inputEl.dataset.stRgsHideTarget, !!inputEl.checked);
      });
    }

    ensureRegexHideDocHandlers();
    syncRegexHideMenuInputs();
    positionRegexHideMenu();
    applyRegexPageHideConfig();
    return true;
  }

  function startRegexHideObserver() {
    if (regexPageHideObserver) return;
    if (typeof MutationObserver !== 'function') return;

    const root = document.body || document.documentElement;
    if (!root) return;

    let scheduled = false;
    regexPageHideObserver = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      schedule(() => {
        scheduled = false;
        ensureRegexHideControls();
      });
    });

    regexPageHideObserver.observe(root, { childList: true, subtree: true });
  }

  function makeGroupKey(group1, group2) {
    if (!group2) return String(group1);
    return `${group1}${GROUP_KEY_SEP}${group2}`;
  }

  function parseGroupPath(name) {
    // 支持：
    // 1) 【前缀】xxx
    // 2) 前缀-xxx
    // 3) 混合，且最多取 2 级：前缀1-【前缀2】xxx / 【前缀1】前缀2-xxx / 前缀1-前缀2-xxx
    let rest = String(name || '').trim();
    const groups = [];

    for (let depth = 0; depth < 2; depth++) {
      if (!rest) break;

      // 【...】
      if (rest.startsWith('【')) {
        const end = rest.indexOf('】');
        if (end > 1) {
          const g = rest.slice(1, end).trim();
          if (g) groups.push(g);
          rest = rest.slice(end + 1).trimStart();
          continue;
        }
      }

      // xxx-...
      const hyphenIndex = rest.indexOf('-');
      if (hyphenIndex > 0) {
        const g = rest.slice(0, hyphenIndex).trim();
        if (g) groups.push(g);
        rest = rest.slice(hyphenIndex + 1).trimStart();
        continue;
      }

      break;
    }

    return { groups, rest };
  }

  // =====================
  // Help Modal (shared)
  // =====================

  function ensureHelpModal() {
    if (document.getElementById(HELP_MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.id = HELP_MODAL_ID;
    modal.className = 'st-rgs-help-modal st-rgs-hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
      <div class="st-rgs-help-backdrop" data-st-rgs-help-close></div>
      <div class="st-rgs-help-panel">
        <div class="st-rgs-help-title flex-container flexnowrap alignItemsCenter">
          <b class="flex1">正则分组展示 - 使用说明</b>
          <button type="button" class="menu_button interactable st-rgs-help-close" data-st-rgs-help-close title="关闭">✕</button>
        </div>
        <div class="st-rgs-help-body">
          <p><b>1) 开启分组：</b>点击标题右侧的「未分组 / 分组」按钮切换，启用时会显示高亮与勾选图标。</p>
          <p><b>2) 支持两种前缀：</b></p>
          <ul>
            <li>以<code>【前缀名字】</code> 包裹的，例如 → <code>【常用】</code></li>
            <li>以<code>前缀名 与 减号"-"</code> 组合，例如 → <code>常用-</code></li>
          </ul>
          <p><b>3) 分组规则（默认支持最多二级分类，可在设置里关闭二级，两种前缀可混用）：</b></p>
          <ul>
            <li><code>【常用】阡濯自制</code> → <code>常用</code></li>
            <li><code>文生图-测试1</code> → <code>文生图</code></li>
            <li><code>文生图-【常用】测试2</code> → <code>文生图 / 常用</code></li>
            <li><code>【文生图】常用-测试3</code> → <code>文生图 / 常用</code></li>
          </ul>
          <p><b>4) 折叠/展开：</b>点击组标题前的三角箭头即可折叠/展开；也可使用右侧的「全部展开 / 全部收纳」按钮。</p>
          <p><b>5) 执行顺序：</b>分组仅改变显示，不改变正则执行顺序。</p>
          <p><b>6) 拖拽排序：</b>分组开启时会禁用酒馆原生的拖拽排序；关闭分组后恢复拖拽。</p>
        </div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      const closeEl = e.target?.closest?.('[data-st-rgs-help-close]');
      if (!closeEl) return;
      e.preventDefault();
      e.stopPropagation();
      closeHelpModal();
    });

    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeHelpModal();
      }
    });

    document.body.appendChild(modal);
  }

  function openHelpModal() {
    ensureHelpModal();
    const modal = document.getElementById(HELP_MODAL_ID);
    if (!modal) return;
    modal.classList.remove('st-rgs-hidden');
    modal.tabIndex = -1;
    modal.focus?.();
  }

  function closeHelpModal() {
    const modal = document.getElementById(HELP_MODAL_ID);
    if (!modal) return;
    modal.classList.add('st-rgs-hidden');
  }

  function normalizeQuickGroupingScope(scope) {
    return QUICK_GROUPING_SCOPE_ORDER.includes(scope) ? scope : 'global';
  }

  function getQuickGroupingScopeLabel(scope) {
    switch (normalizeQuickGroupingScope(scope)) {
      case 'preset': return '预设';
      case 'scoped': return '局部';
      case 'global':
      default:
        return '全局';
    }
  }

  function normalizeQuickGroupingFormat(format) {
    return String(format ?? '') === 'dash' ? 'dash' : 'bracket';
  }

  function getQuickGroupingSelectedKeys(scope) {
    const normalizedScope = normalizeQuickGroupingScope(scope);
    return Array.isArray(quickGroupingSelections[normalizedScope]) ? quickGroupingSelections[normalizedScope] : [];
  }

  function setQuickGroupingSelectedKeys(scope, values) {
    quickGroupingSelections[normalizeQuickGroupingScope(scope)] = uniqStrings(values);
  }

  function getQuickGroupingLeafName(item) {
    const leaf = String(item?.leaf ?? '').trimStart();
    if (leaf) return leaf;

    const group2 = String(item?.group2 ?? '').trim();
    if (group2) return group2;

    const group1 = String(item?.group1 ?? '').trim();
    if (group1) return group1;

    return String(item?.rawName ?? item?.name ?? '').trimStart();
  }

  function buildQuickGroupedScriptName({ leaf, group1, group2, format1, format2 }) {
    const leafText = String(leaf ?? '').trimStart();
    const group1Text = String(group1 ?? '').trim();
    const group2Text = String(group2 ?? '').trim();
    const level1Format = normalizeQuickGroupingFormat(format1);
    const level2Format = normalizeQuickGroupingFormat(format2);

    const applyOne = (prefix, rest, format) => {
      const prefixText = String(prefix ?? '').trim();
      const restText = String(rest ?? '').trimStart();
      if (!prefixText) return restText;
      return format === 'dash' ? `${prefixText}-${restText}` : `【${prefixText}】${restText}`;
    };

    if (!group1Text) return leafText;
    const withGroup2 = group2Text ? applyOne(group2Text, leafText, level2Format) : leafText;
    return applyOne(group1Text, withGroup2, level1Format);
  }

  async function loadQuickGroupingItems(scope) {
    const normalizedScope = normalizeQuickGroupingScope(scope);
    const engine = await importRegexEngine();
    if (!engine) throw new Error('Regex engine 不可用');

    const scriptType = getRegexScopeType(normalizedScope, engine.SCRIPT_TYPES);
    const scripts = Array.isArray(engine.getScriptsByType(scriptType)) ? [...engine.getScriptsByType(scriptType)] : [];

    return scripts.map((script, index) => {
      const rawName = String(script?.scriptName ?? '');
      const parsed = parseGroupNameSegments(rawName);
      const group1 = String(parsed?.segments?.[0]?.value ?? '').trim();
      const group2 = String(parsed?.segments?.[1]?.value ?? '').trim();
      const itemKey = script?.id !== undefined && script?.id !== null ? String(script.id) : `__${normalizedScope}_${index}`;

      return {
        key: itemKey,
        id: script?.id !== undefined && script?.id !== null ? String(script.id) : '',
        index,
        name: rawName.trim() || `（未命名正则 ${index + 1}）`,
        rawName,
        group1,
        group2,
        leaf: String(parsed?.rest ?? '').trimStart(),
        disabled: !!script?.disabled,
      };
    });
  }

  async function applyQuickGroupingUpdates(scope, updatesMap) {
    const normalizedScope = normalizeQuickGroupingScope(scope);
    const updates = updatesMap instanceof Map ? updatesMap : new Map(Object.entries(updatesMap || {}));
    if (updates.size < 1) return { changedCount: 0 };

    const engine = await importRegexEngine();
    if (!engine) throw new Error('Regex engine 不可用');

    const scriptType = getRegexScopeType(normalizedScope, engine.SCRIPT_TYPES);
    const scripts = Array.isArray(engine.getScriptsByType(scriptType)) ? [...engine.getScriptsByType(scriptType)] : [];

    let changedCount = 0;
    const nextScripts = scripts.map((script, index) => {
      const itemKey = script?.id !== undefined && script?.id !== null ? String(script.id) : `__${normalizedScope}_${index}`;
      if (!updates.has(itemKey)) return script;

      const currentName = String(script?.scriptName ?? '').trim();
      const nextName = String(updates.get(itemKey) ?? '').trim();
      if (!nextName || nextName === currentName) return script;

      changedCount += 1;
      return { ...script, scriptName: nextName };
    });

    if (changedCount < 1) return { changedCount: 0 };

    await engine.saveScriptsByType(nextScripts, scriptType);
    await triggerRegexUiRefresh();
    return { changedCount };
  }

  function ensureQuickGroupingModal() {
    const existing = document.getElementById(QUICK_GROUPING_MODAL_ID);
    if (existing instanceof HTMLElement) return existing;

    const modal = document.createElement('div');
    modal.id = QUICK_GROUPING_MODAL_ID;
    modal.className = 'st-rgs-quick-grouping-modal st-rgs-hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
      <div class="st-rgs-qg-backdrop" data-st-rgs-qg-close></div>
      <div class="st-rgs-qg-panel">
        <div class="st-rgs-qg-header flex-container alignItemsCenter flexGap10">
          <div class="st-rgs-qg-header-main flex-container alignItemsCenter flexGap10 flex1">
            <b class="st-rgs-qg-title">快捷正则分组</b>
            <div class="st-rgs-qg-tabs"></div>
          </div>
          <button type="button" class="menu_button interactable st-rgs-qg-close" data-st-rgs-qg-close title="关闭">✕</button>
        </div>
        <div class="st-rgs-qg-body"></div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      const closeEl = e.target?.closest?.('[data-st-rgs-qg-close]');
      if (!closeEl) return;
      e.preventDefault();
      e.stopPropagation();
      closeQuickGroupingModal();
    });

    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeQuickGroupingModal();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function closeQuickGroupingModal() {
    const modal = document.getElementById(QUICK_GROUPING_MODAL_ID);
    if (!modal) return;
    modal.classList.add('st-rgs-hidden');
  }

  function renderQuickGroupingCurrentInfo(container, item) {
    if (!(container instanceof HTMLElement)) return;

    container.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'st-rgs-qg-current-label';
    label.textContent = '当前：';
    container.appendChild(label);

    const group1 = String(item?.group1 ?? '').trim();
    const group2 = String(item?.group2 ?? '').trim();
    const leaf = getQuickGroupingLeafName(item);
    if (!group1) {
      const noPrefix = document.createElement('span');
      noPrefix.className = 'st-rgs-qg-current-none';
      noPrefix.textContent = '无前缀';
      container.appendChild(noPrefix);
      return;
    }

    const createArrow = () => {
      const arrow = document.createElement('span');
      arrow.className = 'st-rgs-qg-current-arrow';
      arrow.textContent = ' → ';
      return arrow;
    };

    const group1El = document.createElement('span');
    group1El.className = 'st-rgs-qg-current-group1';
    group1El.textContent = group1;
    container.appendChild(group1El);

    if (group2) {
      container.appendChild(createArrow());
      const group2El = document.createElement('span');
      group2El.className = 'st-rgs-qg-current-group2';
      group2El.textContent = group2;
      container.appendChild(group2El);
    }

    container.appendChild(createArrow());
    const leafEl = document.createElement('span');
    leafEl.className = 'st-rgs-qg-current-leaf';
    leafEl.textContent = leaf;
    container.appendChild(leafEl);
  }

  async function renderQuickGroupingModal(scope, { statusMessage = '' } = {}) {
    const normalizedScope = normalizeQuickGroupingScope(scope);
    quickGroupingActiveScope = normalizedScope;

    const modal = ensureQuickGroupingModal();
    const body = modal.querySelector('.st-rgs-qg-body');
    if (!(body instanceof HTMLElement)) return;

    const tabsEl = modal.querySelector('.st-rgs-qg-tabs');

    const currentToken = ++quickGroupingRenderToken;
    body.innerHTML = `<div class="st-rgs-qg-loading">正在加载 ${getQuickGroupingScopeLabel(normalizedScope)}...</div>`;

    try {
      const items = await loadQuickGroupingItems(normalizedScope);
      if (currentToken !== quickGroupingRenderToken) return;

      body.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'st-rgs-qg-wrapper';
      const SEARCH_SUGGESTIONS_ID = `st-rgs-qg-search-suggestions-${normalizedScope}`;
      const GROUP1_SUGGESTIONS_ID = `st-rgs-qg-group1-suggestions-${normalizedScope}`;
      const GROUP2_SUGGESTIONS_ID = `st-rgs-qg-group2-suggestions-${normalizedScope}`;
      wrapper.innerHTML = `
        <div class="st-rgs-qg-tip">批量给正则添加/修改分组前缀。支持 <code>【分组】</code> 与 <code>分组-</code> 两种格式；一级分组留空时等同于清除前缀。</div>
        <div class="st-rgs-qg-controls">
          <div class="st-rgs-qg-row flex-container flexGap10 alignItemsCenter flex-wrap">
            <input type="text" class="text_pole st-rgs-qg-filter-input" data-st-rgs-qg="filter" placeholder="搜索当前范围正则" list="${SEARCH_SUGGESTIONS_ID}">
          </div>
          <div class="st-rgs-qg-row st-rgs-qg-prefix-row">
            <select class="text_pole st-rgs-qg-format-select" data-st-rgs-qg="format1">
              <option value="bracket">【】包裹</option>
              <option value="dash">- 分割</option>
            </select>
            <input type="text" class="text_pole st-rgs-qg-group-input" data-st-rgs-qg="group1" placeholder="一级分组（留空=清除前缀）" list="${GROUP1_SUGGESTIONS_ID}">
            <select class="text_pole st-rgs-qg-format-select" data-st-rgs-qg="format2">
              <option value="bracket">【】包裹</option>
              <option value="dash">- 分割</option>
            </select>
            <input type="text" class="text_pole st-rgs-qg-group-input" data-st-rgs-qg="group2" placeholder="二级分组（可选）" list="${GROUP2_SUGGESTIONS_ID}">
          </div>
          <div class="st-rgs-qg-row flex-container flexGap10 alignItemsCenter flex-wrap">
            <button type="button" class="menu_button interactable" data-st-rgs-qg="apply">应用</button>
            <button type="button" class="menu_button interactable caution" data-st-rgs-qg="clear">清除前缀</button>
            <button type="button" class="menu_button interactable" data-st-rgs-qg="select-all">全选</button>
            <button type="button" class="menu_button interactable" data-st-rgs-qg="invert">反选</button>
          </div>
          <div class="st-rgs-qg-status" data-st-rgs-qg="status"></div>
          <datalist id="${SEARCH_SUGGESTIONS_ID}"></datalist>
          <datalist id="${GROUP1_SUGGESTIONS_ID}"></datalist>
          <datalist id="${GROUP2_SUGGESTIONS_ID}"></datalist>
        </div>
        <div class="st-rgs-qg-list"></div>
      `;

      body.appendChild(wrapper);

      const listEl = wrapper.querySelector('.st-rgs-qg-list');
      const filterInput = wrapper.querySelector('[data-st-rgs-qg="filter"]');
      const group1Input = wrapper.querySelector('[data-st-rgs-qg="group1"]');
      const group2Input = wrapper.querySelector('[data-st-rgs-qg="group2"]');
      const format1Select = wrapper.querySelector('[data-st-rgs-qg="format1"]');
      const format2Select = wrapper.querySelector('[data-st-rgs-qg="format2"]');
      const statusEl = wrapper.querySelector('[data-st-rgs-qg="status"]');
      const applyBtn = wrapper.querySelector('[data-st-rgs-qg="apply"]');
      const clearBtn = wrapper.querySelector('[data-st-rgs-qg="clear"]');
      const selectAllBtn = wrapper.querySelector('[data-st-rgs-qg="select-all"]');
      const invertBtn = wrapper.querySelector('[data-st-rgs-qg="invert"]');
      const searchSuggestionsEl = wrapper.querySelector(`#${SEARCH_SUGGESTIONS_ID}`);
      const group1SuggestionsEl = wrapper.querySelector(`#${GROUP1_SUGGESTIONS_ID}`);
      const group2SuggestionsEl = wrapper.querySelector(`#${GROUP2_SUGGESTIONS_ID}`);
      if (tabsEl instanceof HTMLElement) tabsEl.innerHTML = '';

      for (const scopeKey of QUICK_GROUPING_SCOPE_ORDER) {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'menu_button interactable st-rgs-qg-tab';
        tabBtn.dataset.stRgsQgTab = scopeKey;
        tabBtn.dataset.active = scopeKey === normalizedScope ? '1' : '0';
        tabBtn.textContent = getQuickGroupingScopeLabel(scopeKey);
        tabBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          void renderQuickGroupingModal(scopeKey);
        });
        tabsEl?.appendChild(tabBtn);
      }

      if (filterInput instanceof HTMLInputElement) filterInput.value = String(quickGroupingDraftState.filter ?? '');
      if (group1Input instanceof HTMLInputElement) group1Input.value = String(quickGroupingDraftState.group1 ?? '');
      if (group2Input instanceof HTMLInputElement) group2Input.value = String(quickGroupingDraftState.group2 ?? '');
      if (format1Select instanceof HTMLSelectElement) format1Select.value = normalizeQuickGroupingFormat(quickGroupingDraftState.format1);
      if (format2Select instanceof HTMLSelectElement) format2Select.value = normalizeQuickGroupingFormat(quickGroupingDraftState.format2);
      if (statusEl instanceof HTMLElement) statusEl.textContent = String(statusMessage || '');

      const selectionSet = new Set(getQuickGroupingSelectedKeys(normalizedScope));
      const rowEntries = [];
      const listEmptyEl = document.createElement('div');
      listEmptyEl.className = 'st-rgs-qg-empty';
      listEl?.appendChild(listEmptyEl);

      const fillSuggestions = (datalistEl, values) => {
        if (!(datalistEl instanceof HTMLDataListElement)) return;
        datalistEl.innerHTML = '';

        for (const value of uniqStrings(values).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
          const text = String(value ?? '').trim();
          if (!text) continue;
          const optionEl = document.createElement('option');
          optionEl.value = text;
          datalistEl.appendChild(optionEl);
        }
      };

      const refreshAutocompleteSuggestions = () => {
        const group1Values = rowEntries.map(({ item }) => String(item?.group1 ?? '').trim()).filter(Boolean);
        const group2Values = rowEntries.map(({ item }) => String(item?.group2 ?? '').trim()).filter(Boolean);
        const searchValues = [
          ...group1Values,
          ...group2Values,
        ];

        fillSuggestions(searchSuggestionsEl, searchValues);
        fillSuggestions(group1SuggestionsEl, group1Values);
        fillSuggestions(group2SuggestionsEl, group2Values);
      };

      const updateSelectAllButtonLabel = () => {
        if (!(selectAllBtn instanceof HTMLButtonElement)) return;
        const visibleRows = getVisibleRows();
        const hasVisibleRows = visibleRows.length > 0;
        const allVisibleSelected = hasVisibleRows && visibleRows.every(
          ({ checkboxEl }) => checkboxEl instanceof HTMLInputElement && checkboxEl.checked
        );
        selectAllBtn.textContent = allVisibleSelected ? '取消全选' : '全选';
      };

      const updateRowSelectionUi = (entry) => {
        if (!entry?.rowEl || !(entry.checkboxEl instanceof HTMLInputElement)) return;
        entry.rowEl.classList.toggle('st-rgs-qg-item-selected', !!entry.checkboxEl.checked);
      };

      const syncSelectionState = () => {
        for (const entry of rowEntries) {
          updateRowSelectionUi(entry);
        }

        const selectedKeys = rowEntries
          .filter(({ checkboxEl }) => checkboxEl instanceof HTMLInputElement && checkboxEl.checked)
          .map(({ item }) => item.key);
        setQuickGroupingSelectedKeys(normalizedScope, selectedKeys);
        updateSelectAllButtonLabel();
      };

      const updateRowEntryDisplay = (entry, nextName) => {
        if (!entry?.item) return;

        const parsed = parseGroupNameSegments(nextName);
        entry.item.rawName = String(nextName ?? '');
        entry.item.name = entry.item.rawName.trim() || `（未命名正则 ${Number(entry.item.index ?? 0) + 1}）`;
        entry.item.group1 = String(parsed?.segments?.[0]?.value ?? '').trim();
        entry.item.group2 = String(parsed?.segments?.[1]?.value ?? '').trim();
        entry.item.leaf = String(parsed?.rest ?? '').trimStart();
        if (entry.titleEl instanceof HTMLElement) entry.titleEl.textContent = entry.item.name;
        renderQuickGroupingCurrentInfo(entry.subEl, entry.item);
        entry.searchText = `${entry.item.name}\n${entry.item.rawName}\n${entry.item.group1}\n${entry.item.group2}\n${getQuickGroupingLeafName(entry.item)}`;
      };

      if (items.length > 0 && listEl instanceof HTMLElement) {
        for (const item of items) {
          const rowEl = document.createElement('div');
          rowEl.className = 'st-rgs-qg-item';
          rowEl.dataset.stRgsQgItem = '1';

          const checkboxEl = document.createElement('input');
          checkboxEl.type = 'checkbox';
          checkboxEl.value = item.key;
          checkboxEl.checked = selectionSet.has(item.key);

          const textWrapEl = document.createElement('div');
          textWrapEl.className = 'st-rgs-qg-item-text';

          const titleRowEl = document.createElement('div');
          titleRowEl.className = 'st-rgs-qg-item-title-row';

          const titleEl = document.createElement('div');
          titleEl.className = 'st-rgs-qg-item-title';
          titleEl.textContent = item.name;
          titleRowEl.appendChild(titleEl);

          if (item.disabled) {
            const badgeEl = document.createElement('span');
            badgeEl.className = 'st-rgs-qg-item-badge';
            badgeEl.textContent = '已禁用';
            titleRowEl.appendChild(badgeEl);
          }

          const subEl = document.createElement('div');
          subEl.className = 'st-rgs-qg-item-sub';
          renderQuickGroupingCurrentInfo(subEl, item);

          textWrapEl.appendChild(titleRowEl);
          textWrapEl.appendChild(subEl);
          rowEl.appendChild(checkboxEl);
          rowEl.appendChild(textWrapEl);
          listEl.appendChild(rowEl);

          checkboxEl.addEventListener('change', syncSelectionState);

          rowEl.addEventListener('click', (e) => {
            const target = e.target;
            if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.closest('input'))) return;
            checkboxEl.checked = !checkboxEl.checked;
            syncSelectionState();
          });

          rowEntries.push({
            item,
            rowEl,
            checkboxEl,
            titleEl,
            subEl,
            searchText: `${item.name}\n${item.rawName}\n${item.group1}\n${item.group2}\n${getQuickGroupingLeafName(item)}`,
          });
        }
        refreshAutocompleteSuggestions();
      }

      const setStatus = (message) => {
        if (statusEl instanceof HTMLElement) statusEl.textContent = String(message || '');
      };

      const getVisibleRows = () => rowEntries.filter(({ rowEl }) => !rowEl.classList.contains('st-rgs-qg-item-hidden'));

      const applyFilter = () => {
        const query = filterInput instanceof HTMLInputElement ? filterInput.value : '';
        quickGroupingDraftState.filter = query;

        let visibleCount = 0;
        for (const entry of rowEntries) {
          const matched = !normalizeSearchText(query) || fuzzyMatches(entry.searchText, query);
          entry.rowEl.classList.toggle('st-rgs-qg-item-hidden', !matched);
          if (matched) visibleCount += 1;
        }

        if (items.length < 1) {
          listEmptyEl.textContent = `当前范围暂无可编辑的${getQuickGroupingScopeLabel(normalizedScope)}`;
          listEmptyEl.classList.remove('st-rgs-qg-empty-hidden');
          updateSelectAllButtonLabel();
          return;
        }

        if (visibleCount < 1) {
          listEmptyEl.textContent = '当前筛选条件下没有匹配的正则';
          listEmptyEl.classList.remove('st-rgs-qg-empty-hidden');
          updateSelectAllButtonLabel();
          return;
        }

        listEmptyEl.classList.add('st-rgs-qg-empty-hidden');
        updateSelectAllButtonLabel();
      };

      filterInput?.addEventListener('input', applyFilter);
      group1Input?.addEventListener('input', () => { quickGroupingDraftState.group1 = group1Input.value; });
      group2Input?.addEventListener('input', () => { quickGroupingDraftState.group2 = group2Input.value; });
      format1Select?.addEventListener('change', () => { quickGroupingDraftState.format1 = normalizeQuickGroupingFormat(format1Select.value); });
      format2Select?.addEventListener('change', () => { quickGroupingDraftState.format2 = normalizeQuickGroupingFormat(format2Select.value); });

      const updateVisibleSelection = (mode) => {
        const visibleRows = getVisibleRows();
        const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(
          ({ checkboxEl }) => checkboxEl instanceof HTMLInputElement && checkboxEl.checked
        );

        for (const { checkboxEl } of visibleRows) {
          if (!(checkboxEl instanceof HTMLInputElement)) continue;
          if (mode === 'toggle-all') checkboxEl.checked = !allVisibleSelected;
          if (mode === 'invert') checkboxEl.checked = !checkboxEl.checked;
        }
        syncSelectionState();
      };

      selectAllBtn?.addEventListener('click', () => updateVisibleSelection('toggle-all'));
      invertBtn?.addEventListener('click', () => updateVisibleSelection('invert'));

      const setBusy = (busy) => {
        for (const controlEl of wrapper.querySelectorAll('button, input, select')) {
          if (controlEl instanceof HTMLButtonElement || controlEl instanceof HTMLInputElement || controlEl instanceof HTMLSelectElement) {
            controlEl.disabled = !!busy;
          }
        }
      };

      const applyUpdates = async (mode) => {
        const selectedKeys = rowEntries
          .filter(({ checkboxEl }) => checkboxEl instanceof HTMLInputElement && checkboxEl.checked)
          .map(({ item }) => item.key);

        if (selectedKeys.length < 1) {
          setStatus('未选择任何正则脚本');
          return;
        }

        let group1 = group1Input instanceof HTMLInputElement ? group1Input.value.trim() : '';
        let group2 = group2Input instanceof HTMLInputElement ? group2Input.value.trim() : '';
        const format1 = format1Select instanceof HTMLSelectElement ? format1Select.value : 'bracket';
        const format2 = format2Select instanceof HTMLSelectElement ? format2Select.value : 'bracket';

        try {
          if (mode !== 'clear') {
            if (group1) group1 = normalizeGroupRenameInput(group1);
            if (group2) group2 = normalizeGroupRenameInput(group2);
          }
        } catch (err) {
          setStatus(`失败：${String(err?.message || err)}`);
          return;
        }

        const itemMap = new Map(items.map((item) => [item.key, item]));
        const updates = new Map();

        for (const key of selectedKeys) {
          const item = itemMap.get(key);
          if (!item) continue;

          const leaf = getQuickGroupingLeafName(item);
          const nextName = mode === 'clear'
            ? leaf
            : buildQuickGroupedScriptName({ leaf, group1, group2, format1, format2 });
          updates.set(key, nextName);
        }

        if (updates.size < 1) {
          setStatus('没有可更新的条目');
          return;
        }

        const confirmed = await confirmWithNativePopup(`将修改 ${updates.size} 条${getQuickGroupingScopeLabel(normalizedScope)}的分组前缀，是否继续？`);
        if (!confirmed) return;

        setBusy(true);
        setStatus('处理中...');
        setQuickGroupingSelectedKeys(normalizedScope, selectedKeys);

        try {
          const { changedCount } = await applyQuickGroupingUpdates(normalizedScope, updates);
          if (changedCount > 0) {
            for (const [key, nextName] of updates.entries()) {
              const entry = rowEntries.find(({ item }) => item?.key === key);
              if (!entry) continue;
              updateRowEntryDisplay(entry, nextName);
              flashElement(entry.rowEl, 'st-rgs-qg-item-updated', 1800);
              updateRowSelectionUi(entry);
            }
            refreshAutocompleteSuggestions();
            applyFilter();
            setStatus(`完成：已更新 ${changedCount} 项`);
          } else {
            setStatus('没有需要更新的条目');
          }

          setBusy(false);
        } catch (err) {
          setBusy(false);
          setStatus(`失败：${String(err?.message || err)}`);
        }
      };

      applyBtn?.addEventListener('click', () => void applyUpdates('apply'));
      clearBtn?.addEventListener('click', () => void applyUpdates('clear'));
      applyFilter();
      syncSelectionState();
    } catch (err) {
      if (currentToken !== quickGroupingRenderToken) return;
      body.innerHTML = `<div class="st-rgs-qg-loading">加载失败：${String(err?.message || err)}</div>`;
    }
  }

  function openQuickGroupingModal(scope = quickGroupingActiveScope) {
    const modal = ensureQuickGroupingModal();
    modal.classList.remove('st-rgs-hidden');
    modal.tabIndex = -1;
    modal.focus?.();
    void renderQuickGroupingModal(scope);
  }

  // =====================
  // Panel Controller (per block)
  // =====================

  function createPanelController({ scope, blockId, listId, titleText, preserveSelectors = [] }) {
    // 本插件注入的 header 按钮 ID（用于防重复）
    const HEADER_ID = `st-rgs-collapse-header-${scope}`;

    // Header 上的快捷按钮（每个面板独立一套 ID，避免冲突）
    const GROUP_TOGGLE_ID = `st-rgs-group-toggle-${scope}`;
    const SUBGROUP_TOGGLE_ID = `st-rgs-subgroup-toggle-${scope}`;
    const EXPAND_ALL_BTN_ID = `st-rgs-expand-all-${scope}`;
    const COLLAPSE_ALL_BTN_ID = `st-rgs-collapse-all-${scope}`;
    const HELP_BTN_ID = `st-rgs-help-btn-${scope}`;
    const SETTINGS_BTN_ID = `st-rgs-settings-btn-${scope}`;
    const SETTINGS_MENU_ID = `st-rgs-settings-menu-${scope}`;

    // 折叠状态持久化（按 scope 区分）
    const STORAGE_KEY_COLLAPSED = `${MODULE_NAME}:${scope}:collapsed`;

    // 分组展示开关持久化
    const STORAGE_KEY_GROUPING = `${MODULE_NAME}:${scope}:grouping`;

    // 组折叠状态持久化：{ [groupKey]: true/false }
    const STORAGE_KEY_GROUP_COLLAPSE = `${MODULE_NAME}:${scope}:groupCollapse`;

    // 组开关占位状态持久化：{ [groupKey]: true/false }，true 表示“禁用/关闭”视觉状态
    const STORAGE_KEY_GROUP_DISABLED = `${MODULE_NAME}:${scope}:groupDisabled`;

    // 组开关恢复快照：{ [groupKey]: { [scriptId]: boolean } }，boolean 为脚本原始 disabled 状态
    const STORAGE_KEY_GROUP_DISABLED_SNAPSHOT = `${MODULE_NAME}:${scope}:groupDisabledSnapshot`;

    // 一级分组置顶（图钉）持久化：string[]
    const STORAGE_KEY_PINNED_GROUPS = `${MODULE_NAME}:${scope}:pinnedGroups`;

    // 是否启用二级分组（仅影响显示）
    const STORAGE_KEY_SUBGROUP = `${MODULE_NAME}:${scope}:subgroup`;

    // 真实脚本顺序快照（用于在酒馆重绘/重启后尽量维持稳定显示顺序）
    const STORAGE_KEY_ITEM_ORDER = `${MODULE_NAME}:${scope}:itemOrder`;

    let groupingEnabled = loadBool(STORAGE_KEY_GROUPING, false);
    let subgroupEnabled = loadBool(STORAGE_KEY_SUBGROUP, true);
    let groupCollapseState = loadJson(STORAGE_KEY_GROUP_COLLAPSE, {});
    let groupDisabledState = loadJson(STORAGE_KEY_GROUP_DISABLED, {});
    let groupDisabledSnapshots = loadJson(STORAGE_KEY_GROUP_DISABLED_SNAPSHOT, {});
    let collapsedState = loadBool(STORAGE_KEY_COLLAPSED, false);
    let searchQuery = getSharedSearchQuery();

    const loadItemOrder = () => {
      const val = loadJson(STORAGE_KEY_ITEM_ORDER, []);
      return Array.isArray(val) ? val.filter((x) => typeof x === 'string' && x) : [];
    };

    const saveItemOrder = (value) => {
      itemOrderState = value;
      saveJson(STORAGE_KEY_ITEM_ORDER, value);
    };

    const loadPinnedGroups = () => {
      const val = loadJson(STORAGE_KEY_PINNED_GROUPS, []);
      return Array.isArray(val) ? val.filter((x) => typeof x === 'string') : [];
    };

    let pinnedGroup1List = loadPinnedGroups();
    let itemOrderState = loadItemOrder();

    subscribeSharedSearch((nextQuery) => {
      searchQuery = String(nextQuery ?? '');

      const blockEl = getBlockEl();
      if (blockEl) applyBlockCollapsedState(blockEl);

      const listEl = getScriptsListEl();
      if (!listEl || !listEl.isConnected) return;

      if (groupingEnabled && listEl.classList.contains(GROUPING_CLASS)) applyGroupVisibility(listEl);
      else applyPlainSearchVisibility(listEl);

      updateHeaderBulkButtonsState();
    });

    function getBlockEl() {
      return document.getElementById(blockId);
    }

    function getHeaderEl() {
      return document.getElementById(HEADER_ID);
    }

    function getScriptsListEl() {
      return document.getElementById(listId);
    }

    function refreshCollapsePreservedElements(blockEl) {
      if (!blockEl?.children) return;

      for (const child of Array.from(blockEl.children)) {
        if (child?.dataset && COLLAPSE_PRESERVE_DATA_KEY in child.dataset) {
          delete child.dataset[COLLAPSE_PRESERVE_DATA_KEY];
        }
      }

      for (const selector of preserveSelectors) {
        if (!selector) continue;

        const targetEl = blockEl.querySelector(selector);
        if (!targetEl) continue;

        let directChild = targetEl;
        while (directChild && directChild.parentElement !== blockEl) {
          directChild = directChild.parentElement;
        }

        if (directChild?.parentElement === blockEl && directChild?.dataset) {
          directChild.dataset[COLLAPSE_PRESERVE_DATA_KEY] = '1';
        }
      }
    }

    // === block 折叠 ===

    function hasActiveSearchQuery() {
      return !!normalizeSearchText(searchQuery);
    }

    function applyBlockCollapsedState(blockEl) {
      if (!blockEl) return;

      refreshCollapsePreservedElements(blockEl);

      const searchActive = hasActiveSearchQuery();
      const effectiveCollapsed = collapsedState && !searchActive;

      if (effectiveCollapsed) {
        blockEl.classList.add(COLLAPSED_CLASS);
      } else {
        blockEl.classList.remove(COLLAPSED_CLASS);
      }

      blockEl.dataset.stRgsCollapsed = collapsedState ? '1' : '0';
      blockEl.dataset.stRgsSearchActive = searchActive ? '1' : '0';

      // 同步 header 的显示状态
      const header = getHeaderEl();
      if (header) {
        const arrow = header.querySelector('[data-st-rgs-arrow]');
        if (arrow) {
          arrow.textContent = effectiveCollapsed ? '▶' : '▼';
        }

        const toggleArea = header.querySelector('[data-st-rgs-collapse-toggle]');
        (toggleArea || header).setAttribute('aria-expanded', effectiveCollapsed ? 'false' : 'true');
      }
    }

    function setCollapsed(blockEl, collapsed) {
      collapsedState = !!collapsed;
      if (!blockEl) return;

      applyBlockCollapsedState(blockEl);
      saveBool(STORAGE_KEY_COLLAPSED, collapsedState);
    }

    function getCollapsed() {
      return collapsedState;
    }

    function itemMatchesSearch(itemEl) {
      return fuzzyMatches(getScriptDisplayName(itemEl), searchQuery);
    }

    function applyPlainSearchVisibility(listEl) {
      if (!listEl) return;
      const searchActive = hasActiveSearchQuery();

      for (const itemEl of getScriptItemEls(listEl)) {
        const matched = !searchActive || itemMatchesSearch(itemEl);
        itemEl.dataset.stRgsSearchMatch = matched ? '1' : '0';
        itemEl.classList.toggle(SEARCH_HIDDEN_CLASS, !matched);
      }

      applyForcedDisabledUi(listEl);
    }

    // === 分组展示 ===

    function getScriptItemEls(listEl) {
      if (!listEl?.children) return [];
      return Array.from(listEl.children).filter((el) => el?.classList?.contains('regex-script-label'));
    }

    function getGroupHeaderEls(listEl) {
      if (!listEl?.children) return [];
      return Array.from(listEl.children).filter(
        (el) => el?.classList?.contains('st-rgs-group-header') || el?.classList?.contains('st-rgs-subgroup-header')
      );
    }

    function getScriptDisplayName(itemEl) {
      const nameEl = itemEl?.querySelector?.('.regex_script_name');
      const txt = nameEl?.textContent?.trim();
      if (txt) return txt;
      // 兜底：有些版本可能放在 title
      const title = nameEl?.getAttribute?.('title');
      if (title) return title.trim();
      return String(itemEl?.dataset?.stRgsRawScriptName || '').trim();
    }

    function getGroupHeaderContext(headerEl) {
      if (!headerEl) return null;
      const level = Number(headerEl.dataset.stRgsLevel || 0);
      const group1 = String(headerEl.dataset.stRgsGroup1 || '');
      const group2 = String(headerEl.dataset.stRgsGroup2 || '');
      if (!level || !group1) return null;
      return {
        level,
        group1,
        group2,
        currentName: level === 1 ? group1 : group2,
      };
    }

    function getGroupScriptItemEls(listEl, groupContext) {
      if (!listEl || !groupContext) return [];
      return getScriptItemEls(listEl).filter((itemEl) => {
        if (String(itemEl?.dataset?.stRgsGroup1 || '') !== groupContext.group1) return false;
        if (groupContext.level === 2) {
          return String(itemEl?.dataset?.stRgsGroup2 || '') === groupContext.group2;
        }
        return true;
      });
    }

    function applyScriptItemForcedDisabledUi(listEl) {
      if (!listEl?.isConnected) return;

      for (const itemEl of getScriptItemEls(listEl)) {
        const scriptId = String(itemEl?.dataset?.regexScriptId || '');
        const groupContext = resolveItemGroupContext(itemEl, { subgroupEnabled });
        const activeDisabledKeys = getActiveDisabledGroupKeys(groupDisabledState, groupContext.keys);
        const forcedDisabled = activeDisabledKeys.length > 0;
        const preferredState = findPreferredGroupSnapshotState(groupDisabledSnapshots, activeDisabledKeys, scriptId);

        itemEl.classList.toggle('st-rgs-group-forced-disabled', forcedDisabled);
        itemEl.dataset.stRgsGroupForcedDisabled = forcedDisabled ? '1' : '0';

        const inputEl = itemEl.querySelector('.disable_regex');
        const titleEl = itemEl.querySelector('.regex_script_name');
        if (titleEl?.classList) {
          titleEl.classList.toggle('st-rgs-group-title-disabled', forcedDisabled);
        }

        if (inputEl instanceof HTMLInputElement) {
          const rawDisabled = itemEl?.dataset?.stRgsRawScriptDisabled === '1';

          if (forcedDisabled && preferredState !== undefined && inputEl.checked !== preferredState) {
            inputEl.checked = preferredState;
          }

          if (!forcedDisabled && inputEl.checked !== rawDisabled) {
            inputEl.checked = rawDisabled;
          }

          inputEl.disabled = forcedDisabled;

          if (!forcedDisabled) {
            delete inputEl.dataset.stRgsForcedDisabled;
          } else {
            inputEl.dataset.stRgsForcedDisabled = '1';
          }
        }
      }
    }

    function applyGroupHeaderToggleForcedDisabledUi(listEl) {
      if (!listEl?.isConnected) return;

      for (const headerEl of getGroupHeaderEls(listEl)) {
        const groupContext = getGroupHeaderContext(headerEl);
        if (!groupContext) continue;

        const toggleLabelEl = headerEl.querySelector('.st-rgs-group-toggle-checkbox');
        const toggleInputEl = headerEl.querySelector('.st-rgs-group-disable-toggle');
        if (!(toggleInputEl instanceof HTMLInputElement)) continue;

        const forcedDisabled = groupContext.level > 1 && !!groupDisabledState[makeGroupKey(groupContext.group1)];
        toggleInputEl.disabled = forcedDisabled;
        toggleInputEl.dataset.stRgsForcedDisabled = forcedDisabled ? '1' : '0';

        if (toggleLabelEl?.dataset) {
          toggleLabelEl.dataset.stRgsToggleLocked = forcedDisabled ? '1' : '0';
        }

        headerEl.dataset.stRgsGroupToggleLocked = forcedDisabled ? '1' : '0';
      }
    }

    function applyForcedDisabledUi(listEl) {
      applyScriptItemForcedDisabledUi(listEl);
      applyGroupHeaderToggleForcedDisabledUi(listEl);
    }

    function updateSnapshotsForManualScriptToggle(itemEl, nextDisabled) {
      const scriptId = String(itemEl?.dataset?.regexScriptId || '');
      if (!scriptId) return false;

      const groupContext = resolveItemGroupContext(itemEl, { subgroupEnabled });
      const activeDisabledKeys = sortGroupKeysBySpecificity(getActiveDisabledGroupKeys(groupDisabledState, groupContext.keys));
      if (activeDisabledKeys.length < 1) return false;

      for (const key of activeDisabledKeys) {
        const currentSnapshot = groupDisabledSnapshots[key] && typeof groupDisabledSnapshots[key] === 'object'
          ? { ...groupDisabledSnapshots[key] }
          : {};
        currentSnapshot[scriptId] = !!nextDisabled;
        groupDisabledSnapshots[key] = currentSnapshot;
      }

      debugGroupState('manual-script-toggle-while-group-disabled', {
        scope,
        scriptId,
        nextDisabled: !!nextDisabled,
        activeDisabledKeys,
        snapshots: activeDisabledKeys.reduce((acc, key) => ({ ...acc, [key]: groupDisabledSnapshots[key] }), {}),
      });

      saveGroupDisabledSnapshots();
      return true;
    }

    async function syncRegexScriptIdsToList(listEl) {
      if (!listEl?.isConnected) return false;

      const items = getScriptItemEls(listEl);
      if (items.length < 1) return false;

      const engine = await importRegexEngine();
      if (!engine) return false;

      const { SCRIPT_TYPES, getScriptsByType } = engine;
      const scriptType = getRegexScopeType(scope, SCRIPT_TYPES);
      const rawScripts = Array.isArray(getScriptsByType(scriptType)) ? getScriptsByType(scriptType) : [];
      if (rawScripts.length < 1) return false;

      const assignScriptMeta = (itemEl, rawScript) => {
        if (!itemEl || !rawScript) return;
        if (rawScript.id !== undefined && rawScript.id !== null) itemEl.dataset.regexScriptId = String(rawScript.id);
        itemEl.dataset.stRgsScope = scope;
        itemEl.dataset.stRgsRawScriptName = String(rawScript.scriptName || '');
        itemEl.dataset.stRgsRawScriptDisabled = rawScript.disabled ? '1' : '0';
      };

      if (items.length === rawScripts.length) {
        items.forEach((itemEl, index) => assignScriptMeta(itemEl, rawScripts[index]));
        applyForcedDisabledUi(listEl);
        return true;
      }

      const rawEntries = rawScripts.map((rawScript, index) => ({
        rawScript,
        index,
        name: String(rawScript?.scriptName || ''),
        used: false,
      }));

      let assignedCount = 0;
      for (const itemEl of items) {
        const displayName = getScriptDisplayName(itemEl);
        const matchedEntry = rawEntries.find((entry) => !entry.used && entry.name === displayName);
        if (!matchedEntry) continue;
        matchedEntry.used = true;
        assignScriptMeta(itemEl, matchedEntry.rawScript);
        assignedCount += 1;
      }

      for (const itemEl of items) {
        if (itemEl?.dataset?.regexScriptId) continue;
        const nextEntry = rawEntries.find((entry) => !entry.used);
        if (!nextEntry) break;
        nextEntry.used = true;
        assignScriptMeta(itemEl, nextEntry.rawScript);
        assignedCount += 1;
      }

      applyForcedDisabledUi(listEl);
      return assignedCount > 0;
    }

    let regexScriptIdSyncScheduled = false;

    function requestRegexScriptIdSync(listEl = getScriptsListEl()) {
      if (regexScriptIdSyncScheduled || !listEl) return;
      regexScriptIdSyncScheduled = true;

      schedule(async () => {
        regexScriptIdSyncScheduled = false;
        try {
          await syncRegexScriptIdsToList(listEl);
        } catch (err) {
          warn(`sync regex script ids failed (${scope})`, err);
        }
      });
    }

    function saveGroupDisabledState() {
      saveJson(STORAGE_KEY_GROUP_DISABLED, groupDisabledState);
    }

    function saveGroupDisabledSnapshots() {
      saveJson(STORAGE_KEY_GROUP_DISABLED_SNAPSHOT, groupDisabledSnapshots);
    }

    function remapGroupStateKeys(groupContext, state, newName) {
      const nextState = {};

      if (groupContext.level === 1) {
        const oldGroup1Key = makeGroupKey(groupContext.group1);
        const newGroup1Key = makeGroupKey(newName);

        for (const [key, value] of Object.entries(state || {})) {
          if (key === oldGroup1Key) nextState[newGroup1Key] = value;
          else if (key.startsWith(`${groupContext.group1}${GROUP_KEY_SEP}`)) nextState[`${newName}${key.slice(groupContext.group1.length)}`] = value;
          else nextState[key] = value;
        }

        return nextState;
      }

      const oldSubgroupKey = makeGroupKey(groupContext.group1, groupContext.group2);
      const newSubgroupKey = makeGroupKey(groupContext.group1, newName);
      for (const [key, value] of Object.entries(state || {})) {
        nextState[key === oldSubgroupKey ? newSubgroupKey : key] = value;
      }

      return nextState;
    }

    function clearGroupStateKeys(groupContext) {
      if (!groupContext) return;

      const clearObjectState = (source) => {
        const next = {};
        for (const [key, value] of Object.entries(source || {})) {
          if (groupContext.level === 1) {
            if (key === makeGroupKey(groupContext.group1)) continue;
            if (key.startsWith(`${groupContext.group1}${GROUP_KEY_SEP}`)) continue;
          } else {
            if (key === makeGroupKey(groupContext.group1, groupContext.group2)) continue;
          }
          next[key] = value;
        }
        return next;
      };

      groupCollapseState = clearObjectState(groupCollapseState);
      groupDisabledState = clearObjectState(groupDisabledState);
      groupDisabledSnapshots = clearObjectState(groupDisabledSnapshots);
      saveJson(STORAGE_KEY_GROUP_COLLAPSE, groupCollapseState);
      saveGroupDisabledState();
      saveGroupDisabledSnapshots();

      if (groupContext.level === 1) {
        pinnedGroup1List = uniqStrings(pinnedGroup1List.filter((item) => item !== groupContext.group1));
        saveJson(STORAGE_KEY_PINNED_GROUPS, pinnedGroup1List);
      }
    }

    function transferGroupDisabledStateToScope(groupContext, targetScope) {
      if (!groupContext) return;
      const stateKey = makeGroupKey(groupContext.group1, groupContext.group2);
      if (!groupDisabledState[stateKey] && !groupDisabledSnapshots[stateKey]) return;

      const targetDisabledStorageKey = `${MODULE_NAME}:${targetScope}:groupDisabled`;
      const targetSnapshotStorageKey = `${MODULE_NAME}:${targetScope}:groupDisabledSnapshot`;
      const targetDisabledState = loadJson(targetDisabledStorageKey, {});
      const targetDisabledSnapshots = loadJson(targetSnapshotStorageKey, {});

      if (Object.prototype.hasOwnProperty.call(groupDisabledState, stateKey)) {
        targetDisabledState[stateKey] = groupDisabledState[stateKey];
      }
      if (Object.prototype.hasOwnProperty.call(groupDisabledSnapshots, stateKey)) {
        targetDisabledSnapshots[stateKey] = groupDisabledSnapshots[stateKey];
      }

      saveJson(targetDisabledStorageKey, targetDisabledState);
      saveJson(targetSnapshotStorageKey, targetDisabledSnapshots);
    }

    function remapGroupUiStateAfterRename(groupContext, newName) {
      if (!groupContext || !newName) return;

      const nextCollapseState = {};
      if (groupContext.level === 1) {
        const oldGroup1Key = makeGroupKey(groupContext.group1);
        const newGroup1Key = makeGroupKey(newName);

        for (const [key, value] of Object.entries(groupCollapseState || {})) {
          if (key === oldGroup1Key) {
            nextCollapseState[newGroup1Key] = value;
            continue;
          }

          if (key.startsWith(`${groupContext.group1}${GROUP_KEY_SEP}`)) {
            nextCollapseState[`${newName}${key.slice(groupContext.group1.length)}`] = value;
            continue;
          }

          nextCollapseState[key] = value;
        }

        groupCollapseState = nextCollapseState;
        saveJson(STORAGE_KEY_GROUP_COLLAPSE, groupCollapseState);

        groupDisabledState = remapGroupStateKeys(groupContext, groupDisabledState, newName);
        saveGroupDisabledState();

        groupDisabledSnapshots = remapGroupStateKeys(groupContext, groupDisabledSnapshots, newName);
        saveGroupDisabledSnapshots();

        pinnedGroup1List = uniqStrings(pinnedGroup1List.map((item) => (item === groupContext.group1 ? newName : item)));
        saveJson(STORAGE_KEY_PINNED_GROUPS, pinnedGroup1List);
        return;
      }

      const oldSubgroupKey = makeGroupKey(groupContext.group1, groupContext.group2);
      const newSubgroupKey = makeGroupKey(groupContext.group1, newName);
      for (const [key, value] of Object.entries(groupCollapseState || {})) {
        nextCollapseState[key === oldSubgroupKey ? newSubgroupKey : key] = value;
      }

      groupCollapseState = nextCollapseState;
      saveJson(STORAGE_KEY_GROUP_COLLAPSE, groupCollapseState);

      groupDisabledState = remapGroupStateKeys(groupContext, groupDisabledState, newName);
      saveGroupDisabledState();

      groupDisabledSnapshots = remapGroupStateKeys(groupContext, groupDisabledSnapshots, newName);
      saveGroupDisabledSnapshots();
    }

    async function renameGroupScripts(groupContext, newName) {
      const listEl = getScriptsListEl();
      if (!listEl) throw new Error('当前正则列表尚未渲染完成');

      await syncRegexScriptIdsToList(listEl);

      const targetItems = getGroupScriptItemEls(listEl, groupContext);
      const targetIds = new Set(targetItems.map((itemEl) => String(itemEl?.dataset?.regexScriptId || '')).filter(Boolean));
      if (targetIds.size < 1) throw new Error('未找到分组对应的脚本 ID');

      const engine = await importRegexEngine();
      if (!engine) throw new Error('Regex engine 不可用');

      const { SCRIPT_TYPES, getScriptsByType, saveScriptsByType } = engine;
      const scriptType = getRegexScopeType(scope, SCRIPT_TYPES);
      const scripts = Array.isArray(getScriptsByType(scriptType)) ? [...getScriptsByType(scriptType)] : [];

      let changedCount = 0;
      const nextScripts = scripts.map((script) => {
        const id = String(script?.id ?? '');
        if (!targetIds.has(id)) return script;

        const nextScriptName = renameGroupedScriptName(script?.scriptName, { ...groupContext, newName });
        if (!nextScriptName || nextScriptName === script?.scriptName) return script;

        changedCount += 1;
        return { ...script, scriptName: nextScriptName };
      });

      if (changedCount < 1) return { changedCount: 0 };

      await saveScriptsByType(nextScripts, scriptType);
      await triggerRegexUiRefresh();
      return { changedCount };
    }

    async function getGroupRawScripts(groupContext, options = {}) {
      const listEl = getScriptsListEl();
      if (!listEl) throw new Error('当前正则列表尚未渲染完成');

      await syncRegexScriptIdsToList(listEl);
      const targetItems = getGroupScriptItemEls(listEl, groupContext);
      const targetIds = new Set(targetItems.map((itemEl) => String(itemEl?.dataset?.regexScriptId || '')).filter(Boolean));
      if (targetIds.size < 1) throw new Error('未找到分组对应的脚本 ID');

      const engine = await importRegexEngine();
      if (!engine) throw new Error('Regex engine 不可用');

      const scriptType = getRegexScopeType(scope, engine.SCRIPT_TYPES);
      const scripts = Array.isArray(engine.getScriptsByType(scriptType)) ? [...engine.getScriptsByType(scriptType)] : [];
      const matchedScripts = scripts.filter((script) => targetIds.has(String(script?.id ?? '')));

      if (matchedScripts.length < 1) throw new Error('未找到分组对应的脚本数据');

      if (options.requireScopedValidation) {
        await ensureScopedMoveAllowed();
      }

      debugGroupState('resolve-group-raw-scripts', {
        scope,
        groupContext,
        matchedIds: Array.from(targetIds),
        matchedScripts: summarizeRegexScriptStates(matchedScripts),
        totalScripts: scripts.length,
      });

      return {
        engine,
        scriptType,
        listEl,
        scripts,
        matchedScripts,
        matchedIds: new Set(matchedScripts.map((script) => String(script?.id ?? '')).filter(Boolean)),
      };
    }

    async function moveGroupScripts(groupContext, targetScope) {
      if (!groupContext) throw new Error('未找到分组上下文');
      if (targetScope === scope) return { movedCount: 0 };

      const { engine, scripts, matchedScripts, matchedIds } = await getGroupRawScripts(groupContext, { requireScopedValidation: targetScope === 'scoped' });

      if (targetScope === 'preset') {
        await ensurePresetMoveAllowed(engine);
      }

      const sourceScripts = scripts.filter((script) => !matchedIds.has(String(script?.id ?? '')));
      const targetScriptType = getRegexScopeType(targetScope, engine.SCRIPT_TYPES);
      const currentTargetScripts = Array.isArray(engine.getScriptsByType(targetScriptType)) ? [...engine.getScriptsByType(targetScriptType)] : [];
      const nextTargetScripts = currentTargetScripts.concat(matchedScripts.map((script) => ({ ...script })));

      await persistScriptsForScope(engine, scope, sourceScripts);
      await persistScriptsForScope(engine, targetScope, nextTargetScripts);
      await triggerRegexUiRefresh();
      return { movedCount: matchedScripts.length };
    }

    async function setGroupDisabled(groupContext, disabled) {
      const { engine, scripts, matchedScripts, matchedIds, listEl } = await getGroupRawScripts(groupContext);
      const groupKey = makeGroupKey(groupContext.group1, groupContext.group2);
      const snapshot = groupDisabledSnapshots[groupKey] && typeof groupDisabledSnapshots[groupKey] === 'object'
        ? groupDisabledSnapshots[groupKey]
        : {};

      const visualStateById = Object.fromEntries(
        getGroupScriptItemEls(listEl, groupContext).map((itemEl) => {
          const inputEl = itemEl?.querySelector?.('.disable_regex');
          return [String(itemEl?.dataset?.regexScriptId || ''), inputEl instanceof HTMLInputElement ? !!inputEl.checked : false];
        }).filter(([id]) => !!id)
      );

      const getDesiredDisabledForScript = (script) => {
        const { keys } = getScriptGroupKeysFromName(script?.scriptName, { subgroupEnabled });
        const activeOtherGroupKeys = getActiveDisabledGroupKeys(groupDisabledState, keys).filter((key) => key !== groupKey);
        const preferredSnapshotState = findPreferredGroupSnapshotState(groupDisabledSnapshots, activeOtherGroupKeys, String(script?.id ?? ''));
        if (preferredSnapshotState !== undefined) {
          return preferredSnapshotState;
        }
        if (Object.prototype.hasOwnProperty.call(visualStateById, String(script?.id ?? ''))) {
          return !!visualStateById[String(script?.id ?? '')];
        }
        return !!script?.disabled;
      };

      debugGroupState('set-group-disabled:start', {
        scope,
        groupContext,
        disabled,
        groupKey,
        currentGroupDisabledState: groupDisabledState[groupKey],
        currentSnapshot: snapshot,
        visualStateById,
        matchedScripts: summarizeRegexScriptStates(matchedScripts),
        allScripts: summarizeRegexScriptStates(scripts),
      });

      let changedCount = 0;
      const nextScripts = scripts.map((script) => {
        const id = String(script?.id ?? '');
        if (!matchedIds.has(id)) return script;

        const { keys } = getScriptGroupKeysFromName(script?.scriptName, { subgroupEnabled });
        const forcedByOtherGroups = isForcedDisabledByOtherGroups(groupDisabledState, keys, groupKey);

        const nextDisabled = disabled
          ? true
          : (forcedByOtherGroups ? true : (Object.prototype.hasOwnProperty.call(snapshot, id) ? !!snapshot[id] : !!script.disabled));

        if (!!script.disabled === nextDisabled) return script;
        changedCount += 1;
        return { ...script, disabled: nextDisabled };
      });

      const nextMatchedScripts = nextScripts.filter((script) => matchedIds.has(String(script?.id ?? '')));

      if (disabled) {
        groupDisabledSnapshots[groupKey] = Object.fromEntries(matchedScripts.map((script) => [String(script?.id ?? ''), getDesiredDisabledForScript(script)]));
        groupDisabledState[groupKey] = true;
      } else {
        delete groupDisabledSnapshots[groupKey];
        delete groupDisabledState[groupKey];
      }

      debugGroupState('set-group-disabled:before-persist', {
        scope,
        groupContext,
        disabled,
        groupKey,
        changedCount,
        nextMatchedScripts: summarizeRegexScriptStates(nextMatchedScripts),
        nextAllScripts: summarizeRegexScriptStates(nextScripts),
        nextGroupDisabledState: { ...groupDisabledState },
        nextSnapshotForGroup: groupDisabledSnapshots[groupKey],
      });

      saveGroupDisabledSnapshots();
      saveGroupDisabledState();
      await persistScriptsForScope(engine, scope, nextScripts);

      const scriptType = getRegexScopeType(scope, engine.SCRIPT_TYPES);
      debugGroupState('set-group-disabled:readback-after-persist-before-refresh', {
        scope,
        groupContext,
        disabled,
        groupKey,
        persistedMatchedScripts: summarizeRegexScriptStates(
          (Array.isArray(engine.getScriptsByType(scriptType)) ? engine.getScriptsByType(scriptType) : [])
            .filter((script) => matchedIds.has(String(script?.id ?? '')))
        ),
      });

      await triggerRegexUiRefresh();

      setTimeout(() => {
        try {
          const readbackScripts = Array.isArray(engine.getScriptsByType(scriptType)) ? engine.getScriptsByType(scriptType) : [];
          debugGroupState('set-group-disabled:delayed-readback-after-refresh', {
            scope,
            groupContext,
            disabled,
            groupKey,
            delayedMatchedScripts: summarizeRegexScriptStates(
              readbackScripts.filter((script) => matchedIds.has(String(script?.id ?? '')))
            ),
          });
        } catch (err) {
          warn('delayed readback failed', err);
        }
      }, 300);

      debugGroupState('set-group-disabled:after-persist', {
        scope,
        groupContext,
        disabled,
        groupKey,
        changedCount,
        affectedCount: matchedScripts.length,
      });

      return { changedCount, affectedCount: matchedScripts.length };
    }

    async function exportGroupScripts(groupContext) {
      const { matchedScripts } = await getGroupRawScripts(groupContext);
      const safeName = sanitizeFileName(groupContext.currentName) || `group-${Date.now()}`;
      const fileName = `regex-${safeName}.json`;
      downloadJsonFile(matchedScripts, fileName);
      return { exportedCount: matchedScripts.length, fileName };
    }

    async function deleteGroupScripts(groupContext) {
      const { engine, scripts, matchedScripts, matchedIds } = await getGroupRawScripts(groupContext);
      const nextScripts = scripts.filter((script) => !matchedIds.has(String(script?.id ?? '')));
      clearGroupStateKeys(groupContext);
      await persistScriptsForScope(engine, scope, nextScripts);
      await triggerRegexUiRefresh();
      return { deletedCount: matchedScripts.length };
    }

    async function runGroupAction(groupContext, action) {
      if (!groupContext || !action) return;

      if (action === 'move-global') {
        const confirmed = await confirmWithNativePopup(`Are you sure you want to move this regex script group to global?`);
        if (!confirmed) return;
        const result = await moveGroupScripts(groupContext, 'global');
        transferGroupDisabledStateToScope(groupContext, 'global');
        clearGroupStateKeys(groupContext);
        if (result?.movedCount) toastSuccess(`已将 ${result.movedCount} 条脚本移至全局`);
        return;
      }

      if (action === 'move-preset') {
        const confirmed = await confirmWithNativePopup(`Are you sure you want to move this regex script group to preset?`);
        if (!confirmed) return;
        const result = await moveGroupScripts(groupContext, 'preset');
        transferGroupDisabledStateToScope(groupContext, 'preset');
        clearGroupStateKeys(groupContext);
        if (result?.movedCount) toastSuccess(`已将 ${result.movedCount} 条脚本移至预设`);
        return;
      }

      if (action === 'move-scoped') {
        const confirmed = await confirmWithNativePopup(`Are you sure you want to move this regex script group to scoped?`);
        if (!confirmed) return;
        const result = await moveGroupScripts(groupContext, 'scoped');
        transferGroupDisabledStateToScope(groupContext, 'scoped');
        clearGroupStateKeys(groupContext);
        if (result?.movedCount) toastSuccess(`已将 ${result.movedCount} 条脚本移至局部`);
        return;
      }

      if (action === 'export-group') {
        const result = await exportGroupScripts(groupContext);
        toastSuccess(`已导出 ${result.exportedCount} 条脚本`);
        return;
      }

      if (action === 'delete-group') {
        const confirmed = await confirmWithNativePopup(`Are you sure you want to delete this regex script group?`);
        if (!confirmed) return;
        const result = await deleteGroupScripts(groupContext);
        if (result?.deletedCount) toastSuccess(`已删除 ${result.deletedCount} 条脚本`);
      }
    }

    async function promptRenameGroup(headerEl) {
      const groupContext = getGroupHeaderContext(headerEl);
      if (!groupContext) return;

      if (groupContext.level === 1 && groupContext.group1 === UNGROUPED_GROUP_NAME) {
        toastInfo('“未分组”没有固定前缀，暂不支持直接重命名');
        return;
      }

      const promptLabel = groupContext.level === 1 ? '一级分组新名称' : '二级分组新名称';
      const nextInput = await showNativeInputPopup(promptLabel, groupContext.currentName);
      if (nextInput == null) return;

      let newName = '';
      try {
        newName = normalizeGroupRenameInput(nextInput);
      } catch (err) {
        toastError(err?.message || '分组名称不合法');
        return;
      }

      if (newName === groupContext.currentName) return;

      try {
        const result = await renameGroupScripts(groupContext, newName);
        if (!result?.changedCount) {
          toastInfo('没有检测到需要改名的脚本');
          return;
        }

        remapGroupUiStateAfterRename(groupContext, newName);

        const listEl = getScriptsListEl();
        requestRegexScriptIdSync(listEl);
        if (groupingEnabled && listEl?.isConnected) applyGrouping(listEl);
        else if (listEl?.isConnected) {
          syncItemOrderAndSnapshot(getScriptItemEls(listEl), { preferCurrent: true });
          applyPlainSearchVisibility(listEl);
        }

        toastSuccess(`已重命名 ${result.changedCount} 条脚本`);
      } catch (err) {
        warn(`rename grouped scripts failed (${scope})`, err);
        toastError(err?.message || '分组重命名失败');
      }
    }

    function getScriptIdentityBaseKey(itemEl) {
      const explicitId = [
        itemEl?.dataset?.scriptId,
        itemEl?.dataset?.regexScriptId,
        itemEl?.dataset?.regexId,
        itemEl?.dataset?.id,
        itemEl?.getAttribute?.('data-script-id'),
        itemEl?.getAttribute?.('data-regex-script-id'),
        itemEl?.getAttribute?.('data-regex-id'),
        itemEl?.getAttribute?.('data-id'),
        itemEl?.id,
      ].find((value) => !!value);

      if (explicitId) return `id:${String(explicitId).trim()}`;

      const name = getScriptDisplayName(itemEl);
      const fieldFingerprints = Array.from(itemEl?.querySelectorAll?.('input, textarea, select') || [])
        .map((fieldEl) => {
          const marker =
            fieldEl.name ||
            fieldEl.id ||
            fieldEl.getAttribute?.('data-property') ||
            fieldEl.getAttribute?.('placeholder') ||
            fieldEl.className ||
            fieldEl.tagName;

          if (!marker) return '';

          if (fieldEl instanceof HTMLTextAreaElement) {
            return `${marker}:${fieldEl.value}`;
          }

          if (fieldEl instanceof HTMLSelectElement) {
            return `${marker}:${fieldEl.value}`;
          }

          if (fieldEl instanceof HTMLInputElement) {
            const type = (fieldEl.type || '').toLowerCase();
            if (type === 'checkbox' || type === 'radio') {
              // 启用/禁用状态不参与指纹，避免仅因开关变化就把同一条脚本识别成新条目。
              return `${marker}:${type}`;
            }
            return `${marker}:${fieldEl.value}`;
          }

          return `${marker}:${fieldEl.value ?? ''}`;
        })
        .filter(Boolean)
        .join(GROUP_KEY_SEP);

      return `fp:${hashString(`${name}${GROUP_KEY_SEP}${fieldFingerprints}`)}`;
    }

    function buildScriptOrderEntries(items) {
      const occurrenceMap = new Map();

      return items.map((itemEl, domIndex) => {
        const baseKey = getScriptIdentityBaseKey(itemEl);
        const occurrence = (occurrenceMap.get(baseKey) || 0) + 1;
        occurrenceMap.set(baseKey, occurrence);

        return {
          el: itemEl,
          domIndex,
          orderKey: `${baseKey}#${occurrence}`,
        };
      });
    }

    function mergeItemOrderState(currentKeys, { preferCurrent = false } = {}) {
      const nextCurrent = Array.from(new Set(currentKeys.filter(Boolean)));
      if (nextCurrent.length === 0) return [];

      if (preferCurrent || itemOrderState.length === 0) {
        return nextCurrent;
      }

      const currentKeySet = new Set(nextCurrent);
      const next = itemOrderState.filter((key) => currentKeySet.has(key));

      for (let i = 0; i < nextCurrent.length; i++) {
        const key = nextCurrent[i];
        if (next.includes(key)) continue;

        let insertAt = -1;

        for (let j = i - 1; j >= 0; j--) {
          const prevIndex = next.indexOf(nextCurrent[j]);
          if (prevIndex >= 0) {
            insertAt = prevIndex + 1;
            break;
          }
        }

        if (insertAt < 0) {
          for (let j = i + 1; j < nextCurrent.length; j++) {
            const nextIndex = next.indexOf(nextCurrent[j]);
            if (nextIndex >= 0) {
              insertAt = nextIndex;
              break;
            }
          }
        }

        if (insertAt < 0) next.push(key);
        else next.splice(insertAt, 0, key);
      }

      return next;
    }

    function setFlexOrder(el, order) {
      if (!el || !el.style) return;
      if (el.dataset.stRgsPrevOrder === undefined) {
        el.dataset.stRgsPrevOrder = el.style.order || '';
      }
      el.style.order = String(order);
    }

    function restoreFlexOrder(el) {
      if (!el || !el.style) return;
      if (el.dataset.stRgsPrevOrder !== undefined) {
        el.style.order = el.dataset.stRgsPrevOrder;
        delete el.dataset.stRgsPrevOrder;
      } else {
        el.style.order = '';
      }
    }

    function syncStoredItemOrder(items, options = {}) {
      const entries = buildScriptOrderEntries(items);
      const next = mergeItemOrderState(
        entries.map((entry) => entry.orderKey),
        options
      );

      if (!arrayShallowEqual(itemOrderState, next)) {
        saveItemOrder(next);
      }

      return entries;
    }

    let lastKnownItemOrderKeys = null;
    let lastKnownGroupKeys = null;

    function buildGroupingSnapshot(entries) {
      const itemOrderKeys = [];
      const groupKeys = new Set();

      for (const entry of entries) {
        const displayName = getScriptDisplayName(entry.el);
        const { groups } = parseGroupPath(displayName);
        const group1 = groups[0] || UNGROUPED_GROUP_NAME;
        const group2 = subgroupEnabled ? (groups[1] || '') : '';

        itemOrderKeys.push(entry.orderKey);
        groupKeys.add(makeGroupKey(group1));
        if (group2) groupKeys.add(makeGroupKey(group1, group2));
      }

      return {
        itemOrderKeys,
        groupKeys: Array.from(groupKeys),
      };
    }

    function storeGroupingSnapshot(snapshot) {
      lastKnownItemOrderKeys = Array.isArray(snapshot?.itemOrderKeys) ? snapshot.itemOrderKeys.slice() : [];
      lastKnownGroupKeys = Array.isArray(snapshot?.groupKeys) ? snapshot.groupKeys.slice() : [];
    }

    function syncItemOrderAndSnapshot(items, options = {}) {
      const entries = syncStoredItemOrder(items, options);
      storeGroupingSnapshot(buildGroupingSnapshot(entries));
      return entries;
    }

    function getOrderedScriptEntries(listEl) {
      const items = getScriptItemEls(listEl);
      const entries = syncStoredItemOrder(items);
      if (entries.length === 0) return [];

      const rankMap = new Map(itemOrderState.map((key, index) => [key, index]));
      const fallbackBaseRank = rankMap.size;

      return entries
        .slice()
        .sort((a, b) => {
          const orderA = rankMap.has(a.orderKey) ? rankMap.get(a.orderKey) : fallbackBaseRank + a.domIndex;
          const orderB = rankMap.has(b.orderKey) ? rankMap.get(b.orderKey) : fallbackBaseRank + b.domIndex;
          return orderA - orderB || a.domIndex - b.domIndex;
        });
    }

    function getOrderedScriptItemEls(listEl) {
      return getOrderedScriptEntries(listEl).map((entry) => entry.el);
    }

    function createGroupHeader({ level, group1, group2, title, count, order }) {
      const createActionButton = ({ action, className, title: buttonTitle, iconClass }) => {
        const buttonEl = document.createElement('div');
        buttonEl.className = `${className} menu_button interactable`;
        buttonEl.dataset.stRgsAction = action;
        buttonEl.title = buttonTitle;
        buttonEl.tabIndex = 0;
        buttonEl.setAttribute('role', 'button');
        buttonEl.innerHTML = `<i class="${iconClass}"></i>`;
        return buttonEl;
      };

      const el = document.createElement('div');
      el.className = level === 1 ? 'st-rgs-group-header' : 'st-rgs-subgroup-header';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');

      el.dataset.stRgsLevel = String(level);
      el.dataset.stRgsGroup1 = String(group1);
      if (group2) el.dataset.stRgsGroup2 = String(group2);

      const key = makeGroupKey(group1, group2);
      el.dataset.stRgsGroupKey = key;
      el.dataset.stRgsGroupDisabled = groupDisabledState[key] ? '1' : '0';

      const arrow = document.createElement('span');
      arrow.className = 'st-rgs-group-arrow';
      arrow.dataset.stRgsGroupArrow = '1';
      // 二级分组用不同箭头符号，便于区分
      arrow.textContent = level === 1 ? '▼' : '▾';

      const titleEl = document.createElement('span');
      titleEl.className = 'st-rgs-group-title';
      titleEl.classList.toggle('st-rgs-group-title-disabled', !!groupDisabledState[key]);
      titleEl.textContent = title;

      const countEl = document.createElement('span');
      countEl.className = 'st-rgs-group-count';
      countEl.dataset.stRgsBaseCount = String(count);
      countEl.textContent = `(${count})`;

      const toggleLabelEl = document.createElement('label');
      toggleLabelEl.className = 'checkbox flex-container margin-r5 st-rgs-group-toggle-checkbox';
      toggleLabelEl.dataset.stRgsIgnoreToggle = '1';
      toggleLabelEl.title = '分组统一开关（占位，暂未接入真实逻辑）';
      toggleLabelEl.innerHTML = `
        <input type="checkbox" name="regex_disable" class="disable_regex st-rgs-group-disable-toggle" ${groupDisabledState[key] ? 'checked' : ''}>
        <span class="regex-toggle-on fa-solid fa-toggle-on" title="禁用分组（占位）"></span>
        <span class="regex-toggle-off fa-solid fa-toggle-off" title="启用分组（占位）"></span>
      `;

      const expandLabelEl = document.createElement('label');
      expandLabelEl.className = 'menu_button regex_script_expand interactable st-rgs-group-expand';
      expandLabelEl.dataset.stRgsIgnoreToggle = '1';
      expandLabelEl.title = '显示更多分组操作';
      expandLabelEl.innerHTML = `
        <input type="checkbox" name="regex_expand">
        <span class="fa-solid fa-ellipsis"></span>
      `;

      const nativeButtonsEl = document.createElement('div');
      nativeButtonsEl.className = 'flex-container regex_script_buttons';
      nativeButtonsEl.dataset.stRgsIgnoreToggle = '1';
      nativeButtonsEl.append(
        createActionButton({ action: 'move-global', className: 'move_to_global', title: '移至全局', iconClass: 'fa-solid fa-globe' }),
        createActionButton({ action: 'move-preset', className: 'move_to_preset', title: '移至预设', iconClass: 'fa-solid fa-sliders' }),
        createActionButton({ action: 'move-scoped', className: 'move_to_scoped', title: '移至局部', iconClass: 'fa-solid fa-address-card' }),
        createActionButton({ action: 'export-group', className: 'export_regex', title: '导出分组', iconClass: 'fa-solid fa-file-export' })
      );

      const actionsEl = document.createElement('div');
      actionsEl.className = 'flex-container flexnowrap st-rgs-group-native-actions';
      actionsEl.dataset.stRgsIgnoreToggle = '1';
      actionsEl.append(
        toggleLabelEl,
        expandLabelEl,
        nativeButtonsEl,
        createActionButton({ action: 'rename-group', className: 'edit_existing_regex', title: level === 1 ? '重命名一级分组' : '重命名二级分组', iconClass: 'fa-solid fa-pencil' }),
        createActionButton({ action: 'delete-group', className: 'delete_regex', title: '删除分组', iconClass: 'fa-solid fa-trash' })
      );

      // 一级组：图钉（置顶）
      if (level === 1 && group1 !== UNGROUPED_GROUP_NAME) {
        const pin = document.createElement('span');
        pin.className = 'st-rgs-pin menu_button interactable';
        pin.dataset.stRgsIgnoreToggle = '1';
        pin.dataset.stRgsPin = '1';
        const pinned = pinnedGroup1List.includes(group1);
        pin.dataset.stRgsPinned = pinned ? '1' : '0';
        pin.title = pinned ? '取消置顶该分组' : '置顶该分组';
        pin.tabIndex = 0;
        pin.setAttribute('role', 'button');
        pin.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        el.append(arrow, titleEl, countEl, pin, actionsEl);
      } else {
        actionsEl.style.marginLeft = 'auto';
        el.append(arrow, titleEl, countEl, actionsEl);
      }

      setFlexOrder(el, order);

      return el;
    }

    function togglePinnedGroup(headerEl) {
      const group1 = headerEl?.dataset?.stRgsGroup1;
      if (!group1 || group1 === UNGROUPED_GROUP_NAME) return;

      pinnedGroup1List = loadPinnedGroups();
      const idx = pinnedGroup1List.indexOf(group1);
      if (idx >= 0) pinnedGroup1List.splice(idx, 1);
      else pinnedGroup1List.unshift(group1);

      saveJson(STORAGE_KEY_PINNED_GROUPS, pinnedGroup1List);

      const listEl = getScriptsListEl();
      if (listEl?.isConnected) applyGrouping(listEl);
      toastInfo(idx >= 0 ? `已取消置顶：${group1}` : `已置顶：${group1}`);
    }

    async function handleGroupAction(actionEl) {
      const action = String(actionEl?.dataset?.stRgsAction || '');
      if (!action) return;

      const headerEl = actionEl.closest?.('.st-rgs-group-header, .st-rgs-subgroup-header');
      if (!headerEl) return;

      const groupContext = getGroupHeaderContext(headerEl);
      if (!groupContext) return;

      if (action === 'rename-group') {
        await promptRenameGroup(headerEl);
        return;
      }

      try {
        await runGroupAction(groupContext, action);
      } catch (err) {
        warn(`group action failed (${scope}:${action})`, err);
        toastError(err?.message || `分组操作失败：${getScopeLabel(scope)}`);
      }
    }

    function updateHeaderBulkButtonsState() {
      const expandBtn = document.getElementById(EXPAND_ALL_BTN_ID);
      const collapseBtn = document.getElementById(COLLAPSE_ALL_BTN_ID);
      const searchActive = hasActiveSearchQuery();

      const listEl = getScriptsListEl();
      if (!expandBtn || !collapseBtn || !listEl || !listEl.classList.contains(GROUPING_CLASS) || searchActive) {
        if (expandBtn) expandBtn.disabled = true;
        if (collapseBtn) collapseBtn.disabled = true;
        return;
      }

      const headers = getGroupHeaderEls(listEl);
      const anyHeader = headers.length > 0;

      const anyCollapsed = headers.some((h) => !!groupCollapseState[h.dataset.stRgsGroupKey]);
      const anyExpanded = headers.some((h) => !groupCollapseState[h.dataset.stRgsGroupKey]);

      // 有折叠的组 → “全部展开”可用
      expandBtn.disabled = !anyHeader || !anyCollapsed;
      // 有展开的组 → “全部收纳”可用
      collapseBtn.disabled = !anyHeader || !anyExpanded;
    }

    function applyGroupVisibility(listEl) {
      const groupHeaders = getGroupHeaderEls(listEl);
      const items = getScriptItemEls(listEl);
      const searchActive = hasActiveSearchQuery();
      const matchedGroup1CountMap = new Map();
      const matchedSubgroupCountMap = new Map();

      for (const itemEl of items) {
        const group1 = itemEl.dataset.stRgsGroup1 || UNGROUPED_GROUP_NAME;
        const group2 = itemEl.dataset.stRgsGroup2 || '';
        const matched = !searchActive || itemMatchesSearch(itemEl);

        itemEl.dataset.stRgsSearchMatch = matched ? '1' : '0';
        if (!matched) continue;

        matchedGroup1CountMap.set(group1, (matchedGroup1CountMap.get(group1) || 0) + 1);
        if (group2) matchedSubgroupCountMap.set(makeGroupKey(group1, group2), (matchedSubgroupCountMap.get(makeGroupKey(group1, group2)) || 0) + 1);
      }

      const group1Collapsed = new Set();

      // 先处理一级组
      for (const headerEl of groupHeaders) {
        if (!headerEl.classList.contains('st-rgs-group-header')) continue;

        const group1 = headerEl.dataset.stRgsGroup1;
        const key = makeGroupKey(group1);
        const hasMatches = !searchActive || (matchedGroup1CountMap.get(group1) || 0) > 0;
        const collapsed = !!groupCollapseState[key];
        const effectiveCollapsed = !searchActive && collapsed;

        headerEl.classList.toggle('st-rgs-is-collapsed', effectiveCollapsed);
        headerEl.classList.toggle(SEARCH_HIDDEN_CLASS, !hasMatches);
        headerEl.setAttribute('aria-expanded', effectiveCollapsed ? 'false' : 'true');

        const countEl = headerEl.querySelector('.st-rgs-group-count');
        const shownCount = searchActive ? (matchedGroup1CountMap.get(group1) || 0) : Number(countEl?.dataset?.stRgsBaseCount || 0);
        if (countEl) countEl.textContent = `(${shownCount})`;

        const arrow = headerEl.querySelector('[data-st-rgs-group-arrow]');
        if (arrow) arrow.textContent = effectiveCollapsed ? '▶' : '▼';

        if (collapsed) group1Collapsed.add(group1);
      }

      // 再处理二级组（需要知道一级是否被折叠）
      for (const headerEl of groupHeaders) {
        if (!headerEl.classList.contains('st-rgs-subgroup-header')) continue;

        const group1 = headerEl.dataset.stRgsGroup1;
        const group2 = headerEl.dataset.stRgsGroup2;
        const key = makeGroupKey(group1, group2);
        const hasMatches = !searchActive || (matchedSubgroupCountMap.get(key) || 0) > 0;
        const parentHasMatches = !searchActive || (matchedGroup1CountMap.get(group1) || 0) > 0;

        const parentCollapsed = !searchActive && group1Collapsed.has(group1);
        const collapsed = !!groupCollapseState[key];
        const effectiveCollapsed = !searchActive && collapsed;

        headerEl.classList.toggle('st-rgs-is-collapsed', effectiveCollapsed);
        headerEl.classList.toggle(HIDDEN_CLASS, parentCollapsed);
        headerEl.classList.toggle(SEARCH_HIDDEN_CLASS, !hasMatches || !parentHasMatches);
        headerEl.setAttribute('aria-expanded', effectiveCollapsed ? 'false' : 'true');

        const countEl = headerEl.querySelector('.st-rgs-group-count');
        const shownCount = searchActive ? (matchedSubgroupCountMap.get(key) || 0) : Number(countEl?.dataset?.stRgsBaseCount || 0);
        if (countEl) countEl.textContent = `(${shownCount})`;

        const arrow = headerEl.querySelector('[data-st-rgs-group-arrow]');
        // 二级分组用不同箭头符号，便于区分
        if (arrow) arrow.textContent = effectiveCollapsed ? '▸' : '▾';
      }

      // 最后处理脚本本体
      for (const itemEl of items) {
        const group1 = itemEl.dataset.stRgsGroup1;
        const group2 = itemEl.dataset.stRgsGroup2;
        const matched = itemEl.dataset.stRgsSearchMatch === '1';

        const hideByGroup1 = !searchActive && group1Collapsed.has(group1);
        const hideByGroup2 = !searchActive && !!group2 && !!groupCollapseState[makeGroupKey(group1, group2)];

        itemEl.classList.toggle(HIDDEN_CLASS, hideByGroup1 || hideByGroup2);
        itemEl.classList.toggle(SEARCH_HIDDEN_CLASS, !matched);
      }

      applyForcedDisabledUi(listEl);
      updateHeaderBulkButtonsState();
    }

    function cleanupGroupingArtifacts(listEl) {
      if (!listEl) return;

      // 移除分组 header
      for (const el of getGroupHeaderEls(listEl)) {
        el.remove();
      }

      // 清理脚本项状态
      const items = getScriptItemEls(listEl);
      for (const itemEl of items) {
        itemEl.classList.remove(HIDDEN_CLASS);

        delete itemEl.dataset.stRgsGroup1;
        delete itemEl.dataset.stRgsGroup2;
        delete itemEl.dataset.stRgsDepth;
      }

      // 恢复 flex order（包括脚本项与其它元素）
      if (listEl.children) {
        for (const el of Array.from(listEl.children)) {
          restoreFlexOrder(el);
        }
      }

      listEl.classList.remove(GROUPING_CLASS);
    }

    let rebuilding = false;
    let rebuildScheduled = false;
    let itemOrderSyncScheduled = false;
    let itemOrderSyncPreferCurrent = false;

    function applyGrouping(listEl) {
      if (!listEl) return;

      rebuilding = true;
      try {
        // 清空旧状态后重建
        cleanupGroupingArtifacts(listEl);

        const orderedEntries = getOrderedScriptEntries(listEl);
        const snapshot = buildGroupingSnapshot(orderedEntries);
        const previousItemKeySet = Array.isArray(lastKnownItemOrderKeys) ? new Set(lastKnownItemOrderKeys) : null;
        const previousGroupKeySet = Array.isArray(lastKnownGroupKeys) ? new Set(lastKnownGroupKeys) : null;
        const newItemKeySet = previousItemKeySet
          ? new Set(snapshot.itemOrderKeys.filter((key) => !previousItemKeySet.has(key)))
          : new Set();
        const newGroupKeySet = previousGroupKeySet
          ? new Set(snapshot.groupKeys.filter((key) => !previousGroupKeySet.has(key)))
          : new Set();
        const attentionGroupKeySet = new Set();

        if (orderedEntries.length === 0) {
          storeGroupingSnapshot(snapshot);
          return;
        }

        listEl.classList.add(GROUPING_CLASS);

        // 收集分组信息（按 DOM 顺序，保证“首次出现顺序”稳定）
        const groupOrder = [];
        const groupDataMap = new Map();

        // 每次重建时刷新置顶列表（可能在别处被更新）
        pinnedGroup1List = loadPinnedGroups();

        function ensureGroupData(group1) {
          if (!groupDataMap.has(group1)) {
            groupOrder.push(group1);
            groupDataMap.set(group1, {
              direct: [],
              subOrder: [],
              subMap: new Map(),
            });
          }
          return groupDataMap.get(group1);
        }

        function ensureSubGroupData(gData, group2) {
          if (!gData.subMap.has(group2)) {
            gData.subOrder.push(group2);
            gData.subMap.set(group2, []);
          }
          return gData.subMap.get(group2);
        }

        for (const entry of orderedEntries) {
          const itemEl = entry.el;
          const displayName = getScriptDisplayName(itemEl);
          const { groups } = parseGroupPath(displayName);

          const group1 = groups[0] || UNGROUPED_GROUP_NAME;
          const group2 = subgroupEnabled ? (groups[1] || '') : '';

          itemEl.dataset.stRgsGroup1 = group1;
          if (group2) itemEl.dataset.stRgsGroup2 = group2;

          const gData = ensureGroupData(group1);
          if (!group2) {
            gData.direct.push(entry);
            itemEl.dataset.stRgsDepth = '1';
          } else {
            ensureSubGroupData(gData, group2).push(entry);
            itemEl.dataset.stRgsDepth = '2';
          }

          if (newItemKeySet.has(entry.orderKey)) {
            const group1Key = makeGroupKey(group1);
            const group2Key = group2 ? makeGroupKey(group1, group2) : '';

            if (!!groupCollapseState[group1Key]) attentionGroupKeySet.add(group1Key);
            else if (group2Key && !!groupCollapseState[group2Key]) attentionGroupKeySet.add(group2Key);
          }
        }

        // 为避免“未知子元素”跑到最上面：把它们压到最后
        // （例如某些版本可能在列表里插入提示/按钮）
        const miscEls = Array.from(listEl.children).filter(
          (el) =>
            el &&
            !el.classList.contains('regex-script-label') &&
            !el.classList.contains('st-rgs-group-header') &&
            !el.classList.contains('st-rgs-subgroup-header')
        );

        // 注意：flex order 的范围要足够大，避免 direct/sub 内数量太多溢出
        const GROUP_STEP = 1_000_000;
        const SUB_STEP = 10_000;

        // 调整组展示顺序：
        // 1) “未分组”默认在最前
        // 2) 用户置顶（图钉）的一级组依照 pinnedGroup1List 顺序排在前面（但在“未分组”之后）
        // 3) 其它组保持首次出现顺序
        const groupOrderAdjusted = (() => {
          const uniq = (arr) => {
            const s = new Set();
            const out = [];
            for (const x of arr) {
              const k = String(x);
              if (s.has(k)) continue;
              s.add(k);
              out.push(k);
            }
            return out;
          };

          const base = uniq(groupOrder);
          const pinned = uniq(pinnedGroup1List).filter((g) => base.includes(g) && g !== UNGROUPED_GROUP_NAME);

          const rest = base.filter((g) => g !== UNGROUPED_GROUP_NAME && !pinned.includes(g));
          const ungrouped = base.includes(UNGROUPED_GROUP_NAME) ? [UNGROUPED_GROUP_NAME] : [];

          return [...ungrouped, ...pinned, ...rest];
        })();

        for (let gi = 0; gi < groupOrderAdjusted.length; gi++) {
          const group1 = groupOrderAdjusted[gi];
          const gData = groupDataMap.get(group1);
          if (!gData) continue;

          const base = gi * GROUP_STEP;

          const totalCount =
            gData.direct.length + Array.from(gData.subMap.values()).reduce((acc, arr) => acc + arr.length, 0);

          const groupHeader = createGroupHeader({
            level: 1,
            group1,
            title: group1,
            count: totalCount,
            order: base,
          });
          const group1Key = makeGroupKey(group1);
          if (newGroupKeySet.has(group1Key) || attentionGroupKeySet.has(group1Key)) {
            flashElement(groupHeader, attentionGroupKeySet.has(group1Key) ? NEW_GROUP_ATTENTION_HIGHLIGHT_CLASS : NEW_GROUP_HIGHLIGHT_CLASS);
          }

          listEl.appendChild(groupHeader);

          // 一级组直辖脚本
          for (let i = 0; i < gData.direct.length; i++) {
            const entry = gData.direct[i];
            const itemEl = entry.el;
            setFlexOrder(itemEl, base + 1 + i);
            if (newItemKeySet.has(entry.orderKey)) flashElement(itemEl, NEW_ITEM_HIGHLIGHT_CLASS);
          }

          // 二级组（可在设置中关闭）
          if (subgroupEnabled) {
            for (let si = 0; si < gData.subOrder.length; si++) {
              const group2 = gData.subOrder[si];
              const subItems = gData.subMap.get(group2) || [];

              const subBase = base + (si + 1) * SUB_STEP;

              const subHeader = createGroupHeader({
                level: 2,
                group1,
                group2,
                title: group2,
                count: subItems.length,
                order: subBase,
              });
              const subgroupKey = makeGroupKey(group1, group2);
              if (newGroupKeySet.has(subgroupKey) || attentionGroupKeySet.has(subgroupKey)) {
                flashElement(subHeader, attentionGroupKeySet.has(subgroupKey) ? NEW_GROUP_ATTENTION_HIGHLIGHT_CLASS : NEW_GROUP_HIGHLIGHT_CLASS);
              }

              listEl.appendChild(subHeader);

              for (let i = 0; i < subItems.length; i++) {
                const entry = subItems[i];
                const itemEl = entry.el;
                setFlexOrder(itemEl, subBase + 1 + i);
                if (newItemKeySet.has(entry.orderKey)) flashElement(itemEl, NEW_ITEM_HIGHLIGHT_CLASS);
              }
            }
          }
        }

        // misc 放最后
        for (const el of miscEls) {
          setFlexOrder(el, groupOrderAdjusted.length * GROUP_STEP + 999_999);
        }

        applyGroupVisibility(listEl);
        storeGroupingSnapshot(snapshot);
      } finally {
        rebuilding = false;
      }
    }

    function scheduleGroupingRebuild() {
      if (rebuildScheduled) return;
      rebuildScheduled = true;

      schedule(() => {
        rebuildScheduled = false;
        if (!groupingEnabled) return;
        const listEl = getScriptsListEl();
        if (!listEl || !listEl.isConnected) return;
        requestRegexScriptIdSync(listEl);
        applyGrouping(listEl);
      });
    }

    function scheduleItemOrderSync(options = {}) {
      if (options.preferCurrent) itemOrderSyncPreferCurrent = true;
      if (itemOrderSyncScheduled) return;
      itemOrderSyncScheduled = true;

      schedule(() => {
        const preferCurrent = itemOrderSyncPreferCurrent;
        itemOrderSyncScheduled = false;
        itemOrderSyncPreferCurrent = false;
        const listEl = getScriptsListEl();
        if (!listEl || !listEl.isConnected) return;
        requestRegexScriptIdSync(listEl);
        syncItemOrderAndSnapshot(getScriptItemEls(listEl), { preferCurrent });
        if (!groupingEnabled) {
          applyPlainSearchVisibility(listEl);
        }
      });
    }

    function setAllGroupsCollapsed(collapsed) {
      const listEl = getScriptsListEl();
      if (!listEl || !listEl.classList.contains(GROUPING_CLASS)) return;

      const headers = getGroupHeaderEls(listEl);
      if (headers.length === 0) return;

      for (const h of headers) {
        const key = h.dataset.stRgsGroupKey;
        if (!key) continue;
        groupCollapseState[key] = !!collapsed;
      }

      saveJson(STORAGE_KEY_GROUP_COLLAPSE, groupCollapseState);
      applyGroupVisibility(listEl);
    }

    function updateGroupingToggleButton(buttonEl) {
      if (!buttonEl) return;

      const enabled = !!groupingEnabled;
      const labelEl = buttonEl.querySelector('.st-rgs-group-toggle-label');
      const iconEl = buttonEl.querySelector('.st-rgs-group-toggle-icon');

      buttonEl.dataset.stRgsEnabled = groupingEnabled ? '1' : '0';
      buttonEl.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      buttonEl.setAttribute('aria-label', enabled ? '已启用分组展示，点击切换为未分组' : '当前为未分组展示，点击启用分组');

      if (labelEl) labelEl.textContent = enabled ? '分组' : UNGROUPED_GROUP_NAME;
      else buttonEl.textContent = enabled ? '分组' : UNGROUPED_GROUP_NAME;

      if (iconEl) {
        iconEl.className = enabled
          ? 'fa-solid fa-circle-check st-rgs-group-toggle-icon'
          : 'fa-solid fa-layer-group st-rgs-group-toggle-icon';
      }

      buttonEl.title = enabled
        ? '已启用按前缀分组展示（一级/二级可选），点击切换为未分组'
        : '按前缀分组展示（一级/二级可选），并在分组时禁用拖拽排序';
    }

    function toggleGrouping(nextEnabled) {
      groupingEnabled = !!nextEnabled;
      saveBool(STORAGE_KEY_GROUPING, groupingEnabled);

      const headerToggle = document.getElementById(GROUP_TOGGLE_ID);
      updateGroupingToggleButton(headerToggle);

      const listEl = getScriptsListEl();
      if (!listEl) {
        // 还没渲染出来，等它出现后自动接管。
        startScriptsListWaitObserver();
        return;
      }

      ensureScriptsListEventHandlers(listEl);
      startScriptsListWaitObserver();
      startScriptsListObserver(listEl);

      if (groupingEnabled) {
        applyGrouping(listEl);
      } else {
        cleanupGroupingArtifacts(listEl);
        syncItemOrderAndSnapshot(getScriptItemEls(listEl), { preferCurrent: true });
        applyPlainSearchVisibility(listEl);
      }

      applyBlockCollapsedState(getBlockEl());
      updateHeaderBulkButtonsState();
    }

    function ensureScriptsListEventHandlers(listEl) {
      if (!listEl || listEl.dataset.stRgsHandlers === '1') return;
      listEl.dataset.stRgsHandlers = '1';

      // 点击 header：折叠/展开组；点击图钉：置顶一级组
      listEl.addEventListener('click', (e) => {
        if (!listEl.classList.contains(GROUPING_CLASS)) return;

        const ignoredEl = e.target?.closest?.('[data-st-rgs-ignore-toggle="1"]');
        if (ignoredEl) {
          if (ignoredEl.matches?.('.st-rgs-group-toggle-checkbox')) {
            e.stopPropagation();
            return;
          }

          if (ignoredEl.matches?.('.st-rgs-group-expand')) {
            e.stopPropagation();
            return;
          }
        }

        const actionEl = e.target?.closest?.('[data-st-rgs-action]');
        if (actionEl) {
          e.preventDefault();
          e.stopPropagation();
          void handleGroupAction(actionEl);
          return;
        }

        // 图钉优先
        const pinEl = e.target?.closest?.('[data-st-rgs-pin]');
        if (pinEl) {
          const headerEl = pinEl.closest('.st-rgs-group-header');
          e.preventDefault();
          e.stopPropagation();
          togglePinnedGroup(headerEl);
          return;
        }

        const headerEl = e.target?.closest?.('.st-rgs-group-header, .st-rgs-subgroup-header');
        if (!headerEl) return;

        e.preventDefault();
        e.stopPropagation();

        const key = headerEl.dataset.stRgsGroupKey;
        if (!key) return;

        groupCollapseState[key] = !groupCollapseState[key];
        saveJson(STORAGE_KEY_GROUP_COLLAPSE, groupCollapseState);

        applyGroupVisibility(listEl);
      });

      // 键盘可访问性
      listEl.addEventListener('keydown', (e) => {
        if (!listEl.classList.contains(GROUPING_CLASS)) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;

        const ignoredEl = e.target?.closest?.('[data-st-rgs-ignore-toggle="1"]');
        if (ignoredEl) {
          if (ignoredEl.matches?.('.st-rgs-group-toggle-checkbox')) {
            e.stopPropagation();
            return;
          }

          if (ignoredEl.matches?.('.st-rgs-group-expand')) {
            e.stopPropagation();
            return;
          }
        }

        const actionEl = e.target?.closest?.('[data-st-rgs-action]');
        if (actionEl) {
          e.preventDefault();
          e.stopPropagation();
          void handleGroupAction(actionEl);
          return;
        }

        const pinEl = e.target?.closest?.('[data-st-rgs-pin]');
        if (pinEl) {
          const headerEl = pinEl.closest('.st-rgs-group-header');
          e.preventDefault();
          e.stopPropagation();
          togglePinnedGroup(headerEl);
          return;
        }

        const headerEl = e.target?.closest?.('.st-rgs-group-header, .st-rgs-subgroup-header');
        if (!headerEl) return;

        e.preventDefault();
        e.stopPropagation();

        const key = headerEl.dataset.stRgsGroupKey;
        if (!key) return;

        groupCollapseState[key] = !groupCollapseState[key];
        saveJson(STORAGE_KEY_GROUP_COLLAPSE, groupCollapseState);

        applyGroupVisibility(listEl);
      });

      listEl.addEventListener('input', (e) => {
        const inputEl = e.target;
        if (!(inputEl instanceof HTMLInputElement) || !inputEl.classList.contains('disable_regex')) return;

        if (inputEl.classList.contains('st-rgs-group-disable-toggle')) return;

        const itemEl = inputEl.closest('.regex-script-label');
        if (!itemEl) return;

        const groupContext = resolveItemGroupContext(itemEl, { subgroupEnabled });
        if (!isForcedDisabledByAnyGroup(groupDisabledState, groupContext.keys)) return;

        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();

        schedule(() => applyForcedDisabledUi(listEl));
      }, true);

      listEl.addEventListener('click', (e) => {
        const controlEl = e.target?.closest?.('.regex-toggle-on, .regex-toggle-off');
        if (!controlEl) return;

        if (controlEl.closest?.('.st-rgs-group-toggle-checkbox[data-st-rgs-toggle-locked="1"]')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }


        const itemEl = controlEl.closest?.('.regex-script-label');
        if (!itemEl) return;

        const groupContext = resolveItemGroupContext(itemEl, { subgroupEnabled });
        if (!isForcedDisabledByAnyGroup(groupDisabledState, groupContext.keys)) return;

        e.preventDefault();
        e.stopPropagation();
        schedule(() => applyForcedDisabledUi(listEl));
      }, true);

      listEl.addEventListener('change', async (e) => {
        if (!listEl.classList.contains(GROUPING_CLASS)) return;

        const toggleEl = e.target?.closest?.('.st-rgs-group-disable-toggle');
        if (!toggleEl) return;

        const headerEl = toggleEl.closest?.('.st-rgs-group-header, .st-rgs-subgroup-header');
        const groupContext = getGroupHeaderContext(headerEl);
        if (!groupContext) return;

        const nextDisabled = !!toggleEl.checked;
        toggleEl.disabled = true;

        try {
          debugGroupState('group-toggle-change-event', {
            scope,
            groupContext,
            nextDisabled,
          });

          const result = await setGroupDisabled(groupContext, nextDisabled);
          if (headerEl?.dataset) headerEl.dataset.stRgsGroupDisabled = nextDisabled ? '1' : '0';
          const titleEl = headerEl?.querySelector?.('.st-rgs-group-title');
          if (titleEl?.classList) titleEl.classList.toggle('st-rgs-group-title-disabled', nextDisabled);

          const actionLabel = nextDisabled ? '关闭' : '恢复';
          const count = Number(result?.affectedCount || 0);
          toastSuccess(`已${actionLabel}${count} 条组内正则的状态`);
        } catch (err) {
          warn(`set group disabled failed (${scope})`, err);
          toggleEl.checked = !nextDisabled;
          toastError(err?.message || '分组开关操作失败');
        } finally {
          if (toggleEl?.isConnected) toggleEl.disabled = false;
        }

        requestRegexScriptIdSync(listEl);
      });

      // 分组模式下：拦截拖拽手柄的事件，避免触发原生排序
      const blockDrag = (e) => {
        if (!listEl.classList.contains(GROUPING_CLASS)) return;

        const handle = e.target?.closest?.('.drag-handle, .menu-handle');
        if (!handle) return;

        e.preventDefault();
        e.stopPropagation();
      };

      listEl.addEventListener('pointerdown', blockDrag, true);
      listEl.addEventListener('mousedown', blockDrag, true);
    }

    let scriptsListObserver = null;
    let observedScriptsListEl = null;

    function startScriptsListObserver(listEl) {
      stopScriptsListObserver();

      if (!listEl || typeof MutationObserver !== 'function') return;

      const isGroupHeaderEl = (node) =>
        node?.nodeType === 1 &&
        (node.classList?.contains('st-rgs-group-header') || node.classList?.contains('st-rgs-subgroup-header'));

      const isScriptItemEl = (node) => node?.nodeType === 1 && node.classList?.contains('regex-script-label');

      const isWithinGroupHeader = (node) => {
        if (!node) return false;
        const el = node.nodeType === 1 ? node : node.parentElement;
        return !!el?.closest?.('.st-rgs-group-header, .st-rgs-subgroup-header');
      };

      const isWithinScriptName = (node) => {
        if (!node) return false;
        const el = node.nodeType === 1 ? node : node.parentElement;
        return !!el?.closest?.('.regex_script_name');
      };

      observedScriptsListEl = listEl;

      scriptsListObserver = new MutationObserver((mutations) => {
        let needRebuild = false;
        let needOrderSync = false;

        for (const m of mutations) {
          if (isWithinGroupHeader(m.target)) continue;

          if (m.type === 'childList') {
            // 只关心列表容器自身的直接 children 变动（新增/删除脚本）。
            if (m.target !== listEl) continue;

            const nodes = [...m.addedNodes, ...m.removedNodes];
            for (const n of nodes) {
              if (isGroupHeaderEl(n)) continue;
              if (isScriptItemEl(n)) {
                needRebuild = groupingEnabled;
                needOrderSync = !groupingEnabled;
                break;
              }
              // 其它元素（非组 header）的增删也可能影响布局，保险起见也重建
              if (n?.nodeType === 1) {
                needRebuild = groupingEnabled;
                needOrderSync = !groupingEnabled;
                break;
              }
            }
          } else if (m.type === 'characterData') {
            // 只关心脚本名的文本变化
            if (!isWithinScriptName(m.target)) continue;
            needRebuild = groupingEnabled;
            needOrderSync = !groupingEnabled;
          }

          if (needRebuild || needOrderSync) break;
        }

        if (groupingEnabled) {
          if (!needRebuild) return;
          scheduleGroupingRebuild();
          return;
        }

        if (!needOrderSync) return;
        scheduleItemOrderSync({ preferCurrent: true });
      });

      scriptsListObserver.observe(listEl, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    function stopScriptsListObserver() {
      if (!scriptsListObserver) return;
      scriptsListObserver.disconnect();
      observedScriptsListEl = null;
      scriptsListObserver = null;
    }

    let scriptsListWaitObserver = null;

    function startScriptsListWaitObserver() {
      if (scriptsListWaitObserver || typeof MutationObserver !== 'function') return;


      const root = getBlockEl() || document.body || document.documentElement;
      if (!root) return;

      let scheduled = false;

      const syncCurrentList = () => {
        const listEl = getScriptsListEl();
        if (!listEl || !listEl.isConnected) {
          if (observedScriptsListEl && !observedScriptsListEl.isConnected) {
            stopScriptsListObserver();
          }
          return;
        }

        requestRegexScriptIdSync(listEl);
        ensureScriptsListEventHandlers(listEl);

        if (listEl === observedScriptsListEl) return;

        startScriptsListObserver(listEl);

        if (groupingEnabled) applyGrouping(listEl);
        else {
          syncItemOrderAndSnapshot(getScriptItemEls(listEl), { preferCurrent: true });
          applyPlainSearchVisibility(listEl);
        }

        updateHeaderBulkButtonsState();
      };

      scriptsListWaitObserver = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        schedule(() => {
          scheduled = false;
          syncCurrentList();
        });
      });

      scriptsListWaitObserver.observe(root, { childList: true, subtree: true });
      syncCurrentList();
    }

    function stopScriptsListWaitObserver() {
      if (!scriptsListWaitObserver) return;
      scriptsListWaitObserver.disconnect();
      scriptsListWaitObserver = null;
    }

    function ensureGroupingMounted() {
      const listEl = getScriptsListEl();
      if (!listEl) {
        startScriptsListWaitObserver();
        return false;
      }

      startScriptsListWaitObserver();
      ensureScriptsListEventHandlers(listEl);
      startScriptsListObserver(listEl);
      requestRegexScriptIdSync(listEl);

      if (groupingEnabled) {
        applyGrouping(listEl);
      } else {
        cleanupGroupingArtifacts(listEl);
        syncItemOrderAndSnapshot(getScriptItemEls(listEl), { preferCurrent: true });
        applyPlainSearchVisibility(listEl);
      }

      applyBlockCollapsedState(getBlockEl());
      updateHeaderBulkButtonsState();
      return true;
    }

    // === Header 注入与挂载 ===

    function ensureMounted() {
      const blockEl = getBlockEl();
      if (!blockEl) {
        // Regex 界面可能还没打开；先不报错，等待下一次触发。
        return false;
      }

      refreshCollapsePreservedElements(blockEl);

      // 每次尝试挂载时刷新设置（避免其他地方修改了 localStorage）
      subgroupEnabled = loadBool(STORAGE_KEY_SUBGROUP, true);
      collapsedState = loadBool(STORAGE_KEY_COLLAPSED, false);
      groupDisabledState = loadJson(STORAGE_KEY_GROUP_DISABLED, {});
      groupDisabledSnapshots = loadJson(STORAGE_KEY_GROUP_DISABLED_SNAPSHOT, {});
      itemOrderState = loadItemOrder();

      if (scope === 'global') ensureSearchBar();

      // 已经注入过就不重复注入
      const existingHeader = getHeaderEl();
      if (existingHeader) {
        // 同步一下 header 的展示（箭头/aria），并更新分组 toggle
        setCollapsed(blockEl, getCollapsed());
        existingHeader.dataset[COLLAPSE_HEADER_DATA_KEY] = '1';

        const toggle = existingHeader.querySelector(`#${GROUP_TOGGLE_ID}`);
        updateGroupingToggleButton(toggle);

        const subgroupToggle = existingHeader.querySelector(`#${SUBGROUP_TOGGLE_ID}`);
        if (subgroupToggle) subgroupToggle.checked = !!subgroupEnabled;

        ensureGroupingMounted();
        updateHeaderBulkButtonsState();
        return true;
      }

      const header = document.createElement('div');
      header.id = HEADER_ID;
      header.className = 'st-rgs-header flex-container flexGap10 alignItemsCenter';
      header.dataset[COLLAPSE_HEADER_DATA_KEY] = '1';
      header.setAttribute('aria-controls', blockId);

      header.innerHTML = `
        <div class="st-rgs-click-area flex-container flexGap10 alignItemsCenter flex1" data-st-rgs-collapse-toggle role="button" tabindex="0" title="点击收起/展开">
          <span class="st-rgs-arrow" data-st-rgs-arrow>▼</span>
          <b class="st-rgs-title">${titleText}</b>
        </div>
        <div class="st-rgs-controls flex-container flexGap10 alignItemsCenter">
          <button type="button" class="menu_button interactable st-rgs-icon-btn st-rgs-group-toggle" id="${GROUP_TOGGLE_ID}" title="按前缀分组展示（一级/二级可选），并在分组时禁用拖拽排序" aria-label="切换分组展示" aria-pressed="false">
            <span class="fa-solid fa-layer-group st-rgs-group-toggle-icon" aria-hidden="true"></span>
            <span class="st-rgs-group-toggle-label">${UNGROUPED_GROUP_NAME}</span>
          </button>

          <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${EXPAND_ALL_BTN_ID}" title="全部展开" aria-label="全部展开" disabled>
            <span class="fa-solid fa-angles-down"></span>
          </button>
          <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${COLLAPSE_ALL_BTN_ID}" title="全部收纳" aria-label="全部收纳" disabled>
            <span class="fa-solid fa-angles-up"></span>
          </button>
          <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${HELP_BTN_ID}" title="使用说明" aria-label="使用说明">
            <span class="fa-solid fa-circle-info"></span>
          </button>

          <div class="st-rgs-settings">
            <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${SETTINGS_BTN_ID}" title="设置" aria-label="设置">
              <span class="fa-solid fa-gear"></span>
            </button>
            <div class="st-rgs-settings-menu st-rgs-hidden" id="${SETTINGS_MENU_ID}" role="menu">
              <label class="checkbox flex-container alignItemsCenter st-rgs-subgroup-toggle" title="开启后，支持从脚本名前缀解析第二级分组（例如：文生图-【常用】xxx）">
                <input type="checkbox" id="${SUBGROUP_TOGGLE_ID}">
                <span>启用二级分类</span>
              </label>
            </div>
          </div>
        </div>
      `;

      // 插入到 block 顶部
      blockEl.insertAdjacentElement('afterbegin', header);

      const toggleArea = header.querySelector('[data-st-rgs-collapse-toggle]');

      const toggleCollapse = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const next = !getCollapsed();
        setCollapsed(blockEl, next);
      };

      toggleArea?.addEventListener('click', toggleCollapse);
      toggleArea?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggleCollapse(e);
        }
      });

      // 分组 toggle
      const groupToggle = header.querySelector(`#${GROUP_TOGGLE_ID}`);
      if (groupToggle) {
        updateGroupingToggleButton(groupToggle);

        // 不要冒泡到 toggleArea，避免误触发整体收起
        groupToggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleGrouping(!groupingEnabled);
        });
      }

      // 全部展开 / 全部收纳 / 说明 / 设置
      const expandAllBtn = header.querySelector(`#${EXPAND_ALL_BTN_ID}`);
      const collapseAllBtn = header.querySelector(`#${COLLAPSE_ALL_BTN_ID}`);
      const helpBtn = header.querySelector(`#${HELP_BTN_ID}`);
      const settingsBtn = header.querySelector(`#${SETTINGS_BTN_ID}`);
      const settingsMenu = header.querySelector(`#${SETTINGS_MENU_ID}`);
      const subgroupToggle = header.querySelector(`#${SUBGROUP_TOGGLE_ID}`);

      const closeSettingsMenu = () => {
        if (!settingsMenu) return;
        settingsMenu.classList.add('st-rgs-hidden');
      };

      const toggleSettingsMenu = () => {
        if (!settingsMenu) return;
        settingsMenu.classList.toggle('st-rgs-hidden');
      };

      // 设置菜单：阻止冒泡，避免触发整体收起
      settingsBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSettingsMenu();
      });
      settingsMenu?.addEventListener('click', (e) => e.stopPropagation());

      if (subgroupToggle) {
        subgroupToggle.checked = !!subgroupEnabled;
        subgroupToggle.addEventListener('click', (e) => e.stopPropagation());
        subgroupToggle.addEventListener('change', (e) => {
          e.stopPropagation();
          subgroupEnabled = !!subgroupToggle.checked;
          saveBool(STORAGE_KEY_SUBGROUP, subgroupEnabled);

          // 开关变化时，如果正在分组展示，则立即重建
          if (groupingEnabled) {
            const listEl = getScriptsListEl();
            if (listEl) applyGrouping(listEl);
          }
        });
      }

      // 点击空白处关闭设置菜单
      const docCloseHandler = (e) => {
        if (!settingsMenu || !settingsBtn || !settingsMenu.isConnected || !settingsBtn.isConnected) {
          document.removeEventListener('click', docCloseHandler, true);
          document.removeEventListener('keydown', docEscHandler, true);
          return;
        }

        if (settingsMenu.classList.contains('st-rgs-hidden')) return;

        const inMenu = e.target?.closest?.(`#${SETTINGS_MENU_ID}`);
        const inBtn = e.target?.closest?.(`#${SETTINGS_BTN_ID}`);
        if (inMenu || inBtn) return;

        closeSettingsMenu();
      };

      const docEscHandler = (e) => {
        if (e.key === 'Escape') closeSettingsMenu();
      };

      document.addEventListener('click', docCloseHandler, true);
      document.addEventListener('keydown', docEscHandler, true);

      expandAllBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!groupingEnabled) {
          toastInfo('请先开启「分组」');
          return;
        }
        setAllGroupsCollapsed(false);
      });

      collapseAllBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!groupingEnabled) {
          toastInfo('请先开启「分组」');
          return;
        }
        setAllGroupsCollapsed(true);
      });

      helpBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHelpModal();
      });

      // 初始化：优先从 localStorage 恢复用户上一次的折叠状态
      setCollapsed(blockEl, loadBool(STORAGE_KEY_COLLAPSED, false));

      // 初始化：根据 localStorage 恢复分组展示开关，并同步按钮文案
      ensureGroupingMounted();
      updateHeaderBulkButtonsState();

      log(`mounted on #${blockId} (${scope})`);
      return true;
    }

    let domObserver = null;

    function startDomObserver() {
      // 已经挂载就不需要 observer 了
      if (getHeaderEl()) return;
      if (domObserver) return;
      if (typeof MutationObserver !== 'function') return;

      const root = document.body || document.documentElement;
      if (!root) return;

      let scheduled = false;

      domObserver = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        schedule(() => {
          scheduled = false;
          const ok = ensureMounted();
          if (ok && domObserver) {
            domObserver.disconnect();
            domObserver = null;
          }
        });
      });

      domObserver.observe(root, { childList: true, subtree: true });

      // observe 不会对“当前已存在”的元素触发，所以这里主动试一次
      const ok = ensureMounted();
      if (ok && domObserver) {
        domObserver.disconnect();
        domObserver = null;
      }
    }

    function tryEnsure() {
      try {
        const ok = ensureMounted();
        if (!ok) {
          startDomObserver();
        }
      } catch (err) {
        console.error(`[${MODULE_NAME}] ensureMounted failed (${scope}):`, err);
      }
    }

    return {
      scope,
      tryEnsure,
    };
  }

  function init() {
    const ctx = getCtx();
    if (!ctx) {
      warn('SillyTavern context not found.');
      return;
    }

    const { eventSource, event_types } = ctx;

    const controllers = [
      // 全局正则
      createPanelController({
        scope: 'global',
        blockId: 'global_scripts_block',
        listId: 'saved_regex_scripts',
        titleText: '全局正则',
      }),

      // 预设正则（用户已知容器 id="preset_scripts_block"，列表 id="saved_preset_scripts"）
      createPanelController({
        scope: 'preset',
        blockId: 'preset_scripts_block',
        listId: 'saved_preset_scripts',
        titleText: '预设正则',
      }),

      // 局部正则（角色局部脚本，收纳时保留局部启用开关）
      createPanelController({
        scope: 'scoped',
        blockId: 'scoped_scripts_block',
        listId: 'saved_scoped_scripts',
        titleText: '局部正则',
        preserveSelectors: ['#toggle_scoped_regex'],
      }),
    ];

    const tryEnsureAll = () => {
      ensureRegexHideControls();
      for (const c of controllers) {
        c.tryEnsure();
      }
    };

    startRegexHideObserver();

    // 规范：等 APP_READY 再动 DOM
    eventSource?.on?.(event_types.APP_READY, tryEnsureAll);

    // 兜底：Regex 页面可能是按需加载的
    if (event_types?.SETTINGS_LOADED) eventSource?.on?.(event_types.SETTINGS_LOADED, tryEnsureAll);
    if (event_types?.PRESET_CHANGED) eventSource?.on?.(event_types.PRESET_CHANGED, tryEnsureAll);

    // 立即尝试一次
    tryEnsureAll();
  }

  init();
})();
