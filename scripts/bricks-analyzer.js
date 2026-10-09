import fs from "fs";
import path from "path";

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const inputFile =
  process.argv[2] || "./homepage.json";

const outputDir = "./output";


// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function ensureOutputDir() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getShape(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      itemTypes: [...new Set(value.map(v => typeof v))]
    };
  }

  if (isObject(value)) {
    return {
      type: "object",
      keys: Object.keys(value).sort()
    };
  }

  return {
    type: typeof value
  };
}

// Deep, real-value sample of a setting — recursive, but caps array length to
// 1 sample item (with a note of true length) and truncates long strings, so
// e.g. accordion's `accordions` array of 6 Q&A pairs collapses to 1 real
// example rather than dumping the whole thing into the schema file.
function deepValueSample(value, depthLeft = 5) {
  if (Array.isArray(value)) {
    return {
      __array_length: value.length,
      __sample_item: value.length && depthLeft > 0 ? deepValueSample(value[0], depthLeft - 1) : null,
    };
  }
  if (isObject(value)) {
    if (depthLeft <= 0) return "__object_truncated";
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepValueSample(v, depthLeft - 1);
    return out;
  }
  if (typeof value === "string" && value.length > 80) {
    return value.slice(0, 80) + "…";
  }
  return value;
}

function walkElements(elements, callback, parentId = null) {
  if (!Array.isArray(elements)) return;

  for (const element of elements) {
    if (!element || typeof element !== "object") continue;

    callback(element, parentId);

    if (Array.isArray(element.children)) {
      walkElements(element.children, callback, element.id);
    }

    if (Array.isArray(element.content)) {
      walkElements(element.content, callback, element.id);
    }
  }
}


// --------------------------------------------------
// LOAD JSON
// --------------------------------------------------

console.log("");
console.log("======================================");
console.log("        BRICKS JSON ANALYZER");
console.log("======================================");
console.log("");

console.log("Input:", inputFile);

if (!fs.existsSync(inputFile)) {
  console.error("");
  console.error("ERROR: JSON file not found.");
  console.error("");
  console.error("Expected file:");
  console.error(path.resolve(inputFile));
  console.error("");
  console.error("Usage:");
  console.error(
    'node scripts/bricks-analyzer.js "your-file.json"'
  );
  process.exit(1);
}

let data;

try {
  data = JSON.parse(fs.readFileSync(inputFile, "utf8"));
} catch (error) {
  console.error("");
  console.error("ERROR: Could not parse JSON.");
  console.error(error.message);
  process.exit(1);
}

console.log("JSON loaded successfully.");


// --------------------------------------------------
// FIND ELEMENTS
// --------------------------------------------------

let elements = [];

if (Array.isArray(data)) {
  elements = data;
} else if (Array.isArray(data.content)) {
  elements = data.content;
} else if (Array.isArray(data.elements)) {
  elements = data.elements;
}

if (!elements.length) {
  console.warn("");
  console.warn("WARNING: No element array found.");
  console.warn("Top-level keys:", Object.keys(data));
  process.exit(0);
}

console.log("Root elements:", elements.length);

// Bricks stores content as a FLAT array — every element (however deeply
// nested visually) sits at the top level of `content`, with `parent`
// pointing at another element's id and `children` listing ITS children's
// ids as strings (not nested objects). Build a lookup so we can resolve
// "what type is child X" for the structural-pattern report below.
const byId = new Map();
for (const el of elements) {
  if (el && el.id) byId.set(el.id, el);
}


// --------------------------------------------------
// ANALYSIS STORAGE
// --------------------------------------------------

const elementTypes = {};
const settingKeysByElementType = {}; // for schema/bricks-elements.json
const valueShapesByElementType = {}; // NEW: element type -> setting key -> {shape signature -> sample}
const settingKeys = {};
const responsiveKeys = {};
const pseudoKeys = {};

const settingShapes = {};

const typographyKeys = {};
const backgroundKeys = {};
const borderKeys = {};
const shadowKeys = {};
const gradientKeys = {};

const specialStructures = {
  image: [],
  icon: [],
  link: []
};

const customCSS = [];
const cssClasses = [];
const cssIds = [];

const allElementIds = new Set();
const parentRelationships = [];

const structuralPatterns = {};

let totalElements = 0;


// --------------------------------------------------
// ANALYZE ELEMENTS
// --------------------------------------------------

walkElements(elements, (element, parentId) => {

  totalElements++;

  const id = element.id || null;
  const type = element.name || element.type || "unknown";

  if (id) {
    allElementIds.add(id);
  }

  elementTypes[type] = (elementTypes[type] || 0) + 1;

  if (parentId) {
    parentRelationships.push({
      child: id,
      parent: parentId
    });
  }

  // ----------------------------------------------
  // Analyze settings (Bricks nests real settings one
  // level deeper, inside element.settings — NOT on
  // the element itself. That's the bug that produced
  // "Settings found: 5" before: it was counting
  // {id, name, parent, children, settings, themeStyles}
  // as if those were the settings.)
  // ----------------------------------------------

  const settingsObj = isObject(element.settings) ? element.settings : {};

  if (!settingKeysByElementType[type]) {
    settingKeysByElementType[type] = { count: 0, settingKeys: {} };
  }
  settingKeysByElementType[type].count++;

  if (!valueShapesByElementType[type]) valueShapesByElementType[type] = {};

  for (const [key, value] of Object.entries(settingsObj)) {

    settingKeys[key] = (settingKeys[key] || 0) + 1;
    settingKeysByElementType[type].settingKeys[key] =
      (settingKeysByElementType[type].settingKeys[key] || 0) + 1;

    // Deep real-value sample, keyed by shape signature so we keep up to a
    // few genuinely different shapes per key (e.g. _padding with 2 sides
    // set vs. all 4 sides set) instead of just the first one seen.
    const shape = getShape(value);
    const shapeSig = JSON.stringify(shape);
    if (!valueShapesByElementType[type][key]) valueShapesByElementType[type][key] = {};
    if (
      !valueShapesByElementType[type][key][shapeSig] &&
      Object.keys(valueShapesByElementType[type][key]).length < 3
    ) {
      valueShapesByElementType[type][key][shapeSig] = deepValueSample(value);
    }

    // Responsive settings
    if (key.includes(":")) {
      responsiveKeys[key] = (responsiveKeys[key] || 0) + 1;
    }

    // Pseudo elements
    if (
      key.includes("::before") ||
      key.includes("::after")
    ) {
      pseudoKeys[key] = (pseudoKeys[key] || 0) + 1;
    }

    // --------------------------------------------
    // Shape of setting (reuses `shape`/`shapeSig` computed above)
    // --------------------------------------------

    if (!settingShapes[key]) {
      settingShapes[key] = {
        occurrences: 0,
        shapes: {}
      };
    }

    settingShapes[key].occurrences++;

    settingShapes[key].shapes[shapeSig] =
      (settingShapes[key].shapes[shapeSig] || 0) + 1;


    // --------------------------------------------
    // Nested structures
    // --------------------------------------------

    if (key === "_typography" && isObject(value)) {

      for (const nestedKey of Object.keys(value)) {
        typographyKeys[nestedKey] =
          (typographyKeys[nestedKey] || 0) + 1;
      }
    }

    if (key === "_background" && isObject(value)) {

      for (const nestedKey of Object.keys(value)) {
        backgroundKeys[nestedKey] =
          (backgroundKeys[nestedKey] || 0) + 1;
      }
    }

    if (key === "_border" && isObject(value)) {

      for (const nestedKey of Object.keys(value)) {
        borderKeys[nestedKey] =
          (borderKeys[nestedKey] || 0) + 1;
      }
    }

    if (key === "_boxShadow" && isObject(value)) {

      for (const nestedKey of Object.keys(value)) {
        shadowKeys[nestedKey] =
          (shadowKeys[nestedKey] || 0) + 1;
      }
    }

    if (key === "_gradient" && isObject(value)) {

      for (const nestedKey of Object.keys(value)) {
        gradientKeys[nestedKey] =
          (gradientKeys[nestedKey] || 0) + 1;
      }
    }


    // --------------------------------------------
    // Special structures
    // --------------------------------------------

    if (key === "image" && isObject(value)) {
      specialStructures.image.push({
        elementId: id,
        elementType: type,
        keys: Object.keys(value)
      });
    }

    if (key === "icon" && isObject(value)) {
      specialStructures.icon.push({
        elementId: id,
        elementType: type,
        keys: Object.keys(value)
      });
    }

    if (key === "link" && isObject(value)) {
      specialStructures.link.push({
        elementId: id,
        elementType: type,
        keys: Object.keys(value)
      });
    }


    // --------------------------------------------
    // Custom CSS
    // --------------------------------------------

    if (key === "_cssCustom" && value) {

      customCSS.push({
        elementId: id,
        elementType: type,
        css: value
      });
    }


    // --------------------------------------------
    // CSS classes / IDs
    // --------------------------------------------

    if (key === "_cssClasses" && value) {

      cssClasses.push({
        elementId: id,
        elementType: type,
        value
      });
    }

    if (key === "_cssId" && value) {

      cssIds.push({
        elementId: id,
        elementType: type,
        value
      });
    }
  }


  // ----------------------------------------------
  // Structural signature
  // ----------------------------------------------

  const childTypes = [];

  if (Array.isArray(element.children)) {
    for (const childId of element.children) {
      // children are id strings in this export format — resolve via byId
      const child = typeof childId === "string" ? byId.get(childId) : childId;
      childTypes.push(
        (child && (child.name || child.type)) || "unknown"
      );
    }
  }

  const signature = [
    type,
    childTypes.join(",")
  ].join(" -> ");

  if (!structuralPatterns[signature]) {
    structuralPatterns[signature] = {
      count: 0,
      elementIds: [],
      elementType: type,
      children: childTypes
    };
  }

  structuralPatterns[signature].count++;

  if (id) {
    structuralPatterns[signature].elementIds.push(id);
  }

});


// --------------------------------------------------
// BUILD REPORT
// --------------------------------------------------

const repeatedPatterns = Object.entries(structuralPatterns)
  .filter(([_, value]) => value.count > 1)
  .sort((a, b) => b[1].count - a[1].count)
  .map(([signature, value]) => ({
    signature,
    ...value
  }));

const report = {

  meta: {
    inputFile,
    totalElements,
    rootElements: elements.length,
    generatedAt: new Date().toISOString()
  },

  elementTypes,

  settingKeys,

  responsiveKeys,

  pseudoKeys,

  typographyKeys,

  backgroundKeys,

  borderKeys,

  shadowKeys,

  gradientKeys,

  settingShapes,

  specialStructures,

  customCSS,

  cssClasses,

  cssIds,

  parentRelationships,

  structuralPatterns,

  repeatedPatterns

};


// --------------------------------------------------
// WRITE OUTPUT
// --------------------------------------------------

ensureOutputDir();

const jsonOutput = path.join(
  outputDir,
  "bricks-analysis.json"
);

fs.writeFileSync(
  jsonOutput,
  JSON.stringify(report, null, 2)
);


// --------------------------------------------------
// MARKDOWN REPORT
// --------------------------------------------------

let md = "";

md += "# Bricks JSON Analysis\n\n";

md += `**Input:** \`${inputFile}\`\n\n`;

md += `**Total elements:** ${totalElements}\n\n`;

md += "## Element Types\n\n";

for (const [type, count] of Object.entries(elementTypes)
  .sort((a, b) => b[1] - a[1])) {

  md += `- **${type}**: ${count}\n`;
}

md += "\n## All Setting Keys\n\n";

for (const [key, count] of Object.entries(settingKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Responsive Settings\n\n";

for (const [key, count] of Object.entries(responsiveKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Pseudo-element Settings\n\n";

for (const [key, count] of Object.entries(pseudoKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Typography Keys\n\n";

for (const [key, count] of Object.entries(typographyKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Background Keys\n\n";

for (const [key, count] of Object.entries(backgroundKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Border Keys\n\n";

for (const [key, count] of Object.entries(borderKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Box Shadow Keys\n\n";

for (const [key, count] of Object.entries(shadowKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Gradient Keys\n\n";

for (const [key, count] of Object.entries(gradientKeys)
  .sort((a, b) => b[1] - a[1])) {

  md += `- \`${key}\` — ${count}\n`;
}

md += "\n## Images\n\n";

md += `Total image structures: ${specialStructures.image.length}\n\n`;

md += "\n## Icons\n\n";

md += `Total icon structures: ${specialStructures.icon.length}\n\n`;

md += "\n## Links\n\n";

md += `Total link structures: ${specialStructures.link.length}\n\n`;

md += "\n## Custom CSS\n\n";

md += `Total elements with custom CSS: ${customCSS.length}\n\n`;

md += "\n## CSS Classes\n\n";

md += `Total elements with CSS classes: ${cssClasses.length}\n\n`;

md += "\n## CSS IDs\n\n";

md += `Total elements with CSS IDs: ${cssIds.length}\n\n`;

md += "\n## Repeated Structural Patterns\n\n";

for (const pattern of repeatedPatterns.slice(0, 100)) {

  md += `### ${pattern.count}×\n\n`;

  md += `\`${pattern.signature}\`\n\n`;

  md += `Element IDs: ${pattern.elementIds.join(", ")}\n\n`;
}

const mdOutput = path.join(
  outputDir,
  "bricks-analysis.md"
);

fs.writeFileSync(
  mdOutput,
  md
);


// --------------------------------------------------
// CONSOLE SUMMARY
// --------------------------------------------------

console.log("");
console.log("======================================");
console.log("           ANALYSIS COMPLETE");
console.log("======================================");
console.log("");

console.log("Total elements:", totalElements);

console.log("");
console.log("Element types:");

for (const [type, count] of Object.entries(elementTypes)
  .sort((a, b) => b[1] - a[1])) {

  console.log(`  ${type}: ${count}`);
}

console.log("");
console.log("Settings found:", Object.keys(settingKeys).length);
console.log("Responsive settings:", Object.keys(responsiveKeys).length);
console.log("Pseudo settings:", Object.keys(pseudoKeys).length);
console.log("Custom CSS:", customCSS.length);
console.log("Images:", specialStructures.image.length);
console.log("Icons:", specialStructures.icon.length);
console.log("Links:", specialStructures.link.length);
console.log("Repeated patterns:", repeatedPatterns.length);

console.log("");

// --------------------------------------------------
// SCHEMA FILES — generated FROM your real data, not
// hand-written. Re-run this analyzer against more of
// your real page exports and these get more complete.
// --------------------------------------------------

const schemaDir = "./schema";
if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir, { recursive: true });

// bricks-elements.json: which settings actually appear on each element type,
// and how often — so the compiler knows what's plausible vs. what it's
// inventing when it builds a "heading" or "button" element.
const bricksElements = {};
for (const [type, info] of Object.entries(settingKeysByElementType)) {
  bricksElements[type] = {
    count: info.count,
    observedSettingKeys: Object.entries(info.settingKeys)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    // Real sample values per key, up to 3 distinct shapes each — this is
    // what bricks-schema.js and bricks-validator.js should be checked
    // against instead of guessed value shapes.
    sampleValues: valueShapesByElementType[type] || {},
  };
}
fs.writeFileSync(
  path.join(schemaDir, "bricks-elements.json"),
  JSON.stringify(bricksElements, null, 2)
);

// bricks-settings.json: shape of each nested setting object (_typography,
// _padding, _background, _border, _boxShadow, _gradient) as actually seen,
// so the compiler emits the right nested keys instead of guessed ones.
const bricksSettings = {
  responsiveKeys: Object.keys(responsiveKeys).sort(),
  pseudoKeys: Object.keys(pseudoKeys).sort(),
  typography: Object.keys(typographyKeys).sort(),
  background: Object.keys(backgroundKeys).sort(),
  border: Object.keys(borderKeys).sort(),
  boxShadow: Object.keys(shadowKeys).sort(),
  gradient: Object.keys(gradientKeys).sort(),
  imageSettingShape: specialStructures.image[0]
    ? Object.keys(byId.get(specialStructures.image[0].elementId)?.settings?.image || {})
    : [],
  iconSettingShape: specialStructures.icon[0]
    ? Object.keys(byId.get(specialStructures.icon[0].elementId)?.settings?.icon || {})
    : [],
};
fs.writeFileSync(
  path.join(schemaDir, "bricks-settings.json"),
  JSON.stringify(bricksSettings, null, 2)
);

console.log("Reports created:");

console.log(path.resolve(jsonOutput));
console.log(path.resolve(mdOutput));
console.log(path.resolve(path.join(schemaDir, "bricks-elements.json")));
console.log(path.resolve(path.join(schemaDir, "bricks-settings.json")));

console.log("");