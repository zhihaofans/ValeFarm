// 作物状态机回归：浇水推进 / 缺水停滞 / 过季枯萎 / 雨天补水。
// 每条用例对应一类「如果这个 bug 回来，这个测试会红」的静默失败。

import { describe, expect, it } from 'vitest';
import { advanceCrops, applyRain, endDay } from '../../src/core/daycycle';
import { doHoe, doPlant, doWater } from '../../src/core/actions';
import { createWorld, plotAt } from '../../src/core/world';

function plantedWorld(crop: 'radish' | 'pea' | 'corn' | 'pumpkin' = 'radish') {
  const w = createWorld();
  // 非春季作物把世界拨到对应季节（玉米夏、南瓜秋）
  if (crop === 'corn') w.season = 1;
  if (crop === 'pumpkin') w.season = 2;
  w.inventory['seed:' + crop] = 3;
  // 用 (0,3)：初始地图上既无障碍也未开垦的格子
  doHoe(w, 0, 3);
  const r = doPlant(w, 0, 3, crop);
  expect(r.ok).toBe(true);
  return w;
}

describe('作物状态机', () => {
  it('浇水后睡觉推进一阶段，3 天成熟（四季萝卜）', () => {
    const w = plantedWorld('radish');
    const p = plotAt(w, 0, 3)!;
    doWater(w, 0, 3);
    expect(p.crop!.wateredToday).toBe(true);
    advanceCrops(w);
    expect(p.crop!.stage).toBe(1);
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(2);
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(3); // 成熟
  });

  it('不浇水则停滞并计入缺水，浇水后恢复推进', () => {
    const w = plantedWorld('radish');
    const p = plotAt(w, 0, 3)!;
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(1);
    advanceCrops(w); // 忘了浇水
    expect(p.crop!.stage).toBe(1); // 停滞
    expect(p.crop!.dryDays).toBe(1);
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(2);
  });

  it('玉米需要更多浇水天数（阶段阈值 1,2,2）', () => {
    const w = plantedWorld('corn');
    const p = plotAt(w, 0, 3)!;
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(1);
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(1); // 阶段 1 需要浇 2 天
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(2);
  });

  it('过季未成熟作物枯萎，无法再推进', () => {
    const w = plantedWorld('pumpkin'); // 只能秋天种
    // 直接跳到冬天
    (w as { season: number }).season = 3;
    const p = plotAt(w, 0, 3)!;
    doWater(w, 0, 3);
    advanceCrops(w);
    expect(p.crop!.withered).toBe(true);
    const before = p.crop!.stage;
    doWater(w, 0, 3); advanceCrops(w);
    expect(p.crop!.stage).toBe(before); // 枯萎后不再生长
  });

  it('过季已成熟作物不枯萎（留给玩家一天缓冲收掉）', () => {
    const w = plantedWorld('pumpkin');
    const p = plotAt(w, 0, 3)!;
    p.crop!.stage = 3;
    (w as { season: number }).season = 3;
    advanceCrops(w);
    expect(p.crop!.withered).toBe(false);
    expect(p.crop!.stage).toBe(3);
  });

  it('雨天所有已开垦地块自动湿润并标记作物已浇水', () => {
    const w = plantedWorld('radish');
    const p = plotAt(w, 0, 3)!;
    applyRain(w);
    expect(p.state).toBe('watered');
    expect(p.crop!.wateredToday).toBe(true);
  });

  it('雨天播种：新苗当天继承雨水，不会因为浇水被拒而停滞', () => {
    const w = createWorld();
    w.weather = 'rain';
    w.inventory['seed:radish'] = 1;
    doHoe(w, 0, 3);
    expect(doPlant(w, 0, 3, 'radish').ok).toBe(true);
    const p = plotAt(w, 0, 3)!;
    expect(p.state).toBe('watered');
    expect(p.crop!.wateredToday).toBe(true);
  });

  it('已浇湿的裸地播种：新苗继承水分', () => {
    const w = createWorld();
    w.inventory['seed:radish'] = 1;
    doHoe(w, 0, 3);
    expect(doWater(w, 0, 3).ok).toBe(true);
    expect(doPlant(w, 0, 3, 'radish').ok).toBe(true);
    const p = plotAt(w, 0, 3)!;
    expect(p.crop!.wateredToday).toBe(true);
  });
});

describe('日循环', () => {
  it('睡觉推进天数与季节，体力回满', () => {
    const w = plantedWorld('radish');
    w.energy = 20;
    w.minute = 1300;
    endDay(w, false);
    expect(w.day).toBe(2);
    expect(w.energy).toBe(w.maxEnergy);
    expect(w.minute).toBe(360); // 6:00
  });

  it('昏倒次日体力减半并罚金币，但不会扣成负数', () => {
    const w = plantedWorld('radish');
    w.gold = 10;
    endDay(w, true);
    expect(w.energy).toBe(Math.floor(w.maxEnergy / 2));
    expect(w.gold).toBe(0);
    expect(w.collapsedLastNight).toBe(true);
  });

  it('跨入新季节（28 天/季）', () => {
    const w = plantedWorld('radish');
    w.day = 28;
    endDay(w, false);
    expect(w.day).toBe(29);
    expect(w.season).toBe(1); // 夏
  });

  it('跨季当晚按新季节结算：春末种下的豌豆不会白活第一个夏天', () => {
    const w = plantedWorld('pea'); // 豌豆只适合春/秋
    w.day = 28;
    doWater(w, 0, 3);
    endDay(w, false);
    expect(w.day).toBe(29);
    expect(w.season).toBe(1);
    expect(plotAt(w, 0, 3)!.crop!.withered).toBe(true);
  });

  it('每日 NPC 互动标记在睡觉后重置', () => {
    const w = plantedWorld('radish');
    w.npcs.mira.talkedToday = true;
    w.npcs.mira.giftedToday = true;
    endDay(w, false);
    expect(w.npcs.mira.talkedToday).toBe(false);
    expect(w.npcs.mira.giftedToday).toBe(false);
  });
});
