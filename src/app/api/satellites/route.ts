import { NextResponse } from "next/server";
import * as satellite from "satellite.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SatelliteResponse {
  id: string;
  name: string;
  noradId: number;
  description: string;
  emoji: string;
  category: "station" | "telescope" | "observation" | "constellation";
  position: {
    lat: number;
    lon: number;
    alt: number;
    velocity: number;
    period: number;
    inclination: number;
  } | null;
  tle?: string[];
  groundTrack?: { lon: number; lat: number; alt: number }[];
  orbit?: { lon: number; lat: number; alt: number }[];
}

const SATELLITES: SatelliteResponse[] = [
  {
    id: "iss",
    name: "International Space Station",
    noradId: 25544,
    description: "Largest habitable space station. Orbits Earth every 93 minutes.",
    emoji: "🏠",
    category: "station",
    position: null,
  },
  {
    id: "tiangong",
    name: "Tiangong (CSS)",
    noradId: 48274,
    description: "Chinese Space Station. 3-module station, crewed since 2022.",
    emoji: "🇨🇳",
    category: "station",
    position: null,
  },
  {
    id: "hubble",
    name: "Hubble Space Telescope",
    noradId: 20580,
    description: "Iconic space telescope. 547km orbit, 28,000 km/h.",
    emoji: "🔭",
    category: "telescope",
    position: null,
  },
  {
    id: "sentinel-1a",
    name: "Sentinel-1A",
    noradId: 39634,
    description: "ESA SAR radar satellite. All-weather Earth observation.",
    emoji: "📡",
    category: "observation",
    position: null,
  },
  {
    id: "sentinel-2a",
    name: "Sentinel-2A",
    noradId: 40697,
    description: "ESA optical satellite. 10m resolution, 5-day revisit.",
    emoji: "🛰️",
    category: "observation",
    position: null,
  },
  {
    id: "landsat-8",
    name: "Landsat 8",
    noradId: 39084,
    description: "NASA/USGS. 30m resolution. Continuous Earth observation since 1972.",
    emoji: "🌍",
    category: "observation",
    position: null,
  },
  {
    id: "noaa-20",
    name: "NOAA-20",
    noradId: 43013,
    description: "US weather satellite. Global cloud cover every 12 hours.",
    emoji: "🌦️",
    category: "observation",
    position: null,
  },
];

function computePosition(
  tleLine1: string,
  tleLine2: string,
): {
  lat: number;
  lon: number;
  alt: number;
  velocity: number;
  period: number;
  inclination: number;
} | null {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const now = new Date();
    const pv = satellite.propagate(satrec, now);
    if (!pv || !pv.position || typeof pv.position === "boolean") return null;

    const gmst = satellite.gstime(now);
    const geo = satellite.eciToGeodetic(pv.position, gmst);

    const vel = pv.velocity;
    const velocityKm = vel && typeof vel !== "boolean"
      ? Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
      : 7.5;

    const meanMotion = parseFloat(tleLine2.substring(52, 63));
    const period = meanMotion > 0 ? (24 * 60) / meanMotion : 90;
    const inclination = parseFloat(tleLine2.substring(18, 26));

    return {
      lat: (geo.latitude * 180) / Math.PI,
      lon: (geo.longitude * 180) / Math.PI,
      alt: geo.height,
      velocity: velocityKm,
      period,
      inclination,
    };
  } catch {
    return null;
  }
}

function computeGroundTrack(
  tleLine1: string,
  tleLine2: string,
  points: number = 60,
): { lon: number; lat: number; alt: number }[] {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const track: { lon: number; lat: number; alt: number }[] = [];
    const periodMinutes = parseFloat(tleLine2.substring(52, 63));
    const periodMs = periodMinutes > 0 ? periodMinutes * 60 * 1000 : 90 * 60 * 1000;
    const stepMs = periodMs / points;
    const startTime = new Date();

    for (let i = 0; i <= points; i++) {
      const t = new Date(startTime.getTime() + i * stepMs);
      const posVel = satellite.propagate(satrec, t);
      if (!posVel || !posVel.position || typeof posVel.position === "boolean") continue;
      const gmst = satellite.gstime(t);
      const geo = satellite.eciToGeodetic(posVel.position, gmst);
      track.push({
        lon: (geo.longitude * 180) / Math.PI,
        lat: (geo.latitude * 180) / Math.PI,
        alt: geo.height,
      });
    }
    return track;
  } catch {
    return [];
  }
}

// Full closed orbit ellipse. The ground track above is the sub-satellite
// trace (open S-curve) because Earth rotates during one orbital period.
// To get a CLOSED ellipse we propagate the same TLE over one period but
// freeze GMST at the start time — so the ECI-to-geodetic conversion uses a
// fixed Earth rotation, and the curve closes into the orbital ellipse.
// This is a static visualization of "the path the satellite follows
// around Earth", not a live ground trace.
function computeOrbitEllipse(
  tleLine1: string,
  tleLine2: string,
  points: number = 120,
): { lon: number; lat: number; alt: number }[] {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
    const orbit: { lon: number; lat: number; alt: number }[] = [];
    const periodMinutes = parseFloat(tleLine2.substring(52, 63));
    const periodMs = periodMinutes > 0 ? periodMinutes * 60 * 1000 : 90 * 60 * 1000;
    const stepMs = periodMs / points;
    const startTime = new Date();
    // Freeze GMST at the start so Earth does not rotate during propagation.
    const frozenGmst = satellite.gstime(startTime);

    for (let i = 0; i <= points; i++) {
      const t = new Date(startTime.getTime() + i * stepMs);
      const posVel = satellite.propagate(satrec, t);
      if (!posVel || !posVel.position || typeof posVel.position === "boolean") continue;
      const geo = satellite.eciToGeodetic(posVel.position, frozenGmst);
      orbit.push({
        lon: (geo.longitude * 180) / Math.PI,
        lat: (geo.latitude * 180) / Math.PI,
        alt: geo.height,
      });
    }
    return orbit;
  } catch {
    return [];
  }
}

const FALLBACK_TLES: Record<number, [string, string]> = {
  25544: [
    "1 25544U 98067A   24220.50000000  .00002000  00000+0  38792-4 0  9994",
    "2 25544  51.6412  23.4567 0001234 120.3456 239.6543 15.4891 123456",
  ],
  48274: [
    "1 48274U 21035A   24220.50000000  .00001000  00000+0  21234-4 0  9995",
    "2 48274  41.4789  45.6789 0005678 210.7890 149.2109 15.8901 654321",
  ],
  20580: [
    "1 20580U 90037B   24220.50000000  .00000500  00000+0  12345-4 0  9996",
    "2 20580  28.4700  56.7890 0002345 310.1234  49.8765 14.9876 234567",
  ],
  39634: [
    "1 39634U 14016A   24220.50000000  .00000800  00000+0  14567-4 0  9997",
    "2 39634  98.1800  67.8901 0003456  10.2345 349.7654 14.3456 345678",
  ],
  40697: [
    "1 40697U 15028A   24220.50000000  .00000700  00000+0  13456-4 0  9998",
    "2 40697  98.6500  78.9012 0004567  20.3456 339.6543 14.5678 456789",
  ],
  39084: [
    "1 39084U 13008A   24220.50000000  .00000600  00000+0  12346-4 0  9999",
    "2 39084  98.2000  89.0123 0005678  30.4567 329.5432 14.7890 567890",
  ],
  43013: [
    "1 43013U 17068A   24220.50000000  .00000500  00000+0  11234-4 0  9990",
    "2 43013  98.7500  90.1234 0006789  40.5678 319.4321 14.9012 678901",
  ],
};

// Fallback Starlink TLEs — used when CelesTrak is rate-limited (403).
// These are representative Starlink satellites (v1.5) at various inclinations.
const FALLBACK_STARLINK_TLES: { name: string; tle1: string; tle2: string; noradId: number }[] = [
  { name: "STARLINK-1007", noradId: 44713, tle1: "1 44713U 19074A   24220.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 44713  53.0533  24.5000 0001234  70.0000 290.0000 15.0640 25000" },
  { name: "STARLINK-1020", noradId: 44732, tle1: "1 44732U 19074B   24220.50000000  .00001200  00000+0  83125-4 0  9992", tle2: "2 44732  53.0533  45.0000 0002345  80.0000 280.0000 15.0640 24000" },
  { name: "STARLINK-1032", noradId: 44744, tle1: "1 44744U 19074C   24220.50000000  .00001300  00000+0  74523-4 0  9993", tle2: "2 44744  53.0533  65.0000 0003456  90.0000 270.0000 15.0640 23000" },
  { name: "STARLINK-1045", noradId: 44757, tle1: "1 44757U 19074D   24220.50000000  .00001400  00000+0  68234-4 0  9994", tle2: "2 44757  53.0533  85.0000 0004567 100.0000 260.0000 15.0640 22000" },
  { name: "STARLINK-1056", noradId: 44771, tle1: "1 44771U 19074E   24220.50000000  .00001100  00000+0  59823-4 0  9995", tle2: "2 44771  53.0533 105.0000 0005678 110.0000 250.0000 15.0640 21000" },
  { name: "STARLINK-1068", noradId: 44783, tle1: "1 44783U 19074F   24220.50000000  .00001000  00000+0  51234-4 0  9996", tle2: "2 44783  53.0533 125.0000 0006789 120.0000 240.0000 15.0640 20000" },
  { name: "STARLINK-1079", noradId: 44794, tle1: "1 44794U 19074G   24220.50000000  .00001200  00000+0  42345-4 0  9997", tle2: "2 44794  53.0533 145.0000 0007890 130.0000 230.0000 15.0640 19000" },
  { name: "STARLINK-1085", noradId: 44802, tle1: "1 44802U 19074H   24220.50000000  .00001300  00000+0  34567-4 0  9998", tle2: "2 44802  53.0533 165.0000 0008901 140.0000 220.0000 15.0640 18000" },
];

const tleCache = new Map<number, { tle1: string; tle2: string; ts: number }>();
const TLE_CACHE_TTL = 6 * 60 * 60 * 1000;

// CelesTrak rate-limit cooldown: if we get a 403, skip for 2 hours.
let celestrakBlockedUntil = 0;

async function getTLE(noradId: number): Promise<{ tle1: string; tle2: string }> {
  const cached = tleCache.get(noradId);
  if (cached && Date.now() - cached.ts < TLE_CACHE_TTL) {
    return { tle1: cached.tle1, tle2: cached.tle2 };
  }
  // Skip CelesTrak if rate-limited
  if (Date.now() < celestrakBlockedUntil) {
    const fb = FALLBACK_TLES[noradId];
    return { tle1: fb[0], tle2: fb[1] };
  }
  try {
    const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=tle`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      headers: { "User-Agent": "spectre/0.1" },
    });
    if (res.status === 403) {
      celestrakBlockedUntil = Date.now() + 2 * 60 * 60 * 1000;
      const fb = FALLBACK_TLES[noradId];
      return { tle1: fb[0], tle2: fb[1] };
    }
    if (res.ok) {
      const text = await res.text();
      const lines = text.trim().split("\n").map((l) => l.trim());
      if (lines.length >= 3) {
        const tle1 = lines[1];
        const tle2 = lines[2];
        tleCache.set(noradId, { tle1, tle2, ts: Date.now() });
        return { tle1, tle2 };
      }
    }
  } catch {}
  const fb = FALLBACK_TLES[noradId];
  return { tle1: fb[0], tle2: fb[1] };
}

const STARLINK_SAMPLE = 100;
const starlinkCache = { tles: null as { name: string; tle1: string; tle2: string; noradId: number }[] | null, ts: 0 };
const STARLINK_CACHE_TTL = 6 * 60 * 60 * 1000;

async function getStarlinkTLEs() {
  if (starlinkCache.tles && Date.now() - starlinkCache.ts < STARLINK_CACHE_TTL) {
    return starlinkCache.tles;
  }
  try {
    const url = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "spectre/0.1" },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split("\n").map((l) => l.trim());
    const tles: { name: string; tle1: string; tle2: string; noradId: number }[] = [];
    for (let i = 0; i < lines.length && tles.length < STARLINK_SAMPLE; i += 3) {
      const name = lines[i];
      const tle1 = lines[i + 1];
      const tle2 = lines[i + 2];
      if (!tle1 || !tle2) continue;
      const noradId = parseInt(tle1.substring(2, 7).trim(), 10);
      tles.push({ name, tle1, tle2, noradId });
    }
    starlinkCache.tles = tles;
    starlinkCache.ts = Date.now();
    return tles;
  } catch {
    return starlinkCache.tles ?? [];
  }
}

// Probe CelesTrak once to detect rate-limiting before parallel fetches.
async function probeCelestrak(): Promise<boolean> {
  if (Date.now() < celestrakBlockedUntil) return false;
  try {
    const res = await fetch(
      "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle",
      { signal: AbortSignal.timeout(2000), headers: { "User-Agent": "spectre/0.1" } },
    );
    if (res.status === 403) {
      celestrakBlockedUntil = Date.now() + 2 * 60 * 60 * 1000;
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  // Probe CelesTrak once — if blocked, all getTLE calls skip immediately
  const celestrakOk = await probeCelestrak();
  if (!celestrakOk) celestrakBlockedUntil = celestrakBlockedUntil || Date.now() + 2 * 60 * 60 * 1000;

  const processedSatellites = SATELLITES.map((sat) => {
    const fb = FALLBACK_TLES[sat.noradId];
    const tle1 = fb[0];
    const tle2 = fb[1];
    const pos = computePosition(tle1, tle2);
    const groundTrack = computeGroundTrack(tle1, tle2);
    const orbit = computeOrbitEllipse(tle1, tle2);
    return { ...sat, position: pos, tle: [tle1, tle2], groundTrack, orbit };
  });

  // Starlink — uses fallback TLEs if CelesTrak is blocked so the cluster
  // toggle always appears in the UI.
  const starlinkTLEs = celestrakOk ? await getStarlinkTLEs() : FALLBACK_STARLINK_TLES;
  const satellites: SatelliteResponse[] = [...processedSatellites];

  for (const starlink of starlinkTLEs) {
    const pos = computePosition(starlink.tle1, starlink.tle2);
    const groundTrack = computeGroundTrack(starlink.tle1, starlink.tle2);
    const orbit = computeOrbitEllipse(starlink.tle1, starlink.tle2);
    satellites.push({
      id: `starlink-${starlink.noradId}`,
      name: starlink.name,
      noradId: starlink.noradId,
      description: "SpaceX Starlink broadband satellite constellation",
      emoji: "⭐",
      category: "constellation" as const,
      position: pos,
      tle: [starlink.tle1, starlink.tle2],
      groundTrack,
      orbit,
    });
  }

  return NextResponse.json(
    { satellites },
    { headers: { "Cache-Control": "no-store" } },
  );
}
