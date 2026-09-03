import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const csvPath = resolve(root, "public", "data", "plane-alert-civ.csv");
const outPath = resolve(root, "public", "data", "viptrack.json");

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { fields.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

function computePriority(tags) {
  const joined = tags.join(" ").toLowerCase();
  if (joined.includes("oligarch") || joined.includes("dictator")) return 1;
  if (joined.includes("government") || joined.includes("heads of state")) return 2;
  if (joined.includes("bizjet") || joined.includes("climate crisis") || joined.includes("man made climate change")) return 3;
  if (joined.includes("air ambo") || joined.includes("medical evac") || joined.includes("flying doctors")) return 4;
  if (joined.includes("aerial survey") || joined.includes("cargo")) return 5;
  return 6;
}

const raw = readFileSync(csvPath, "utf-8");
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = parseCsvLine(lines[0]);

const idx = {};
for (let i = 0; i < header.length; i++) {
  const h = header[i].replace(/[$#]/g, "").trim().toLowerCase();
  idx[h] = i;
}

const iIcao = idx["icao"] ?? 0;
const iReg = idx["registration"] ?? 1;
const iOp = idx["operator"] ?? 2;
const iType = idx["type"] ?? 3;
const iIcaoType = idx["icao type"] ?? 4;
const iTag1 = idx["tag 1"] ?? 6;
const iTag2 = idx["tag 2"] ?? 7;
const iTag3 = idx["tag 3"] ?? 8;
const iCat = idx["category"] ?? 9;
const iLink = idx["link"] ?? 10;

const entries = [];
for (let i = 1; i < lines.length; i++) {
  const f = parseCsvLine(lines[i]);
  if (f.length < 5) continue;
  const icao24 = (f[iIcao] ?? "").trim().toLowerCase();
  if (!icao24) continue;
  const tags = [f[iTag1], f[iTag2], f[iTag3]]
    .map((t) => (t ?? "").trim())
    .filter((t) => t && t.toLowerCase() !== "none");
  entries.push({
    icao24,
    registration: (f[iReg] ?? "").trim(),
    operator: (f[iOp] ?? "").trim(),
    type: (f[iType] ?? "").trim(),
    icaoType: (f[iIcaoType] ?? "").trim(),
    tags,
    category: (f[iCat] ?? "").trim(),
    link: (f[iLink] ?? "").trim(),
    priority: computePriority(tags),
  });
}

entries.sort((a, b) => a.priority - b.priority || a.operator.localeCompare(b.operator));

writeFileSync(outPath, JSON.stringify(entries));
console.log(`Wrote ${entries.length} entries to ${outPath}`);
