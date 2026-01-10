import fs from "node:fs/promises";
import path from "node:path";

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildingsSvg({ rand, w, groundY }) {
  const leftMargin = 0;
  const rightMargin = w;
  const minWidth = 40;
  const maxWidth = 120;
  const fill = "rgba(10,14,24,0.85)";

  let x = leftMargin;
  const rects = [];
  while (x < rightMargin) {
    const bw = Math.round(minWidth + rand() * (maxWidth - minWidth));
    const bh = Math.round(220 + rand() * 280);
    const y = groundY - bh;
    rects.push(
      `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${fill}" />`
    );
    x += bw + Math.round(6 + rand() * 16);
  }
  return rects.join("\n");
}

function windowsSvg({ rand, w, groundY }) {
  const rows = 9;
  const cols = 18;
  const cellW = w / cols;
  const cellH = 28;
  const y0 = groundY - rows * cellH - 40;
  const blocks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rand() < 0.65) continue;
      const x = Math.round(c * cellW + 12 + rand() * 10);
      const y = Math.round(y0 + r * cellH + rand() * 10);
      const ww = Math.round(12 + rand() * 10);
      const wh = Math.round(10 + rand() * 10);
      const hue = rand() < 0.75 ? "rgba(255, 208, 120, 0.65)" : "rgba(120, 210, 255, 0.55)";
      blocks.push(
        `<rect x="${x}" y="${y}" width="${ww}" height="${wh}" rx="2" fill="${hue}" />`
      );
    }
  }
  return blocks.join("\n");
}

function rainSvg({ rand, w, h, density = 140 }) {
  const drops = [];
  for (let i = 0; i < density; i++) {
    const x = Math.round(rand() * w);
    const y = Math.round(rand() * h);
    const len = Math.round(16 + rand() * 28);
    const opacity = (0.08 + rand() * 0.18).toFixed(3);
    drops.push(
      `<line x1="${x}" y1="${y}" x2="${x - 6}" y2="${y + len}" stroke="rgba(200,220,255,${opacity})" stroke-width="1" />`
    );
  }
  return drops.join("\n");
}

function neonReflectionsSvg({ rand, w, h, groundY }) {
  const bands = [];
  const colors = [
    "rgba(255,60,180,0.25)",
    "rgba(70,210,255,0.22)",
    "rgba(255,160,60,0.18)",
    "rgba(150,80,255,0.20)",
  ];
  for (let i = 0; i < 10; i++) {
    const x = Math.round(rand() * w);
    const ww = Math.round(120 + rand() * 260);
    const y = Math.round(groundY + 20 + rand() * (h - groundY - 30));
    const hh = Math.round(10 + rand() * 26);
    const c = colors[Math.floor(rand() * colors.length)];
    bands.push(
      `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="8" fill="${c}" />`
    );
  }
  return bands.join("\n");
}

function catSilhouetteSvg({ x, y, scale = 1 }) {
  const s = scale;
  const p = [
    `M ${x + 0 * s} ${y + 32 * s}`,
    `c 8 ${-10 * s} 22 ${-16 * s} 36 ${-12 * s}`,
    `c 12 ${3 * s} 18 ${12 * s} 22 ${20 * s}`,
    `c 4 ${10 * s} 0 ${18 * s} -10 ${22 * s}`,
    `c -12 ${5 * s} -24 ${2 * s} -34 ${-6 * s}`,
    `c -10 ${-8 * s} -16 ${-12 * s} -14 ${-24 * s}`,
    `z`,
  ].join(" ");
  const ear1 = `<path d="M ${x + 10 * s} ${y + 18 * s} l 6 ${-10 * s} l 6 ${12 * s} z" fill="rgba(8,10,14,0.92)" />`;
  const ear2 = `<path d="M ${x + 24 * s} ${y + 16 * s} l 7 ${-9 * s} l 4 ${13 * s} z" fill="rgba(8,10,14,0.92)" />`;
  const tail = `<path d="M ${x + 46 * s} ${y + 42 * s} c 18 ${-8 * s} 22 ${10 * s} 10 ${16 * s}" fill="none" stroke="rgba(8,10,14,0.92)" stroke-width="${5 * s}" stroke-linecap="round" />`;
  return [
    `<path d="${p}" fill="rgba(8,10,14,0.92)" />`,
    ear1,
    ear2,
    tail,
  ].join("\n");
}

function frameSvg({ title, caption, seed, variant }) {
  const w = 1280;
  const h = 720;
  const groundY = 470;
  const rand = lcg(seed);

  const awning =
    variant === "awning"
      ? `<g opacity="0.95">
  <rect x="720" y="300" width="430" height="110" rx="10" fill="rgba(30,30,50,0.88)" />
  <rect x="720" y="300" width="430" height="16" fill="rgba(255,60,180,0.50)" />
  <rect x="740" y="323" width="390" height="12" fill="rgba(70,210,255,0.30)" />
  <text x="740" y="385" font-family="ui-sans-serif, system-ui" font-size="22" fill="rgba(230,240,255,0.78)">flickering storefront awning</text>
</g>`
      : "";

  const commuters =
    variant === "commuters"
      ? `<g opacity="0.65" filter="url(#blur)">
  <rect x="180" y="370" width="110" height="220" rx="30" fill="rgba(220,230,255,0.18)" />
  <rect x="290" y="380" width="130" height="260" rx="34" fill="rgba(220,230,255,0.14)" />
  <rect x="420" y="400" width="100" height="210" rx="28" fill="rgba(220,230,255,0.12)" />
  <rect x="520" y="390" width="140" height="260" rx="34" fill="rgba(220,230,255,0.12)" />
</g>`
      : "";

  const vent =
    variant === "vent"
      ? `<g opacity="0.95">
  <rect x="820" y="520" width="320" height="120" rx="18" fill="rgba(30,30,40,0.9)" />
  <g opacity="0.6">
    ${Array.from({ length: 10 })
      .map((_, i) => `<rect x="${850 + i * 26}" y="540" width="10" height="80" rx="5" fill="rgba(190,210,230,0.35)" />`)
      .join("\n")}
  </g>
  <g opacity="0.5">
    ${Array.from({ length: 12 })
      .map((_, i) => {
        const x = 860 + i * 22;
        const y = 520 - i * 4;
        return `<path d="M ${x} ${y + 40} c -10 -20 10 -40 0 -60" stroke="rgba(240,240,255,0.22)" stroke-width="4" fill="none" />`;
      })
      .join("\n")}
  </g>
  <text x="840" y="610" font-family="ui-sans-serif, system-ui" font-size="22" fill="rgba(230,240,255,0.74)">warm subway vent</text>
</g>`
      : "";

  const puddles =
    variant === "puddles"
      ? `<g opacity="0.9">
  <ellipse cx="360" cy="610" rx="280" ry="70" fill="rgba(80,120,200,0.14)" />
  <ellipse cx="980" cy="640" rx="240" ry="64" fill="rgba(120,80,240,0.10)" />
  <ellipse cx="720" cy="600" rx="200" ry="54" fill="rgba(255,60,180,0.08)" />
  <text x="120" y="670" font-family="ui-sans-serif, system-ui" font-size="22" fill="rgba(230,240,255,0.72)">puddles and wet asphalt</text>
</g>`
      : "";

  const catX = variant === "vent" ? 720 : variant === "awning" ? 700 : 560;
  const catY = variant === "vent" ? 560 : 540;
  const catScale = variant === "close" ? 1.5 : 1.1;

  const extraClose =
    variant === "close"
      ? `<g opacity="0.88">
  <circle cx="660" cy="420" r="140" fill="rgba(70,210,255,0.08)" />
  <circle cx="680" cy="440" r="180" fill="rgba(255,60,180,0.05)" />
  <text x="520" y="520" font-family="ui-sans-serif, system-ui" font-size="22" fill="rgba(230,240,255,0.72)">neon reflections ripple</text>
</g>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070916"/>
      <stop offset="55%" stop-color="#0b1328"/>
      <stop offset="100%" stop-color="#0a0e18"/>
    </linearGradient>
    <linearGradient id="street" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(20,26,40,0.92)"/>
      <stop offset="55%" stop-color="rgba(10,14,24,0.92)"/>
      <stop offset="100%" stop-color="rgba(18,20,30,0.92)"/>
    </linearGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" />
    </filter>
  </defs>

  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <g opacity="0.85">
    ${buildingsSvg({ rand, w, groundY })}
  </g>
  <g opacity="0.9">
    ${windowsSvg({ rand, w, groundY })}
  </g>

  <rect y="${groundY}" width="${w}" height="${h - groundY}" fill="url(#street)"/>
  <g>
    ${neonReflectionsSvg({ rand, w, h, groundY })}
  </g>

  ${puddles}
  ${awning}
  ${commuters}
  ${vent}
  ${extraClose}

  <g opacity="0.98">
    ${catSilhouetteSvg({ x: catX, y: catY, scale: catScale })}
  </g>

  <g opacity="0.9">
    ${rainSvg({ rand, w, h, density: 180 })}
  </g>

  <g>
    <rect x="32" y="28" width="1216" height="86" rx="14" fill="rgba(0,0,0,0.35)" />
    <text x="56" y="70" font-family="ui-sans-serif, system-ui" font-size="28" fill="rgba(240,245,255,0.92)">${esc(
      title
    )}</text>
    <text x="56" y="102" font-family="ui-sans-serif, system-ui" font-size="18" fill="rgba(240,245,255,0.70)">${esc(
      caption
    )}</text>
    <text x="1130" y="102" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" fill="rgba(240,245,255,0.60)">1280×720 • rainy neon city</text>
  </g>
</svg>`;
}

const outDirArg = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
const outDir = outDirArg ? path.resolve(outDirArg) : path.resolve("tmp");

const frames = [
  {
    name: "poor-cat-city_01_puddles.svg",
    title: "Beat 1 — Puddles",
    caption: "The stray cat steps through puddles; neon ripples on wet asphalt.",
    seed: 1001,
    variant: "puddles",
  },
  {
    name: "poor-cat-city_02_awning.svg",
    title: "Beat 2 — Awning",
    caption: "It slips under a flickering storefront awning, rain ticking nearby.",
    seed: 1002,
    variant: "awning",
  },
  {
    name: "poor-cat-city_03_commuters.svg",
    title: "Beat 3 — Passing Crowd",
    caption: "Commuters blur past; the cat watches from the edge of light.",
    seed: 1003,
    variant: "commuters",
  },
  {
    name: "poor-cat-city_04_neon-close.svg",
    title: "Beat 4 — Neon Close",
    caption: "Close, low angle; reflections shimmer and the city hums around it.",
    seed: 1004,
    variant: "close",
  },
  {
    name: "poor-cat-city_05_vent.svg",
    title: "Beat 5 — Warm Vent",
    caption: "It finds warmth by a subway vent; steam curls into the rain.",
    seed: 1005,
    variant: "vent",
  },
  {
    name: "poor-cat-city_06_settle.svg",
    title: "Beat 6 — Settle",
    caption: "The cat curls up, blinking slowly as distant traffic streaks by.",
    seed: 1006,
    variant: "puddles",
  },
];

await fs.mkdir(outDir, { recursive: true });
await Promise.all(
  frames.map(async (frame) => {
    const svg = frameSvg(frame);
    const outPath = path.join(outDir, frame.name);
    await fs.writeFile(outPath, svg, "utf8");
  })
);

const manifest = frames
  .map((f) => `- ${f.name}: ${f.caption}`)
  .join("\n");
await fs.writeFile(
  path.join(outDir, "poor-cat-city_storyboard.md"),
  `# Poor cat in the city — storyboard (SVG)\n\n${manifest}\n`,
  "utf8"
);

console.log(`Wrote ${frames.length} SVG files to ${outDir}`);
