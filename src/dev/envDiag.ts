// 环境诊断：把「真正决定画面排版的那些运行时数值」原样收集出来。
//
// 存在的理由：iOS PWA 独立窗口里**没有地址栏**，输不了网址 ——
// public/diag.html 那种「打开某个 URL 看数值」的做法在那儿根本到不了用户手里。
// 所以同一套采集必须做进游戏内部：☰ → 系统 → 环境诊断，点开就能看到、一键能复制。
//
// 和 diag.html 的区别：那份只看浏览器环境，这份还带上**游戏实际采用的排版结果**
// （最终 safe、HUD 高度、文字顶边、画布像素比），因为这些才是画面是否正确的判据 ——
// env() 报多少不重要，重要的是 UIScene 最后按多少排的版。

import { isIosDevice, isStandaloneApp, readSafeInsets, type SafeInsets } from '../layout';

export interface EnvDiagInput {
  /** 排版实际采用的安全区（UIScene.safe），不是 env() 的原始读数 */
  safe: SafeInsets;
  /** HUD 条实际高度（CSS 像素） */
  hudHCss: number;
  /** HUD 首行文字的顶边（CSS 像素） */
  textTopCss: number;
  /** 画布像素 / CSS 像素（= dpr，封顶 2） */
  renderScale: number;
}

export interface EnvDiag {
  rows: [string, string][];
  summary: string;
}

/** 保留 2 位小数，去掉浮点噪声（dpr 常有 2.9999998 这种） */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function boxRect(el: Element | null): string {
  const r = el?.getBoundingClientRect();
  return r ? `${Math.round(r.width)}×${Math.round(r.height)} @top ${Math.round(r.top)}` : '-';
}

export function collectEnvDiag(input: EnvDiagInput): EnvDiag {
  const raw = readSafeInsets();
  const envWorks = raw.top > 0 || raw.bottom > 0 || raw.left > 0 || raw.right > 0;
  const standalone = isStandaloneApp();
  const ios = isIosDevice();
  const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  const mm = (q: string) => {
    try { return String(window.matchMedia(q).matches); } catch { return 'n/a'; }
  };

  const vv = window.visualViewport;
  const cv = document.querySelector('#game canvas') as HTMLCanvasElement | null;
  const appH = getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim();

  // 这一行是整份诊断的结论：**为什么**最后用了这组安全区。
  // 三种来源互斥，看到「兜底」说明 env() 在真机上失效了 —— 那正是 PWA 黑屏的常见根因。
  const source = envWorks
    ? 'env() 实测有效'
    : (ios && standalone ? 'iOS PWA 兜底 59/34（env 全 0）' : '全 0：系统未遮挡内容');

  const rows: [string, string][] = [
    ['模式', standalone ? 'PWA 独立窗口' : '浏览器标签页'],
    ['navigator.standalone', String(navStandalone)],
    ['display-mode:standalone', mm('(display-mode: standalone)')],
    ['是否 iOS / iPadOS', String(ios)],
    ['innerWidth × innerHeight', `${window.innerWidth} × ${window.innerHeight}`],
    ['visualViewport', vv
      ? `${Math.round(vv.width)} × ${Math.round(vv.height)} offTop=${Math.round(vv.offsetTop)} scale=${vv.scale}`
      : '不支持'],
    ['screen / availHeight', `${screen.width} × ${screen.height} / ${screen.availHeight}`],
    ['devicePixelRatio', String(window.devicePixelRatio)],
    ['--app-h', appH || '(未写入)'],
    ['#game 盒子', boxRect(document.getElementById('game'))],
    ['canvas 盒子', boxRect(cv)],
    ['canvas 内部像素', cv ? `${cv.width} × ${cv.height}` : '-'],
    ['env(t/r/b/l)', `${raw.top} / ${raw.right} / ${raw.bottom} / ${raw.left}`],
    ['安全区来源', source],
    ['★ 最终 safe(t/r/b/l)', `${n(input.safe.top)} / ${n(input.safe.right)} / ${n(input.safe.bottom)} / ${n(input.safe.left)}`],
    ['HUD 高度 / 首行文字顶边', `${n(input.hudHCss)} / ${n(input.textTopCss)}`],
    ['画布 px / CSS px', String(input.renderScale)],
    ['UA', navigator.userAgent],
  ];

  return {
    rows,
    summary: ['=== 微光农庄环境诊断 ===', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n'),
  };
}

/** 复制到剪贴板。iOS 需要 https + 用户手势上下文，失败时返回 false 让调用方提示截图 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的 execCommand：老 Safari / 无 https 时的老办法
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
