import { getAllVIPEntries, getVIPByRegistration, type VIPEntry } from "./viptrack-db";

export function searchVIPTrack(query: string): VIPEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = getAllVIPEntries();
  if (all.length === 0) return [];

  const regHit = getVIPByRegistration(query.trim());
  const seen = new Set<string>();
  const results: VIPEntry[] = [];

  if (regHit) {
    results.push(regHit);
    seen.add(regHit.icao24);
  }

  for (const e of all) {
    if (seen.has(e.icao24)) continue;
    const icao = e.icao24.toLowerCase();
    const reg = e.registration.toLowerCase();
    const op = e.operator.toLowerCase();
    const type = e.type.toLowerCase();
    const icaoType = e.icaoType.toLowerCase();
    const tags = e.tags.join(" ").toLowerCase();

    if (
      icao === q ||
      reg === q ||
      reg.startsWith(q) ||
      op.includes(q) ||
      type.includes(q) ||
      icaoType.includes(q) ||
      tags.includes(q)
    ) {
      results.push(e);
      seen.add(e.icao24);
      if (results.length >= 20) break;
    }
  }

  results.sort((a, b) => a.priority - b.priority);
  return results.slice(0, 20);
}

export function getNotableFlights(limit: number): VIPEntry[] {
  const all = getAllVIPEntries();
  if (all.length === 0) return [];
  return all.slice(0, Math.min(limit, all.length));
}
