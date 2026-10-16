/** Compile preserved measurements only when the installed element schema exposes the control. */
export function applyFigmaSettings(node, settings, { supportedKeys = new Set(), assetUrl, parentNode } = {}) {
  const source = node.figma;
  const warnings = [];
  if (!source) return warnings;
  const supported = supportedKeys instanceof Set ? supportedKeys : new Set(supportedKeys);
  const set = (key, value) => {
    if (value === undefined) return;
    if (supported.has(key)) settings[key] = value;
    else warnings.push(`${node.id}: native control ${key} is unavailable; source measurement retained in normalized metadata`);
  };
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  if (source.visible === false || source.effectiveVisible === false) set("_display", "none");
  if (source.clipsContent === true) set("_overflow", "hidden");
  // Existing image/icon assets are Figma node exports, with node opacity already baked into their pixels.
  if (finite(source.opacity) && source.opacity !== 1 && !["image", "icon"].includes(node.type)) set("_opacity", String(source.opacity));
  for (const [input, key] of [["minWidth", "_widthMin"], ["maxWidth", "_widthMax"], ["minHeight", "_heightMin"], ["maxHeight", "_heightMax"]]) if (finite(source[input])) set(key, `${source[input]}px`);
  if (finite(source.layoutGrow) && source.layoutGrow !== 0) set("_flexGrow", String(source.layoutGrow));
  if (source.layoutAlign === "STRETCH") set("_alignSelf", "stretch");
  if (source.type === 'TEXT' && (source.textAutoResize || source.style?.textAutoResize) === 'WIDTH_AND_HEIGHT' && parentNode?.layout?.direction === 'row' && !String(node.text || '').includes('\n')) {
    set('_flexShrink', '0'); set('_width', parentNode._measuredRowWidth && source.absoluteBoundingBox ? `${source.absoluteBoundingBox.width}px` : 'auto');
  }
  if (node.asset && source.type === 'LINE' && source.absoluteBoundingBox?.width < 0.01 && parentNode?.layout?.direction === 'row') {
    // The SVG already contains the stroke. Keep its painted width while its
    // layout footprint remains the source line's zero width.
    const width = source.strokeWeight || 1;
    delete settings._border;
    set('_width', `${width}px`); set('_widthMax', `${width}px`); set('_flexShrink', '0');
    set('_margin', { ...(settings._margin || {}), left: `${(parseFloat(settings._margin?.left)||0)-width/2}px`, right: `${(parseFloat(settings._margin?.right)||0)-width/2}px` });
  }
  const hasAbsoluteChildren = (node.children || []).some((child) => child.figma?.position?.mode === "absolute" || child.figma?.layoutPositioning === "ABSOLUTE");
  if(source.type==='TEXT' && source.style?.textAlignHorizontal==='CENTER' && parentNode?.layout?.direction!=='row'){
    set('_alignSelf','center');set('_width','100%');
  }
  if (hasAbsoluteChildren || source.geometryPositioned) set("_position", "relative");
  // Artwork pinned behind flowing content: the parent opens a stacking context so a negative z-index stays inside it.
  if (source.geometryLayered) { set("_position", "relative"); set("_zIndex", "0"); }
  if (source.position?.mode === "absolute") {
    // Measured offsets refer to the original parent's origin, so regrouping must not reuse them blindly.
    const actualParent = parentNode?.figmaNodeId || parentNode?.asset?.nodeId;
    if (parentNode && source.parentId && actualParent !== source.parentId) warnings.push(`${node.id}: absolute offset belongs to Figma parent ${source.parentId}, not ${actualParent || parentNode.id}; positioning requires reconciliation`);
    else {
      set("_position", "absolute");
      const crop = source.exportBounds, box = source.absoluteBoundingBox;
      if (finite(source.position.left)) set("_left", `${source.position.left + (crop && box ? crop.x-box.x : 0)}px`);
      if (finite(source.position.top)) set("_top", `${source.position.top + (crop && box ? crop.y-box.y : 0)}px`);
      if (source.position.behind) set("_zIndex", "-1");
      const width = crop?.width ?? source.size?.x ?? source.absoluteBoundingBox?.width;
      const height = crop?.height ?? source.size?.y ?? source.absoluteBoundingBox?.height;
      if (finite(width)) { set("_width", `${width}px`); set("_widthMax", "100%"); } // a pinned layer may never be wider than its box: no sideways scrolling on narrow screens
      if (finite(height)) set("_height", `${height}px`);
    }
  }
  if (node.border?.radii) {
    const radii = node.border.radii;
    const radius = {};
    for (const [corner, side] of [["topLeft", "top"], ["topRight", "right"], ["bottomRight", "bottom"], ["bottomLeft", "left"]]) if (finite(radii[corner])) radius[side] = `${radii[corner]}px`;
    set("_border", { ...(settings._border || {}), radius });
  }
  if (source.strokeAlign && source.strokeAlign !== "INSIDE" && node.border?.width) warnings.push(`${node.id}: ${source.strokeAlign.toLowerCase()} Figma stroke retained in metadata; CSS border lies inside the box`);
  if (source.cornerSmoothing > 0) warnings.push(`${node.id}: corner smoothing retained; CSS border radius represents circular corners`);
  const imageFill = (source.fills || []).find((fill) => fill.visible !== false && fill.type === "IMAGE");
  if (imageFill && node.type !== "image" && node.type !== "icon") {
    const sourceImage = source.imageFillAsset?.exportMode === "source-image";
    const resolved = typeof assetUrl === "function" ? assetUrl(source.imageFillAsset?.nodeId || node.figmaNodeId) : assetUrl;
    if (resolved) {
      // Source-only fills keep text and other children independently editable.
      const image = typeof resolved === "string" ? { id: null, filename: null, size: "full", url: resolved, full: resolved } : resolved;
      const size = sourceImage ? ({ FILL: "cover", FIT: "contain", TILE: "auto", STRETCH: "100% 100%" }[imageFill.scaleMode] || "cover") : "100% 100%";
      set("_background", { ...(settings._background || {}), image, size, position: "center center", repeat: sourceImage && imageFill.scaleMode === "TILE" ? "repeat" : "no-repeat" });
      if (!sourceImage && source.opacity !== undefined && source.opacity !== 1) warnings.push(`${node.id}: exported image background includes opacity; native opacity can fade that background twice`);
      if (!sourceImage && source.childIds?.length) warnings.push(`${node.id}: legacy rendered-node background may include child artwork; refresh extraction for source-image-only export`);
      if (sourceImage && imageFill.imageTransform) warnings.push(`${node.id}: custom image fill transform retained in figma.fills; native cover/contain does not express arbitrary cropping matrices`);
      if (imageFill.scaleMode === "TILE") warnings.push(`${node.id}: tile scale parameters retained in figma.fills; native repeat uses the image's natural dimensions until its tile scale is configured`);
      if (sourceImage && imageFill.opacity !== undefined && imageFill.opacity !== 1) warnings.push(`${node.id}: image paint opacity retained; fading this background alone requires a verified native background-layer control`);
    } else warnings.push(`${node.id}: image background export is unresolved`);
  }
  if (source.isMask) warnings.push(`${node.id}: arbitrary Figma mask requires an exported graphic or explicit native mask mapping`);
  if (finite(source.rotation) && Math.abs(source.rotation) > 0.001 || source.relativeTransform && (Math.abs(source.relativeTransform[0]?.[1] || 0) > 0.001 || Math.abs(source.relativeTransform[1]?.[0] || 0) > 0.001)) warnings.push(`${node.id}: rotated or sheared geometry preserved; transform mapping requires verified nested control values`);
  return warnings;
}
