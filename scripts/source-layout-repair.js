import { buttonLike, figmaColor } from './figma-preservation.js';
import { resolveLinearGradient } from './gradient-utils.js';
import { repairSourceFaq } from './source-faq.js';

// Repair semantic losses in saved AI output using source hierarchy, never copy guesses.
export function repairSourceLayout(doc, root) {
  const raw = new Map(), parents = new Map(), report = [];
  (function index(n, p) { raw.set(n.id, n); parents.set(n.id, p); for (const c of n.children || []) index(c, n); })(root);
  const mediaOnly = n => ['image', 'icon', 'spacer'].includes(n.type) || n.type === 'block' && !!n.background && !n.children?.length || !!n.children?.length && n.children.every(mediaOnly);
  const represented = new Set();
  (function index(n) { if(n.figmaNodeId) represented.add(n.figmaNodeId); if(n.asset?.nodeId) represented.add(n.asset.nodeId); for(const c of n.children || []) index(c); })(doc);
  function bounds(n) {
    const own = raw.get(n.figmaNodeId || n.asset?.nodeId)?.absoluteBoundingBox;
    if (own) return own;
    const bs = (n.children || []).map(bounds).filter(Boolean);
    if (!bs.length) return null;
    const x=Math.min(...bs.map(b=>b.x)),y=Math.min(...bs.map(b=>b.y));
    return {x,y,width:Math.max(...bs.map(b=>b.x+b.width))-x,height:Math.max(...bs.map(b=>b.y+b.height))-y};
  }
  function visit(n, owner) {
    let source = raw.get(n.figmaNodeId || n.asset?.nodeId);
    const box = source?.absoluteBoundingBox, pageBox = root.absoluteBoundingBox;
    if ((n.type === 'row' || n.layout?.direction === 'row') && mediaOnly(n) && box?.height <= 48 && n.children?.length > 1) {
      const bs = n.children.map(bounds).filter(Boolean);
      if (bs.length === n.children.length && bs.every(b => Math.abs(b.y+b.height/2-box.y-box.height/2) <= 1)) n.layout = { ...(n.layout || {}), align: 'center' };
    }
    if (n.children?.length > 1 && box && pageBox && box.height <= 64 && box.width >= 600 && box.y-pageBox.y >= 0 && box.y-pageBox.y <= 128) {
      n.size = { ...(n.size || {}), width: box.width }; n._measuredRowWidth = box.width;
      const boxes = n.children.map(bounds).filter(Boolean);
      if (boxes.length === n.children.length && boxes.every(b => Math.abs(b.y+b.height/2-box.y-box.height/2) <= 1)) n.layout = { ...(n.layout || {}), align: 'center' };
    }
    if (source && n.children?.length && mediaOnly(n)) for (const missing of source.children || []) {
      const fill=missing.fills?.find(f=>f.visible!==false && ['SOLID','GRADIENT_LINEAR'].includes(f.type)), b=missing.absoluteBoundingBox;
      if (missing.visible!==false && missing.type==='RECTANGLE' && !missing.children?.length && fill && b && !represented.has(missing.id)) {
        n.children.push({id:`source-paint-${missing.id.replace(/[^a-z0-9]/gi,'-')}`,type:'block',figmaNodeId:missing.id,background:fill.type==='SOLID'?{color:figmaColor(fill.color,fill.opacity??1)}:{gradient:resolveLinearGradient(fill,b)},size:{width:b.width,height:b.height}});
        represented.add(missing.id); report.push(`${missing.id}: recovered painted cover inside layered artwork`);
      }
    }
    const parent = parents.get(source?.id);
    const candidate = source && buttonLike(source, (source.children || []).filter(c => c.visible !== false)) ? source
      : source?.type === 'TEXT' && parent && buttonLike(parent, (parent.children || []).filter(c => c.visible !== false)) ? parent : null;
    if (candidate && n.type !== 'button') {
      const label = buttonLike(candidate, candidate.children.filter(c => c.visible !== false));
      n.type = 'button'; n.figmaNodeId = candidate.id; n.text = label.characters;
      delete n.children; delete n.asset; delete n.level; delete n.figma;
      n.size = { width: candidate.absoluteBoundingBox.width };
      const b = candidate.absoluteBoundingBox, t = label.absoluteBoundingBox;
      n.layout = { ...(n.layout?.margin ? { margin: n.layout.margin } : {}), padding: { top: t.y-b.y, left: t.x-b.x, right: b.x+b.width-t.x-t.width, bottom: b.y+b.height-t.y-t.height } };
      if (owner && owner.type !== 'row' && owner.layout?.direction !== 'row') {
        const at=owner.children.indexOf(n), previous=at>0?bounds(owner.children[at-1]):null, ob=bounds(owner);
        n.layout.margin = { ...(n.layout.margin || {}), ...(previous?{top:Math.max(0,b.y-previous.y-previous.height-(owner.layout?.gap||0))}:{}), ...(ob?{left:Math.max(0,b.x-ob.x-(owner.layout?.padding?.left||0))}:{}) };
      }
      report.push(`${candidate.id}: restored source button frame and label`);
      return;
    }
    if (n.type === 'row' || n.layout?.direction === 'row') for (const c of n.children || []) {
      const s = raw.get(c.figmaNodeId);
      if (s?.children?.length && s.absoluteBoundingBox && (c.size?.width === 'hug' || c.size?.width === undefined)) {
        c.size = { ...(c.size || {}), width: s.absoluteBoundingBox.width };
        c._measuredRowWidth = s.absoluteBoundingBox.width;
      }
    }
    for (const c of n.children || []) visit(c, n);
    if (source?.type === 'GROUP' && n.layout?.padding?.bottom !== undefined && n.children?.length && !n.figma?.geometryPositioned) {
      const children=n.children.map(bounds).filter(Boolean), b=source.absoluteBoundingBox;
      if (b && children.length===n.children.length) n.layout.padding.bottom=Math.max(0,b.y+b.height-Math.max(...children.map(c=>c.y+c.height)));
    }
    if (!source || !mediaOnly(n) || (n.children || []).length < 2 || ['HORIZONTAL', 'VERTICAL', 'GRID'].includes(source.layoutMode)) return;
    const kids = n.children, sources = kids.map(c => raw.get(c.figmaNodeId || c.asset?.nodeId));
    if (sources.some(s => !s?.absoluteBoundingBox || parents.get(s.id)?.id !== source.id)) return;
    const boxes = sources.map(s => s.absoluteBoundingBox);
    const overlap = boxes.some((a, i) => boxes.some((b, j) => i < j && Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>2 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>2));
    if (!overlap) return;
    const b = source.absoluteBoundingBox;
    n.type = 'block'; n.layout = {}; n.size = { width: b.width, height: b.height };
    n.figma = { ...(n.figma || {}), geometryDerived: true, geometryPositioned: true };
    kids.sort((a,c) => source.children.findIndex(s=>s.id===(a.figmaNodeId||a.asset?.nodeId))-source.children.findIndex(s=>s.id===(c.figmaNodeId||c.asset?.nodeId)));
    for (const c of kids) {
      const box = raw.get(c.figmaNodeId || c.asset.nodeId).absoluteBoundingBox;
      c.layout = {}; c.figma = { ...(c.figma || {}), geometryDerived: true, position: { mode: 'absolute', left: box.x-b.x, top: box.y-b.y } };
    }
    report.push(`${source.id}: preserved ${kids.length} overlapping artwork layers in source paint order`);
  }
  visit(doc);
  report.push(...repairSourceFaq(doc));
  return { doc, report };
}
