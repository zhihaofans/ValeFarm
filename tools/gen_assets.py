#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微光农庄 · 像素资源程序化生成器

所有美术都由这份脚本画出来 —— 没有任何外部素材，改配色/造型改这里重跑即可：
    python3 tools/gen_assets.py      （或 npm run assets）

产物：
    public/assets/tiles.png      地块图集（8 列 × 2 行，每格 32×32）
    public/assets/crops.png      作物图集（5 列 × 4 行：阶段 0..3 + 枯萎）
    public/assets/player.png     玩家（4 方向 × 4 帧）
    public/assets/npc.png        NPC（4 方向 × 4 帧）
    public/assets/ui.png         UI 图标（6 列 × 3 行）
    public/icons/*.png           PWA 图标 / apple-touch-icon / favicon
    public/splash/*.png          iOS 启动图
    src/core/generated/tiles.frames.ts   ← TS 侧的帧索引，唯一数据源

设计约定（改动前先看）：
    · 所有精灵按 16×16 逻辑像素作画，再 NEAREST 放大 2 倍输出 32×32，
      这样在手机上放大 2~3 倍仍然是硬边像素，不会被插值糊掉。
    · 图集帧索引按「行主序」排列，与 Phaser 的 spritesheet 切帧规则一致。
"""

import os
import random
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ASSETS = os.path.join(ROOT, 'public', 'assets')
ICONS = os.path.join(ROOT, 'public', 'icons')
SPLASH = os.path.join(ROOT, 'public', 'splash')
GEN = os.path.join(ROOT, 'src', 'core', 'generated')

LOGICAL = 16          # 逻辑像素（作画单位）
SCALE = 2             # 输出放大倍数
TILE = LOGICAL * SCALE  # 32

for d in (ASSETS, ICONS, SPLASH, GEN):
    os.makedirs(d, exist_ok=True)


# ---------------------------------------------------------------- 基础工具

def canvas16():
    return Image.new('RGBA', (LOGICAL, LOGICAL), (0, 0, 0, 0))


def up2(img):
    """逻辑 16×16 → 输出 32×32，最近邻放大，保持硬边。"""
    return img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)


def art_to_img(art, pal):
    """ASCII art（16×16 字符网格）→ 逻辑图。'.' 为透明。"""
    img = canvas16()
    d = ImageDraw.Draw(img)
    for y, line in enumerate(art):
        for x, ch in enumerate(line):
            c = pal.get(ch)
            if c:
                d.point((x, y), fill=c)
    return img


def mirror_art(art):
    return [line[::-1] for line in art]


def cut_top(art, n):
    """裁掉顶部 n 行，空出来的补到最上面（保持底部贴地）。"""
    if n <= 0:
        return list(art)
    return ['................' for _ in range(n)] + list(art[n:])


def replace_chars(art, mapping):
    out = []
    for line in art:
        for a, b in mapping.items():
            line = line.replace(a, b)
        out.append(line)
    return out


def paste_grid(sheet, img32, col, row):
    sheet.paste(img32, (col * TILE, row * TILE), img32)


def blank_sheet(cols, rows):
    return Image.new('RGBA', (cols * TILE, rows * TILE), (0, 0, 0, 0))


# ---------------------------------------------------------------- 调色板

P = {
    'g': '#6cbf4a',   # 叶（亮）
    'G': '#4a9136',   # 叶（暗）
    's': '#3a6f28',   # 茎
    'f': '#f4ead8',   # 白
    'h': '#4a3423',   # 头发
    'w': '#e8e4dc',   # 白发
    'k': '#f2c49b',   # 皮肤
    'e': '#2b1d14',   # 眼睛
    'b': '#3f7d5a',   # 衣服（玩家）
    'v': '#7a5798',   # 衣服（NPC）
    'p': '#33507a',   # 裤子
    'o': '#2a2a2a',   # 鞋
    'c': '#d9534f',   # 围巾
    'F': '#d94f4f',   # 果实：萝卜
    'D': '#7fd45a',   # 果实：豌豆
    'C': '#f2c53d',   # 果实：玉米
    'U': '#e07b28',   # 果实：南瓜
    'H': '#c2621a',   # 南瓜暗部
}

CROP_FRUIT = {'F': '#d94f4f', 'D': '#7fd45a', 'C': '#f2c53d', 'U': '#e07b28'}


# ---------------------------------------------------------------- 地块

def noise_tile(base, specks, seed, density=0.10):
    """单色底 + 确定性噪点，避免每次重跑图案都变（影响 diff 与缓存）。"""
    rnd = random.Random(seed)
    img = canvas16()
    d = ImageDraw.Draw(img)
    for y in range(LOGICAL):
        for x in range(LOGICAL):
            c = base
            if rnd.random() < density:
                c = specks[rnd.randrange(len(specks))]
            d.point((x, y), fill=c)
    return img


def grass_tile(seed, flower=False):
    img = noise_tile('#6a9a4a', ['#5d8c41', '#78a955', '#82b460'], seed, 0.18)
    d = ImageDraw.Draw(img)
    rnd = random.Random(seed + 900)
    for _ in range(10):
        x = rnd.randrange(LOGICAL)
        y = rnd.randrange(LOGICAL)
        d.point((x, y), fill='#8fc96b')
    if flower:
        for (x, y) in ((3, 5), (11, 9)):
            d.point((x, y), fill='#f2e06a')
            d.point((x + 1, y), fill='#e8c94f')
    return img


def wild_grass_tile():
    """未开垦的野草地：底色 + 一簇簇杂草（锄地对象）。"""
    img = grass_tile(7, True)
    d = ImageDraw.Draw(img)
    rnd = random.Random(42)
    for _ in range(14):
        x = rnd.randrange(1, 15)
        y = rnd.randrange(2, 15)
        d.point((x, y), fill='#3f7a2a')
        d.point((x, y - 1), fill='#4f9436')
    return img


def tilled_tile(wet):
    base = '#5b4029' if wet else '#8a6242'
    dark = '#3f2c1c' if wet else '#6f4e33'
    hi = '#7a5836' if wet else '#a2764f'
    img = canvas16()
    d = ImageDraw.Draw(img)
    for y in range(LOGICAL):
        for x in range(LOGICAL):
            c = base
            if y % 4 == 0:
                c = dark            # 犁沟
            elif y % 4 == 1:
                c = hi              # 垄背高光
            d.point((x, y), fill=c)
    rnd = random.Random(11 if wet else 5)
    for _ in range(18):
        d.point((rnd.randrange(LOGICAL), rnd.randrange(LOGICAL)), fill=dark)
    return img


def path_tile():
    img = noise_tile('#b9a07a', ['#a88f6b', '#cbb391'], 3, 0.2)
    return img


def water_tile():
    img = canvas16()
    d = ImageDraw.Draw(img)
    for y in range(LOGICAL):
        for x in range(LOGICAL):
            c = '#4a86c8'
            if (x + y) % 7 < 2:
                c = '#5f9ada'
            if (x * 3 + y * 2) % 11 == 0:
                c = '#6fb0e8'
            d.point((x, y), fill=c)
    return img


def weed_tile():
    img = grass_tile(21, False)
    art = [
        '................',
        '................',
        '................',
        '................',
        '................',
        '.......g........',
        '......gGg.......',
        '.....gGgGg......',
        '....gGg.gGg.....',
        '...gGg.g.gGg....',
        '...ggGgGgGgg....',
        '....gG.G.Gg.....',
        '.....s...s......',
        '......s.s.......',
        '................',
        '................',
    ]
    pal = {'g': '#65b046', 'G': '#2f6b2a', 's': '#3a6f28'}
    img.alpha_composite(art_to_img(art, pal))
    return img


def stone_tile():
    img = grass_tile(9, False)
    art = [
        '................',
        '................',
        '................',
        '................',
        '................',
        '.....SSSSSS.....',
        '....SSsssSSS....',
        '...SsssssSSSS...',
        '...SsssssssSS...',
        '...SsssssssSS...',
        '....SSssssSS....',
        '.....SSSSSS.....',
        '................',
        '................',
        '................',
        '................',
    ]
    pal = {'S': '#6f6f6f', 's': '#9d9d9d'}
    img.alpha_composite(art_to_img(art, pal))
    return img


def stump_tile():
    img = grass_tile(13, True)
    art = [
        '................',
        '................',
        '................',
        '................',
        '.....WWWWWW.....',
        '....WwwwwWWW....',
        '...WwwwwwwwWW...',
        '...WwwrrwwwWW...',
        '...WwwrrwwwWW...',
        '...WwwwwwwwWW...',
        '....WwwwwWWW....',
        '.....WWWWWW.....',
        '................',
        '................',
        '................',
        '................',
    ]
    pal = {'W': '#5b3c22', 'w': '#8a5c34', 'r': '#b98a55'}
    img.alpha_composite(art_to_img(art, pal))
    return img


def fence_tile():
    img = grass_tile(17, False)
    art = [
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        'WWWWWWWWWWWWWWWW',
        'WWWWWWWWWWWWWWWW',
        'WwwwwwwwwwwwwwwW',
        'WwwwwwwwwwwwwwwW',
        'WwWwwwwwwwwwwWwW',
        'WwWwwwwwwwwwwWwW',
        'WwWwwwwwwwwwwWwW',
        'WwWwwwwwwwwwwWwW',
        'WwWwwwwwwwwwwWwW',
        'WwWwwwwwwwwwwWwW',
    ]
    pal = {'W': '#6b482a', 'w': '#a2764c'}
    img.alpha_composite(art_to_img(art, pal))
    return img


def tree_tile():
    img = grass_tile(19, False)
    art = [
        '................',
        '.....GGGGGG.....',
        '...GGggggGGG....',
        '..GgggggggggG...',
        '..GgggggggggG...',
        '..GgggggggggG...',
        '...GGggggGGG....',
        '.....GGGGGG.....',
        '......WWWW......',
        '......WwwW......',
        '......WwwW......',
        '......WwwW......',
        '......WwwW......',
        '.....WWwwWW.....',
        '................',
        '................',
    ]
    pal = {'G': '#2f6b2a', 'g': '#4a9136', 'W': '#5b3c22', 'w': '#8a5c34'}
    img.alpha_composite(art_to_img(art, pal))
    return img


def house_tile():
    art = [
        '................',
        '.......RR.......',
        '......RRRR......',
        '.....RRRRRR.....',
        '....RRRRRRRR....',
        '...RRRRRRRRRR...',
        '..RRRRRRRRRRRR..',
        '..WWWWWWWWWWWW..',
        '..WwwwwwwwwwwW..',
        '..WwWwwwwwwWwW..',
        '..WwWwwddwwWwW..',
        '..WwWwwddwwWwW..',
        '..WwwwwddwwwwW..',
        '..WwwwwddwwwwW..',
        '..WWWWWWWWWWWW..',
        '..WWWWWWWWWWWW..',
    ]
    pal = {'R': '#a4453a', 'W': '#6b482a', 'w': '#c39a6b', 'd': '#5b3c22'}
    img = grass_tile(31, False)
    img.alpha_composite(art_to_img(art, pal))
    return img


def well_tile():
    art = [
        '................',
        '................',
        '................',
        '....SSSSSSSS....',
        '...SwwwwwwwwS...',
        '..SwwwwwwwwwwS..',
        '..SwWWWWWWWWwS..',
        '..SwWaaaaaaWwS..',
        '..SwWaaaaaaWwS..',
        '..SwWWWWWWWWwS..',
        '..SwwwwwwwwwwS..',
        '...SwwwwwwwwS...',
        '....SSSSSSSS....',
        '.......WW.......',
        '......WwwW......',
        '................',
    ]
    pal = {'S': '#5b5b5b', 'w': '#9d9d9d', 'W': '#6f6f6f', 'a': '#4f8fbf'}
    img = canvas16()
    img.alpha_composite(art_to_img(art, pal))
    return img


def bench_tile():
    art = [
        '................',
        '................',
        '................',
        '...WWWWWWWWWW...',
        '..WwwwwwwwwwwW..',
        '..WwwwwwwwwwwW..',
        '..WWWWWWWWWWWW..',
        '..W..........W..',
        '..W..........W..',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
    ]
    pal = {'W': '#6b482a', 'w': '#b07c4a'}
    img = canvas16()
    img.alpha_composite(art_to_img(art, pal))
    return img


def lamp_tile():
    art = [
        '................',
        '.....LLLL.......',
        '....LllllL......',
        '....LllllL......',
        '.....LLLL.......',
        '......WW........',
        '......Ww........',
        '......Ww........',
        '......Ww........',
        '.....WWWW.......',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
    ]
    pal = {'L': '#8a6a2a', 'l': '#ffe08a', 'W': '#5b3c22', 'w': '#8a5c34'}
    img = canvas16()
    img.alpha_composite(art_to_img(art, pal))
    return img


def sign_tile():
    art = [
        '................',
        '................',
        '................',
        '....WWWWWWWW....',
        '...WwwwwwwwwW...',
        '...WwWWWWWWwW...',
        '...WwwwwwwwwW...',
        '...WWWWWWWWWW...',
        '.......WW.......',
        '.......Ww.......',
        '.......Ww.......',
        '......WWWW......',
        '................',
        '................',
        '................',
        '................',
    ]
    pal = {'W': '#5b3c22', 'w': '#c39a6b'}
    img = canvas16()
    img.alpha_composite(art_to_img(art, pal))
    return img


def shop_tile():
    art = [
        '................',
        '....GGGGGGGG....',
        '...GaaaaaaaaG...',
        '..GaGGaGGaGGaG..',
        '..GaaaaaaaaaaG..',
        '..GaaaaaaaaaaG..',
        '..GaaWWWWWWaaG..',
        '..GaaWwwwwWaaG..',
        '..GaaWwddwWaaG..',
        '..GaaWwddwWaaG..',
        '..GaaWwwwwWaaG..',
        '..GaaWWWWWWaaG..',
        '..GaaaaaaaaaaG..',
        '..GaaaaaaaaaaG..',
        '..GGGGGGGGGGGG..',
        '..GGGGGGGGGGGG..',
    ]
    pal = {'G': '#4f7d8c', 'a': '#d9c9a3', 'W': '#6b482a', 'w': '#c39a6b', 'd': '#3a2a1a'}
    img = path_tile()
    img.alpha_composite(art_to_img(art, pal))
    return img


def bin_tile():
    """出货箱：把作物丢进去换钱。"""
    art = [
        '................',
        '................',
        '................',
        '................',
        '...WWWWWWWWWW...',
        '..WwwwwwwwwwwW..',
        '..WwWWWWWWWWwW..',
        '..WwWgggggwWwW..',
        '..WwWgggggwWwW..',
        '..WwWWWWWWWWwW..',
        '..WwwwwwwwwwwW..',
        '..WwWWWWWWWWwW..',
        '..WwwwwwwwwwwW..',
        '..WWWWWWWWWWWW..',
        '..WWWWWWWWWWWW..',
        '................',
    ]
    pal = {'W': '#5b3c22', 'w': '#8a5c34', 'g': '#c9a227'}
    img = grass_tile(51, False)
    img.alpha_composite(art_to_img(art, pal))
    return img


def bed_tile():
    art = [
        '................',
        '................',
        '................',
        '....WWWWWWWW....',
        '...WwwwwwwwwW...',
        '...WppppppppW...',
        '...WppppppppW...',
        '...WppppppppW...',
        '...WppppppppW...',
        '...WppppppppW...',
        '...WkkkkkkkkW...',
        '...WwwwwwwwwW...',
        '...WWWWWWWWWW...',
        '...WWWWWWWWWW...',
        '................',
        '................',
    ]
    pal = {'W': '#5b3c22', 'w': '#8a5c34', 'p': '#c9d6e8', 'k': '#f2c49b'}
    img = canvas16()
    d = ImageDraw.Draw(img)
    for y in range(LOGICAL):
        for x in range(LOGICAL):
            d.point((x, y), fill='#7a5c3a' if (x + y) % 6 < 2 else '#8a6a45')
    img.alpha_composite(art_to_img(art, pal))
    return img


# 顺序即帧索引，写进 tiles.frames.ts（唯一数据源，改这里要重跑脚本）
TILE_LIST = [
    ('grass_a', grass_tile(1, False)),
    ('grass_b', grass_tile(2, True)),
    ('grass_c', grass_tile(3, False)),
    ('wild', wild_grass_tile()),
    ('tilled_dry', tilled_tile(False)),
    ('tilled_wet', tilled_tile(True)),
    ('path', path_tile()),
    ('water', water_tile()),
    ('weed', weed_tile()),
    ('stone', stone_tile()),
    ('stump', stump_tile()),
    ('fence', fence_tile()),
    ('tree', tree_tile()),
    ('house', house_tile()),
    ('shop', shop_tile()),
    ('bin', bin_tile()),
    ('bed', bed_tile()),
    ('well', well_tile()),
    ('bench', bench_tile()),
    ('lamp', lamp_tile()),
    ('sign', sign_tile()),
]

TILE_COLS = 8


def build_tiles():
    rows = (len(TILE_LIST) + TILE_COLS - 1) // TILE_COLS
    sheet = blank_sheet(TILE_COLS, rows)
    for i, (name, img) in enumerate(TILE_LIST):
        paste_grid(sheet, up2(img), i % TILE_COLS, i // TILE_COLS)
    sheet.save(os.path.join(ASSETS, 'tiles.png'))

    lines = [
        '// 由 tools/gen_assets.py 生成 —— 请勿手改，改美术请改脚本后重跑 `npm run assets`。',
        '// 帧索引按图集行主序排列，与 Phaser spritesheet 的切帧规则一致。',
        '',
        'export const TILE_COLS = %d;' % TILE_COLS,
        '',
        'export const TILE = {',
    ]
    for i, (name, _img) in enumerate(TILE_LIST):
        lines.append('  %s: %d,' % (name, i))
    lines.append('} as const;')
    lines.append('')
    lines.append('export type TileName = keyof typeof TILE;')
    lines.append('')
    with open(os.path.join(GEN, 'tiles.frames.ts'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


# ---------------------------------------------------------------- 作物

SPROUT = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......g........',
    '......gGg.......',
    '.......g........',
    '.......s........',
    '................',
]

CROP_ART = {
    # 萝卜：矮丛叶 + 露出地面的红白根
    'radish': [
        '................',
        '................',
        '................',
        '................',
        '.......g........',
        '....g..g..g.....',
        '...gGg.gGg.g....',
        '...gGg.gGg.g....',
        '....g...g..g....',
        '......FFF.......',
        '......FfF.......',
        '......FFF.......',
        '.......F........',
        '................',
        '................',
        '................',
    ],
    # 豌豆：细藤 + 豆荚
    'pea': [
        '................',
        '................',
        '................',
        '.......g........',
        '......gGg.......',
        '.....g.g.g......',
        '....g..g..g.....',
        '...gGg.g..g.....',
        '..g..g..gGg.....',
        '..g..gDg..g.....',
        '..g.gDDg..g.....',
        '..g..DD...g.....',
        '..g...D...g.....',
        '...s.....s......',
        '................',
        '................',
    ],
    # 玉米：高杆 + 玉米棒
    'corn': [
        '................',
        '.......g........',
        '......gGg.......',
        '......gGg.......',
        '.....g.g.g......',
        '.....gGgGg......',
        '....C.gGg.C.....',
        '....CC.g.CC.....',
        '.....C.g.C......',
        '......g.g.......',
        '.....g...g......',
        '....g.....g.....',
        '....g.....g.....',
        '....g.....g.....',
        '................',
        '................',
    ],
    # 南瓜：矮藤 + 大果
    'pumpkin': [
        '................',
        '................',
        '................',
        '................',
        '................',
        '.......g........',
        '......gGg.......',
        '.....g...g......',
        '....g.....g.....',
        '...UUUUUUUUU....',
        '..UUHHUUHHUUU...',
        '..UUHHUUHHUUU...',
        '..UUUUUUUUUUU...',
        '...UUUUUUUUU....',
        '................',
        '................',
    ],
    # 草莓：低矮叶丛 + 三颗红果
    'strawberry': [
        '................',
        '................',
        '.......g........',
        '......gGg.......',
        '.....g.g.g......',
        '....gGg.gGg.....',
        '....g.....g.....',
        '...gFg...gFg....',
        '...FFF...FFF....',
        '...FFF...FFF....',
        '....F.....F.....',
        '.....s...s......',
        '......s.s.......',
        '.......s........',
        '................',
        '................',
    ],
    # 红薯：藤叶 + 露出地面的橙色块根
    'sweetpotato': [
        '................',
        '................',
        '................',
        '.......g........',
        '......gGg.......',
        '.....g...g......',
        '....gGg.gGg.....',
        '....g.....g.....',
        '.....g...g......',
        '......g.g.......',
        '...UUUUUUUUU....',
        '..UUHHUUHHUUU...',
        '..UUHHUUHHUUU...',
        '..UUUUUUUUUUU...',
        '...UUUUUUUUU....',
        '................',
    ],
}

CROP_ORDER = ['radish', 'pea', 'corn', 'pumpkin', 'strawberry', 'sweetpotato']
CROP_STAGES = 5     # 0..3 生长，4 = 枯萎


def crop_stage_art(name, stage):
    """阶段由成熟形态程序化派生 —— 每季只需画一张成熟图，阶段递进天然一致。"""
    mature = CROP_ART[name]
    if stage == 0:
        pal = dict(P)
        pal.update(CROP_FRUIT)
        return art_to_img(SPROUT, pal)
    if stage == 4:  # 枯萎：成熟形态去顶 + 全部褪成褐色
        art = cut_top(mature, 2)
        pal = dict(P)
        for k in ('g', 'G', 's', 'f'):
            pal[k] = '#8a7a45'
        for k in CROP_FRUIT:
            pal[k] = '#6f5c34'
        pal['H'] = '#5a4a28'
        return art_to_img(art, pal)
    # 1/2/3：越高阶段保留越多的上半部分；未成熟时果实位还是叶子
    cut = {1: 8, 2: 4, 3: 0}[stage]
    art = cut_top(mature, cut)
    if stage < 3:
        art = replace_chars(art, {k: 'g' for k in CROP_FRUIT})
        art = replace_chars(art, {'H': 'G'})
    pal = dict(P)
    pal.update(CROP_FRUIT)
    return art_to_img(art, pal)


def build_crops():
    sheet = blank_sheet(CROP_STAGES, len(CROP_ORDER))
    for r, name in enumerate(CROP_ORDER):
        for c in range(CROP_STAGES):
            paste_grid(sheet, up2(crop_stage_art(name, c)), c, r)
    sheet.save(os.path.join(ASSETS, 'crops.png'))


# ---------------------------------------------------------------- 角色

PLAYER_BODY = [
    '................',
    '.....hhhhhh.....',
    '....hhhhhhhh....',
    '....hkkkkkkh....',
    '....hkekkekh....',
    '....kkkkkkkk....',
    '.....kcccck.....',
    '...bbbbbbbbbb...',
    '...bbbbbbbbbb...',
    '..kbbbbbbbbbbk..',
    '..kbbbbbbbbbbk..',
    '...bbbbbbbbbb...',
    '....pppppppp....',
    '....pp....pp....',
    '....oo....oo....',
    '................',
]

NPC_BODY = [
    '................',
    '.....wwwwww.....',
    '....wwwwwwww....',
    '....wkkkkkkw....',
    '....wkekkekw....',
    '....kkkkkkkk....',
    '.....kcccck.....',
    '...vvvvvvvvvv...',
    '...vvvvvvvvvv...',
    '..kvvvvvvvvvvk..',
    '..kvvvvvvvvvvk..',
    '...vvvvvvvvvv...',
    '....pppppppp....',
    '....pp....pp....',
    '....oo....oo....',
    '................',
]


def facing_art(body, direction):
    """下 / 上 / 左 / 右 四向。上向把脸遮成后脑勺，左右把眼睛偏到一侧。"""
    if direction == 'down':
        return list(body)
    if direction == 'up':
        art = list(body)
        art[3] = '....hhhhhhhh....'
        art[4] = '....hhhhhhhh....'
        return art
    if direction == 'left':
        art = list(body)
        art[3] = '...hkkkkkkkh....'
        art[4] = '...hkekkkkh.....'
        art[9] = '.kbbbbbbbbbb....' if 'b' in art[9] else '.kvvvvvvvvvv....'
        art[10] = '.kbbbbbbbbbb....' if 'b' in art[10] else '.kvvvvvvvvvv....'
        return art
    return mirror_art(facing_art(body, 'left'))


def walk_art(art, frame):
    """4 帧走路循环：0/2 站立，1 左脚，3 右脚。"""
    art = list(art)
    if frame == 1:
        art[13] = '...pp....pp.....'
        art[14] = '...oo......oo...'
    elif frame == 3:
        art[13] = '.....pp....pp...'
        art[14] = '...oo......oo...'
    return art


DIRS = ['down', 'left', 'right', 'up']
FRAMES = 4


def build_actor(body, path):
    sheet = blank_sheet(FRAMES, len(DIRS))
    for r, d in enumerate(DIRS):
        base = facing_art(body, d)
        for c in range(FRAMES):
            img = art_to_img(walk_art(base, c), P)
            paste_grid(sheet, up2(img), c, r)
    sheet.save(path)


# ---------------------------------------------------------------- UI 图标

def icon_coin():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([2, 2, 13, 13], fill='#f2c53d', outline='#b98a1f')
    d.ellipse([4, 4, 11, 11], fill='#ffe08a')
    d.point((8, 5), fill='#b98a1f')
    d.point((8, 10), fill='#b98a1f')
    return img


def icon_energy():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.polygon([(9, 1), (4, 9), (8, 9), (6, 15), (12, 6), (8, 6)], fill='#f2e06a', outline='#c9a227')
    return img


def icon_water():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.polygon([(8, 1), (12, 8), (8, 14), (4, 8)], fill='#5f9ada')
    d.point((6, 7), fill='#a8d4f5')
    return img


def icon_hoe():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.line([(3, 13), (12, 4)], fill='#8a5c34', width=1)
    d.polygon([(11, 2), (15, 3), (14, 6), (10, 6)], fill='#9d9d9d')
    return img


def icon_seed():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.polygon([(3, 6), (13, 6), (12, 14), (4, 14)], fill='#c9a06b')
    d.rectangle([3, 4, 13, 6], fill='#a8804f')
    for (x, y) in ((6, 3), (9, 3)):
        d.point((x, y), fill='#6cbf4a')
    return img


def icon_calendar():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.rectangle([2, 3, 13, 14], fill='#f4ead8', outline='#6b482a')
    d.rectangle([2, 3, 13, 6], fill='#a4453a')
    for x in (5, 8, 11):
        d.point((x, 1), fill='#6b482a')
    for y in (8, 11):
        for x in (4, 7, 10):
            d.point((x, y), fill='#8a7a45')
    return img


def icon_star(gold):
    img = canvas16()
    d = ImageDraw.Draw(img)
    c = '#f2c53d' if gold else '#c8cdd4'
    o = '#b98a1f' if gold else '#8f959d'
    d.polygon([(8, 1), (10, 6), (15, 6), (11, 9), (12, 14), (8, 11), (4, 14), (5, 9), (1, 6), (6, 6)],
              fill=c, outline=o)
    return img


def icon_gift():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.rectangle([2, 6, 13, 14], fill='#d9534f')
    d.rectangle([2, 4, 13, 6], fill='#c13f3b')
    d.rectangle([7, 4, 8, 14], fill='#f2e06a')
    d.polygon([(7, 1), (9, 1), (9, 4), (7, 4)], fill='#f2e06a')
    d.polygon([(1, 1), (6, 1), (6, 4), (1, 4)], fill='#f2e06a')
    d.polygon([(9, 1), (14, 1), (14, 4), (9, 4)], fill='#f2e06a')
    return img


def icon_heart():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([2, 3, 8, 9], fill='#e05252')
    d.ellipse([7, 3, 13, 9], fill='#e05252')
    d.polygon([(2, 7), (13, 7), (8, 14)], fill='#e05252')
    return img


def icon_sun():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 11, 11], fill='#f2c53d')
    for (x, y) in ((8, 1), (8, 14), (1, 8), (14, 8), (3, 3), (12, 12), (12, 3), (3, 12)):
        d.point((x, y), fill='#ffe08a')
    return img


def icon_rain():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([2, 3, 13, 9], fill='#8f959d')
    d.ellipse([5, 2, 11, 7], fill='#b8bfc7')
    for (x, y) in ((4, 10), (7, 11), (10, 10), (6, 13), (9, 13)):
        d.point((x, y), fill='#5f9ada')
        d.point((x, y + 1), fill='#5f9ada')
    return img


def icon_snow():
    img = canvas16()
    d = ImageDraw.Draw(img)
    for i in range(16):
        d.point((8, i), fill='#a8d4f5')
    for (x, y) in ((3, 3), (12, 3), (3, 12), (12, 12)):
        d.point((x, y), fill='#a8d4f5')
    d.line([(2, 2), (13, 13)], fill='#cfe6f7')
    d.line([(13, 2), (2, 13)], fill='#cfe6f7')
    return img


def icon_leaf():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.polygon([(8, 14), (3, 6), (13, 6)], fill='#6cbf4a')
    d.line([(8, 13), (8, 4)], fill='#4a9136')
    return img


def icon_sprout():
    img = art_to_img(SPROUT, P)
    return img


def icon_clock():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([2, 2, 13, 13], fill='#f4ead8', outline='#6b482a')
    d.line([(8, 8), (8, 4)], fill='#6b482a')
    d.line([(8, 8), (11, 9)], fill='#6b482a')
    return img


def icon_basket():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.polygon([(2, 6), (13, 6), (12, 14), (3, 14)], fill='#c9a06b')
    d.line([(2, 6), (13, 6)], fill='#8a5c34')
    d.arc([4, 2, 11, 8], 180, 360, fill='#8a5c34')
    for (x, y) in ((5, 8), (8, 9), (10, 8)):
        d.point((x, y), fill='#d94f4f')
    return img


def icon_hoe_up():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.line([(4, 12), (11, 5)], fill='#a2764c', width=2)
    d.polygon([(10, 2), (15, 3), (14, 7), (9, 6)], fill='#c8cdd4')
    d.point((13, 4), fill='#ffffff')
    return img


def icon_can():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.rectangle([3, 5, 12, 13], fill='#7a9db5')
    d.rectangle([3, 4, 12, 6], fill='#5f8098')
    d.line([(12, 6), (15, 3)], fill='#5f8098')
    for (x, y) in ((6, 8), (8, 8), (6, 10), (8, 10)):
        d.point((x, y), fill='#a8d4f5')
    return img


UI_LIST = [
    ('coin', icon_coin()),
    ('energy', icon_energy()),
    ('water', icon_water()),
    ('hoe', icon_hoe()),
    ('seed', icon_seed()),
    ('calendar', icon_calendar()),
    ('star_silver', icon_star(False)),
    ('star_gold', icon_star(True)),
    ('gift', icon_gift()),
    ('heart', icon_heart()),
    ('sun', icon_sun()),
    ('rain', icon_rain()),
    ('snow', icon_snow()),
    ('leaf', icon_leaf()),
    ('sprout', icon_sprout()),
    ('clock', icon_clock()),
    ('basket', icon_basket()),
    ('hoe_up', icon_hoe_up()),
    ('can', icon_can()),
    ('radish', crop_stage_art('radish', 3)),
    ('pea', crop_stage_art('pea', 3)),
    ('corn', crop_stage_art('corn', 3)),
    ('pumpkin', crop_stage_art('pumpkin', 3)),
    ('strawberry', crop_stage_art('strawberry', 3)),
    ('sweetpotato', crop_stage_art('sweetpotato', 3)),
    ('withered', crop_stage_art('radish', 4)),
]

UI_COLS = 8


def build_ui():
    rows = (len(UI_LIST) + UI_COLS - 1) // UI_COLS
    sheet = blank_sheet(UI_COLS, rows)
    for i, (name, img) in enumerate(UI_LIST):
        paste_grid(sheet, up2(img), i % UI_COLS, i // UI_COLS)
    sheet.save(os.path.join(ASSETS, 'ui.png'))

    lines = [
        '// 由 tools/gen_assets.py 生成 —— 请勿手改。',
        '',
        'export const UI = {',
    ]
    for i, (name, _img) in enumerate(UI_LIST):
        lines.append('  %s: %d,' % (name, i))
    lines.append('} as const;')
    lines.append('')
    with open(os.path.join(GEN, 'ui.frames.ts'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


# ---------------------------------------------------------------- PWA 图标

def draw_logo(S, maskable=False):
    """母版 1024：太阳 + 田垄 + 幼苗。maskable 版本整体内缩到安全区。"""
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    # 背景：天空渐变（上浅下深）
    for y in range(S):
        t = y / max(1, S - 1)
        r = int(126 + (94 - 126) * t)
        g = int(200 + (150 - 200) * t)
        b = int(96 + (72 - 96) * t)
        d.line([(0, y), (S, y)], fill=(r, g, b, 255))
    # 地面
    d.rectangle([0, int(S * 0.62), S, S], fill=(112, 74, 44, 255))
    d.rectangle([0, int(S * 0.62), S, int(S * 0.66)], fill=(94, 148, 62, 255))

    scale = 0.74 if maskable else 1.0
    cx = S / 2
    cy = S / 2
    R = S * 0.5 * scale

    # 太阳
    sr = R * 0.30
    d.ellipse([cx - sr, cy - R * 0.44 - sr, cx + sr, cy - R * 0.44 + sr], fill=(255, 214, 92, 255))
    # 光芒
    import math
    for i in range(12):
        a = math.pi * 2 * i / 12
        x1 = cx + math.cos(a) * sr * 1.18
        y1 = cy - R * 0.44 + math.sin(a) * sr * 1.18
        x2 = cx + math.cos(a) * sr * 1.42
        y2 = cy - R * 0.44 + math.sin(a) * sr * 1.42
        d.line([(x1, y1), (x2, y2)], fill=(255, 230, 150, 255), width=max(2, int(S * 0.012)))

    # 田垄：三条由远及近的弧
    for i, (yy, rr, col) in enumerate((
        (0.72, 0.42, (94, 66, 38)),
        (0.84, 0.52, (110, 78, 46)),
        (0.96, 0.62, (126, 90, 54)),
    )):
        y0 = cy + R * (yy - 0.5) * 1.1
        w = R * rr
        d.pieslice([cx - w, y0 - w * 0.55, cx + w, y0 + w * 0.55], 0, 180, fill=col)

    # 三株幼苗
    for i, off in enumerate((-0.30, 0.0, 0.30)):
        x = cx + R * off
        base = cy + R * (0.80 - 0.5) * 1.1 - R * 0.02
        hgt = R * (0.26 if i == 1 else 0.20)
        d.line([(x, base), (x, base - hgt)], fill=(58, 111, 40, 255), width=max(3, int(S * 0.022)))
        d.ellipse([x - hgt * 0.55, base - hgt * 1.25, x - hgt * 0.05, base - hgt * 0.62],
                  fill=(108, 191, 74, 255))
        d.ellipse([x + hgt * 0.05, base - hgt * 1.25, x + hgt * 0.55, base - hgt * 0.62],
                  fill=(74, 145, 54, 255))
    return bg


def build_icons():
    master = draw_logo(1024, maskable=False)
    master_mask = draw_logo(1024, maskable=True)

    def save(img, size, name):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, name))

    save(master, 512, 'icon-512.png')
    save(master, 192, 'icon-192.png')
    save(master_mask, 512, 'icon-maskable-512.png')

    # iOS 主屏图标必须不透明，否则会被填成黑底
    opaque = Image.new('RGBA', master.size, (94, 148, 62, 255))
    opaque.alpha_composite(master)
    opaque.resize((180, 180), Image.LANCZOS).convert('RGB').save(
        os.path.join(ICONS, 'apple-touch-icon-180.png'))
    opaque.resize((32, 32), Image.LANCZOS).convert('RGB').save(os.path.join(ICONS, 'favicon-32.png'))


SPLASH_SPECS = [
    # (文件名, 物理宽, 物理高, CSS 宽, CSS 高, dpr)
    ('splash-iphone-se-750x1334.png', 750, 1334, 375, 667, 2),
    ('splash-iphone-x-1125x2436.png', 1125, 2436, 375, 812, 3),
    ('splash-iphone13-1170x2532.png', 1170, 2532, 390, 844, 3),
    ('splash-iphone15pro-1179x2556.png', 1179, 2556, 393, 852, 3),
    ('splash-iphone15promax-1290x2796.png', 1290, 2796, 430, 932, 3),
    ('splash-ipad-1536x2048.png', 1536, 2048, 768, 1024, 2),
]


def build_splash():
    """iOS 启动图：深色底 + 居中 logo，避免冷启动白闪。"""
    master = draw_logo(1024, maskable=False)
    for name, w, h, _cw, _ch, _dpr in SPLASH_SPECS:
        bg = Image.new('RGBA', (w, h), (26, 34, 24, 255))
        side = int(min(w, h) * 0.42)
        logo = master.resize((side, side), Image.LANCZOS)
        bg.alpha_composite(logo, ((w - side) // 2, (h - side) // 2))
        bg.convert('RGB').save(os.path.join(SPLASH, name))


# ---------------------------------------------------------------- 主流程

def main():
    build_tiles()
    build_crops()
    build_actor(PLAYER_BODY, os.path.join(ASSETS, 'player.png'))
    build_actor(NPC_BODY, os.path.join(ASSETS, 'npc.png'))
    build_ui()
    build_icons()
    build_splash()
    print('assets  ->', ASSETS)
    print('icons   ->', ICONS)
    print('splash  ->', SPLASH)
    print('frames  ->', GEN)
    for f in sorted(os.listdir(ASSETS)):
        p = os.path.join(ASSETS, f)
        print('  %-14s %6d B' % (f, os.path.getsize(p)))
    print('  %-14s %6d B' % ('icons/', sum(
        os.path.getsize(os.path.join(ICONS, f)) for f in os.listdir(ICONS))))


if __name__ == '__main__':
    main()
