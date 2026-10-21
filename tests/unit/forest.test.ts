import { describe, expect, it } from 'vitest';
import { chopTree, treeAt } from '../../src/core/forest';
import { createWorld } from '../../src/core/world';

describe('林区砍树', () => {
  it('树占位、三次砍倒、给 2 木头并扣体力', () => {
    const w = createWorld();
    const tree = treeAt(w, 26, 5)!;
    expect(tree.hp).toBe(3);
    expect(w.energy).toBe(100);

    expect(chopTree(w, 26, 5).ok).toBe(true);
    expect(tree.hp).toBe(2);
    expect(chopTree(w, 26, 5).ok).toBe(true);
    expect(tree.hp).toBe(1);
    const r = chopTree(w, 26, 5);
    expect(r.ok).toBe(true);
    expect(r.chopped).toBe(true);
    expect(w.inventory.wood).toBe(2);
    expect(w.energy).toBe(88);
    expect(treeAt(w, 26, 5)).toBeNull();
  });

  it('砍倒后不能继续砍，没树/没体力会失败', () => {
    const w = createWorld();
    for (let i = 0; i < 3; i++) chopTree(w, 26, 5);
    expect(chopTree(w, 26, 5).ok).toBe(false);

    const t = w.trees.find((x) => x.hp > 0)!;
    w.energy = 0;
    const r = chopTree(w, t.x, t.y);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('体力');
  });
});
