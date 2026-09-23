/**
 * omd HUD client half —— dsh web 客户端插件（v0.4 P2-D）。
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
 * 3. 面板轮询 node 数据面 GET /oh-my-dsh/hud.json（lib/hud-route.js；loopback 同源），
 *    渲染 lib/hud.js renderCard 同款 6 行五要素卡 + 状态细节；5s 刷新，卸载停止
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

    function useHudSnapshot() {
      var s1 = React.useState(null), snap = s1[0], setSnap = s1[1];
      var s2 = React.useState(null), err = s2[0], setErr = s2[1];
      React.useEffect(function () {
        var stopped = false;
        function tick() {
          fetch(HUD_ROUTE + '?_=' + Date.now(), { headers: { accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (stopped) return;
              if (data && data.ok) { setSnap(data); setErr(null); }
              else setErr((data && data.error) || 'HUD 数据面返回异常');
            })
            .catch(function (ex) { if (!stopped) setErr(String((ex && ex.message) || ex)); });
        }
        tick();
        var timer = setInterval(tick, REFRESH_MS);
        return function () { stopped = true; clearInterval(timer); };
      }, []);
      return { snap: snap, err: err };
    }

    function row(label, value) {
      return e('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
        e('span', { style: { opacity: 0.65 } }, label),
        e('span', { style: { fontFamily: 'monospace' } }, String(value)));
    }

    /** HUD 面板体（sidebar.right.pane.tab 座组件；不消费 per-tab props——项目级摘要）。 */
    function HudPanel() {
      var st = useHudSnapshot();
      var children = [];
      children.push(e('div', { key: 't', style: { fontWeight: 600, marginBottom: 8 } }, 'omd HUD 摘要卡'));
      if (st.err) {
        children.push(e('div', { key: 'e', style: { color: 'var(--dsh-error, #d33)', fontSize: 12 } },
          '数据面不可用：' + st.err + '（确认 dsh web 宿主已加载 omd 插件；或经 MCP hud_render 获取同款摘要）'));
      } else if (!st.snap) {
        children.push(e('div', { key: 'l', style: { opacity: 0.6 } }, '加载中…'));
      } else {
        var s = st.snap.summary || {};
        var todo = s.todo || {};
        children.push(e('pre', {
          key: 'card',
          style: {
            margin: 0, padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.6,
            background: 'var(--dsh-surface-muted, rgba(127,127,127,0.08))',
            border: '1px solid var(--dsh-border, rgba(127,127,127,0.25))',
            whiteSpace: 'pre-wrap', fontFamily: 'monospace',
          },
        }, st.snap.card));
        children.push(e('div', { key: 'detail', style: { marginTop: 12, display: 'grid', gap: 4, fontSize: 12 } },
          row('cwd', st.snap.cwd || '-'),
          row('working/priority/manual', (todo.working || 0) + ' / ' + (todo.priority || 0) + ' / ' + (todo.manual || 0)),
          row('刷新间隔', REFRESH_MS / 1000 + 's'),
          row('最近取数', st.snap.at || '-')));
      }
      return e('div', { style: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box' } }, children);
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
