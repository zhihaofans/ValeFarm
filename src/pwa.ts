// PWA 引导层 —— 与玩法完全解耦：
// 把这一整段注释掉，游戏照常能玩（file:// 打开也不报错）。
//
// 职责：注册 SW、断网提示条、新版本提示（只提示不自动 reload）。
// 三个更新触发源（installing/controllerchange/version.json 比对）在此去重。

const SW_ENABLED = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * 新版本提示条。
 *
 * 三个真机踩过的坑（0.4.2 竖屏实拍）：
 *
 * ① **压在状态栏上**：原来是 `top:8px`，完全没算安全区。iOS PWA 里
 *    black-translucent 让内容铺到状态栏下，8px 等于贴着灵动岛画，
 *    文字被吞掉一半、能看见的那条又窄又难戳。
 *
 * ② **离拇指太远**：即使躲开状态栏，它仍贴在屏幕最上沿。竖屏单手握持时
 *    那是全屏最难够到的位置，用户反馈"很难按"就是这个。
 *    → 改为**屏幕中部偏上**（纵向 38%）居中浮动：离 HUD 远、在拇指舒适区内。
 *      用户明确要求过同类元素垂直居中，这里保持一致的做法。
 *
 * ③ **点击被画布吃掉**：与 Phaser canvas 叠在一起时，触摸命中可能落到 canvas。
 *    → 给足触控尺寸（最小 44px 高）、顶格 z-index、`touch-action:manipulation`。
 */
function showBanner(text: string, onClick?: () => void): void {
  if (document.getElementById('pwa-banner')) return;
  const b = document.createElement('div');
  b.id = 'pwa-banner';
  b.setAttribute('role', 'button');
  b.setAttribute('tabindex', '0');
  b.textContent = text;
  b.style.cssText = [
    'position:fixed', 'left:50%', 'top:38%',
    // translate(-50%,-50%) 而不是只 translX：按元素自身高度居中，多行也不会偏
    'transform:translate(-50%,-50%)',
    'z-index:2147483647',
    'background:#c9a06b', 'color:#1a2218',
    // 描边 + 双层阴影：草地是亮的绿色，纯色块的边界会"糊"进去，看着不像能点的东西
    'border:2px solid #f4ead8',
    // 触控目标够大：上下各 14px 内边距 → 整条高度约 48px（iOS HIG 下限 44）
    'padding:14px 24px', 'border-radius:26px', 'font-size:16px', 'font-weight:600',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
    'box-shadow:0 0 0 4px rgba(0,0,0,.28), 0 8px 24px rgba(0,0,0,.65)',
    'cursor:pointer', 'user-select:none', '-webkit-user-select:none',
    'touch-action:manipulation', '-webkit-tap-highlight-color:transparent',
    'white-space:nowrap', 'pointer-events:auto',
  ].join(';');
  if (onClick) b.addEventListener('click', onClick);
  document.body.appendChild(b);
}

function showOfflineBanner(): void {
  const old = document.getElementById('offline-banner');
  if (old) return;
  const b = document.createElement('div');
  b.id = 'offline-banner';
  b.textContent = '当前离线，游戏仍在本地运行';
  b.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:8px',
    'z-index:99999', 'background:#000000aa', 'color:#fff',
    'padding:6px 16px', 'border-radius:16px', 'font-size:13px', 'font-family:sans-serif',
  ].join(';');
  document.body.appendChild(b);
}
function hideOfflineBanner(): void {
  document.getElementById('offline-banner')?.remove();
}

function watchOnline(): void {
  // 冷启动就离线时 offline 事件不会触发，必须主动查一次
  if (!navigator.onLine) showOfflineBanner();
  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online', hideOfflineBanner);
}

/** 切回前台时比对 version.json —— SW 字节没变时唯一能发现新版本的路 */
function watchVersion(): void {
  let known: string | null = null;
  let noticed = '';
  const check = async () => {
    try {
      const r = await fetch('./version.json', { cache: 'no-store' });
      const meta = await r.json();
      const v = String(meta.ver ?? '') + '#' + String(meta.build ?? '');
      if (known === null) {
        known = v;
        return;
      }
      if (v !== known && noticed !== v) {
        noticed = v;
        showBanner('发现新版本，点此刷新', () => location.reload());
      }
    } catch { /* 断网时静默失败 */ }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  void check();
}

function registerSW(): void {
  if (!SW_ENABLED) return;
  // 注册前先记下有没有 controller：首次接管不是"更新"，不打扰用户
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller && hadController) {
            showBanner('已更新到新版本，点此刷新', () => location.reload());
          }
        });
      });
    })
    .catch(() => { /* 注册失败（如 file://）不报错，游戏照常可玩 */ });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // 首次接管，不是更新
    showBanner('已更新到新版本，点此刷新', () => location.reload());
  });
}

registerSW();
watchOnline();
watchVersion();
void isStandalone;
