import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const escape = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const px = (v) => /^-?\d+(\.\d+)?$/.test(String(v)) ? `${v}px` : String(v);
const color = (v) => typeof v === "object" ? v?.raw || v?.hex : v;
const breakpoints = { tablet_portrait: 1024, mobile_landscape: 767, mobile_portrait: 478 };

export function findBrowser() {
  const candidates = [process.env.BROWSER_EXECUTABLE, chromium.executablePath(),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const executablePath = candidates.find((p) => p && fs.existsSync(p));
  if (!executablePath) throw new Error("Browser not found. Set BROWSER_EXECUTABLE to Chrome/Edge/Chromium.");
  return executablePath;
}

export function previewHTML(tree, treeDir) {
  const byId = new Map(tree.map((e) => [e.id, e]));
  const missingAssets = new Set();
  const asset = (ref) => {
    const url = ref?.url || ref?.full;
    if (!url) return "";
    if (/^(https?:|data:|\/\/)/i.test(url)) return url;
    const file = path.resolve(treeDir, url);
    if (!fs.existsSync(file)) { missingAssets.add(url); return ""; }
    const mime = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[path.extname(file).slice(1).toLowerCase()];
    if (!mime) throw new Error(`Unsupported asset: ${url}`);
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  };
  function declarations(s) {
    const out = [];
    const props = { _display: "display", _direction: "flex-direction", _flexDirection: "flex-direction", _alignItems: "align-items", _alignItemsGrid: "align-items", _justifyContent: "justify-content", _flexWrap: "flex-wrap", _gridTemplateColumns: "grid-template-columns", _position: "position", _overflow: "overflow", _zIndex: "z-index", _alignSelf: "align-self", _flexGrow: "flex-grow", _flexShrink: "flex-shrink", _flexBasis: "flex-basis", _opacity: "opacity", _objectFit: "object-fit" };
    for (const [key, prop] of Object.entries(props)) if (s[key] !== undefined) out.push(`${prop}:${s[key]}`);
    const lengths = { _rowGap: "row-gap", _columnGap: "column-gap", _gap: "gap", _gridGap: "gap", iconGap: "column-gap", _width: "width", _widthMax: "max-width", _widthMin: "min-width", _height: "height", _heightMin: "min-height", _heightMax: "max-height", _top: "top", _left: "left", _bottom: "bottom", _right: "right" };
    for (const [key, prop] of Object.entries(lengths)) if (s[key] !== undefined) out.push(`${prop}:${px(s[key])}`);
    for (const key of ["padding", "margin"]) for (const [side, v] of Object.entries(s[`_${key}`] || {})) if (v !== undefined && v !== "") out.push(`${key}-${side}:${px(v)}`);
    const bg = s._background;
    if (bg?.color) out.push(`background-color:${color(bg.color)}`);
    if (bg?.image) out.push(`background-image:url("${asset(bg.image)}");background-size:${bg.size || "cover"};background-position:${bg.position || "center"};background-repeat:${bg.repeat || "no-repeat"}`);
    const border = s._border;
    if (border?.radius) out.push(`border-radius:${["top", "right", "bottom", "left"].map((side) => px(border.radius[side] || 0)).join(" ")}`);
    for (const [side, v] of Object.entries(border?.width || {})) out.push(`border-${side}:${px(v)} ${border.style || "solid"} ${color(border.color) || "currentColor"}`);
    for (const [k, v] of Object.entries(s._typography || {})) {
      if (v === undefined || v === "") continue;
      out.push(`${k}:${k === "color" ? color(v) : k === "font-family" ? `${v},Arial,sans-serif` : ["font-size", "letter-spacing"].includes(k) ? px(v) : v}`);
    }
    const sh = s._boxShadow;
    if (sh?.values) out.push(`box-shadow:${["offsetX", "offsetY", "blur", "spread"].map((k) => px(sh.values[k] || 0)).join(" ")} ${color(sh.color) || "#000"}`);
    const gr = s._gradient;
    if (gr?.colors?.length) {
      out.push(`background-image:linear-gradient(${gr.angle || 180}deg,${gr.colors.map((c) => `${color(c.color)} ${c.stop}`).join(",")})`);
      if (gr.applyTo === "text") out.push("background-clip:text;-webkit-background-clip:text;color:transparent");
    }
    if (s._content !== undefined) out.push(`content:${JSON.stringify(s._content)}`);
    return out.join(";");
  }
  let css = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}h1,h2,h3,h4,h5,h6,p{margin:0}.brxe-section{width:100%;display:flex;flex-direction:column;align-items:center}.brxe-container{width:1200px;max-width:100%;display:flex;flex-direction:column;align-items:flex-start}img{max-width:100%;height:auto;display:block}.bricks-button{display:inline-flex;align-items:center;justify-content:center;padding:.5em 1em;color:inherit;text-decoration:none}`;
  const fontMapFile = path.resolve("preview-fonts.json");
  if (fs.existsSync(fontMapFile)) for (const font of JSON.parse(fs.readFileSync(fontMapFile, "utf8"))) {
    const file = path.resolve(path.dirname(fontMapFile), font.file);
    const mime = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" }[path.extname(file).slice(1)];
    if (!mime || !fs.existsSync(file)) throw new Error(`Preview font missing/unsupported: ${font.file}`);
    css += `@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight || "100 900"};font-style:${font.style || "normal"};src:url("data:${mime};base64,${fs.readFileSync(file).toString("base64")}")}`;
  }
  for (const e of tree) {
    const settings = e.settings || {};
    for (const [bp, max] of [["", null], ...Object.entries(breakpoints)]) {
      let rules = "";
      for (const pseudo of ["", "before", "after"]) {
        const mapped = {};
        for (const [key, value] of Object.entries(settings)) {
          const m = key.match(/^(_[^:]+|iconGap)(?::(tablet_portrait|mobile_landscape|mobile_portrait))?(?:::?(before|after))?$/);
          if (m && (m[2] || "") === bp && (m[3] || "") === pseudo) mapped[m[1]] = value;
        }
        const decl = declarations(mapped);
        if (decl) rules += `#brxe-${e.id}${pseudo ? `::${pseudo}` : ""}{${decl}}`;
      }
      css += max ? `@media(max-width:${max}px){${rules}}` : rules;
    }
    css += (settings._cssCustom || "").replaceAll("__ID__", e.id);
  }
  function render(e) {
    const s = e.settings || {}, id = `brxe-${e.id}`;
    const children = (e.children || []).map((c) => render(byId.get(c))).join("");
    if (["image", "icon"].includes(e.name)) {
      const ref = e.name === "image" ? s.image : s.icon?.svg;
      const size = e.name === "icon" && s.icon?.width ? ` style="width:${escape(px(s.icon.width))}"` : "";
      return `<img id="${id}" src="${escape(asset(ref))}"${size}>`;
    }
    const tag = e.name === "heading" && /^h[1-6]$/.test(s.tag) ? s.tag : e.name === "section" ? "section" : e.name === "button" ? "a" : "div";
    let text = s.text || "";
    if (e.name === "button" && s.icon?.svg) text += `<img style="width:${escape(px(s.icon.width || 20))}" src="${escape(asset(s.icon.svg))}">`;
    return `<${tag} id="${id}" class="brxe-${e.name}${e.name === "button" ? " bricks-button" : ""}">${text}${children}</${tag}>`;
  }
  const body = tree.filter((e) => !e.parent || e.parent === "0").map(render).join("");
  if (missingAssets.size) throw new Error(`Preview assets missing: ${[...missingAssets].join(", ")}`);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body>${body}</body>`;
}

export async function renderScreenshots({ html, url, outDir, widths = [1440, 1024, 390] }) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const results = {};
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      if (url) await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      else await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
      const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        brokenImages: [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.id),
        elements: [...document.querySelectorAll('[id^="brxe-"]')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.id.replace("brxe-", ""), x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; }),
        sections: [...document.querySelectorAll("body > section")].map((e) => { const r = e.getBoundingClientRect(); return { id: e.id.replace("brxe-", ""), x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; }) }));
      metrics.overflowX = metrics.scrollWidth > width + 1;
      const file = path.join(outDir, `${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      results[width] = { ...metrics, screenshot: file };
      await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(results, null, 2));
  return results;
}
