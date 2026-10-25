import { describe, expect, it } from 'vitest';
import { ENERGY, ORE_HP } from '../../src/core/config';
import { toolMaxDur } from '../../src/core/data';
import {
  CAVE_ORE_SPOTS, CAVE_SPAWN, caveOreAt, enterCave, exitCave, inCaveMap,
} from '../../src/core/cave';
import { mineOre, oreAt, refreshOres } from '../../src/core/mine';
import { deserialize, serialize } from '../../src/core/save';
import { createWorld } from '../../src/core/world';

const PICK = 'tool:pickaxe';

function withPickaxe(w: ReturnType<typeof createWorld>): ReturnType<typeof createWorld> {
  w.inventory[PICK] = 1;
  w.toolDur[PICK] = toolMaxDur(PICK);
  return w;
}

describe('矿洞 B1', () => {
  it('默认在农场，洞内 4 处矿脉满血', () => {
    const w = createWorld();
    expect(w.area).toBe('farm');
    expect(w.cave.depth).toBe(1);
    expect(w.cave.ores.length).toBe(CAVE_ORE_SPOTS.length);
    expect(w.cave.ores.every((o) => o.hp === ORE_HP)).toBe(true);
    expect(inCaveMap(CAVE_SPAWN.x, CAVE_SPAWN.y)).toBe(true);
  });

  it('进洞记录返回坐标并落到洞内，出洞回到原位', () => {
    const w = createWorld();
    w.playerX = 27;
    w.playerY = 2;
    expect(enterCave(w)).toBe(true);
    expect(w.area).toBe('cave');
    expect(w.playerX).toBe(CAVE_SPAWN.x);
    expect(w.playerY).toBe(CAVE_SPAWN.y);
    expect([w.cave.returnX, w.cave.returnY]).toEqual([27, 2]);

    expect(exitCave(w)).toBe(true);
    expect(w.area).toBe('farm');
    expect([w.playerX, w.playerY]).toEqual([27, 2]);
  });

  it('洞内矿脉按 area 选择，挖矿走同一套体力/耐久/产出', () => {
    const w = withPickaxe(createWorld());
    enterCave(w);
    const [x, y] = CAVE_ORE_SPOTS[0];
    expect(oreAt(w, x, y)?.hp).toBe(ORE_HP);
    expect(caveOreAt(w, x, y)?.hp).toBe(ORE_HP);

    const forestHp = w.ores[0].hp;
    const r = mineOre(w, x, y);
    expect(r.ok).toBe(true);
    expect(r.energy).toBe(ENERGY.mine);
    expect(caveOreAt(w, x, y)?.hp).toBe(ORE_HP - 1);
    expect(w.ores[0].hp).toBe(forestHp); // 不误伤林区矿脉
    expect(w.inventory['ore:copper']).toBe(1);
  });

  it('矿洞矿脉次日回满，存档往返保留 area/cave', () => {
    const w = withPickaxe(createWorld());
    enterCave(w);
    mineOre(w, CAVE_ORE_SPOTS[0][0], CAVE_ORE_SPOTS[0][1]);
    refreshOres(w);
    expect(w.cave.ores.every((o) => o.hp === ORE_HP)).toBe(true);

    enterCave(w); // noop in cave
    const back = deserialize(serialize(w))!;
    expect(back.area).toBe('cave');
    expect(back.cave.returnX).toBe(w.cave.returnX);
    expect(back.cave.ores.length).toBe(CAVE_ORE_SPOTS.length);
  });

  it('旧档（fmt6）默认回农场并补矿洞', () => {
    const w = deserialize(JSON.stringify({ fmt: 6, day: 3, playerX: 5, playerY: 6 }))!;
    expect(w.fmt).toBe(7);
    expect(w.area).toBe('farm');
    expect(w.cave.ores.length).toBe(CAVE_ORE_SPOTS.length);
  });
});
