/**
 * omd HUD client half —— dsh web 客户端插件（v0.4 P2-D；ralplan-hud-clarity 呈现层重写）。
 *
 * 形态：dsh client-modules 懒加载 CJS bundle（window.__ModuleLoader__.load 注册工厂，
 * 工厂执行只注册、不运行副作用；首次物化时才执行本体）。**手工维护，无构建步骤**——
 * 保持与工厂格式逐字对齐（参照第一方包 lib/client.js 产物形态）；改动时同步
 * tests/lib/client-bundle.test.js 的沙箱断言。
 *
 * 行为：
 * 1. 注册右侧边栏 tab 类型（ctx.sidebarRightTabs.register，page 类型无 patterns，
 *    guide 胶囊进引导页，id='omd-hud-panel' / kind='omd-hud'）
 * 2. 注册 tab 体组件（seat 'sidebar.right.pane.tab'，key=定义 id；会话作用域座，
 *    组件不消费 per-tab props——HUD 是项目级摘要）
 * 3. 面板轮询 node 数据面 GET /oh-my-dsh/hud.json?cwd=<会话工作区>（lib/hud-route.js；loopback 同源；
 *    cwd 取自座标准 props sessionId+useSessions——2026-10-26 审查前不带 cwd，宿主回落 process.cwd()
 *    致面板永远读启动目录残渣 .omd；cwd 未知时拒绝取数并显式提示），
 *    只渲染数据面下发内容：preset 三档（minimal/focused/full，缺省 focused）、
 *    modeCatalog 模式目录（单源自 lib 常量，本文件不内置任何目录文案）、
 *    detail（主模式卡 + 次要模式，中文标签：模式/阶段/轮次/代理/故事 + 任务句 + PRD 进度 + 最近活动）；
 *    tier 色档（ok/warn/danger，CSS 变量三档 + 文字标记；判定输入=detail，
 *    payload 带 detail.tier 时优先采用，缺省走 AC10 三条件的 client 侧受锁副本——
 *    本 bundle 无法 import lib ESM，同 stale 文案的 A1 处置，见 lib/hud.js buildHudView）；
 *    minimal 预设与 detail 缺席回退呈现 <pre> 卡文本（与 MCP 卡同源的至多 8 行中文卡）；
 *    full preset 追加「队员」（workers={list,truncated}：U6 S1 自适应 run 分组两级树——
 *    ≥2 distinct runId 时渲染组头行（runId 末 8 字符短式 + 「· N 名」，N=组内已渲染行数，
 *    截断腰斩 run 由截断提示行兜底）+ 缩进队员行（树上限=run 根→队员行两级，不虚构
 *    更深层级）；单 run 保持 U8 平铺原状（零组头、零缩进变化）；截断时提示行照旧）与
 *    「工具调用」（toolCalls：路由判定计数/tier 分布/fallback 异常行，
 *    fallback>0 该行 warn 色）两区（U8 S3 + U6 S1；键缺席——旧 server——跳过不炸，
 *    focused/minimal 不含两区）；
 *    5s 刷新，卸载停止
 *
 * 依赖面（inject）：slots（槽位系统）、sidebarRightTabs（tab 类型注册表）——
 * 二者均为 web 组合出厂服务；缺失时 apply 告警直通（console.warn），不炸页面。
 */
window.__ModuleLoader__.load({
  id: '@sakura12/oh-my-deepseekharness',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var e = React.createElement;

    var HUD_ROUTE = '/oh-my-dsh/hud.json';
    var REFRESH_MS = 5000;
    var TAB_ID = 'omd-hud-panel';
    var TAB_KIND = 'omd-hud';
    var PRESETS = ['minimal', 'focused', 'full'];
    var DEFAULT_PRESET = 'focused';
    var TIER_TEXT = { ok: '状态正常', warn: '警告', danger: '危险' };
    var TIER_COLOR = {
      ok: 'var(--dsh-success, #2a7)',
      warn: 'var(--dsh-warn, #d90)',
      danger: 'var(--dsh-error, #d33)',
    };

    function useHudSnapshot(cwd) {
      var s1 = React.useState(null), snap = s1[0], setSnap = s1[1];
      var s2 = React.useState(null), err = s2[0], setErr = s2[1];
      var s3 = React.useState(false), noCwd = s3[0], setNoCwd = s3[1];
      React.useEffect(function () {
        // cwd 未知（sessionId/useSessions 缺席或会话尚无 cwd）→ 不取数：静默回落宿主
        // process.cwd() 正是「面板永远空」的病灶（hud-route.js 缺省锚宿主进程目录），
        // 此处显式拒绝，改呈现「未绑定会话工作区」提示（2026-10-26 审查症状二 H1 修复）。
        if (!cwd) { setNoCwd(true); setSnap(null); setErr(null); return; }
        setNoCwd(false);
        var stopped = false;
        var timer = null;
        var lastKey = null;
        var delay = REFRESH_MS;
        function schedule() { timer = setTimeout(tick, delay); }
        function tick() {
          fetch(HUD_ROUTE + '?cwd=' + encodeURIComponent(cwd) + '&_=' + Date.now(), { headers: { accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (stopped) return;
              if (data && data.ok) {
                // 刻板审查修复（报告二 性能 P2）：空转自适应退避——内容不变间隔翻倍（5s→≤30s），
                // 有变化即复位 5s；活跃时实时性不变，空闲时无效 I/O 约降 84%。
                var key = JSON.stringify([data.card, data.summary, data.detail && data.detail.tier, data.workers && data.workers.list && data.workers.list.length, data.alerts]); // P2-1：alerts 纳入退避 key——新告警 5s 内上屏
                if (key === lastKey) { delay = Math.min(delay * 2, 30000); }
                else { delay = REFRESH_MS; lastKey = key; }
                setSnap(data); setErr(null);
              }
              else setErr((data && data.error) || 'HUD 数据面返回异常');
            })
            .catch(function (ex) { if (!stopped) setErr(String((ex && ex.message) || ex)); })
            .finally(function () { if (!stopped) schedule(); });
        }
        tick();
        return function () { stopped = true; if (timer) clearTimeout(timer); };
        // P1-1 修复（评审）：deps 含 cwd——会话 store 异步水合后 cwd 到达须重跑 effect
        // （否则永久卡「未绑定会话工作区」）；cwd 变化时上文的 stopped/lastKey/delay 全部重建。
      }, [cwd]);
      return { snap: snap, err: err, noCwd: noCwd };
    }

    function count(v) { return String(v == null ? 0 : v); }

    /** 心跳时长（U8 S3）：snap.at 与 lastHeartbeatAt 算分钟/小时级时长；
     *  一期纯时长显示，不做 stale 阈值推导（staleAfterMs 是 Config 可配项会漂移，
     *  本 bundle 无法 import lib——要 stale 标记由二期 server 侧按配置现算下发）。 */
    function hbAge(at, last) {
      var a = Date.parse(at), b = Date.parse(last);
      if (!isFinite(a) || !isFinite(b)) return '-';
      var ms = a - b;
      if (ms < 0) ms = 0;
      var min = Math.floor(ms / 60000);
      if (min < 1) return '刚刚';
      if (min < 60) return min + ' 分钟';
      return Math.floor(min / 60) + ' 小时';
    }

    /** tier 判定（AC10 三条件；payload 的 detail.tier 为 lib 单源下发时直接采用）。 */
    function resolveTier(detail) {
      if (detail && TIER_TEXT[detail.tier]) return detail.tier;
      var modes = (detail && detail.modes) || [];
      var i, m;
      for (i = 0; i < modes.length; i++) {
        if (modes[i] && modes[i].state === 'failed') return 'danger';
      }
      if (modes[0] && modes[0].stale === true) return 'warn';
      for (i = 0; i < modes.length; i++) {
        m = modes[i];
        if (m && m.current_phase === 'fix') {
          var loops = m.fixLoops != null ? m.fixLoops : m.fix_loops;
          if (Number(loops || 0) >= 2) return 'warn';
        }
      }
      return 'ok';
    }

    function tierBadge(tier) {
      return e('div', { key: 'tier', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 8 } },
        e('span', { 'data-tier': tier, style: { width: 8, height: 8, borderRadius: 8, background: TIER_COLOR[tier], display: 'inline-block' } }),
        e('span', { style: tier === 'ok' ? undefined : { color: TIER_COLOR[tier] } }, TIER_TEXT[tier]));
    }

    function row(label, value, indent) {
      var st = { display: 'flex', justifyContent: 'space-between', gap: 12 };
      if (indent) st.paddingLeft = 12; // U6 S1：run 组头下队员行缩进一级（仅分组时传入）
      return e('div', { key: label, style: st },
        e('span', { style: { opacity: 0.65 } }, label),
        e('span', { style: { fontFamily: 'monospace' } }, String(value)));
    }

    function section(text, key) {
      return e('div', { key: key, style: { fontSize: 11, opacity: 0.6, margin: '12px 0 4px', letterSpacing: 1 } }, text);
    }

    /** <pre> 卡文本（minimal 预设与 detail 缺席回退的正式形态，与 MCP 卡同源）。 */
    function preCard(text) {
      return e('pre', {
        key: 'card',
        style: {
          margin: 0, padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: 'var(--dsh-surface-muted, rgba(127,127,127,0.08))',
          border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
          whiteSpace: 'pre-wrap', fontFamily: 'monospace',
        },
      }, String(text != null ? text : ''));
    }

    function modeBrief(m) { return (m.label != null ? m.label : m.mode) + '（' + m.mode + '）'; }
    function modeNames(arr) { var out = []; for (var i = 0; i < arr.length; i++) out.push(modeBrief(arr[i])); return out; }

    /** 单个模式的语义卡：模式/阶段/轮次/代理/故事 + 任务句与 PRD 进度（HUD 重设计）+ stale 行（「未更新」为受锁文案）。 */
    function modeCard(m, key, at) {
      var mm = m || {};
      // 2026-10-26 审查 S3：iteration/current_story/active_agents 靠模型 state_write 自觉写，
      // 缺失时显示「未上报」而非 '-'/'0'——后者谎称「已监测到零」，前者承认「没数据」。
      var kids = [];
      // HUD 重设计：任务句置顶（prompt_echo，回答「在干嘛」）
      if (typeof mm.prompt_echo === 'string' && mm.prompt_echo) {
        kids.push(e('div', { key: 'task', style: { fontSize: 12, marginBottom: 2, wordBreak: 'break-all' } }, mm.prompt_echo));
      }
      kids.push(row('模式', mm.label != null ? mm.label + '（' + mm.mode + '）' : String(mm.mode != null ? mm.mode : '-')));
      kids.push(row('阶段', mm.current_phase != null ? String(mm.current_phase) : '-'));
      kids.push(row('轮次', mm.iteration != null ? String(mm.iteration) : '未上报'));
      // 2026-10-26 审查修复：标签名实相符（原「任务」行实为代理计数，与 lib/hud.js 口径统一为「代理」）
      kids.push(row('代理', Array.isArray(mm.active_agents) ? mm.active_agents.length + ' 个 agent' : '未上报'));
      kids.push(row('故事', mm.current_story != null ? String(mm.current_story) : '未上报'));
      if (at != null && mm.updatedAt != null) {
        kids.push(row('最近活动', hbAge(at, mm.updatedAt) + '前'));
      }
      if (mm.stale === true) {
        // P0 修复：不再写死「2 小时」——读 server 下发的真实阈值（state.mjs 按模式双语义现算），
        // 旧 server 无 staleAfterMs 字段时回退为不说时长（绝不谎报）。
        var th = typeof mm.staleAfterMs === 'number' && isFinite(mm.staleAfterMs)
          ? (mm.staleAfterMs >= 3600000 ? Math.round(mm.staleAfterMs / 3600000) + ' 小时' : Math.round(mm.staleAfterMs / 60000) + ' 分钟')
          : null;
        kids.push(e('div', { key: 'stale', style: { fontSize: 12, marginTop: 4, color: TIER_COLOR.warn } },
          th != null
            ? '状态已超过阈值（' + th + '）未更新（上次更新：' + (mm.updatedAt != null ? mm.updatedAt : '-') + '）'
            : '状态超过阈值未更新（上次更新：' + (mm.updatedAt != null ? mm.updatedAt : '-') + '）'));
      }
      return e('div', {
        key: key,
        style: {
          border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))', borderRadius: 8,
          padding: 10, display: 'grid', gap: 4, fontSize: 12,
        },
      }, kids);
    }

    /** 记忆行（focused/空态）：中文标签 + 三区含义，非裸 working= 计数。 */
    function memoryBrief(todo) {
      return '记忆：工作区 ' + count(todo.working) + ' 条 / 优先区 ' + count(todo.priority) + ' 条 / 手动区 ' + count(todo.manual) +
        ' 条（7 天过期 / 永久 / 手动维护）';
    }

    /** idle 空态引导：渲染下发 modeCatalog（模式名 + 中文名同现），不内置目录。 */
    function catalogView(snap) {
      var kids = [];
      kids.push(e('div', { key: 'idle', style: { marginBottom: 8 } }, '当前没有运行中的 omd 模式。'));
      // HUD 重设计：空态显示上次活动（server 派生 lastActivity），不再是纯广告页
      var la = snap.lastActivity;
      if (la && la.updatedAt) {
        kids.push(e('div', { key: 'la', style: { fontSize: 12, marginBottom: 8 } },
          '上次活动：' + String(la.mode || '?') + ' · ' + hbAge(snap.at, la.updatedAt) + '前'));
      }
      // 2026-10-26 审查 S3/H2：空态必须显示正在监测的目录——读错目录时用户能自行发现，
      // 不再表现为无声的「永远 idle」。
      kids.push(e('div', { key: 'cwd', style: { fontSize: 11, opacity: 0.6, marginBottom: 8, fontFamily: 'monospace', wordBreak: 'break-all' } },
        '正在监测目录：' + (snap.cwd || '未知')));
      var cat = Array.isArray(snap.modeCatalog) ? snap.modeCatalog : [];
      for (var i = 0; i < cat.length; i++) {
        kids.push(e('div', { key: 'c' + i, style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0' } },
          e('span', null, String(cat[i].label != null ? cat[i].label : cat[i].mode)),
          e('span', { style: { fontFamily: 'monospace', opacity: 0.75 } }, String(cat[i].mode))));
      }
      kids.push(e('div', { key: 'hint', style: { fontSize: 12, opacity: 0.65, marginTop: 8 } },
        '启动方式：在会话中说出模式关键词并给出目标（CLI 会话可经 MCP hud_render 拿同款摘要）。'));
      return e('div', { key: 'catalog', style: { border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))', borderRadius: 8, padding: 10 } }, kids);
    }

    function isIdle(snap) {
      var s = snap.summary || {};
      if (s.mode === 'idle') return true;
      var d = snap.detail;
      return !!(d && Array.isArray(d.modes) && d.modes.length === 0);
    }

    function panel(children, tier) {
      var props = { style: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box' } };
      if (tier) props['data-tier'] = tier;
      return e('div', props, children);
    }

    /** 会话工作区 cwd：座注入的标准 props（sessionId + useSessions，第一方 sidebar-files
     *  FilesBody 同款契约——session 作用域座的标准 props 面）。useSessions 是 selector hook。
     *  R5 深审存疑项收口：hook 调用数只依赖「useSessions 是否函数」（座注入面恒定）——
     *  sessionId 不再参与调用条件（若座异步水合 sessionId，条件调用曾致 hooks 数 4→5 的
     *  React「Rendered more hooks」崩溃风险）。缺席 sessionId 由 selector 返回 undefined →
     *  走「未绑定」提示分支，绝不静默锚宿主目录。 */
    function useSessionCwd(props) {
      var useSessions = props && props.useSessions;
      var sessionId = props && props.sessionId;
      if (typeof useSessions !== 'function') return undefined;
      return useSessions(function (sessions) {
        var s = sessionId && sessions && sessions.byId && sessions.byId[sessionId];
        return s && s.cwd ? s.cwd : undefined;
      });
    }

    /** HUD 面板体（sidebar.right.pane.tab 座组件；消费座标准 props 的 sessionId/useSessions
     *  推导会话工作区 cwd——面板摘要锚定会话项目目录，不再是宿主进程目录）。 */
    function HudPanel(props) {
      var cwd = useSessionCwd(props);
      var st = useHudSnapshot(cwd);
      var children = [];
      children.push(e('div', { key: 't', style: { fontWeight: 600, marginBottom: 8 } }, 'omd 编排状态'));
      if (st.noCwd) {
        children.push(e('div', { key: 'nc', style: { fontSize: 12, opacity: 0.75, lineHeight: 1.7 } },
          '未绑定会话工作区：HUD 需要当前会话的项目目录才能取数（已拒绝回落到 dsh 启动目录）。请确认本面板挂在已打开工作区的会话页内。'));
        return panel(children, null);
      }
      if (st.err) {
        children.push(e('div', { key: 'e', style: { color: 'var(--dsh-error, #d33)', fontSize: 12 } },
          '数据面不可用：' + st.err + '（确认 dsh web 宿主已加载 omd 插件；或经 MCP hud_render 获取同款摘要）'));
        return panel(children, null);
      }
      if (!st.snap) {
        children.push(e('div', { key: 'l', style: { opacity: 0.6 } }, '加载中…'));
        return panel(children, null);
      }
      var snap = st.snap;
      var preset = PRESETS.indexOf(snap.preset) >= 0 ? snap.preset : DEFAULT_PRESET;
      var detail = snap.detail;
      var todo = (snap.summary && snap.summary.todo) || {};
      var tier = resolveTier(detail);
      children.push(tierBadge(tier));
      // 2026-10-26 审查 S5：告警区（全 preset 可见，最高优先级信息）——heartbeat 扫描发现
      // （stale 队员/未处置信件/心跳异常），server 侧已对请求 cwd 实弹扫描并提升 tier。
      var alerts = snap.alerts;
      if (typeof alerts !== 'undefined') {
        children.push(section('告警', 'sec-alerts'));
        if (Array.isArray(alerts) && alerts.length) {
          for (var ai = 0; ai < alerts.length; ai++) {
            children.push(e('div', { key: 'al' + ai, style: { fontSize: 12, color: TIER_COLOR.warn, marginBottom: 4 } }, String(alerts[ai])));
          }
        } else {
          children.push(e('div', { key: 'al-ok', style: { fontSize: 12, opacity: 0.6 } }, '无 team 告警（stale 队员/未处置信件）'));
        }
      }
      if (preset === 'minimal' || !detail) {
        // minimal 预设（正式 <pre> 卡文本档）；detail 缺席回退同款（AC11）
        children.push(preCard(snap.card));
        // 2026-10-26 审查 S3：监测目录行提升到所有 preset（原为 full 数据面区专属）
        children.push(e('div', { key: 'cwd-min', style: { fontSize: 11, opacity: 0.5, marginTop: 8 } },
          '正在监测 ' + (snap.cwd || '未知') + ' · 最近取数 ' + (snap.at || '-')));
      } else if (isIdle(snap)) {
        children.push(catalogView(snap));
        children.push(e('div', { key: 'mem', style: { fontSize: 12, marginTop: 10, opacity: 0.85 } }, memoryBrief(todo)));
      } else {
        var modes = detail.modes || [];
        children.push(section('主模式', 'sec-p'));
        children.push(modeCard(modes[0], 'p', snap.at));
        // HUD 重设计（2026-10-26 审查 R3）：PRD 进度行——server 已 join prd_path 指向的 story 完成度
        if (detail.prd && typeof detail.prd.total === 'number') {
          children.push(row('PRD 进度',
            'story ' + (detail.prd.done != null ? detail.prd.done : 0) + '/' + detail.prd.total + ' 通过' +
            (detail.prd.current ? ' · 当前 ' + detail.prd.current : '')));
        }
        var minors = modes.slice(1);
        if (minors.length && preset === 'full') {
          children.push(section('其他模式', 'sec-minor'));
          for (var i = 0; i < minors.length; i++) children.push(modeCard(minors[i], 'm' + i, snap.at));
        } else if (minors.length) {
          children.push(e('div', { key: 'more', style: { fontSize: 12, opacity: 0.65, marginTop: 6 } },
            '另有 ' + minors.length + ' 个模式：' + modeNames(minors).join('、')));
        }
        if (preset === 'full') {
          children.push(section('记忆（notepad 三区）', 'sec-mem'));
          children.push(row('工作区（working）', count(todo.working) + ' 条（7 天过期自动清理）'));
          children.push(row('优先区（priority）', count(todo.priority) + ' 条（永久保留）'));
          children.push(row('手动区（manual）', count(todo.manual) + ' 条（手动维护）'));
          // U8 S3：「队员」「工具调用」两区（键缺席=旧 server → 跳过不炸）
          // U6 S1：「队员」区自适应 run 分组两级树——≥2 distinct runId 才渲染组头行
          // （runId 末 8 字符短式 + 「· N 名」，N=组内已渲染行数；截断腰斩 run 由提示行兜底），
          // 队员行缩进一级；单 run（全同 runId）保持 U8 平铺原状（零组头、零缩进变化）。
          // registry 平铺是事实（leaf-guard 禁孙代理）——树上限=run 根→队员行两级，不虚构更深层级。
          var workers = snap.workers;
          if (workers && Array.isArray(workers.list)) {
            children.push(section('队员', 'sec-workers'));
            // 按 runId 保序分组：输入已是 spawnedAt 新者优先（组内保持该序），组序=组内首元素出现序
            var wgroups = [];
            var wgix = {};
            for (var wi = 0; wi < workers.list.length; wi++) {
              var w = workers.list[wi] || {};
              // runId 兜底照 hud-route.js:52 先例（registry.runId ?? run.name 类：缺席落占位名，不炸）
              var rid = String(w.runId != null ? w.runId : '-');
              if (!Object.prototype.hasOwnProperty.call(wgix, rid)) {
                wgix[rid] = wgroups.length;
                wgroups.push({ rid: rid, items: [] });
              }
              wgroups[wgix[rid]].items.push(w);
            }
            var multiRun = wgroups.length >= 2;
            for (var wgi = 0; wgi < wgroups.length; wgi++) {
              var wg = wgroups[wgi];
              if (multiRun) {
                var shortRid = wg.rid.length > 8 ? wg.rid.slice(-8) : wg.rid;
                children.push(e('div', { key: 'w-run-' + wgi, style: { fontSize: 12, opacity: 0.85, marginTop: 4 } },
                  'run …' + shortRid + ' · ' + wg.items.length + ' 名'));
              }
              for (var wii = 0; wii < wg.items.length; wii++) {
                var ww = wg.items[wii];
                children.push(row(String(ww.workerId != null ? ww.workerId : '-'),
                  String(ww.role != null ? ww.role : '-') + ' · ' + String(ww.status != null ? ww.status : '-') +
                  ' · 心跳 ' + hbAge(snap.at, ww.lastHeartbeatAt), multiRun));
              }
            }
            if (workers.truncated === true) {
              children.push(e('div', { key: 'w-trunc', style: { fontSize: 11, opacity: 0.6, marginTop: 4 } },
                '仅显示最近 50 名队员（已截断）'));
            }
          }
          var toolCalls = snap.toolCalls;
          if (toolCalls && typeof toolCalls === 'object') {
            var byTier = toolCalls.byTier || {};
            var fb = toolCalls.fallbackCount != null ? toolCalls.fallbackCount : 0;
            children.push(section('工具调用', 'sec-tools'));
            children.push(row('路由判定', count(toolCalls.total) + ' 次'));
            children.push(row('tier 分布',
              'low ' + count(byTier.low) + ' / medium ' + count(byTier.medium) +
              ' / high ' + count(byTier.high) + ' / explicit ' + count(byTier.explicit)));
            children.push(e('div', { key: 'fb', style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
              e('span', { style: { opacity: 0.65 } }, 'fallback 异常'),
              e('span', { style: fb > 0 ? { color: TIER_COLOR.warn, fontFamily: 'monospace' } : { fontFamily: 'monospace' } },
                String(fb) + ' 次')));
          }
          children.push(section('数据面', 'sec-meta'));
          children.push(row('cwd', snap.cwd || '-'));
          children.push(row('最近取数', snap.at || '-'));
        } else {
          children.push(e('div', { key: 'mem', style: { fontSize: 12, marginTop: 10, opacity: 0.85 } }, memoryBrief(todo)));
          children.push(e('div', { key: 'fetch', style: { fontSize: 11, opacity: 0.5, marginTop: 8 } },
            '最近取数 ' + (snap.at || '-') + ' · cwd ' + (snap.cwd || '-')));  // U3/O1：focused 档补取数时间上下文（stale 可信度）
        }
      }
      return panel(children, tier);
    }

    /** client 插件本体：注册 tab 类型 + tab 体。服务缺席告警直通（不炸页面）。
     *  注册经 ctx.effect 托管（评审修复#11：第一方同款——插件重放/HMR 时 disposer
     *  先注销再重注册，裸注册会以 "already has an entry for key" 抛错致面板消失）。 */
    function apply(ctx) {
      if (!ctx || !ctx.sidebarRightTabs || !ctx.slots) {
        (typeof console !== 'undefined' && console.warn || function () {})(
          'oh-my-dsh: sidebarRightTabs/slots 服务缺席，HUD 面板未注册（非 web 组合或服务未挂载）');
        return;
      }
      function registerAll() {
        var disposeTab = ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: function () { return 'omd HUD'; },
          guide: [{
            order: 50,
            title: function () { return 'omd HUD'; },
            description: function () { return 'omd 编排状态五要素摘要卡（mode/round/story/agents/todo）'; },
          }],
        });
        var disposeBody = ctx.slots.inject('sidebar.right.pane.tab', function () {
          // keyed 会话座按 key=tab 定义 id 派发（第一方契约：sidebar-files/documentpreview 同款 key:）
          return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, priority: 50 }, HudPanel);
        });
        return function () {
          try { typeof disposeBody === 'function' && disposeBody(); } catch (e) { /* 注销失败不阻断重放 */ }
          try { typeof disposeTab === 'function' && disposeTab(); } catch (e) { /* 同上 */ }
        };
      }
      if (typeof ctx.effect === 'function') ctx.effect(registerAll);
      else registerAll(); // 测试/降级环境：裸注册（无重放语义）
    }

    exports.apply = apply;
    exports.inject = ['slots', 'sidebarRightTabs'];
    exports.HudPanel = HudPanel;
    exports.HUD_ROUTE = HUD_ROUTE;
    return module.exports;
  }
});
