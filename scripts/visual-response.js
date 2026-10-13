import { jsonrepair } from "jsonrepair";
import { validateReview } from "./visual-patches.js";

export function parseVisualResponse(text, ids) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Vision model returned an empty response.");
  const raw = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let value, repaired = false;
  try { value = JSON.parse(raw); }
  catch { value = JSON.parse(jsonrepair(raw)); repaired = true; }
  return { review: validateReview(value, ids), repaired };
}
