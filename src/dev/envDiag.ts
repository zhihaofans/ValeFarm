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

// 由 vite.config.ts 注入；单测里没有 define 时安全回退到 dev
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __BUILD_TIME__: string;
declare const __GIT_SHA__: string;
declare const __GIT_REF__: string;

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '-';
const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
const GIT_SHA = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'dev';
const GIT_REF = typeof __GIT_REF__ === 'string' ? __GIT_REF__ : '';
/**
 * dev server 的 __APP_VERSION__ 是启动时注入的，发版后不重启会一直显示旧版本。
 * 诊断面板运行时再拉一次 version.json，保证标签页/PWA 都能看到当前部署版本。
 */
let liveVersion: { ver: string; build: string } | null = null;
if (typeof fetch === 'function' && typeof location !== 'undefined') {
  void fetch('./version.json', { cache: 'no-store' })
    .then((r) => r.json())
    .then((m: { ver?: unknown; build?: unknown }) => {
      if (typeof m.ver === 'string') {
        liveVersion = { ver: m.ver, build: String(m.build ?? '') };
      }
    })
    .catch(() => { /* 离线/开发未生成时回退到 Vite 注入值 */ });
}
/** 模块载入时间：PWA 里能看到这次页面到底是什么时候拉起的 */
const PAGE_LOADED_AT = new Date();
/** 构建产物名（生产是 index-xxxx.js，dev 是 envDiag.ts） */
const RESOURCE_NAME = (() => {
  try { return new URL(import.meta.url).pathname.split('/').pop() || '-'; } catch { return '-'; }
})();

export interface EnvDiagInput {
  /** 排版实际采用的安全区（UIScene.safe），不是 env() 的原始读数 */
  safe: SafeInsets;
  /** HUD 条实际高度（CSS 像素） */
  hudHCss: number;
  /** HUD 首行文字的顶边（CSS 像素） */
  textTopCss: number;
  /** 画布像素 / CSS 像素（= dpr，封顶 2） */
  renderScale: number;
  /** 当前面板外点击区的实际顶边 / 高度（CSS 像素）；没有面板时为空 */
  shadeTopCss?: number;
  shadeHCss?: number;
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

function fmtTime(value: Date | string): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(value);
  }
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
  const statusBarStyle = (() => {
    try {
      return document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content') ?? '-';
    } catch { return '-'; }
  })();

  // 这一行是整份诊断的结论：**为什么**最后用了这组安全区。
  // 三种来源互斥，看到「兜底」说明 env() 在真机上失效了 —— 那正是 PWA 黑屏的常见根因。
  const source = envWorks
    ? 'env() 实测有效'
    : (ios && standalone ? 'iOS PWA 兜底 59/34（env 全 0）' : '全 0：系统未遮挡内容');

  const rows: [string, string][] = [
    ['版本 / 构建', `${liveVersion?.ver ?? APP_VERSION} / build ${liveVersion?.build ?? APP_BUILD}`],
    // 源码提交：产物到底是哪次提交编出来的。真机反馈问题时，先看这一行能不能对上
    ['源码提交', GIT_REF && GIT_REF !== 'unknown' ? `${GIT_SHA} · ${GIT_REF}` : GIT_SHA],
    ['构建时间', BUILD_TIME ? fmtTime(BUILD_TIME) : 'dev（Vite 未注入）'],
    ['本次载入', fmtTime(PAGE_LOADED_AT)],
    ['前端资源', RESOURCE_NAME],
    ['模式', standalone ? 'PWA 独立窗口' : '浏览器标签页'],
    ['状态栏样式', statusBarStyle],
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
    ['面板外点击区顶边 / 高度', input.shadeTopCss != null && input.shadeHCss != null
      ? `${n(input.shadeTopCss)} / ${n(input.shadeHCss)}`
      : '-'],
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
  // iOS PWA 里 Clipboard API 经常拒绝；而 execCommand 必须在**手势同步栈**里执行，
  // 先 await clipboard 失败再 fallback 时手势可能已经丢了。所以先同步走旧方案。
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // 不用 top:-9999 的离屏写法：iOS Safari 对不可见/离屏 textarea 的 execCommand 更严格。
    ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;'
      + 'font-size:16px;border:0;padding:0;z-index:2147483647;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    if (document.execCommand('copy')) return true;
  } catch {
    // 落到 Clipboard API
  } finally {
    ta?.remove();
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 无权限 / 非安全上下文
  }
  return false;
}
