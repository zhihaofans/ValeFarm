// 农场评价（D4）回归：这一套会直接决定"装饰/整洁值不值"，所以先把单调性和边界钉死。
//   1) 新档开局是低分档位，不能一上来就"闻名"
//   2) 单因子变化的方向必须正确：清理障碍↑、加装饰↑、枯苗↓、开垦↑、多品种↑
//   3) 封顶与边界：装饰/多样性封顶、脏乱封顶、分数夹在 0..100
//   4) 档位阈值与分数一致（不出现 74 分却标"闻名"）

import { describe, expect, it } from 'vitest';
import { createWorld, plotAt } from '../../src/core/world';
import { rating, ratingDetail, RATING_CAPS, RATING_STEPS, RATING_LABELS } from '../../src/core/rating';
import { FARM_H, FARM_W } from '../../src/core/config';

function clearAllMess(): ReturnType<typeof createWorld> {
  const w = createWorld();
  for (const p of w.plots) p.obstacle = null;
  return w;
}

describe('农场评价', () => {
  it('新档开局不是高分（有障碍、没装饰、没种东西）', () => {
    const w = createWorld();
    const r = rating(w);
    expect(r.score).toBeLessThan(RATING_STEPS[1]);      // < 50
    expect(r.label).toBe(RATING_LABELS[r.grade]);
    expect(['荒芜', '尚可']).toContain(r.label);
  });

  it('清掉所有障碍：分数上升', () => {
    const a = rating(createWorld()).score;
    const b = rating(clearAllMess()).score;
    expect(b).toBeGreaterThan(a);
  });

  it('加装饰：分数单调不降，12 件封顶', () => {
    const w = clearAllMess();
    const s0 = rating(w).score;
    w.decor = [{ id: 'decor:flowerpot', x: 1, y: 1 }];
    const s1 = rating(w).score;
    expect(s1).toBeGreaterThanOrEqual(s0);

    // 塞满 12 件（同一格不重复是存档层的事，这里只测评分）
    w.decor = Array.from({ length: RATING_CAPS.decor }, (_, i) => ({ id: 'decor:flowerpot', x: i, y: 0 }));
    const s12 = rating(w).score;
    w.decor = Array.from({ length: RATING_CAPS.decor + 8 }, (_, i) => ({ id: 'decor:flowerpot', x: i, y: 0 }));
    expect(rating(w).score).toBe(s12);                  // 超过上限不再加分
  });

  it('枯苗与障碍扣分；开垦与多品种加分', () => {
    const clean = clearAllMess();
    const base = rating(clean).score;

    const withered = clearAllMess();
    plotAt(withered, 0, 0)!.crop = { type: 'radish', stage: 1, progress: 0, dryDays: 2, wateredToday: false, withered: true };
    expect(rating(withered).score).toBeLessThan(base);

    const tilled = clearAllMess();
    for (let y = 0; y < FARM_H; y++) {
      for (let x = 0; x < FARM_W; x++) {
        const p = plotAt(tilled, x, y)!;
        p.state = 'tilled';
      }
    }
    expect(rating(tilled).score).toBeGreaterThan(base);

    const diverse = clearAllMess();
    diverse.inventory['crop:radish:norm'] = 1;
    diverse.inventory['crop:pea:norm'] = 1;
    diverse.inventory['crop:corn:norm'] = 1;
    diverse.inventory['crop:pumpkin:norm'] = 1;
    expect(ratingDetail(diverse).diversity).toBe(4);
    expect(rating(diverse).score).toBeGreaterThan(base);
  });

  it('满分档位可达，且分数夹在 0..100', () => {
    const w = clearAllMess();
    for (const p of w.plots) p.state = 'tilled';
    w.decor = Array.from({ length: RATING_CAPS.decor }, (_, i) => ({ id: 'decor:flowerpot', x: i % FARM_W, y: 0 }));
    for (const c of ['radish', 'pea', 'corn', 'pumpkin']) w.inventory[`crop:${c}:norm`] = 1;
    const r = rating(w);
    expect(r.score).toBe(100);
    expect(r.grade).toBe(3);
    expect(r.label).toBe('闻名');

    // 全部地块长满枯苗也不会出现负分
    const bad = createWorld();
    for (const p of bad.plots) {
      p.state = 'wild';
      p.obstacle = 'stump';
      p.crop = { type: 'radish', stage: 0, progress: 0, dryDays: 9, wateredToday: false, withered: true };
    }
    expect(rating(bad).score).toBeGreaterThanOrEqual(0);
    expect(rating(bad).grade).toBe(0);
  });

  it('档位阈值与分数一致', () => {
    const w = clearAllMess();
    // 构造一个刚好落在"兴旺"的中间态：不追求精确分，只验档位映射
    const r = rating(w);
    const expected = r.score >= RATING_STEPS[0] ? 3 : r.score >= RATING_STEPS[1] ? 2 : r.score >= RATING_STEPS[2] ? 1 : 0;
    expect(r.grade).toBe(expected);
  });
});
