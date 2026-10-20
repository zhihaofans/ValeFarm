// collectEnvDiag：决定 PWA 排版的诊断面板里的「安全区来源」判定。
//
// 表面看这只是「把数据拼成一段文字」，但「安全区来源」这一行的判定才是关键：
//   - env() 全 0 + iOS + 独立窗口 → 标「iOS PWA 兜底 59/34」（PWA 真有 bug 时这条会出现）
//   - env() 全 0 + 标签页 → 标「全 0：系统未遮挡」（Safari 自带工具栏已避让，无需补）
//   - env() 任意边有值 → 标「env() 实测有效」
// 一旦标错，开发者就被误导去改「不存在的代码问题」。
import { afterEach, describe, expect, it, vi } from 'vitest';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function stub(opts: {
  ua: string; standalone?: boolean; displayModeStandalone?: boolean;
  env?: { t: number; r: number; b: number; l: number };
  viewH?: number; viewW?: number; dpr?: number;
}) {
  const env = opts.env ?? { t: 0, r: 0, b: 0, l: 0 };
  vi.stubGlobal('window', {
    innerHeight: opts.viewH ?? 852, innerWidth: opts.viewW ?? 393,
    matchMedia: (q: string) => ({
      matches: q === '(display-mode: standalone)' ? !!(opts.displayModeStandalone ?? opts.standalone) : false,
    }),
    visualViewport: undefined,
  });
  vi.stubGlobal('navigator', { userAgent: opts.ua, standalone: opts.standalone ?? false, maxTouchPoints: 5 });
  vi.stubGlobal('screen', { width: 393, height: 852, availHeight: 852 });
  vi.stubGlobal('devicePixelRatio', opts.dpr ?? 3);
  vi.stubGlobal('getComputedStyle', () => ({
    paddingTop: `${env.t}px`, paddingRight: `${env.r}px`, paddingBottom: `${env.b}px`, paddingLeft: `${env.l}px`,
    getPropertyValue: () => '393px',
  }));
  vi.stubGlobal('document', {
    createElement: () => ({ style: { cssText: '' }, remove() {} }),
    body: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    documentElement: {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('collectEnvDiag', () => {
  it('标签页模式 + env 全 0：来源标\"全 0\"而非兜底', async () => {
    stub({ ua: UA_IPHONE, standalone: false, viewH: 695 });
    const m = await import('../../src/dev/envDiag');
    const d = m.collectEnvDiag({ safe: { top: 0, right: 0, bottom: 0, left: 0 }, hudHCss: 52, textTopCss: 60, renderScale: 3 });
    expect(d.summary).toContain('模式: 浏览器标签页');
    expect(d.summary).toContain('env(t/r/b/l): 0 / 0 / 0 / 0');
    expect(d.summary).toContain('安全区来源: 全 0：系统未遮挡内容');
    // 关键反向断言：标签页模式绝不能误判成「PWA 兜底」
    expect(d.summary).not.toContain('iOS PWA 兜底');
  });

  it('PWA 独立模式 + iOS + env 全 0：来源标\"iOS PWA 兜底\"', async () => {
    stub({ ua: UA_IPHONE, standalone: true, viewH: 852 });
    const m = await import('../../src/dev/envDiag');
    const d = m.collectEnvDiag({ safe: { top: 59, right: 0, bottom: 34, left: 0 }, hudHCss: 60, textTopCss: 70, renderScale: 3 });
    expect(d.summary).toContain('模式: PWA 独立窗口');
    expect(d.summary).toContain('安全区来源: iOS PWA 兜底 59/34（env 全 0）');
    expect(d.summary).toContain('★ 最终 safe(t/r/b/l): 59 / 0 / 34 / 0');
  });

  it('PWA 独立模式 + env 有值：来源标\"env() 实测\"，不归到兜底', async () => {
    stub({ ua: UA_IPHONE, standalone: true, env: { t: 47, r: 0, b: 34, l: 0 }, viewH: 852 });
    const m = await import('../../src/dev/envDiag');
    const d = m.collectEnvDiag({ safe: { top: 47, right: 0, bottom: 34, left: 0 }, hudHCss: 56, textTopCss: 56, renderScale: 3 });
    expect(d.summary).toContain('env(t/r/b/l): 47 / 0 / 34 / 0');
    expect(d.summary).toContain('安全区来源: env() 实测有效');
    expect(d.summary).not.toContain('iOS PWA 兜底');
  });

  it('桌面 Mac 独立窗口 + env 全 0：来源仍是\"全 0\"（maxTouchPoints=0，不算 iOS）', async () => {
    stub({ ua: UA_DESKTOP, standalone: true, viewH: 800 });
    // 显式把 maxTouchPoints 拨回 0，模拟真 Mac
    (globalThis as unknown as { navigator: { maxTouchPoints: number } }).navigator.maxTouchPoints = 0;
    const m = await import('../../src/dev/envDiag');
    const d = m.collectEnvDiag({ safe: { top: 0, right: 0, bottom: 0, left: 0 }, hudHCss: 40, textTopCss: 40, renderScale: 2 });
    expect(d.summary).toContain('是否 iOS / iPadOS: false');
    expect(d.summary).toContain('安全区来源: 全 0：系统未遮挡内容');
  });

  it('summary 包含开发者排错需要的全部关键字段', async () => {
    stub({ ua: UA_IPHONE, standalone: false, viewH: 695 });
    const m = await import('../../src/dev/envDiag');
    const d = m.collectEnvDiag({ safe: { top: 0, right: 0, bottom: 0, left: 0 }, hudHCss: 52, textTopCss: 60, renderScale: 3 });
    for (const k of [
      '版本 / 构建', '构建时间', '本次载入', '前端资源',
      '模式', '状态栏样式', 'innerWidth × innerHeight', 'visualViewport', 'screen / availHeight',
      'devicePixelRatio', '--app-h', '#game 盒子', 'canvas 盒子', 'canvas 内部像素',
      'env(t/r/b/l)', '安全区来源', '★ 最终 safe', 'HUD 高度', '面板外点击区顶边', '画布 px / CSS px', 'UA',
    ]) {
      expect(d.summary, `missing ${k}`).toContain(k);
    }
  });
});
