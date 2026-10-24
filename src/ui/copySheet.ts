// 手动复制兜底面板（DOM 层，不画在 Phaser 里）。
//
// 为什么需要它：iOS（尤其 PWA 独立窗口）对 `document.execCommand('copy')` 与
// `navigator.clipboard` 都看得很严，画布上的"点一下就复制"经常被系统拒绝。
// 与其让用户对着"复制失败"干瞪眼，不如直接把文本摊开成可选中的 textarea：
// 他能长按 → 全选 → 拷贝，这条路不依赖任何权限。
//
// 实现约束：纯 DOM、不引样式表、不引外链；用完必须把节点全部移除，
// 否则会挡住后续的触摸（画布在下层）。

const Z = '2147483647';

export interface CopySheetOptions {
  /** 关闭后回调（用于恢复游戏暂停状态等） */
  onDone?: () => void;
}

/** 弹出可手动复制的文本框；返回关闭函数 */
export function openCopySheet(title: string, text: string, opts: CopySheetOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {};

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    wrap.remove();
    opts.onDone?.();
  };

  const wrap = document.createElement('div');
  wrap.setAttribute('data-vale-copy-sheet', '1');
  wrap.style.cssText = [
    'position:fixed', 'inset:0', `z-index:${Z}`,
    'background:rgba(0,0,0,0.72)', 'display:flex', 'align-items:center', 'justify-content:center',
    'padding:16px', 'box-sizing:border-box',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:100%', 'max-width:640px', 'max-height:100%',
    'background:#2a241c', 'border:2px solid #c9a06b', 'border-radius:10px',
    'padding:12px', 'box-sizing:border-box', 'display:flex', 'flex-direction:column', 'gap:8px',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif', 'color:#f4ead8',
  ].join(';');

  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-size:15px;color:#f2e06a;font-weight:700;';

  const hint = document.createElement('div');
  hint.textContent = '系统拦下了自动复制：长按下面文本 → 全选 → 拷贝。';
  hint.style.cssText = 'font-size:12px;color:#c9a06b;';

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.setAttribute('aria-label', '诊断信息');
  ta.style.cssText = [
    'width:100%', 'flex:1 1 auto', 'min-height:42vh', 'box-sizing:border-box',
    'background:#171310', 'color:#d8d2c4', 'border:1px solid #5b5044', 'border-radius:6px',
    'padding:8px', 'font-family:ui-monospace,Menlo,Consolas,monospace', 'font-size:12px',
    'line-height:1.5', 'resize:none', 'white-space:pre', 'overflow:auto',
    '-webkit-user-select:text', 'user-select:text',
  ].join(';');

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;';

  const mkBtn = (label: string, bg: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'flex:1 1 auto', 'min-height:44px', 'border:0', 'border-radius:8px',
      `background:${bg}`, 'color:#fff8e8', 'font-size:16px', 'font-weight:700',
      'cursor:pointer',
    ].join(';');
    b.addEventListener('click', fn);
    return b;
  };

  const selectAll = mkBtn('全选', '#5b5044', () => {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
  });
  const done = mkBtn('完成', '#3f7d5a', () => close());

  row.append(selectAll, done);
  card.append(h, hint, ta, row);
  wrap.append(card);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);

  // 打开即全选，省得用户还要先找"全选"按钮
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
  } catch { /* 老浏览器 select 可能失败，不影响手动选择 */ }

  return close;
}
