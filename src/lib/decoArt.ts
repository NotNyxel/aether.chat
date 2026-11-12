/**
 * Expressive avatar decorations (ears, hats, anime marks, outfits) and illustrated profile frames
 * (clouds, spray paint, lace, tape…). All original SVG, recoloured with the user's colour picks
 * (users.decor.deco = [main, second]). Rendered through CSS backgrounds, so no extra components:
 * avatar → .ae-avatar[data-deco]::after, card → .ae-card[data-cfs='art']::after.
 */

export const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const wrap = (body: string, vb = '0 0 120 120') => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}'>${body}</svg>`;
const float = (dy = 3, dur = 2.4) => `<animateTransform attributeName='transform' type='translate' values='0 0;0 -${dy};0 0' dur='${dur}s' repeatCount='indefinite'/>`;

// Avatar box: the decoration layer is 140% of the avatar, so the head is a circle at (60,60) r≈43.
export interface AvatarDeco {
  id: string;
  label: string;
  group: string;
  colors: [string, string];
  svg: (c: string, d: string) => string;
}

export const AVATAR_DECOS: AvatarDeco[] = [
  // ── Ears & horns ──
  { id: 'dc-cat', label: 'Cat Ears', group: 'Ears & horns', colors: ['#2b2b33', '#ff9ec7'], svg: (c, d) => wrap(`<path d='M20 44 26 6 54 24Z' fill='${c}'/><path d='M27 36 30 16 46 26Z' fill='${d}'/><path d='M100 44 94 6 66 24Z' fill='${c}'/><path d='M93 36 90 16 74 26Z' fill='${d}'/>`) },
  { id: 'dc-fox', label: 'Fox Ears', group: 'Ears & horns', colors: ['#f08a3c', '#fff4e6'], svg: (c, d) => wrap(`<path d='M18 46 18 0 54 22Z' fill='${c}'/><path d='M18 6 18 0 26 5Z' fill='${d}'/><path d='M24 38 24 14 44 26Z' fill='${d}'/><path d='M102 46 102 0 66 22Z' fill='${c}'/><path d='M102 6 102 0 94 5Z' fill='${d}'/><path d='M96 38 96 14 76 26Z' fill='${d}'/>`) },
  { id: 'dc-bunny', label: 'Bunny Ears', group: 'Ears & horns', colors: ['#f4f4fb', '#ffb3cf'], svg: (c, d) => wrap(`<g><ellipse cx='42' cy='4' rx='9' ry='28' fill='${c}' transform='rotate(-14 42 30)'/><ellipse cx='42' cy='6' rx='4' ry='20' fill='${d}' transform='rotate(-14 42 30)'/><ellipse cx='78' cy='4' rx='9' ry='28' fill='${c}' transform='rotate(14 78 30)'/><ellipse cx='78' cy='6' rx='4' ry='20' fill='${d}' transform='rotate(14 78 30)'/>${float(2, 3)}</g>`) },
  { id: 'dc-bear', label: 'Bear Ears', group: 'Ears & horns', colors: ['#8a5a3c', '#e8b98f'], svg: (c, d) => wrap(`<circle cx='28' cy='26' r='14' fill='${c}'/><circle cx='28' cy='26' r='7' fill='${d}'/><circle cx='92' cy='26' r='14' fill='${c}'/><circle cx='92' cy='26' r='7' fill='${d}'/>`) },
  { id: 'dc-devil', label: 'Devil Horns', group: 'Ears & horns', colors: ['#e5293e', '#7a0f1f'], svg: (c, d) => wrap(`<path d='M30 32C22 22 20 10 26 2c2 10 10 16 18 18Z' fill='${c}' stroke='${d}' stroke-width='1.5'/><path d='M90 32c8-10 10-22 4-30-2 10-10 16-18 18Z' fill='${c}' stroke='${d}' stroke-width='1.5'/>`) },
  { id: 'dc-unicorn', label: 'Unicorn Horn', group: 'Ears & horns', colors: ['#ffd166', '#ff8fd8'], svg: (c, d) => wrap(`<path d='M52 22 60 -2 68 22Z' fill='${c}'/><path d='M54 16 66 13M55 10 65 7M57 4 63 2' stroke='${d}' stroke-width='2'/><circle cx='60' cy='0' r='3' fill='#fff'><animate attributeName='opacity' values='1;.2;1' dur='1.6s' repeatCount='indefinite'/></circle>`) },
  { id: 'dc-antlers', label: 'Antlers', group: 'Ears & horns', colors: ['#a8794e', '#6b4a2e'], svg: (c, d) => wrap(`<path d='M36 30C30 20 26 12 18 8M28 16 20 18M32 22 22 26M84 30c6-10 10-18 18-22M92 16l8 2M88 22l10 4' stroke='${c}' stroke-width='5' stroke-linecap='round' fill='none'/><path d='M36 30C30 20 26 12 18 8M84 30c6-10 10-18 18-22' stroke='${d}' stroke-width='1.5' fill='none'/>`) },
  // ── Hats & headwear ──
  { id: 'dc-halo', label: 'Halo', group: 'Hats & headwear', colors: ['#ffe27a', '#fff8d6'], svg: (c, d) => wrap(`<g><ellipse cx='60' cy='10' rx='26' ry='7' fill='none' stroke='${c}' stroke-width='5'/><ellipse cx='60' cy='10' rx='26' ry='7' fill='none' stroke='${d}' stroke-width='1.5'/>${float(4, 2.6)}</g>`) },
  { id: 'dc-crown', label: 'Crown', group: 'Hats & headwear', colors: ['#f7c948', '#e5293e'], svg: (c, d) => wrap(`<path d='M34 28 30 4 46 16 60 0 74 16 90 4 86 28Z' fill='${c}' stroke='#9a6b00' stroke-width='1.5'/><circle cx='60' cy='18' r='4' fill='${d}'/><circle cx='44' cy='21' r='3' fill='${d}'/><circle cx='76' cy='21' r='3' fill='${d}'/>`) },
  { id: 'dc-flowers', label: 'Flower Crown', group: 'Hats & headwear', colors: ['#ff8fb8', '#ffe066'], svg: (c, d) => wrap(`<path d='M22 34Q60 6 98 34' stroke='#5c9b4a' stroke-width='3' fill='none'/>${[[24, 32], [40, 21], [60, 17], [80, 21], [96, 32]].map(([x, y], i) => `<g transform='translate(${x} ${y})'>${[0, 72, 144, 216, 288].map((a) => `<circle cx='${Math.cos((a * Math.PI) / 180) * 5}' cy='${Math.sin((a * Math.PI) / 180) * 5}' r='4' fill='${i % 2 ? d : c}'/>`).join('')}<circle r='2.5' fill='#fff'/></g>`).join('')}`) },
  { id: 'dc-santa', label: 'Santa Hat', group: 'Hats & headwear', colors: ['#d62839', '#ffffff'], svg: (c, d) => wrap(`<path d='M28 30C34 8 62 -2 92 10L80 30Z' fill='${c}'/><path d='M92 10Q104 18 100 34' stroke='${c}' stroke-width='9' fill='none'/><circle cx='100' cy='36' r='7' fill='${d}'/><rect x='24' y='26' width='62' height='11' rx='5.5' fill='${d}'/>`) },
  { id: 'dc-witch', label: 'Witch Hat', group: 'Hats & headwear', colors: ['#3b2063', '#ff9f1c'], svg: (c, d) => wrap(`<ellipse cx='60' cy='30' rx='42' ry='8' fill='${c}'/><path d='M40 30 66 -6 72 2 80 30Z' fill='${c}'/><rect x='40' y='22' width='40' height='7' fill='${d}'/><rect x='56' y='21' width='8' height='9' rx='1.5' fill='none' stroke='#ffd166' stroke-width='2'/>`) },
  { id: 'dc-party', label: 'Party Hat', group: 'Hats & headwear', colors: ['#7c5cff', '#ffd166'], svg: (c, d) => wrap(`<g transform='rotate(14 70 20)'><path d='M54 34 70 -4 86 34Z' fill='${c}'/><path d='M60 20h20M57 27h26M64 11h12' stroke='${d}' stroke-width='3'/><circle cx='70' cy='-5' r='5' fill='${d}'/></g>`) },
  { id: 'dc-beanie', label: 'Beanie', group: 'Hats & headwear', colors: ['#2ec4b6', '#f4f4fb'], svg: (c, d) => wrap(`<path d='M22 34Q22 4 60 4T98 34Z' fill='${c}'/><rect x='20' y='28' width='80' height='10' rx='4' fill='${d}'/><path d='M30 28V20M40 28V14M50 28V10M60 28V9M70 28V10M80 28V14M90 28V20' stroke='#0003' stroke-width='2'/><circle cx='60' cy='4' r='6' fill='${d}'/>`) },
  { id: 'dc-maid', label: 'Maid Headband', group: 'Hats & headwear', colors: ['#ffffff', '#1d1d24'], svg: (c, d) => wrap(`<path d='M24 32Q60 4 96 32' stroke='${d}' stroke-width='6' fill='none'/>${Array.from({ length: 9 }, (_, i) => { const t = Math.PI * (1.08 + (i / 8) * 0.84); const x = 60 + Math.cos(t) * 40; const y = 40 + Math.sin(t) * 28; return `<circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='6' fill='${c}' stroke='#c9c9d6' stroke-width='1'/>`; }).join('')}`) },
  { id: 'dc-bow', label: 'Big Bow', group: 'Hats & headwear', colors: ['#ff4d8d', '#c2185b'], svg: (c, d) => wrap(`<g transform='rotate(18 90 20)'><path d='M90 20 70 6Q66 20 70 34Z' fill='${c}'/><path d='M90 20 110 6Q114 20 110 34Z' fill='${c}'/><path d='M88 22 80 40 86 38 90 30 94 38 100 40 92 22' fill='${d}'/><circle cx='90' cy='20' r='5' fill='${d}'/></g>`) },
  { id: 'dc-headphones', label: 'Headphones', group: 'Hats & headwear', colors: ['#2b2b33', '#7c5cff'], svg: (c, d) => wrap(`<path d='M18 66C14 26 106 26 102 66' stroke='${c}' stroke-width='7' fill='none'/><rect x='8' y='56' width='16' height='28' rx='7' fill='${c}'/><rect x='96' y='56' width='16' height='28' rx='7' fill='${c}'/><rect x='12' y='62' width='8' height='16' rx='4' fill='${d}'/><rect x='100' y='62' width='8' height='16' rx='4' fill='${d}'/>`) },
  { id: 'dc-snowcap', label: 'Snow Cap', group: 'Hats & headwear', colors: ['#ffffff', '#cfe8ff'], svg: (c, d) => wrap(`<path d='M18 40Q20 18 38 16Q46 6 60 10Q74 4 84 14Q100 14 102 40Q90 30 78 34Q68 26 58 32Q46 26 38 34Q28 30 18 40Z' fill='${c}' stroke='${d}' stroke-width='1.5'/>`) },
  { id: 'dc-fire', label: 'Fire Crown', group: 'Hats & headwear', colors: ['#ff7b00', '#ffd23f'], svg: (c, d) => wrap(`<g><path d='M26 34C24 22 34 18 32 6 42 14 44 4 52 0 52 12 62 8 64 0 70 10 80 6 82 14 90 10 92 22 96 28 94 34Z' fill='${c}'/><path d='M36 34C36 26 42 24 42 16 48 22 52 14 58 12 58 20 66 18 70 12 72 22 80 22 82 34Z' fill='${d}'/><animateTransform attributeName='transform' type='scale' values='1 1;1 1.06;1 1' dur='.8s' repeatCount='indefinite' additive='sum'/></g>`) },
  // ── Expressions ──
  { id: 'dc-anger', label: 'Anger Mark', group: 'Expressions', colors: ['#e5293e', '#ff8a8a'], svg: (c, d) => wrap(`<g transform='translate(92 22)'><g><path d='M-12-4Q-4-4-4-12M4-12Q4-4 12-4M12 4Q4 4 4 12M-4 12Q-4 4-12 4' stroke='${c}' stroke-width='4.5' fill='none' stroke-linecap='round'/><path d='M-12-4Q-4-4-4-12M4-12Q4-4 12-4' stroke='${d}' stroke-width='1.2' fill='none'/><animateTransform attributeName='transform' type='scale' values='1;1.25;1' dur='.9s' repeatCount='indefinite'/></g></g>`) },
  { id: 'dc-sweat', label: 'Sweat Drop', group: 'Expressions', colors: ['#7cc8ff', '#ffffff'], svg: (c, d) => wrap(`<g><path d='M96 18C96 18 86 32 86 38A10 10 0 0 0 106 38C106 32 96 18 96 18Z' fill='${c}' stroke='#3c8fd6' stroke-width='1.5'/><ellipse cx='92' cy='37' rx='2' ry='4' fill='${d}'/><animateTransform attributeName='transform' type='translate' values='0 0;0 6;0 0' dur='1.8s' repeatCount='indefinite'/></g>`) },
  { id: 'dc-tears', label: 'Crying', group: 'Expressions', colors: ['#7cc8ff', '#3c8fd6'], svg: (c, d) => wrap(`${[44, 76].map((x) => `<path d='M${x} 64Q${x - 2} 84 ${x} 100' stroke='${c}' stroke-width='5' stroke-linecap='round' fill='none' opacity='.85'/><circle cx='${x}' cy='70' r='3' fill='${d}'><animate attributeName='cy' values='66;102' dur='1.1s' repeatCount='indefinite'/><animate attributeName='opacity' values='1;0' dur='1.1s' repeatCount='indefinite'/></circle>`).join('')}`) },
  { id: 'dc-blush', label: 'Blush', group: 'Expressions', colors: ['#ff7aa8', '#e5293e'], svg: (c, d) => wrap(`${[38, 82].map((x) => `<ellipse cx='${x}' cy='76' rx='9' ry='5' fill='${c}' opacity='.65'/><path d='M${x - 5} 79l3-6M${x - 1} 79l3-6M${x + 3} 79l3-6' stroke='${d}' stroke-width='1.3' opacity='.7'/>`).join('')}`) },
  { id: 'dc-zzz', label: 'Sleepy', group: 'Expressions', colors: ['#c7b8ff', '#7c5cff'], svg: (c, d) => wrap(`${[0, 1, 2].map((i) => `<text x='${86 + i * 8}' y='${30 - i * 10}' font-family='Arial Black,Arial' font-weight='900' font-size='${10 + i * 3}' fill='${i % 2 ? d : c}'>Z<animate attributeName='opacity' values='0;1;0' dur='2.4s' begin='${i * 0.5}s' repeatCount='indefinite'/></text>`).join('')}`) },
  { id: 'dc-question', label: 'Confused', group: 'Expressions', colors: ['#ffd166', '#f08a3c'], svg: (c, d) => wrap(`<g><text x='88' y='34' font-family='Arial Black,Arial' font-weight='900' font-size='30' fill='${c}' stroke='${d}' stroke-width='1.5'>?</text>${float(4, 1.4)}</g>`) },
  { id: 'dc-shock', label: 'Shocked', group: 'Expressions', colors: ['#e5293e', '#ffd166'], svg: (c, d) => wrap(`<g><text x='90' y='34' font-family='Arial Black,Arial' font-weight='900' font-size='30' fill='${c}' stroke='${d}' stroke-width='1.5'>!</text><animateTransform attributeName='transform' type='rotate' values='-6 96 24;6 96 24;-6 96 24' dur='.5s' repeatCount='indefinite'/></g>`) },
  { id: 'dc-hearts', label: 'In Love', group: 'Expressions', colors: ['#ff4d8d', '#ff9ec7'], svg: (c, d) => wrap(`${[[22, 30, 0], [96, 22, 0.6], [104, 52, 1.2]].map(([x, y, b], i) => `<path d='M${x} ${y + 4}l-6-6a3.6 3.6 0 0 1 6-4 3.6 3.6 0 0 1 6 4z' fill='${i % 2 ? d : c}'><animateTransform attributeName='transform' type='translate' values='0 0;0 -8' dur='2s' begin='${b}s' repeatCount='indefinite'/><animate attributeName='opacity' values='0;1;0' dur='2s' begin='${b}s' repeatCount='indefinite'/></path>`).join('')}`) },
  { id: 'dc-steam', label: 'Fuming', group: 'Expressions', colors: ['#e8e8f0', '#b9b9c8'], svg: (c, d) => wrap(`${[16, 104].map((x, i) => `<g><circle cx='${x}' cy='30' r='7' fill='${c}'/><circle cx='${x + (i ? 5 : -5)}' cy='22' r='5' fill='${c}'/><circle cx='${x}' cy='14' r='4' fill='${d}'/><animateTransform attributeName='transform' type='translate' values='0 4;0 -4;0 4' dur='1.2s' repeatCount='indefinite'/></g>`).join('')}`) },
  { id: 'dc-dizzy', label: 'Dizzy', group: 'Expressions', colors: ['#ffd166', '#ffffff'], svg: (c, d) => wrap(`<g>${[0, 120, 240].map((a) => `<path transform='rotate(${a} 60 22) translate(60 6)' d='M0-5 1.5-1.5 5 0 1.5 1.5 0 5-1.5 1.5-5 0-1.5-1.5Z' fill='${a ? c : d}'/>`).join('')}<animateTransform attributeName='transform' type='rotate' values='0 60 22;360 60 22' dur='2.4s' repeatCount='indefinite'/></g><ellipse cx='60' cy='22' rx='30' ry='8' fill='none' stroke='${c}' stroke-width='1' stroke-dasharray='3 4' opacity='.6'/>`) },
  { id: 'dc-idea', label: 'Idea', group: 'Expressions', colors: ['#ffe27a', '#ffffff'], svg: (c, d) => wrap(`<g><circle cx='60' cy='4' r='9' fill='${c}'/><rect x='56' y='12' width='8' height='6' rx='1.5' fill='#9aa0b4'/><path d='M60-12V-7M44-4l4 3M76-4l-4 3' stroke='${c}' stroke-width='2.5' stroke-linecap='round'/><circle cx='57' cy='1' r='2.5' fill='${d}'/><animate attributeName='opacity' values='1;.6;1' dur='1.2s' repeatCount='indefinite'/></g>`, '0 -20 120 140') },
  { id: 'dc-raincloud', label: 'Rain Cloud', group: 'Expressions', colors: ['#9aa6bd', '#7cc8ff'], svg: (c, d) => wrap(`<g><circle cx='50' cy='-2' r='10' fill='${c}'/><circle cx='64' cy='-6' r='12' fill='${c}'/><circle cx='76' cy='0' r='9' fill='${c}'/><rect x='42' y='-2' width='42' height='10' rx='5' fill='${c}'/>${[52, 62, 72].map((x, i) => `<path d='M${x} 12v6' stroke='${d}' stroke-width='2.5' stroke-linecap='round'><animate attributeName='opacity' values='0;1;0' dur='.9s' begin='${i * 0.3}s' repeatCount='indefinite'/></path>`).join('')}${float(2, 3)}</g>`, '0 -20 120 140') },
  { id: 'dc-butterflies', label: 'Butterflies', group: 'Expressions', colors: ['#7cc8ff', '#ff9ec7'], svg: (c, d) => wrap(`${[[16, 40, c], [104, 30, d]].map(([x, y, col], i) => `<g transform='translate(${x} ${y})'><g><ellipse cx='-5' cy='-3' rx='5' ry='6' fill='${col}'/><ellipse cx='5' cy='-3' rx='5' ry='6' fill='${col}'/><ellipse cx='-4' cy='5' rx='3.5' ry='4' fill='${col}'/><ellipse cx='4' cy='5' rx='3.5' ry='4' fill='${col}'/><rect x='-1' y='-6' width='2' height='14' rx='1' fill='#2b2b33'/><animateTransform attributeName='transform' type='scale' values='1 1;.4 1;1 1' dur='${0.5 + i * 0.1}s' repeatCount='indefinite'/></g></g>`).join('')}`) },
  // ── Outfits ──
  { id: 'dc-maidcollar', label: 'Maid Outfit', group: 'Outfits', colors: ['#ffffff', '#1d1d24'], svg: (c, d) => wrap(`<path d='M24 96Q60 124 96 96L104 112Q60 136 16 112Z' fill='${d}'/>${Array.from({ length: 9 }, (_, i) => { const x = 22 + i * 9.5; const y = 99 + Math.sin((i / 8) * Math.PI) * 9; return `<circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='5.5' fill='${c}' stroke='#c9c9d6' stroke-width='.8'/>`; }).join('')}<path d='M60 108 50 100Q48 108 50 116ZM60 108 70 100Q72 108 70 116Z' fill='#e5293e'/><circle cx='60' cy='108' r='3' fill='#a5162b'/>`) },
  { id: 'dc-bowtie', label: 'Bow Tie', group: 'Outfits', colors: ['#1d1d24', '#7c5cff'], svg: (c, d) => wrap(`<path d='M60 108 42 98V118ZM60 108 78 98V118Z' fill='${c}'/><rect x='55' y='103' width='10' height='10' rx='3' fill='${d}'/>`) },
  { id: 'dc-scarf', label: 'Scarf', group: 'Outfits', colors: ['#e5293e', '#ffffff'], svg: (c, d) => wrap(`<path d='M22 94Q60 116 98 94L100 106Q60 128 20 106Z' fill='${c}'/><path d='M80 104 86 130 98 128 92 102Z' fill='${c}'/><path d='M30 100 32 108M42 104 44 112M54 106 55 114M66 106 66 114M78 104 77 112M90 100 88 108M84 116h10M86 122h10' stroke='${d}' stroke-width='3'/>`) },
];
const DECO_BY_ID = new Map(AVATAR_DECOS.map((d) => [d.id, d]));
export function avatarDecoStyle(id: string | null | undefined, colors?: string[] | null): Record<string, string> | null {
  const d = id ? DECO_BY_ID.get(id) : undefined;
  if (!d) return null;
  return { '--deco-art': svgUrl(d.svg(colors?.[0] ?? d.colors[0], colors?.[1] ?? d.colors[1])) };
}

// ── Illustrated profile frames ──────────────────────────────────────────────────────────────
interface Layer {
  svg?: string;
  css?: string; // a raw CSS gradient instead of an SVG
  pos: string;
  size: string;
  repeat?: string;
}
export interface CardArt {
  id: string;
  label: string;
  group: string;
  colors: [string, string];
  layers: (c: string, d: string) => Layer[];
}

const corner = (body: string, size = '110px'): Layer[] =>
  (
    [
      ['top left', ''],
      ['top right', 'translate(100 0) scale(-1 1)'],
      ['bottom left', 'translate(0 100) scale(1 -1)'],
      ['bottom right', 'translate(100 100) scale(-1 -1)'],
    ] as const
  ).map(([pos, t]) => ({ svg: sq(t ? `<g transform='${t}'>${body}</g>` : body), pos, size }));
const sq = (body: string) => wrap(body, '0 0 100 100');
// Deterministic "random" dots for spray paint and splatter.
const dots = (n: number, seed: number, spread: number, color: string, maxR: number) => {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => {
    const a = r() * Math.PI * 0.5;
    const dist = Math.pow(r(), 1.6) * spread;
    return `<circle cx='${(Math.cos(a) * dist).toFixed(1)}' cy='${(Math.sin(a) * dist).toFixed(1)}' r='${(0.4 + r() * maxR * (1 - dist / spread)).toFixed(2)}' fill='${color}'/>`;
  }).join('');
};

export const CARD_ARTS: CardArt[] = [
  { id: 'ca-clouds', label: 'Clouds', group: 'Illustrated', colors: ['#ffffff', '#cfe0ff'], layers: (c, d) => corner((`<g fill='${c}' stroke='${d}' stroke-width='1.5'><circle cx='10' cy='22' r='18'/><circle cx='32' cy='10' r='16'/><circle cx='54' cy='4' r='12'/><circle cx='6' cy='44' r='13'/></g>`), '130px') },
  { id: 'ca-spray', label: 'Spray Paint', group: 'Illustrated', colors: ['#ff3cac', '#00d4ff'], layers: (c, d) => corner((`<g filter='url(#b)'><defs><filter id='b'><feGaussianBlur stdDeviation='.5'/></filter></defs>${dots(420, 7, 72, c, 1.5)}${dots(160, 11, 48, d, 1.1)}</g><path d='M18 0Q17 12 18 20' stroke='${c}' stroke-width='2' stroke-linecap='round' opacity='.7'/><circle cx='18' cy='21' r='1.8' fill='${c}' opacity='.7'/>`), '150px') },
  { id: 'ca-splatter', label: 'Ink Splatter', group: 'Illustrated', colors: ['#f4f4fb', '#7c5cff'], layers: (c, d) => corner((`<path d='M0 0H46C40 10 52 14 42 22 34 28 40 40 28 40 20 40 22 52 12 48 4 46 6 58 0 56Z' fill='${c}'/>${dots(40, 3, 60, c, 3)}<circle cx='54' cy='20' r='3' fill='${d}'/><circle cx='20' cy='62' r='2' fill='${d}'/>`), '120px') },
  { id: 'ca-lace', label: 'Lace', group: 'Illustrated', colors: ['#ffffff', '#ffd6e8'], layers: (c, d) => [
    { svg: wrap(`<path d='M0 0H40V8Q30 22 20 8Q10 22 0 8Z' fill='${c}'/><circle cx='20' cy='6' r='2.4' fill='${d}'/><circle cx='10' cy='12' r='1.4' fill='${d}'/><circle cx='30' cy='12' r='1.4' fill='${d}'/>`, '0 0 40 20'), pos: 'top left', size: '40px 20px', repeat: 'repeat-x' },
    { svg: wrap(`<path d='M0 20H40V12Q30 -2 20 12Q10 -2 0 12Z' fill='${c}'/><circle cx='20' cy='14' r='2.4' fill='${d}'/>`, '0 0 40 20'), pos: 'bottom left', size: '40px 20px', repeat: 'repeat-x' },
  ] },
  { id: 'ca-tape', label: 'Washi Tape', group: 'Illustrated', colors: ['#ffb3cf', '#ffffff'], layers: (c, d) => [
    { svg: wrap(`<g transform='rotate(-35 50 20)'><rect x='5' y='10' width='90' height='22' fill='${c}' opacity='.85'/><path d='M15 10v22M30 10v22M45 10v22M60 10v22M75 10v22' stroke='${d}' stroke-width='4' opacity='.6'/></g>`, '0 0 100 60'), pos: '-14px -6px', size: '110px 66px' },
    { svg: wrap(`<g transform='rotate(35 50 20)'><rect x='5' y='10' width='90' height='22' fill='${c}' opacity='.85'/><path d='M15 10v22M30 10v22M45 10v22M60 10v22M75 10v22' stroke='${d}' stroke-width='4' opacity='.6'/></g>`, '0 0 100 60'), pos: 'right -6px', size: '110px 66px' },
  ] },
  { id: 'ca-polaroid', label: 'Polaroid', group: 'Illustrated', colors: ['#f6f3ea', '#d8d2c2'], layers: (c, d) => [
    { css: `linear-gradient(${c}, ${c})`, pos: 'top', size: '100% 10px', repeat: 'no-repeat' },
    { css: `linear-gradient(${c}, ${c})`, pos: 'left', size: '10px 100%', repeat: 'no-repeat' },
    { css: `linear-gradient(${c}, ${c})`, pos: 'right', size: '10px 100%', repeat: 'no-repeat' },
    { css: `linear-gradient(${d}, ${c} 6px)`, pos: 'bottom', size: '100% 42px', repeat: 'no-repeat' },
  ] },
  { id: 'ca-film', label: 'Film Strip', group: 'Illustrated', colors: ['#111114', '#f2f2f2'], layers: (c, d) => [
    { svg: wrap(`<rect width='16' height='20' fill='${c}'/><rect x='4' y='5' width='8' height='10' rx='1.5' fill='${d}'/>`, '0 0 16 20'), pos: 'left top', size: '16px 20px', repeat: 'repeat-y' },
    { svg: wrap(`<rect width='16' height='20' fill='${c}'/><rect x='4' y='5' width='8' height='10' rx='1.5' fill='${d}'/>`, '0 0 16 20'), pos: 'right top', size: '16px 20px', repeat: 'repeat-y' },
  ] },
  { id: 'ca-sakura', label: 'Sakura Branch', group: 'Illustrated', colors: ['#ffb7d5', '#6b3f2a'], layers: (c, d) => [
    { svg: sq(`<path d='M100 0Q70 20 40 22T0 44' stroke='${d}' stroke-width='4' fill='none'/><path d='M70 16Q66 30 56 34' stroke='${d}' stroke-width='2.5' fill='none'/>${[[86, 8], [62, 20], [44, 24], [56, 36], [24, 32], [10, 40]].map(([x, y]) => `<g transform='translate(${x} ${y})'>${[0, 72, 144, 216, 288].map((a) => `<ellipse cx='${(Math.cos((a * Math.PI) / 180) * 4).toFixed(1)}' cy='${(Math.sin((a * Math.PI) / 180) * 4).toFixed(1)}' rx='3.4' ry='2.6' fill='${c}' transform='rotate(${a} ${(Math.cos((a * Math.PI) / 180) * 4).toFixed(1)} ${(Math.sin((a * Math.PI) / 180) * 4).toFixed(1)})'/>`).join('')}<circle r='1.4' fill='#fff7'/></g>`).join('')}`), pos: 'top right', size: '170px' },
  ] },
  { id: 'ca-sparkles', label: 'Sparkles', group: 'Illustrated', colors: ['#ffe27a', '#ffffff'], layers: (c, d) => corner((`${[[10, 10, 7], [28, 6, 4], [8, 30, 4], [40, 18, 3], [20, 44, 2.5]].map(([x, y, r], i) => `<path d='M${x} ${y - r! * 2}Q${x} ${y} ${x + r! * 2} ${y}Q${x} ${y} ${x} ${y + r! * 2}Q${x} ${y} ${x - r! * 2} ${y}Q${x} ${y} ${x} ${y - r! * 2}Z' fill='${i % 2 ? d : c}'><animate attributeName='opacity' values='1;.3;1' dur='${1.4 + i * 0.3}s' repeatCount='indefinite'/></path>`).join('')}`), '110px') },
  { id: 'ca-bubbles', label: 'Bubbles', group: 'Illustrated', colors: ['#9ee8ff', '#ffffff'], layers: (c, d) => [
    ...['bottom left', 'bottom right'].map((pos) => ({ svg: sq(`${[[20, 80, 9], [40, 64, 6], [12, 52, 5], [34, 40, 4], [52, 84, 4]].map(([x, y, r]) => `<circle cx='${x}' cy='${y}' r='${r}' fill='${c}33' stroke='${c}' stroke-width='1.2'/><circle cx='${x! - r! / 3}' cy='${y! - r! / 3}' r='${r! / 4}' fill='${d}'/>`).join('')}`), pos, size: '120px' })),
  ] },
  { id: 'ca-snow', label: 'Snowdrift', group: 'Illustrated', colors: ['#ffffff', '#cfe8ff'], layers: (c, d) => [
    { svg: wrap(`<path d='M0 0H80V10Q70 18 60 12Q50 20 40 12Q30 22 20 12Q10 18 0 10Z' fill='${c}'/><path d='M20 12v6M60 12v8' stroke='${d}' stroke-width='3' stroke-linecap='round'/>`, '0 0 80 24'), pos: 'top left', size: '80px 24px', repeat: 'repeat-x' },
    ...corner((`${[[14, 40], [36, 60], [8, 72]].map(([x, y]) => `<path d='M${x} ${y - 5}v10M${x - 5} ${y}h10M${x - 3.5} ${y - 3.5}l7 7M${x + 3.5} ${y - 3.5}l-7 7' stroke='${d}' stroke-width='1.2'/>`).join('')}`), '110px').slice(2),
  ] },
  { id: 'ca-drips', label: 'Drips', group: 'Illustrated', colors: ['#8bff3b', '#4fd11a'], layers: (c, d) => [
    { svg: wrap(`<path d='M0 0H60V6Q54 6 54 12V30Q54 36 50 36T46 30V14Q46 8 40 8Q34 8 34 14V18Q34 22 31 22T28 18V10Q28 6 20 6Q14 6 14 12V22Q14 28 10 28T6 22V8Q6 6 0 6Z' fill='${c}' stroke='${d}' stroke-width='1'/>`, '0 0 60 40'), pos: 'top left', size: '60px 40px', repeat: 'repeat-x' },
  ] },
  { id: 'ca-thorns', label: 'Thorns', group: 'Illustrated', colors: ['#2b1d1d', '#7a0f1f'], layers: (c, d) => corner((`<path d='M0 30Q30 22 40 0M0 56Q20 50 30 34Q44 24 62 28' stroke='${c}' stroke-width='3' fill='none'/>${[[8, 28], [22, 22], [33, 12], [14, 52], [38, 28], [52, 26]].map(([x, y]) => `<path d='M${x} ${y}l4-7l2 6Z' fill='${c}'/>`).join('')}<circle cx='30' cy='34' r='4' fill='${d}'/>`), '130px') },
  { id: 'ca-chains', label: 'Chains', group: 'Illustrated', colors: ['#b9bcc8', '#5d6070'], layers: (c, d) => [
    ...['top left', 'bottom left'].map((pos) => ({ svg: wrap(`<rect x='2' y='4' width='18' height='10' rx='5' fill='none' stroke='${c}' stroke-width='3'/><rect x='17' y='6' width='14' height='6' rx='3' fill='none' stroke='${d}' stroke-width='2.5'/>`, '0 0 30 18'), pos, size: '30px 18px', repeat: 'repeat-x' })),
  ] },
  { id: 'ca-pixelhearts', label: 'Pixel Hearts', group: 'Illustrated', colors: ['#ff4d6d', '#ffb3c1'], layers: (c, d) => corner((`<g shape-rendering='crispEdges'>${[[8, 8, 5], [34, 6, 3], [8, 32, 3], [22, 22, 2]].map(([x, y, s]) => { const px = [[1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [3, 4], [4, 4], [3, 5]]; return px.map(([a, b]) => `<rect x='${x! + a! * s!}' y='${y! + b! * s!}' width='${s}' height='${s}' fill='${a === 1 && b === 1 ? d : c}'/>`).join(''); }).join('')}</g>`), '110px') },
  { id: 'ca-stickers', label: 'Stickers', group: 'Illustrated', colors: ['#c77dff', '#5ef2d6'], layers: (c, d) => [
    { svg: sq(`<g transform='rotate(-12 30 30)'><path d='M30 6 36 22 54 22 40 32 46 50 30 40 14 50 20 32 6 22 24 22Z' fill='${c}' stroke='#fff' stroke-width='4' stroke-linejoin='round'/></g>`), pos: '6px 6px', size: '70px' },
    { svg: sq(`<g transform='rotate(14 50 50)'><circle cx='50' cy='50' r='26' fill='${d}' stroke='#fff' stroke-width='4'/><path d='M38 46q4 6 12 0M50 46q4 6 12 0M38 60q12 10 24 0' stroke='#1d1d24' stroke-width='3' fill='none' stroke-linecap='round'/></g>`), pos: 'calc(100% - 6px) calc(100% - 6px)', size: '78px' },
  ] },
  { id: 'ca-sketch', label: 'Sketchbook', group: 'Illustrated', colors: ['#e8e6f5', '#9b98b8'], layers: (c, d) => [
    { svg: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='M3 4Q50 2 97 4T96 96Q50 98 4 96T3 4' fill='none' stroke='${c}' stroke-width='.8' vector-effect='non-scaling-stroke'/><path d='M5 2Q50 5 98 3T98 97Q50 95 2 98T5 2' fill='none' stroke='${d}' stroke-width='.6' vector-effect='non-scaling-stroke'/></svg>`, pos: 'center', size: '100% 100%' },
  ] },
  { id: 'ca-candy', label: 'Candy Cane', group: 'Illustrated', colors: ['#e5293e', '#ffffff'], layers: (c, d) => {
    const stripes = `repeating-linear-gradient(45deg, ${c} 0 8px, ${d} 8px 16px)`;
    return [
      { css: stripes, pos: 'top', size: '100% 7px', repeat: 'no-repeat' },
      { css: stripes, pos: 'bottom', size: '100% 7px', repeat: 'no-repeat' },
      { css: stripes, pos: 'left', size: '7px 100%', repeat: 'no-repeat' },
      { css: stripes, pos: 'right', size: '7px 100%', repeat: 'no-repeat' },
    ];
  } },
  { id: 'ca-crystals', label: 'Crystals', group: 'Illustrated', colors: ['#9ee8ff', '#c77dff'], layers: (c, d) => corner((`<path d='M0 40 10 8 18 34Z' fill='${c}' opacity='.9'/><path d='M12 44 30 0 34 40Z' fill='${d}' opacity='.85'/><path d='M30 40 44 14 46 38Z' fill='${c}' opacity='.75'/><path d='M10 8 18 34M30 0 34 40' stroke='#fff8' stroke-width='1'/>`), '110px').slice(2) },
  { id: 'ca-ribbons', label: 'Ribbons', group: 'Illustrated', colors: ['#ff4d8d', '#c2185b'], layers: (c, d) => corner((`<path d='M0 34 34 0H52L0 52Z' fill='${c}'/><path d='M0 40 40 0' stroke='${d}' stroke-width='2' stroke-dasharray='3 3'/><path d='M20 18 8 6Q4 16 10 22ZM20 18 32 6Q36 16 30 22Z' fill='${d}'/><circle cx='20' cy='18' r='3' fill='${c}'/>`), '110px') },
  { id: 'ca-halftone', label: 'Comic Dots', group: 'Illustrated', colors: ['#ffd166', '#e5293e'], layers: (c, d) => corner((`${Array.from({ length: 64 }, (_, i) => { const x = (i % 8) * 8 + 4; const y = Math.floor(i / 8) * 8 + 4; const r = Math.max(0, 3.6 - (x + y) / 30); return r > 0.2 ? `<circle cx='${x}' cy='${y}' r='${r.toFixed(2)}' fill='${(i + Math.floor(i / 8)) % 2 ? c : d}'/>` : ''; }).join('')}`), '110px') },
  { id: 'ca-autumn', label: 'Autumn Leaves', group: 'Illustrated', colors: ['#f08a3c', '#c2410c'], layers: (c, d) => corner((`${[[12, 14, 30], [34, 8, -20], [10, 38, 60]].map(([x, y, a], i) => `<g transform='translate(${x} ${y}) rotate(${a})'><path d='M0-11Q9-4 0 11Q-9-4 0-11Z' fill='${i % 2 ? d : c}'/><path d='M0-9V12' stroke='#6b3f2a' stroke-width='1'/></g>`).join('')}`), '110px') },
  { id: 'ca-night', label: 'Moon & Stars', group: 'Illustrated', colors: ['#ffe27a', '#ffffff'], layers: (c, d) => [
    { svg: sq(`<path d='M78 8A16 16 0 1 0 94 30 13 13 0 1 1 78 8Z' fill='${c}'/>${[[54, 12], [62, 30], [44, 26], [86, 50], [70, 54]].map(([x, y], i) => `<circle cx='${x}' cy='${y}' r='${i % 2 ? 1.2 : 1.8}' fill='${d}'><animate attributeName='opacity' values='1;.2;1' dur='${1.5 + i * 0.4}s' repeatCount='indefinite'/></circle>`).join('')}`), pos: 'top right', size: '150px' },
  ] },
];
const ART_BY_ID = new Map(CARD_ARTS.map((a) => [a.id, a]));
export function cardArtStyle(id: string | null | undefined, colors?: string[] | null): Record<string, string> | null {
  const a = id ? ART_BY_ID.get(id) : undefined;
  if (!a) return null;
  const layers = a.layers(colors?.[0] ?? a.colors[0], colors?.[1] ?? a.colors[1]);
  const bg = layers.map((l) => `${l.css ?? svgUrl(l.svg!)} ${l.pos} / ${l.size} ${l.repeat ?? 'no-repeat'}`).join(', ');
  return { '--cf-art': bg };
}
