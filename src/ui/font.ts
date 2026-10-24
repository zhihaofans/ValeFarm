// 字体：像素中文字体（自托管，OFL-1.1），缺失时自动退回系统字体。
//
// 为什么集中在这里：
//   · Phaser 的 Text 只认 fontFamily 字符串，散落在各面板里会出现"有的地方像素字、
//     有的地方系统字"的割裂感；
//   · 换字体/换许可时只改一处。
//
// 字体：Ark Pixel Font 12px proportional zh_hans（OFL-1.1）
//       仓库 https://github.com/TakWolf/ark-pixel-font ，许可原文见 public/fonts/OFL-ark-pixel-font.txt
//       取的是 Release 里的单文件 woff2（约 535 KB），自托管、零外链。
//
// ⚠️ 像素字体在 12px / 24px 最清晰；非整数倍字号会有轻微抗锯齿。
//    目前 UI 字号（12~19px × dpr）没有强制对齐，先看观感再决定要不要收拢字号。

/** 常规 UI 字体栈：像素字优先，回退系统黑体（缺字体时界面不能崩） */
export const UI_FONT = '"ValePixel", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

/** 等宽场景（诊断面板）用同一套像素字 + 等宽回退 */
export const UI_FONT_MONO = '"ValePixel", ui-monospace, Menlo, Consolas, monospace';

/** 等字体的超时：宁可先用系统字体开局，也不能因为字体没到而卡住首屏 */
const FONT_READY_TIMEOUT_MS = 1500;

/**
 * 等像素字体就绪。返回值只是"是否等到"，调用方不需要区分 ——
 * 等不到就继续用回退字体，游戏照常跑。
 */
export async function waitPixelFont(timeoutMs = FONT_READY_TIMEOUT_MS): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts?.load) return false;
  try {
    const ok = await Promise.race([
      document.fonts.load('12px ValePixel').then((faces) => faces.length > 0),
      new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    return ok === true;
  } catch {
    return false;
  }
}
