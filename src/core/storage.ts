// IndexedDB 封装：无依赖手写，失败时降级到 localStorage 兜底（不让玩家白玩一场）。
// 存档是玩家最贵的数据 —— 任何一步失败都不能静默丢。

import { DB_NAME, DB_VERSION, SAVE_KEY, SETTINGS_KEY } from './config';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb blocked'));
  });
}

export async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').get(key);
        req.onsuccess = () => resolve((req.result as string) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // 降级：localStorage 兜底（隐私模式 / IDB 被禁）
    try { return localStorage.getItem('vale-farm.idb.' + key); } catch { return null; }
  }
}

export async function idbSet(key: string, value: string): Promise<boolean> {
  try {
    const db = await openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  } catch {
    try { localStorage.setItem('vale-farm.idb.' + key, value); return true; } catch { return false; }
  }
}

export async function loadSaveJson(): Promise<string | null> {
  return idbGet(SAVE_KEY);
}

export async function writeSaveJson(json: string): Promise<boolean> {
  return idbSet(SAVE_KEY, json);
}

// ---------------------------------------------------------------- 设置（localStorage）

export interface Settings {
  sfx: boolean;
  joystickSide: 'left' | 'right';
}

const DEFAULTS: Settings = { sfx: true, joystickSide: 'left' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const o = JSON.parse(raw);
    return {
      // sfx —— 必须登记（逐字段，见 save.ts 的教训）
      sfx: typeof o.sfx === 'boolean' ? o.sfx : DEFAULTS.sfx,
      // joystickSide —— 必须登记
      joystickSide: o.joystickSide === 'right' ? 'right' : 'left',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 忽略 */ }
}
