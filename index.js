(function () {
  'use strict';

  const MODULE_NAME = 'st-regex-global-scripts-collapser';

  // SillyTavern 原生 DOM：Regex / Global Scripts 面板根节点 ID
  const TARGET_ID = 'global_scripts_block';

  // SillyTavern 原生 DOM：全局正则列表容器
  const SCRIPTS_LIST_ID = 'saved_regex_scripts';

  // 本插件注入的 header 按钮 ID（用于防重复）
  const HEADER_ID = 'st-regex-gs-collapse-header';
  const GROUP_TOGGLE_ID = 'st-rgs-group-toggle';

  // 使用说明弹窗
  const HELP_MODAL_ID = 'st-rgs-help-modal';

  // Header 上的快捷按钮
  const EXPAND_ALL_BTN_ID = 'st-rgs-expand-all';
  const COLLAPSE_ALL_BTN_ID = 'st-rgs-collapse-all';
  const HELP_BTN_ID = 'st-rgs-help-btn';

  // 本插件用于标记“已收纳”的 class（收起整个 Global Scripts 区域）
  const COLLAPSED_CLASS = 'st-rgs-collapsed';

  // 分组展示模式 class
  const GROUPING_CLASS = 'st-rgs-grouping';
  const HIDDEN_CLASS = 'st-rgs-hidden';

  // 折叠状态持久化
  const STORAGE_KEY_COLLAPSED = `${MODULE_NAME}:collapsed`;

  // 分组展示开关持久化
  const STORAGE_KEY_GROUPING = `${MODULE_NAME}:grouping`;

  // 组折叠状态持久化：{ [groupKey]: true/false }
  const STORAGE_KEY_GROUP_COLLAPSE = `${MODULE_NAME}:groupCollapse`;

  // 一级分组置顶（图钉）持久化：string[]
  const STORAGE_KEY_PINNED_GROUPS = `${MODULE_NAME}:pinnedGroups`;

  const UNGROUPED_GROUP_NAME = '未分组';

  // 分组 key 分隔符（尽量选一个用户不太会输入的）
  const GROUP_KEY_SEP = '\u001F';

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

  // === Global Scripts 区域折叠（原功能） ===

  function setCollapsed(blockEl, collapsed) {
    if (!blockEl) return;

    if (collapsed) {
      blockEl.classList.add(COLLAPSED_CLASS);
      blockEl.dataset.stRgsCollapsed = '1';
    } else {
      blockEl.classList.remove(COLLAPSED_CLASS);
      blockEl.dataset.stRgsCollapsed = '0';
    }

    // 同步 header 的显示状态
    const header = document.getElementById(HEADER_ID);
    if (header) {
      const arrow = header.querySelector('[data-st-rgs-arrow]');
      if (arrow) {
        arrow.textContent = collapsed ? '▶' : '▼';
      }

      const toggleArea = header.querySelector('[data-st-rgs-collapse-toggle]');
      (toggleArea || header).setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    saveBool(STORAGE_KEY_COLLAPSED, collapsed);
  }

  function getCollapsed(blockEl) {
    return blockEl?.dataset?.stRgsCollapsed === '1' || blockEl?.classList?.contains(COLLAPSED_CLASS);
  }

  // === 分组展示（新功能） ===

  let groupingEnabled = loadBool(STORAGE_KEY_GROUPING, false);
  let groupCollapseState = loadJson(STORAGE_KEY_GROUP_COLLAPSE, {});

  const loadPinnedGroups = () => {
    const val = loadJson(STORAGE_KEY_PINNED_GROUPS, []);
    return Array.isArray(val) ? val.filter((x) => typeof x === 'string') : [];
  };

  let pinnedGroup1List = loadPinnedGroups();

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

  function getScriptsListEl() {
    return document.getElementById(SCRIPTS_LIST_ID);
  }

  function getScriptItemEls(listEl) {
    if (!listEl?.children) return [];
    return Array.from(listEl.children).filter((el) => el?.classList?.contains('regex-script-label'));
  }

  function getGroupHeaderEls(listEl) {
    if (!listEl?.children) return [];
    return Array.from(listEl.children).filter((el) => el?.classList?.contains('st-rgs-group-header') || el?.classList?.contains('st-rgs-subgroup-header'));
  }

  function getScriptDisplayName(itemEl) {
    const nameEl = itemEl?.querySelector?.('.regex_script_name');
    const txt = nameEl?.textContent?.trim();
    if (txt) return txt;
    // 兜底：有些版本可能放在 title
    const title = nameEl?.getAttribute?.('title');
    return (title || '').trim();
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

  function applyGroupVisibility(listEl) {
    const groupHeaders = getGroupHeaderEls(listEl);

    const group1Collapsed = new Set();

    // 先处理一级组
    for (const headerEl of groupHeaders) {
      if (!headerEl.classList.contains('st-rgs-group-header')) continue;

      const group1 = headerEl.dataset.stRgsGroup1;
      const key = makeGroupKey(group1);
      const collapsed = !!groupCollapseState[key];

      headerEl.classList.toggle('st-rgs-is-collapsed', collapsed);
      headerEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

      const arrow = headerEl.querySelector('[data-st-rgs-group-arrow]');
      if (arrow) arrow.textContent = collapsed ? '▶' : '▼';

      if (collapsed) group1Collapsed.add(group1);
    }

    // 再处理二级组（需要知道一级是否被折叠）
    for (const headerEl of groupHeaders) {
      if (!headerEl.classList.contains('st-rgs-subgroup-header')) continue;

      const group1 = headerEl.dataset.stRgsGroup1;
      const group2 = headerEl.dataset.stRgsGroup2;
      const key = makeGroupKey(group1, group2);

      const parentCollapsed = group1Collapsed.has(group1);
      const collapsed = !!groupCollapseState[key];

      headerEl.classList.toggle('st-rgs-is-collapsed', collapsed);
      headerEl.classList.toggle(HIDDEN_CLASS, parentCollapsed);
      headerEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

      const arrow = headerEl.querySelector('[data-st-rgs-group-arrow]');
      // 二级分组用不同箭头符号，便于区分
      if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
    }

    // 最后处理脚本本体
    const items = getScriptItemEls(listEl);
    for (const itemEl of items) {
      const group1 = itemEl.dataset.stRgsGroup1;
      const group2 = itemEl.dataset.stRgsGroup2;

      const hideByGroup1 = group1Collapsed.has(group1);
      const hideByGroup2 = !!group2 && !!groupCollapseState[makeGroupKey(group1, group2)];

      itemEl.classList.toggle(HIDDEN_CLASS, hideByGroup1 || hideByGroup2);
    }

    // 同步“展开/收纳全部”按钮的可用状态
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

  function applyGrouping(listEl) {
    if (!listEl) return;

    rebuilding = true;
    try {
      // 清空旧状态后重建
      cleanupGroupingArtifacts(listEl);

      const items = getScriptItemEls(listEl);
      if (items.length === 0) return;

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

      for (const itemEl of items) {
        const displayName = getScriptDisplayName(itemEl);
        const { groups } = parseGroupPath(displayName);

        const group1 = groups[0] || UNGROUPED_GROUP_NAME;
        const group2 = groups[1] || '';

        itemEl.dataset.stRgsGroup1 = group1;
        if (group2) itemEl.dataset.stRgsGroup2 = group2;

        const gData = ensureGroupData(group1);
        if (!group2) {
          gData.direct.push(itemEl);
          itemEl.dataset.stRgsDepth = '1';
        } else {
          ensureSubGroupData(gData, group2).push(itemEl);
          itemEl.dataset.stRgsDepth = '2';
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

        const totalCount = gData.direct.length + Array.from(gData.subMap.values()).reduce((acc, arr) => acc + arr.length, 0);

        const groupHeader = createGroupHeader({
          level: 1,
          group1,
          title: group1,
          count: totalCount,
          order: base,
        });
        listEl.appendChild(groupHeader);

        // 一级组直辖脚本
        for (let i = 0; i < gData.direct.length; i++) {
          const itemEl = gData.direct[i];
          setFlexOrder(itemEl, base + 1 + i);
        }

        // 二级组
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
          listEl.appendChild(subHeader);

          for (let i = 0; i < subItems.length; i++) {
            const itemEl = subItems[i];
            setFlexOrder(itemEl, subBase + 1 + i);
          }
        }
      }

      // misc 放最后
      for (const el of miscEls) {
        setFlexOrder(el, groupOrderAdjusted.length * GROUP_STEP + 999_999);
      }

      applyGroupVisibility(listEl);
    } finally {
      rebuilding = false;
    }
  }

  function updateHeaderBulkButtonsState() {
    const expandBtn = document.getElementById(EXPAND_ALL_BTN_ID);
    const collapseBtn = document.getElementById(COLLAPSE_ALL_BTN_ID);

    const listEl = getScriptsListEl();
    if (!expandBtn || !collapseBtn || !listEl || !listEl.classList.contains(GROUPING_CLASS)) {
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
          <p><b>1) 开启分组：</b>在 Global Scripts 标题右侧勾选「分组」。</p>
          <p><b>2) 支持两种前缀：</b></p>
          <ul>
            <li>以<code>【前缀名字】</code> 包裹的，例如 → <code>【常用】</code></li>
            <li>以<code>前缀名 与 减号"-"</code> 组合，例如 → <code>常用-</code></li>
          </ul>
          <p><b>3) 分组规则（支持最多二级分类，两种前缀可混用）：</b></p>
          <ul>
            <li><code>【常用】阡濯自制</code> → <code>常用</code></li>
            <li><code>文生图-测试1</code> → <code>文生图</code></li>
            <li><code>文生图-【常用】测试2</code> → <code>文生图 / 常用</code></li>
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

  function toggleGrouping(nextEnabled) {
    groupingEnabled = !!nextEnabled;
    saveBool(STORAGE_KEY_GROUPING, groupingEnabled);

    const headerToggle = document.getElementById(GROUP_TOGGLE_ID);
    if (headerToggle) headerToggle.checked = groupingEnabled;

    const listEl = getScriptsListEl();
    if (!listEl) {
      // 还没渲染出来，等它出现再应用
      if (groupingEnabled) startScriptsListWaitObserver();
      else stopScriptsListWaitObserver();
      return;
    }

    if (groupingEnabled) {
      applyGrouping(listEl);
      startScriptsListObserver(listEl);
    } else {
      stopScriptsListObserver();
      stopScriptsListWaitObserver();
      cleanupGroupingArtifacts(listEl);
    }

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

    scriptsListObserver = new MutationObserver((mutations) => {
      if (!groupingEnabled) return;

      // 仅在“脚本列表结构变化 / 脚本名变化”时重建。
      // 另外：忽略我们自己组 header 内部的变化（包括箭头文本），避免无限重建。
      let needRebuild = false;

      for (const m of mutations) {
        if (isWithinGroupHeader(m.target)) continue;

        if (m.type === 'childList') {
          // 只关心列表容器自身的直接 children 变动（新增/删除脚本）。
          if (m.target !== listEl) continue;

          const nodes = [...m.addedNodes, ...m.removedNodes];
          for (const n of nodes) {
            if (isGroupHeaderEl(n)) continue;
            if (isScriptItemEl(n)) {
              needRebuild = true;
              break;
            }
            // 其它元素（非组 header）的增删也可能影响布局，保险起见也重建
            if (n?.nodeType === 1) {
              needRebuild = true;
              break;
            }
          }
        } else if (m.type === 'characterData') {
          // 只关心脚本名的文本变化
          if (!isWithinScriptName(m.target)) continue;
          needRebuild = true;
        }

        if (needRebuild) break;
      }

      if (!needRebuild) return;
      scheduleGroupingRebuild();
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
    scriptsListObserver = null;
  }

  let scriptsListWaitObserver = null;

  function startScriptsListWaitObserver() {
    if (scriptsListWaitObserver || typeof MutationObserver !== 'function') return;

    const root = document.getElementById(TARGET_ID) || document.body || document.documentElement;
    if (!root) return;

    scriptsListWaitObserver = new MutationObserver(() => {
      if (!groupingEnabled) return;
      const listEl = getScriptsListEl();
      if (!listEl) return;

      // 找到了就挂载
      scriptsListWaitObserver.disconnect();
      scriptsListWaitObserver = null;

      ensureScriptsListEventHandlers(listEl);
      applyGrouping(listEl);
      startScriptsListObserver(listEl);
      updateHeaderBulkButtonsState();
    });

    scriptsListWaitObserver.observe(root, { childList: true, subtree: true });
  }

  function stopScriptsListWaitObserver() {
    if (!scriptsListWaitObserver) return;
    scriptsListWaitObserver.disconnect();
    scriptsListWaitObserver = null;
  }

  function ensureGroupingMounted() {
    const listEl = getScriptsListEl();
    if (!listEl) {
      if (groupingEnabled) startScriptsListWaitObserver();
      return false;
    }

    ensureScriptsListEventHandlers(listEl);

    if (groupingEnabled) {
      applyGrouping(listEl);
      startScriptsListObserver(listEl);
    } else {
      stopScriptsListObserver();
      cleanupGroupingArtifacts(listEl);
    }

    updateHeaderBulkButtonsState();
    return true;
  }

  // === Header 注入与挂载 ===

  function ensureMounted() {
    const blockEl = document.getElementById(TARGET_ID);
    if (!blockEl) {
      // Regex 界面可能还没打开；先不报错，等待下一次触发。
      return false;
    }

    // 已经注入过就不重复注入
    const existingHeader = document.getElementById(HEADER_ID);
    if (existingHeader) {
      // 同步一下 header 的展示（箭头/aria），并更新分组 toggle
      setCollapsed(blockEl, getCollapsed(blockEl));

      const toggle = existingHeader.querySelector(`#${GROUP_TOGGLE_ID}`);
      if (toggle) toggle.checked = !!groupingEnabled;

      ensureGroupingMounted();
      updateHeaderBulkButtonsState();
      return true;
    }

    const header = document.createElement('div');
    header.id = HEADER_ID;
    header.className = 'st-rgs-header flex-container flexGap10 alignItemsCenter';
    header.setAttribute('aria-controls', TARGET_ID);

    header.innerHTML = `
      <div class="st-rgs-click-area flex-container flexGap10 alignItemsCenter flex1" data-st-rgs-collapse-toggle role="button" tabindex="0" title="点击收起/展开">
        <span class="st-rgs-arrow" data-st-rgs-arrow>▼</span>
        <b class="st-rgs-title">Global Scripts</b>
        <span class="st-rgs-hint">（点击收起/展开）</span>
      </div>
      <div class="st-rgs-controls flex-container flexGap10 alignItemsCenter">
        <label class="checkbox flex-container alignItemsCenter st-rgs-group-toggle" title="按前缀分组展示（最多二级），并在分组时禁用拖拽排序">
          <input type="checkbox" id="${GROUP_TOGGLE_ID}">
          <span>分组</span>
        </label>

        <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${EXPAND_ALL_BTN_ID}" title="全部展开" aria-label="全部展开" disabled>
          <span class="fa-solid fa-angles-down"></span>
        </button>
        <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${COLLAPSE_ALL_BTN_ID}" title="全部收纳" aria-label="全部收纳" disabled>
          <span class="fa-solid fa-angles-up"></span>
        </button>
        <button type="button" class="menu_button interactable st-rgs-icon-btn" id="${HELP_BTN_ID}" title="使用说明" aria-label="使用说明">
          <span class="fa-solid fa-circle-info"></span>
        </button>
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
      const next = !getCollapsed(blockEl);
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
      groupToggle.checked = !!groupingEnabled;

      // 不要冒泡到 toggleArea，避免误触发整体收起
      groupToggle.addEventListener('click', (e) => e.stopPropagation());
      groupToggle.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleGrouping(!!groupToggle.checked);
      });
    }

    // 全部展开 / 全部收纳 / 说明
    const expandAllBtn = header.querySelector(`#${EXPAND_ALL_BTN_ID}`);
    const collapseAllBtn = header.querySelector(`#${COLLAPSE_ALL_BTN_ID}`);
    const helpBtn = header.querySelector(`#${HELP_BTN_ID}`);

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

    // 初始化：根据 localStorage 恢复分组展示开关
    ensureGroupingMounted();
    updateHeaderBulkButtonsState();

    log('mounted on #' + TARGET_ID);
    return true;
  }

  let domObserver = null;

  function startDomObserver() {
    // 已经挂载就不需要 observer 了
    if (document.getElementById(HEADER_ID)) return;
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

  function init() {
    const ctx = getCtx();
    if (!ctx) {
      warn('SillyTavern context not found.');
      return;
    }

    const { eventSource, event_types } = ctx;

    // 规范：等 APP_READY 再动 DOM
    eventSource?.on?.(event_types.APP_READY, () => {
      try {
        ensureMounted();
      } catch (err) {
        console.error(`[${MODULE_NAME}] ensureMounted failed:`, err);
      }
    });

    // 兜底：Regex 页面可能是按需加载的
    // 1) 监听设置加载/预设变更等事件（不同版本可能有差异，因此用存在性判断）
    // 2) 额外用 MutationObserver 等待 #global_scripts_block 出现
    const tryEnsure = () => {
      try {
        const ok = ensureMounted();
        if (!ok) {
          // 还没渲染出来，就开启 observer 等它出现
          startDomObserver();
        }
      } catch (err) {
        console.error(`[${MODULE_NAME}] ensureMounted failed:`, err);
      }
    };

    if (event_types?.SETTINGS_LOADED) eventSource?.on?.(event_types.SETTINGS_LOADED, tryEnsure);
    if (event_types?.PRESET_CHANGED) eventSource?.on?.(event_types.PRESET_CHANGED, tryEnsure);

    // 立即尝试一次
    tryEnsure();

    // 兜底：如果用户很晚才打开 Regex 页面，MutationObserver 仍然能捕获到并挂载
    startDomObserver();
  }

  init();
})();
