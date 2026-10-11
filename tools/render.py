#!/usr/bin/env python3
"""Bricks tree -> HTML preview -> screenshot + layout-accuracy metric against the Figma frame.

usage: render.py <bricks-tree.json | template.json> <frame-dir> <out-prefix> [--widths 1440,1024,390]

The preview mimics what Bricks does with the settings the compiler emits (flex / grid / sizes / padding / margin / typography / backgrounds /
pseudo-elements / breakpoints). Invalid CSS values are written as-is so the browser ignores them exactly as it would on the site.
Images are placeholders sized from the Figma asset box (the asset files are not needed).

Metric: every visible Figma TEXT node is matched to the rendered element with the same copy; x is measured from the frame's left edge and
y from the top of the page. Reports mean / p90 error, how many texts were found, and how many sit more than 8px off.
"""
import json, sys, os, re, html, base64, collections
from playwright.sync_api import sync_playwright

tree_path, frame_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
widths = [1440]
if "--widths" in sys.argv:
    widths = [int(x) for x in sys.argv[sys.argv.index("--widths") + 1].split(",")]

raw = json.load(open(tree_path))
content = raw["content"] if isinstance(raw, dict) else raw
byid = {e["id"]: e for e in content}
figma = json.load(open(os.path.join(frame_dir, "figma-node.json")))
manifest = {}
mp = os.path.join(frame_dir, "asset-manifest.json")
if os.path.exists(mp):
    for a in json.load(open(mp)):
        manifest[os.path.basename(a["file"])] = a["nodeId"]
fidx = {}
def walk(n):
    fidx[n["id"]] = n
    for c in n.get("children", []) or []:
        walk(c)
walk(figma)
root_box = figma["absoluteBoundingBox"]

BP = {"tablet_portrait": 1024, "mobile_landscape": 767, "mobile_portrait": 478}
PX_KEYS = {"_rowGap", "_columnGap", "_gridGap", "_gap", "_width", "_widthMax", "_widthMin", "_height", "_heightMin", "_heightMax", "_top", "_left", "_right", "_bottom"}

def px(v):
    if v is None: return None
    s = str(v).strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", s): return s + "px"
    return s

def sides(v, prop):
    out = []
    for k in ("top", "right", "bottom", "left"):
        if k in v and v[k] not in (None, ""):
            out.append(f"{prop}-{k}:{px(v[k])}")
    return out

def color(c):
    if isinstance(c, dict): return c.get("raw") or c.get("hex")
    return c

def placeholder(url):
    name = os.path.basename(url or "")
    nid = manifest.get(name)
    n = fidx.get(nid) if nid else None
    w, h = 100, 100
    if n and n.get("absoluteBoundingBox"):
        w, h = n["absoluteBoundingBox"]["width"], max(1, n["absoluteBoundingBox"]["height"])
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.1f}" height="{h:.1f}" viewBox="0 0 {w:.1f} {h:.1f}"><rect width="100%" height="100%" fill="#8aa" fill-opacity=".35" stroke="#8aa" stroke-opacity=".8"/></svg>'
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode(), w, h

def decl(settings, name):
    """css declarations for one breakpoint suffix ('' = base)"""
    d = []
    suf = "" if name == "" else ":" + name
    def g(k): return settings.get(k + suf)
    m = {"_display": "display", "_direction": "flex-direction", "_flexDirection": "flex-direction", "_alignItems": "align-items", "_alignItemsGrid": "align-items",
         "_justifyContent": "justify-content", "_flexWrap": "flex-wrap", "_gridTemplateColumns": "grid-template-columns", "_position": "position",
         "_overflow": "overflow", "_zIndex": "z-index", "_alignSelf": "align-self", "_flexGrow": "flex-grow", "_flexShrink": "flex-shrink", "_flexBasis": "flex-basis", "_opacity": "opacity", "_objectFit": "object-fit"}
    for k, p in m.items():
        v = g(k)
        if v not in (None, ""): d.append(f"{p}:{v}")
    for k, p in {"_rowGap": "row-gap", "_columnGap": "column-gap", "_gridGap": "gap", "_gap": "gap", "_width": "width", "_widthMax": "max-width", "_widthMin": "min-width",
                 "_height": "height", "_heightMin": "min-height", "_heightMax": "max-height", "_top": "top", "_left": "left", "_right": "right", "_bottom": "bottom"}.items():
        v = g(k)
        if v not in (None, ""): d.append(f"{p}:{px(v)}")
    v = g("_padding")
    if isinstance(v, dict): d += sides(v, "padding")
    v = g("_margin")
    if isinstance(v, dict): d += sides(v, "margin")
    v = g("_background")
    if isinstance(v, dict):
        if v.get("color"): d.append(f"background-color:{color(v['color'])}")
        img = v.get("image")
        if isinstance(img, dict) and (img.get("url") or img.get("full")):
            d.append(f"background-image:url({placeholder(img.get('url') or img.get('full'))[0]})")
            d.append(f"background-size:{v.get('size') or 'cover'}")
            d.append(f"background-position:{v.get('position') or 'center center'}")
            d.append(f"background-repeat:{v.get('repeat') or 'no-repeat'}")
    v = g("_gradient")
    if isinstance(v, dict) and v.get("applyTo") == "background":
        stops = ", ".join(f"{color(c['color'])} {c['stop']}" for c in v.get("colors", []))
        d.append(f"background-image:linear-gradient({v.get('angle', 180)}deg, {stops})")
    elif isinstance(v, dict) and v.get("applyTo") == "text":
        stops = ", ".join(f"{color(c['color'])} {c['stop']}" for c in v.get("colors", []))
        d.append(f"background-image:linear-gradient({v.get('angle', 180)}deg, {stops});-webkit-background-clip:text;color:transparent")
    v = g("_border")
    if isinstance(v, dict):
        r = v.get("radius")
        if isinstance(r, dict):
            d.append("border-radius:" + " ".join(px(r.get(k, 0)) for k in ("top", "right", "bottom", "left")))
        w = v.get("width")
        if isinstance(w, dict):
            for k in ("top", "right", "bottom", "left"):
                if w.get(k) not in (None, ""):
                    d.append(f"border-{k}:{px(w[k])} {v.get('style','solid')} {color(v.get('color')) or 'currentColor'}")
    v = g("_boxShadow")
    if isinstance(v, dict) and v.get("values"):
        vv = v["values"]
        d.append(f"box-shadow:{px(vv.get('offsetX',0))} {px(vv.get('offsetY',0))} {px(vv.get('blur',0))} {px(vv.get('spread',0))} {color(v.get('color'))}")
    v = g("_typography")
    if isinstance(v, dict):
        for k, p in {"font-family": "font-family", "font-size": "font-size", "font-weight": "font-weight", "line-height": "line-height", "letter-spacing": "letter-spacing", "text-align": "text-align", "text-transform": "text-transform"}.items():
            if v.get(k) not in (None, ""): d.append(f"{p}:{v[k]}")
        if v.get("color"): d.append(f"color:{color(v['color'])}")
    return d

def css_for(e):
    s = e["settings"]
    eid = "brxe-" + e["id"]
    out = []
    base = decl(s, "")
    if base: out.append(f"#{eid}{{{';'.join(base)}}}")
    for pseudo in ("before", "after"):
        for sepr in (":", "::"):
            keys = {k: v for k, v in s.items() if k.endswith(f"{sepr}{pseudo}") and ":" + pseudo in k}
        pk = {}
        for k, v in s.items():
            m = re.fullmatch(r"(_\w+)::?(before|after)", k)
            if m and m.group(2) == pseudo: pk[m.group(1)] = v
        if pk:
            pd = decl(pk, "")
            if "_content" in pk: pd.insert(0, f'content:"{pk["_content"].strip()}"')
            out.append(f"#{eid}::{pseudo}{{{';'.join(pd)}}}")
    for bp, mx in sorted(BP.items(), key=lambda x: -x[1]):
        dd = decl(s, bp)
        if dd: out.append(f"@media (max-width:{mx}px){{#{eid}{{{';'.join(dd)}}}}}")
    if s.get("_cssCustom"):
        out.append(s["_cssCustom"].replace("#brxe-__ID__", f"#{eid}"))
    return out

def render(e):
    s = e["settings"]; n = e["name"]; eid = "brxe-" + e["id"]
    kids = "".join(render(byid[c]) for c in e["children"] if c in byid)
    if n == "section": return f'<section id="{eid}" class="brxe-section">{kids}</section>'
    if n == "container": return f'<div id="{eid}" class="brxe-container">{kids}</div>'
    if n in ("div", "block"): return f'<div id="{eid}" class="brxe-div">{kids}</div>'
    if n == "heading": return f'<{s.get("tag","h3")} id="{eid}" class="brxe-heading">{s.get("text","")}</{s.get("tag","h3")}>'
    if n == "text": return f'<div id="{eid}" class="brxe-text">{s.get("text","")}</div>'
    if n == "text-basic": return f'<div id="{eid}" class="brxe-text-basic">{s.get("text","")}</div>'
    if n == "button":
        ic = s.get("icon")
        return f'<a id="{eid}" class="bricks-button">{html.escape(s.get("text","")) if "<" not in s.get("text","") else s.get("text","")}</a>'
    if n == "image":
        im = s.get("image") or {}
        src, w, h = placeholder(im.get("url") or im.get("full"))
        return f'<img id="{eid}" class="brxe-image" src="{src}">'
    if n == "icon":
        ic = (s.get("icon") or {}).get("svg") or {}
        src, w, h = placeholder(ic.get("url") or ic.get("full"))
        iw = (s.get("icon") or {}).get("width"); ih = (s.get("icon") or {}).get("height")
        st = []
        if iw and re.fullmatch(r"\d+(\.\d+)?", str(iw)): st.append(f"width:{iw}px")
        if ih and re.fullmatch(r"\d+(\.\d+)?", str(ih)): st.append(f"height:{ih}px")
        return f'<img id="{eid}" class="brxe-icon" style="{";".join(st)}" src="{src}">'
    return f'<div id="{eid}">{kids}</div>'

roots = [e for e in content if e["parent"] in (0, "0", None, "")]
css = ["""*{box-sizing:border-box}body{margin:0;background:#000;font-family:Inter,sans-serif;color:#fff}
h1,h2,h3,h4,h5,h6,p{margin:0}
.brxe-section{width:100%;display:flex;flex-direction:column;align-items:center}
.brxe-container{width:1100px;max-width:100%;display:flex;flex-direction:column;align-items:flex-start}
.brxe-div{}
.brxe-image,.brxe-icon{display:block;max-width:100%;height:auto}
.brxe-text,.brxe-text-basic,.brxe-heading{}
.bricks-button{display:inline-flex;align-items:center;justify-content:center;padding:.5em 1em;text-decoration:none;color:inherit}"""]
for e in content: css += css_for(e)
body = "".join(render(r) for r in roots)
doc = f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><style>{chr(10).join(css)}</style><body>{body}</body>"
open(out + ".html", "w").write(doc)

# Figma texts
def norm(t): return re.sub(r"\s+", " ", (t or "").replace(" ", " ").replace(" ", " ")).strip().lower()
ftexts = []
def collect(n):
    if n.get("visible") is False: return
    if n["type"] == "TEXT" and n.get("absoluteBoundingBox") and norm(n.get("characters")):
        b = n["absoluteBoundingBox"]
        al = (n.get("style") or {}).get("textAlignHorizontal", "LEFT")
        ax = b["x"] - root_box["x"] + (b["width"] / 2 if al == "CENTER" else b["width"] if al == "RIGHT" else 0)
        ftexts.append({"id": n["id"], "t": norm(n["characters"]), "al": al, "x": ax, "xl": b["x"] - root_box["x"], "y": b["y"] - root_box["y"], "w": b["width"], "h": b["height"]})
    for c in n.get("children", []) or []: collect(c)
collect(figma)

JS = """() => {
  const out = [];
  const secs = [...document.querySelectorAll('body > section')];
  document.querySelectorAll('.brxe-heading,.brxe-text,.brxe-text-basic,.bricks-button').forEach(el => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    let r = rg.getBoundingClientRect(); if (!r.width && !r.height) r = el.getBoundingClientRect();
    const ta = getComputedStyle(el).textAlign;
    const ax = (ta === 'center') ? r.left + r.width / 2 : (ta === 'right' || ta === 'end') ? r.right : r.left;
    out.push({id: el.id, t: el.textContent, ta: ta, x: ax + scrollX, y: r.y + scrollY, w: r.width, h: r.height, sec: secs.indexOf(el.closest('section'))});
  });
  const over = [];
  const vw = document.documentElement.clientWidth;
  document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width > 0) over.push({id: el.id || el.className, right: Math.round(r.right), w: Math.round(r.width)}); });
  over.sort((a, b) => b.right - a.right);
  return {texts: out, H: document.documentElement.scrollHeight, W: document.documentElement.scrollWidth, over: over.slice(0, 5),
          sections: secs.map(s => {const r = s.getBoundingClientRect(); return {id: s.id, y: r.y + scrollY, h: r.height}})};
}"""

# Figma top-level index of each text
ftop_of = {}
tops = sorted([c for c in figma.get("children", []) if c.get("visible") is not False and c.get("absoluteBoundingBox")], key=lambda c: (c["absoluteBoundingBox"]["y"], c["absoluteBoundingBox"]["x"]))
for i, c in enumerate(tops):
    def mark(n):
        ftop_of[n["id"]] = i
        for k in n.get("children", []) or []: mark(k)
    mark(c)
for t in ftexts: t["top"] = ftop_of.get(t["id"], -1)
top_y = [c["absoluteBoundingBox"]["y"] - root_box["y"] for c in tops]
top_h = [c["absoluteBoundingBox"]["height"] for c in tops]

result = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for W in widths:
        pg = b.new_page(viewport={"width": W, "height": 900})
        pg.goto("file://" + os.path.abspath(out + ".html"))
        pg.wait_for_timeout(300)
        data = pg.evaluate(JS)
        pg.screenshot(path=f"{out}-{W}.png", full_page=True)
        res = {"pageHeight": data["H"], "overflowX": data["W"] > W + 1, "scrollWidth": data["W"], "overflowers": data["over"]}
        if W == widths[0]:
            rt = [{"t": norm(t["t"]), **{k: t[k] for k in ("id", "x", "y", "w", "h", "sec", "ta")}} for t in data["texts"]]
            secy = [s["y"] for s in data["sections"]]
            by = collections.defaultdict(list)
            for t in rt: by[t["t"]].append(t)
            fby = collections.defaultdict(list)
            for t in ftexts: fby[t["t"]].append(t)
            # 1) rendered section -> Figma top-level, voted by texts that are unique on both sides
            votes = collections.defaultdict(collections.Counter)
            for key, fl in fby.items():
                if len(fl) == 1 and len(by.get(key, [])) == 1 and fl[0]["top"] >= 0:
                    votes[by[key][0]["sec"]][fl[0]["top"]] += 1
            smap = {rs: v.most_common(1)[0][0] for rs, v in votes.items()}
            # 2) pair texts inside each mapped (rendered section, figma top) by copy, in reading order; errors are section-relative in y
            errs = []; missing = []
            for rs, ft in smap.items():
                for key in set(t["t"] for t in ftexts if t["top"] == ft):
                    fl = sorted([t for t in ftexts if t["top"] == ft and t["t"] == key], key=lambda t: (t["y"], t["x"]))
                    rl = sorted([t for t in by.get(key, []) if t["sec"] == rs], key=lambda t: (t["y"], t["x"]))
                    used = set()
                    for f in fl:
                        best = None
                        for i, r in enumerate(rl):
                            if i in used: continue
                            dd = abs((r["y"] - secy[rs]) - (f["y"] - top_y[ft])) + abs(r["x"] - f["x"])
                            if best is None or dd < best[0]: best = (dd, i)
                        if best is None: missing.append(f); continue
                        used.add(best[1]); r = rl[best[1]]
                        rx = r["x"]
                        if f["al"] == "CENTER" and r["ta"] not in ("center",): rx = r["x"] + r["w"] / 2
                        elif f["al"] != "CENTER" and r["ta"] == "center": rx = r["x"] - r["w"] / 2
                        errs.append({"t": key[:30], "sec": rs, "dx": rx - f["x"], "dy": (r["y"] - secy[rs]) - (f["y"] - top_y[ft]), "dw": r["w"] - f["w"], "fid": f["id"]})
            # a section's constant vertical shift (padding the merge step adds, tall placeholder pictures above) is not a layout error: remove the per-section median
            persec = collections.defaultdict(list)
            for e in errs: persec[e["sec"]].append(e)
            for rs, lst in persec.items():
                ds = sorted(e["dy"] for e in lst); med = ds[len(ds) // 2]
                for e in lst: e["dy_raw"] = e["dy"]; e["dy"] = e["dy"] - med
            unmapped = [t for t in ftexts if t["top"] not in smap.values()]
            ax = sorted(abs(e["dx"]) for e in errs); ay = sorted(abs(e["dy"]) for e in errs)
            q = lambda a, f: a[int(len(a) * f)] if a else None
            res.update({"texts_figma": len(ftexts), "texts_found": len(errs), "texts_missing": len(missing) + len(unmapped),
                        "mean_abs_dx": sum(ax) / max(1, len(ax)), "mean_abs_dy": sum(ay) / max(1, len(ay)), "p90_dx": q(ax, .9), "p90_dy": q(ay, .9),
                        "off_gt8px": sum(1 for e in errs if abs(e["dx"]) > 8 or abs(e["dy"]) > 8),
                        "missing": [m["t"][:40] for m in missing + unmapped][:40], "worst": sorted(errs, key=lambda e: -(abs(e["dx"]) + abs(e["dy"])))[:25]})
            res["per_section"] = {str(rs): {"figma_top": smap[rs], "n": len(l), "bad": sum(1 for e in l if abs(e["dx"]) > 8 or abs(e["dy"]) > 8), "mean_dx": sum(abs(e["dx"]) for e in l) / len(l), "mean_dy": sum(abs(e["dy"]) for e in l) / len(l)} for rs, l in persec.items()}
            res["figmaHeight"] = root_box["height"]
            res["sections"] = [{"rendered_h": round(data["sections"][rs]["h"]), "figma_h": round(top_h[ft]), "figma_top": ft} for rs, ft in sorted(smap.items())]
        result[W] = res
        pg.close()
    b.close()
json.dump(result, open(out + "-metrics.json", "w"), indent=1)
r = result[widths[0]]
print(f"{os.path.basename(out)}: page {r['pageHeight']:.0f}px (figma {r.get('figmaHeight'):.0f}) | texts found {r.get('texts_found')}/{r.get('texts_figma')} | mean |dx| {r.get('mean_abs_dx', 0):.1f} |dy| {r.get('mean_abs_dy', 0):.1f} | >8px off: {r.get('off_gt8px')}")
for W in widths[1:]:
    rr = result[W]
    print(f"   at {W}px: page {rr['pageHeight']:.0f}px, horizontal overflow: {rr['overflowX']} (scrollWidth {rr['scrollWidth']}) {rr['overflowers'][:2] if rr['overflowX'] else ''}")
