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
  const SEARCH_HIDDEN_CLASS = 'st-rgs-search-hidden';
  const SEARCH_BAR_ID = 'st-rgs-search-bar';
  const SEARCH_INPUT_ID = 'st-rgs-search-input';
  const SEARCH_CLEAR_ID = 'st-rgs-search-clear';
  const REGEX_PAGE_HIDE_WRAPPER_ID = 'st-rgs-regex-hide-settings-anchor';
  const REGEX_PAGE_HIDE_BUTTON_ID = 'st-rgs-regex-hide-settings-trigger';
  const REGEX_PAGE_HIDE_MENU_ID = 'st-rgs-regex-hide-settings-menu';
  const REGEX_PAGE_FORCE_HIDDEN_CLASS = 'st-rgs-force-hidden';
  const REGEX_PAGE_HIDE_STORAGE_KEY = `${MODULE_NAME}:regexPageHiddenTargets`;
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
  let regexPageHideObserver = null;
  let regexPageHideDocHandlersBound = false;

  function log(...args) {
    console.log(`[${MODULE_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${MODULE_NAME}]`, ...args);
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

    // 一级分组置顶（图钉）持久化：string[]
    const STORAGE_KEY_PINNED_GROUPS = `${MODULE_NAME}:${scope}:pinnedGroups`;

    // 是否启用二级分组（仅影响显示）
    const STORAGE_KEY_SUBGROUP = `${MODULE_NAME}:${scope}:subgroup`;

    // 真实脚本顺序快照（用于在酒馆重绘/重启后尽量维持稳定显示顺序）
    const STORAGE_KEY_ITEM_ORDER = `${MODULE_NAME}:${scope}:itemOrder`;

    let groupingEnabled = loadBool(STORAGE_KEY_GROUPING, false);
    let subgroupEnabled = loadBool(STORAGE_KEY_SUBGROUP, true);
    let groupCollapseState = loadJson(STORAGE_KEY_GROUP_COLLAPSE, {});
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
      return (title || '').trim();
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
      const el = document.createElement('div');
      el.className = level === 1 ? 'st-rgs-group-header' : 'st-rgs-subgroup-header';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');

      el.dataset.stRgsLevel = String(level);
      el.dataset.stRgsGroup1 = String(group1);
      if (group2) el.dataset.stRgsGroup2 = String(group2);

      const key = makeGroupKey(group1, group2);
      el.dataset.stRgsGroupKey = key;

      const arrow = document.createElement('span');
      arrow.className = 'st-rgs-group-arrow';
      arrow.dataset.stRgsGroupArrow = '1';
      // 二级分组用不同箭头符号，便于区分
      arrow.textContent = level === 1 ? '▼' : '▾';

      const titleEl = document.createElement('span');
      titleEl.className = 'st-rgs-group-title';
      titleEl.textContent = title;

      const countEl = document.createElement('span');
      countEl.className = 'st-rgs-group-count';
      countEl.dataset.stRgsBaseCount = String(count);
      countEl.textContent = `(${count})`;

      // 一级组：图钉（置顶）
      if (level === 1 && group1 !== UNGROUPED_GROUP_NAME) {
        const pin = document.createElement('span');
        pin.className = 'st-rgs-pin';
        pin.dataset.stRgsPin = '1';
        const pinned = pinnedGroup1List.includes(group1);
        pin.dataset.stRgsPinned = pinned ? '1' : '0';
        pin.title = pinned ? '取消置顶该分组' : '置顶该分组';
        pin.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        el.append(arrow, titleEl, countEl, pin);
      } else {
        el.append(arrow, titleEl, countEl);
      }

      setFlexOrder(el, order);

      return el;
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

        // 图钉优先
        const pinEl = e.target?.closest?.('[data-st-rgs-pin]');
        if (pinEl) {
          const headerEl = pinEl.closest('.st-rgs-group-header');
          const group1 = headerEl?.dataset?.stRgsGroup1;
          if (!group1 || group1 === UNGROUPED_GROUP_NAME) return;

          e.preventDefault();
          e.stopPropagation();

          // toggle pin
          pinnedGroup1List = loadPinnedGroups();
          const idx = pinnedGroup1List.indexOf(group1);
          if (idx >= 0) pinnedGroup1List.splice(idx, 1);
          else pinnedGroup1List.unshift(group1);

          saveJson(STORAGE_KEY_PINNED_GROUPS, pinnedGroup1List);

          // 仅重建顺序，不改真实脚本顺序
          applyGrouping(listEl);
          toastInfo(idx >= 0 ? `已取消置顶：${group1}` : `已置顶：${group1}`);
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
