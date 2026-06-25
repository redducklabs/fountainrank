import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "temp/store-screenshot-build/svg");

const assets = {
  logo: dataUri("docs/logos/horizontal-with-text.png"),
  pin: dataUri("docs/logos/512-pin.png"),
  standardPin: dataUri("mobile/assets/pins/pin-standard.png"),
  goldPin: dataUri("mobile/assets/pins/pin-gold.png"),
  brokenPin: dataUri("mobile/assets/pins/pin-broken.png"),
};

const variants = [
  {
    key: "app-store-6-9",
    width: 1290,
    height: 2796,
    headingSize: 72,
    subSize: 35,
    phone: { x: 130, y: 488, w: 1028, h: 2006, r: 74 },
  },
  {
    key: "app-store-6-5",
    width: 1242,
    height: 2688,
    headingSize: 72,
    subSize: 35,
    phone: { x: 126, y: 470, w: 990, h: 1930, r: 72 },
  },
  {
    key: "play-store",
    width: 1080,
    height: 1920,
    headingSize: 54,
    subSize: 28,
    phone: { x: 90, y: 320, w: 900, h: 1460, r: 62 },
  },
];

const screens = [
  {
    id: "01-map-discovery",
    title: "Find fountains nearby",
    subtitle: "Browse public drinking fountains from a native map.",
    body: mapScreen,
  },
  {
    id: "02-fountain-detail",
    title: "Know before you go",
    subtitle: "Check status, ratings, location notes, and community details.",
    body: detailScreen,
  },
  {
    id: "03-contribute",
    title: "Improve fountain info",
    subtitle: "Rate quality, report condition, and share field notes.",
    body: contributeScreen,
  },
  {
    id: "04-add-fountain",
    title: "Add missing fountains",
    subtitle: "Place new fountains from your location or a map point.",
    body: addScreen,
  },
  {
    id: "05-account-diagnostics",
    title: "Sign in and verify",
    subtitle: "Use your account for contributions and check app connectivity.",
    body: accountScreen,
  },
];

for (const variant of variants) {
  for (const screen of screens) {
    const path = join(OUT, variant.key, `${screen.id}.svg`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderShot(variant, screen));
    console.log(path);
  }
}

function dataUri(path) {
  return `data:image/png;base64,${readFileSync(join(ROOT, path)).toString("base64")}`;
}

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderShot(variant, screen) {
  const { width, height, phone } = variant;
  const content = {
    x: phone.x + 34,
    y: phone.y + 92,
    w: phone.w - 68,
    h: phone.h - 146,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#F7FBFF"/>
      <stop offset="0.58" stop-color="#E9F6FA"/>
      <stop offset="1" stop-color="#F5F7F2"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0A357E"/>
      <stop offset="0.55" stop-color="#0E4DA4"/>
      <stop offset="1" stop-color="#0B6FB3"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0A357E" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width * 0.14}" cy="${height * 0.18}" r="${width * 0.14}" fill="#5FC5F0" opacity="0.14"/>
  <circle cx="${width * 0.88}" cy="${height * 0.83}" r="${width * 0.18}" fill="#F2C200" opacity="0.16"/>
  ${
    variant.key.startsWith("app-store")
      ? `<image href="${assets.logo}" x="${width * 0.5 - 155}" y="78" width="310" height="123" preserveAspectRatio="xMidYMid meet"/>`
      : `<image href="${assets.logo}" x="${width * 0.5 - 115}" y="34" width="230" height="91" preserveAspectRatio="xMidYMid meet"/>`
  }
  <text x="${width / 2}" y="${variant.key.startsWith("app-store") ? 250 : 190}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="${variant.headingSize}" font-weight="800" fill="#0A357E">${esc(screen.title)}</text>
  <text x="${width / 2}" y="${variant.key.startsWith("app-store") ? 315 : 238}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="${variant.subSize}" font-weight="500" fill="#3F5872">${esc(screen.subtitle)}</text>
  ${phoneFrame(phone)}
  <clipPath id="screenClip"><rect x="${content.x}" y="${content.y}" width="${content.w}" height="${content.h}" rx="34"/></clipPath>
  <g clip-path="url(#screenClip)">
    <rect x="${content.x}" y="${content.y}" width="${content.w}" height="${content.h}" fill="#F8FAFC"/>
    ${screen.body(content, variant)}
  </g>
</svg>`;
}

function phoneFrame(p) {
  return `
  <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.r}" fill="#071623" filter="url(#shadow)"/>
  <rect x="${p.x + 20}" y="${p.y + 20}" width="${p.w - 40}" height="${p.h - 40}" rx="${p.r - 24}" fill="#101820"/>
  <rect x="${p.x + 34}" y="${p.y + 92}" width="${p.w - 68}" height="${p.h - 146}" rx="34" fill="#F8FAFC"/>
  <rect x="${p.x + p.w / 2 - 110}" y="${p.y + 38}" width="220" height="28" rx="14" fill="#020A12"/>
  <rect x="${p.x + p.w / 2 - 80}" y="${p.y + p.h - 34}" width="160" height="9" rx="5" fill="#E6EDF5" opacity="0.65"/>`;
}

function appHeader(c, title) {
  return `
  <rect x="${c.x}" y="${c.y}" width="${c.w}" height="108" fill="#FFFFFF"/>
  <text x="${c.x + 34}" y="${c.y + 66}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="34" font-weight="800" fill="#0A357E">${esc(title)}</text>
  <circle cx="${c.x + c.w - 54}" cy="${c.y + 54}" r="23" fill="#EAF6FD" stroke="#B9DDEF"/>
  <path d="M${c.x + c.w - 64} ${c.y + 54} h20 M${c.x + c.w - 54} ${c.y + 44} v20" stroke="#0E4DA4" stroke-width="5" stroke-linecap="round"/>
  <line x1="${c.x}" x2="${c.x + c.w}" y1="${c.y + 108}" y2="${c.y + 108}" stroke="#D6E2EC"/>`;
}

function tabBar(c, active) {
  const y = c.y + c.h - 98;
  const labels = ["Map", "Add", "Account"];
  return `
  <rect x="${c.x}" y="${y}" width="${c.w}" height="98" fill="#FFFFFF" stroke="#DFE7EF"/>
  ${labels
    .map((label, i) => {
      const x = c.x + (c.w * (i + 0.5)) / 3;
      const isActive = label === active;
      return `<circle cx="${x}" cy="${y + 30}" r="14" fill="${isActive ? "#0E4DA4" : "#9AA9B7"}"/>
      <text x="${x}" y="${y + 70}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="20" font-weight="${isActive ? "800" : "600"}" fill="${isActive ? "#0A357E" : "#708090"}">${label}</text>`;
    })
    .join("")}`;
}

function pill(x, y, text, active = false) {
  return `<rect x="${x}" y="${y}" width="${text.length * 15 + 42}" height="50" rx="25" fill="${active ? "#0E4DA4" : "#FFFFFF"}" stroke="#C8D7E4"/>
  <text x="${x + 21}" y="${y + 32}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="21" font-weight="700" fill="${active ? "#FFFFFF" : "#274761"}">${esc(text)}</text>`;
}

function card(x, y, w, h, r = 18) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#FFFFFF" stroke="#D8E4EE"/>`;
}

function mapScreen(c) {
  const mapY = c.y + 108;
  const mapH = c.h - 206;
  return `
  ${appHeader(c, "FountainRank")}
  <rect x="${c.x}" y="${mapY}" width="${c.w}" height="${mapH}" fill="#DDEEE5"/>
  ${mapGrid(c.x, mapY, c.w, mapH)}
  <path d="M${c.x + 90} ${mapY + mapH - 70} C${c.x + 250} ${mapY + mapH - 220}, ${c.x + 420} ${mapY + 340}, ${c.x + c.w - 120} ${mapY + 210}" fill="none" stroke="#9CD8EE" stroke-width="54" stroke-linecap="round" opacity="0.7"/>
  <path d="M${c.x + 40} ${mapY + 380} L${c.x + c.w - 50} ${mapY + 210} M${c.x + 110} ${mapY + 760} L${c.x + c.w - 70} ${mapY + 640} M${c.x + 220} ${mapY + 120} L${c.x + 390} ${mapY + mapH - 40}" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round" opacity="0.9"/>
  <rect x="${c.x + 28}" y="${mapY + 28}" width="${c.w - 56}" height="72" rx="36" fill="#FFFFFF" stroke="#C8D7E4"/>
  <circle cx="${c.x + 72}" cy="${mapY + 64}" r="15" fill="#0E4DA4"/>
  <text x="${c.x + 105}" y="${mapY + 73}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="25" font-weight="650" fill="#49647B">Search this area</text>
  ${pill(c.x + 28, mapY + 124, "Working", true)}
  ${pill(c.x + 188, mapY + 124, "Top rated")}
  ${pill(c.x + 360, mapY + 124, "Bottle fill")}
  ${pin(c.x + c.w * 0.38, mapY + 455, "standardPin")}
  ${pin(c.x + c.w * 0.61, mapY + 300, "goldPin")}
  ${pin(c.x + c.w * 0.72, mapY + 760, "standardPin")}
  ${pin(c.x + c.w * 0.24, mapY + 820, "brokenPin")}
  ${pin(c.x + c.w * 0.48, mapY + 1030, "standardPin")}
  <rect x="${c.x + c.w - 100}" y="${mapY + mapH - 180}" width="62" height="62" rx="31" fill="#FFFFFF" stroke="#CAD8E4"/>
  <circle cx="${c.x + c.w - 69}" cy="${mapY + mapH - 149}" r="16" fill="none" stroke="#0E4DA4" stroke-width="5"/>
  <line x1="${c.x + c.w - 69}" y1="${mapY + mapH - 170}" x2="${c.x + c.w - 69}" y2="${mapY + mapH - 128}" stroke="#0E4DA4" stroke-width="4"/>
  <line x1="${c.x + c.w - 90}" y1="${mapY + mapH - 149}" x2="${c.x + c.w - 48}" y2="${mapY + mapH - 149}" stroke="#0E4DA4" stroke-width="4"/>
  <rect x="${c.x + 170}" y="${mapY + mapH - 110}" width="${c.w - 340}" height="60" rx="30" fill="#FFFFFF" stroke="#D8E4EE"/>
  <text x="${c.x + c.w / 2}" y="${mapY + mapH - 72}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="22" font-weight="700" fill="#274761">Showing nearby fountains</text>
  ${tabBar(c, "Map")}`;
}

function mapGrid(x, y, w, h) {
  const lines = [];
  for (let i = 1; i < 7; i++)
    lines.push(
      `<line x1="${x + (w * i) / 7}" x2="${x + (w * i) / 7}" y1="${y}" y2="${y + h}" stroke="#CFE3D9" stroke-width="3"/>`,
    );
  for (let i = 1; i < 10; i++)
    lines.push(
      `<line x1="${x}" x2="${x + w}" y1="${y + (h * i) / 10}" y2="${y + (h * i) / 10}" stroke="#CFE3D9" stroke-width="3"/>`,
    );
  return lines.join("");
}

function pin(x, y, asset) {
  return `<image href="${assets[asset]}" x="${x - 31}" y="${y - 76}" width="62" height="76" preserveAspectRatio="xMidYMid meet"/>`;
}

function detailScreen(c) {
  const y = c.y + 108;
  return `
  ${appHeader(c, "Fountain")}
  <rect x="${c.x}" y="${y}" width="${c.w}" height="${c.h - 206}" fill="#F6F9FB"/>
  ${card(c.x + 28, y + 30, c.w - 56, 390)}
  <image href="${assets.pin}" x="${c.x + 54}" y="${y + 58}" width="100" height="100"/>
  <text x="${c.x + 174}" y="${y + 102}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="34" font-weight="800" fill="#0A357E">Riverside Park Fountain</text>
  <text x="${c.x + 174}" y="${y + 145}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="600" fill="#61778A">0.2 mi away - near the trail entrance</text>
  <rect x="${c.x + 54}" y="${y + 190}" width="170" height="64" rx="32" fill="#E8F7EF"/>
  <text x="${c.x + 139}" y="${y + 231}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="800" fill="#167046">Working</text>
  <rect x="${c.x + 244}" y="${y + 190}" width="150" height="64" rx="32" fill="#FFF5C9"/>
  <text x="${c.x + 319}" y="${y + 231}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="800" fill="#8A6500">4.6 / 5</text>
  <line x1="${c.x + 54}" x2="${c.x + c.w - 54}" y1="${y + 288}" y2="${y + 288}" stroke="#E2EAF2"/>
  <text x="${c.x + 54}" y="${y + 338}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="25" font-weight="700" fill="#274761">Cold water, bottle filler, accessible path</text>
  ${section(c, y + 460, "Recent community notes", ["Strong pressure after the morning rush.", "Working as of today.", "Bottle filler is on the north side."])}
  ${section(c, y + 830, "Fountain details", ["Status: working", "Rating confidence: 28 reports", "Last update: today"])}
  ${tabBar(c, "Map")}`;
}

function section(c, y, title, rows) {
  const h = 110 + rows.length * 58;
  return `${card(c.x + 28, y, c.w - 56, h)}
  <text x="${c.x + 54}" y="${y + 52}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="28" font-weight="800" fill="#0A357E">${esc(title)}</text>
  ${rows
    .map(
      (row, i) => `<circle cx="${c.x + 64}" cy="${y + 102 + i * 58}" r="8" fill="#0E4DA4"/>
    <text x="${c.x + 88}" y="${y + 111 + i * 58}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="600" fill="#40586C">${esc(row)}</text>`,
    )
    .join("")}`;
}

function contributeScreen(c) {
  const y = c.y + 108;
  return `
  ${appHeader(c, "Contribute")}
  <rect x="${c.x}" y="${y}" width="${c.w}" height="${c.h - 206}" fill="#F6F9FB"/>
  ${card(c.x + 28, y + 30, c.w - 56, 300)}
  <text x="${c.x + 54}" y="${y + 82}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="31" font-weight="800" fill="#0A357E">Rate water quality</text>
  ${ratingDots(c.x + 62, y + 132, 5)}
  <text x="${c.x + 54}" y="${y + 238}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="600" fill="#61778A">Your report updates the shared ranking.</text>
  ${card(c.x + 28, y + 370, c.w - 56, 290)}
  <text x="${c.x + 54}" y="${y + 422}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="31" font-weight="800" fill="#0A357E">Report condition</text>
  ${choice(c.x + 54, y + 462, "Working", true)}
  ${choice(c.x + 278, y + 462, "Out of order", false)}
  ${choice(c.x + 54, y + 552, "Bottle filler", true)}
  ${choice(c.x + 318, y + 552, "Accessible", true)}
  ${card(c.x + 28, y + 700, c.w - 56, 360)}
  <text x="${c.x + 54}" y="${y + 752}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="31" font-weight="800" fill="#0A357E">Add a field note</text>
  <rect x="${c.x + 54}" y="${y + 790}" width="${c.w - 108}" height="160" rx="18" fill="#F8FAFC" stroke="#D8E4EE"/>
  <text x="${c.x + 78}" y="${y + 842}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="600" fill="#51697E">Fresh water today. Easy access from the west sidewalk.</text>
  <rect x="${c.x + 54}" y="${y + 978}" width="${c.w - 108}" height="58" rx="29" fill="#F2C200"/>
  <text x="${c.x + c.w / 2}" y="${y + 1016}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="25" font-weight="900" fill="#0A357E">Submit contribution</text>
  ${tabBar(c, "Map")}`;
}

function ratingDots(x, y, count) {
  return Array.from(
    { length: count },
    (_, i) =>
      `<circle cx="${x + i * 70}" cy="${y}" r="28" fill="${i < 4 ? "#F2C200" : "#E4ECF4"}" stroke="#D1DCE7"/>`,
  ).join("");
}

function choice(x, y, label, active) {
  return `<rect x="${x}" y="${y}" width="${label.length * 18 + 70}" height="62" rx="31" fill="${active ? "#E8F7EF" : "#FFFFFF"}" stroke="${active ? "#73C69A" : "#CAD8E4"}"/>
  <circle cx="${x + 32}" cy="${y + 31}" r="14" fill="${active ? "#167046" : "#D7E2EC"}"/>
  <text x="${x + 58}" y="${y + 40}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="23" font-weight="800" fill="${active ? "#167046" : "#40586C"}">${esc(label)}</text>`;
}

function addScreen(c) {
  const y = c.y + 108;
  const buttonY = y + Math.min(1060, c.h - 352);
  return `
  ${appHeader(c, "Add a fountain")}
  <rect x="${c.x}" y="${y}" width="${c.w}" height="${c.h - 206}" fill="#F6F9FB"/>
  ${card(c.x + 28, y + 30, c.w - 56, 460)}
  <text x="${c.x + 54}" y="${y + 82}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="30" font-weight="800" fill="#0A357E">Place the fountain</text>
  <rect x="${c.x + 54}" y="${y + 112}" width="${c.w - 108}" height="260" rx="24" fill="#DDEEE5"/>
  ${mapGrid(c.x + 54, y + 112, c.w - 108, 260)}
  <path d="M${c.x + 100} ${y + 310} C${c.x + 250} ${y + 205}, ${c.x + 390} ${y + 352}, ${c.x + c.w - 95} ${y + 180}" fill="none" stroke="#9CD8EE" stroke-width="34" stroke-linecap="round" opacity="0.75"/>
  ${pin(c.x + c.w / 2, y + 265, "standardPin")}
  <text x="${c.x + 54}" y="${y + 430}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="650" fill="#51697E">Using current location. Drag the point if needed.</text>
  ${field(c.x + 28, y + 530, c.w - 56, "Location note", "Near the south entrance")}
  ${field(c.x + 28, y + 690, c.w - 56, "Initial condition", "Working")}
  ${field(c.x + 28, y + 850, c.w - 56, "Water quality", "4 / 5")}
  <rect x="${c.x + 54}" y="${buttonY}" width="${c.w - 108}" height="66" rx="33" fill="#F2C200"/>
  <text x="${c.x + c.w / 2}" y="${buttonY + 43}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="25" font-weight="900" fill="#0A357E">Add fountain</text>
  ${tabBar(c, "Add")}`;
}

function field(x, y, w, label, value) {
  return `${card(x, y, w, 122)}
  <text x="${x + 26}" y="${y + 44}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="21" font-weight="750" fill="#61778A">${esc(label)}</text>
  <text x="${x + 26}" y="${y + 88}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="27" font-weight="750" fill="#0F2537">${esc(value)}</text>`;
}

function accountScreen(c) {
  const y = c.y + 108;
  return `
  ${appHeader(c, "Account")}
  <rect x="${c.x}" y="${y}" width="${c.w}" height="${c.h - 206}" fill="#F6F9FB"/>
  ${card(c.x + 28, y + 30, c.w - 56, 280)}
  <circle cx="${c.x + 96}" cy="${y + 116}" r="46" fill="#0E4DA4"/>
  <text x="${c.x + 96}" y="${y + 133}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="42" font-weight="900" fill="#FFFFFF">A</text>
  <text x="${c.x + 170}" y="${y + 108}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="31" font-weight="800" fill="#0A357E">Signed in</text>
  <text x="${c.x + 170}" y="${y + 150}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="23" font-weight="600" fill="#61778A">Ready to rate and add fountains</text>
  <rect x="${c.x + 54}" y="${y + 206}" width="${c.w - 108}" height="58" rx="29" fill="#FFFFFF" stroke="#CAD8E4"/>
  <text x="${c.x + c.w / 2}" y="${y + 244}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="800" fill="#0E4DA4">Manage account</text>
  ${card(c.x + 28, y + 360, c.w - 56, 430)}
  <text x="${c.x + 54}" y="${y + 414}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="31" font-weight="800" fill="#0A357E">Diagnostics</text>
  ${statusRow(c.x + 54, y + 472, c.w - 108, "API", "Connected", true)}
  ${statusRow(c.x + 54, y + 570, c.w - 108, "Auth", "Configured", true)}
  ${statusRow(c.x + 54, y + 668, c.w - 108, "Build", "1.0.0", true)}
  ${card(c.x + 28, y + 840, c.w - 56, 235)}
  <text x="${c.x + 54}" y="${y + 894}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="31" font-weight="800" fill="#0A357E">Privacy-first beta</text>
  <text x="${c.x + 54}" y="${y + 948}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="600" fill="#51697E">Location is foreground-only and used for nearby fountains.</text>
  <text x="${c.x + 54}" y="${y + 1004}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="600" fill="#51697E">Contributions require sign-in.</text>
  ${tabBar(c, "Account")}`;
}

function statusRow(x, y, w, name, value, ok) {
  return `<rect x="${x}" y="${y}" width="${w}" height="74" rx="18" fill="#F8FAFC" stroke="#D8E4EE"/>
  <circle cx="${x + 36}" cy="${y + 37}" r="15" fill="${ok ? "#167046" : "#B54708"}"/>
  <text x="${x + 68}" y="${y + 46}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="800" fill="#274761">${esc(name)}</text>
  <text x="${x + w - 24}" y="${y + 46}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="24" font-weight="700" fill="#61778A">${esc(value)}</text>`;
}
