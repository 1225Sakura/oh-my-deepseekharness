// lib/tryget.js
/** cordis 安全取服务（B1 教训：未 inject 的服务属性访问抛错）——刻板审查修复：
 *  此前 probe.js / hud-route.js / delegate.js 三份拷贝且语义微异；现单源。
 *  优先 ctx.get 运行时取面（未 inject 也可取），缺席落到属性访问兜底。 */
export function tryGet(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try { return ctx.get(name) } catch { /* 落到属性访问兜底 */ }
  }
  try { return ctx[name] } catch { return undefined }
}
