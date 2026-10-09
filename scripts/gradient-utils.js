/**
 * Deterministic Figma GRADIENT_LINEAR -> {angle, stops} conversion.
 *
 * Why this isn't left to the LLM in stage 2: converting gradientHandlePositions
 * (3 normalized points, aspect-ratio dependent) into a CSS/Bricks angle is vector
 * math (atan2) on long decimals. That's exactly what stage 3's compiler philosophy
 * already says to keep out of the LLM - deterministic code does it once, correctly,
 * every time. Stage 2 is given the precomputed result and told to copy it verbatim.
 */

const rgbToHex = (c) => {
  const to2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  const hex = `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`.toUpperCase();
  return c.a !== undefined && c.a < 1 ? hex + Math.round(c.a * 255).toString(16).padStart(2, "0").toUpperCase() : hex;
};

/**
 * fill: a Figma paint object with type "GRADIENT_LINEAR" (gradientHandlePositions + gradientStops).
 * box: { width, height } of the node's absoluteBoundingBox (gradient angle depends on aspect ratio).
 * Returns { angle, stops } in the shape normalized-schema.json's `gradient` definition expects,
 * or null if the fill isn't a linear gradient with the handle data we need.
 */
export function resolveLinearGradient(fill, box, nodeOpacity = 1) {
  if (!fill || fill.type !== "GRADIENT_LINEAR") return null;
  const handles = fill.gradientHandlePositions;
  const stops = fill.gradientStops;
  if (!handles || handles.length < 2 || !stops || !box?.width || !box?.height) return null;

  // Figma defines a linear gradient by an affine frame in the node's normalized box space:
  //   handles[0] = origin (t=0), handles[1] = end of the gradient axis (t=1),
  //   handles[2] = end of the "width" axis - lines of constant colour run PARALLEL to handles[2]-handles[0].
  // When the frame is sheared (handles[2]-handles[0] is not perpendicular to the axis in pixel space) the CSS
  // angle is NOT atan2 of the start->end vector: CSS iso-colour lines are always perpendicular to the axis.
  // So: take the CSS axis as the pixel-space normal of the iso-colour lines, then place the stops by projecting
  // the Figma start/end points onto that axis, relative to CSS's gradient line (length |W sin|+|H cos| through the centre).
  // Verified against Figma's own render: mean colour error on the hero heading dropped from 14.2 (old) to 7.4.
  const W = box.width, H = box.height;
  const P = handles.map((h) => ({ x: h.x * W, y: h.y * H }));
  const a = { x: P[1].x - P[0].x, y: P[1].y - P[0].y };
  let n = { x: a.x, y: a.y }; // fallback (no width handle): axis = start->end
  if (P[2]) {
    const bv = { x: P[2].x - P[0].x, y: P[2].y - P[0].y };
    const perp = { x: -bv.y, y: bv.x };
    if (Math.hypot(perp.x, perp.y) > 1e-6) n = perp.x * a.x + perp.y * a.y < 0 ? { x: -perp.x, y: -perp.y } : perp;
  }
  const nl = Math.hypot(n.x, n.y);
  if (nl < 1e-9) return null;
  const u = { x: n.x / nl, y: n.y / nl };

  // CSS/Bricks gradient angle convention: 0deg points up (north), increases clockwise.
  let angleDeg = (Math.atan2(u.x, -u.y) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  const lineLen = W * Math.abs(u.x) + H * Math.abs(u.y); // CSS gradient line length for this angle
  const proj = (pt) => (pt.x - W / 2) * u.x + (pt.y - H / 2) * u.y;
  const startPct = ((proj(P[0]) + lineLen / 2) / lineLen) * 100;
  const endPct = ((proj(P[1]) + lineLen / 2) / lineLen) * 100;
  const r2 = (v) => Math.round(v * 100) / 100;
  // Figma keeps the paint's opacity (and the node's) separate from the stop colours' own alpha; both fade the gradient.
  // Dropping it turned a 12%-opacity green->red card tint into solid green->red.
  const fade = (fill.opacity ?? 1) * (nodeOpacity ?? 1);

  return {
    angle: r2(angleDeg),
    stops: stops.map((s) => ({
      color: rgbToHex({ ...s.color, a: (s.color?.a ?? 1) * fade }),
      position: r2(startPct + s.position * (endPct - startPct)), // may fall outside 0-100, which CSS allows
    })),
  };
}

/**
 * Walks a Figma node tree and returns precomputed gradients for every node that has one,
 * keyed by Figma node id, tagged with where it was found ("fills" = background/shape fill,
 * on a TEXT node "fills" = text color).
 *   [{ nodeId, name, appliesTo: "text" | "background", gradient: {angle, stops} }]
 * Only the FIRST gradient paint per node is used (multiple stacked gradient fills on one
 * node are rare and not representable in Bricks' single _gradient slot anyway).
 */
export function collectGradients(root) {
  const out = [];
  function walk(node) {
    if (node.visible === false) return;
    const fills = node.fills || [];
    const g = fills.filter((f) => f.visible !== false).map((f) => resolveLinearGradient(f, node.absoluteBoundingBox, node.opacity)).find(Boolean);
    if (g) {
      out.push({
        nodeId: node.id,
        name: node.name,
        appliesTo: node.type === "TEXT" ? "text" : "background",
        gradient: g,
      });
    }
    for (const c of node.children || []) walk(c);
  }
  walk(root);
  return out;
}