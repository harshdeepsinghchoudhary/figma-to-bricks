const shapeTypes = new Set(["RECTANGLE", "ELLIPSE", "LINE", "VECTOR", "STAR", "REGULAR_POLYGON", "BOOLEAN_OPERATION"]);
const hasContent = (n) => n.visible !== false && (n.type === "TEXT" || n.fills?.some((p) => p.visible !== false && p.type === "IMAGE") || (n.children || []).some(hasContent));

// Imported web designs often contain page -> Body -> App -> stacked sections.
// Descend only through full-width, non-clipping wrappers with no distinct paint.
export function pageSections(root) {
  const visible=n=>(n.children||[]).filter(c=>c.visible!==false&&c.absoluteBoundingBox);
  const paint=n=>(n.fills||[]).filter(p=>p.visible!==false);
  const box=root.absoluteBoundingBox;
  let current=root;
  for(let depth=0;depth<8;depth++){
    const children=visible(current);
    if(children.length!==1)break;
    const child=children[0],b=child.absoluteBoundingBox;
    if(!child.children?.length||!box||Math.abs(b.x-box.x)>1||Math.abs(b.width-box.width)>1||Math.abs(b.y-box.y)>1||child.clipsContent||child.isMask||child.opacity<1||(child.effects||[]).some(e=>e.visible!==false)||(child.strokes||[]).some(e=>e.visible!==false)||['Top','Right','Bottom','Left'].some(s=>(child['padding'+s]||0)!==0))break;
    if(paint(child).length&&JSON.stringify(paint(child))!==JSON.stringify(paint(root)))break;
    current=child;
  }
  const bands=visible(current).sort((a,b)=>a.absoluteBoundingBox.y-b.absoluteBoundingBox.y);
  if(current!==root&&bands.length>=3&&bands.every((n,i)=>n.children?.length&&n.absoluteBoundingBox.width>=box.width*.95&&(!i||n.absoluteBoundingBox.y>=bands[i-1].absoluteBoundingBox.y+bands[i-1].absoluteBoundingBox.height-1)))return bands;
  return visible(root);
}

// A primitive entirely inside a content-bearing sibling belongs to its visual area,
// not to an additional page section. Keep the primitive in the Figma source tree.
export function decorationOwner(node, siblings) {
  if (!shapeTypes.has(node.type) || hasContent(node) || node.children?.length) return null;
  const a = node.absoluteBoundingBox;
  if (!a || a.width <= 0 || a.height <= 0) return null;
  return siblings.filter((n) => n !== node && n.visible !== false && n.children?.length && hasContent(n) && n.absoluteBoundingBox)
    .filter((n) => { const b = n.absoluteBoundingBox; return a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1; })
    .sort((x, y) => x.absoluteBoundingBox.width * x.absoluteBoundingBox.height - y.absoluteBoundingBox.width * y.absoluteBoundingBox.height)[0] || null;
}
