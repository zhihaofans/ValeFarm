// 程序化音效：WebAudio 合成，零音频文件（离线友好，也不用预缓存任何 mp3）。
// 所有音色都是原创短促合成音，不采样任何第三方素材。

let ctx: AudioContext | null = null;
let enabled = true;

export function setSfxEnabled(v: boolean): void {
  enabled = v;
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 首次触摸解锁音频（移动端自动播放策略） */
export function unlockAudio(): void {
  ac();
}

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  slide?: number; // 结束频率
  delay?: number;
}

function tone({ freq, dur, type = 'square', vol = 0.15, slide, delay = 0 }: ToneOpts): void {
  const c = ac();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const SFX = {
  till() { tone({ freq: 140, dur: 0.12, type: 'triangle', vol: 0.25, slide: 70 }); },
  water() { tone({ freq: 700, dur: 0.18, type: 'sine', vol: 0.12, slide: 380 }); },
  plant() { tone({ freq: 520, dur: 0.09, vol: 0.12 }); tone({ freq: 760, dur: 0.09, vol: 0.1, delay: 0.07 }); },
  harvest() { tone({ freq: 660, dur: 0.08 }); tone({ freq: 880, dur: 0.1, delay: 0.08 }); tone({ freq: 1180, dur: 0.14, delay: 0.16 }); },
  coin() { tone({ freq: 980, dur: 0.07, type: 'square', vol: 0.12 }); tone({ freq: 1320, dur: 0.16, type: 'square', vol: 0.12, delay: 0.06 }); },
  ui() { tone({ freq: 440, dur: 0.05, vol: 0.08 }); },
  sleep() { tone({ freq: 520, dur: 0.3, type: 'sine', vol: 0.12, slide: 260 }); },
  fail() { tone({ freq: 200, dur: 0.15, type: 'sawtooth', vol: 0.1, slide: 120 }); },
  collapse() { tone({ freq: 300, dur: 0.5, type: 'sawtooth', vol: 0.14, slide: 60 }); },
  /** 挖矿：金属敲石的脆响（高频短促 + 一点低频回弹） */
  mine() { tone({ freq: 1200, dur: 0.06, type: 'square', vol: 0.1, slide: 900 }); tone({ freq: 520, dur: 0.1, type: 'triangle', vol: 0.16, slide: 320, delay: 0.03 }); },
  rain() { tone({ freq: 260, dur: 0.5, type: 'sine', vol: 0.06, slide: 340 }); },
};
