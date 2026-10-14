/** Containers that own source behavior/styles are not expendable geometry wrappers. */
export function hasLayoutBoundary(node) {
  const f = node.figma || {};
  const transform = f.relativeTransform;
  const transformed = Array.isArray(transform) && transform.length === 2 && (transform[0]?.[0] !== 1 || transform[0]?.[1] !== 0 || transform[1]?.[0] !== 0 || transform[1]?.[1] !== 1);
  return !!(node.component || node._nativeName || node._nativeLayoutLock || node.globalClasses?.length || node.cssClasses?.length || f.clipsContent || f.isMask || f.position || (f.opacity !== undefined && f.opacity !== 1) || f.rotation || transformed || (node.children || []).some(c => c.abs || c.figma?.position?.mode === "absolute"));
}
