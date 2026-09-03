export interface VIPEntry {
  icao24: string;
  registration: string;
  operator: string;
  type: string;
  icaoType: string;
  tags: string[];
  category: string;
  link: string;
  priority: number;
}

let _cache: VIPEntry[] | null = null;
let _loadPromise: Promise<VIPEntry[]> | null = null;

let _byIcao24: Map<string, VIPEntry> | null = null;
let _byRegistration: Map<string, VIPEntry> | null = null;
let _byOperator: VIPEntry[] | null = null;
let _byTag: Map<string, VIPEntry[]> | null = null;

export async function loadVIPTrack(): Promise<VIPEntry[]> {
  if (_cache) return _cache;
  if (_loadPromise) return _loadPromise;
  _loadPromise = fetch("/data/viptrack.json")
    .then((r) => r.json() as Promise<VIPEntry[]>)
    .then((data) => {
      _cache = data;
      buildIndexes(data);
      return data;
    })
    .catch((err) => {
      _loadPromise = null;
      throw err;
    });
  return _loadPromise;
}

function buildIndexes(data: VIPEntry[]): void {
  const icao = new Map<string, VIPEntry>();
  const reg = new Map<string, VIPEntry>();
  const op: VIPEntry[] = [];
  const tag = new Map<string, VIPEntry[]>();

  for (const e of data) {
    icao.set(e.icao24.toLowerCase(), e);
    if (e.registration) reg.set(e.registration.toUpperCase(), e);
    op.push(e);
    for (const t of e.tags) {
      const tl = t.toLowerCase();
      const arr = tag.get(tl);
      if (arr) arr.push(e);
      else tag.set(tl, [e]);
    }
  }

  op.sort((a, b) => a.operator.localeCompare(b.operator));

  _byIcao24 = icao;
  _byRegistration = reg;
  _byOperator = op;
  _byTag = tag;
}

export function getVIPEntry(icao24: string): VIPEntry | null {
  if (!_byIcao24) return null;
  return _byIcao24.get(icao24.toLowerCase()) ?? null;
}

export function getVIPByRegistration(registration: string): VIPEntry | null {
  if (!_byRegistration) return null;
  return _byRegistration.get(registration.toUpperCase()) ?? null;
}

export function getVIPByOperatorIndex(): VIPEntry[] {
  return _byOperator ?? [];
}

export function getVIPByTag(tag: string): VIPEntry[] {
  if (!_byTag) return [];
  return _byTag.get(tag.toLowerCase()) ?? [];
}

export function getAllVIPEntries(): VIPEntry[] {
  return _cache ?? [];
}

export function isVIPDBLoaded(): boolean {
  return _cache !== null;
}
