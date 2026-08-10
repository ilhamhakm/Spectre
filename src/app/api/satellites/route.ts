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

// Fallback Starlink TLEs: used when CelesTrak is rate-limited (403).
// 80 representative sats across 4 orbital shells:
//   53deg(30), 53.2deg(20), 43deg(15), 70deg(15).
// Generated by scripts/gen-starlink-fallbacks.js.
const FALLBACK_STARLINK_TLES: { name: string; tle1: string; tle2: string; noradId: number }[] = [
{ name: "STARLINK-47100", noradId: 47100, tle1: "1 47100U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47100  53.0000   0.0000 0001234  90.0000   0.0000  15.0600 481006" },
  { name: "STARLINK-47101", noradId: 47101, tle1: "1 47101U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47101  53.0000   0.0000 0001234  90.5000  72.0000  15.0600 481012" },
  { name: "STARLINK-47102", noradId: 47102, tle1: "1 47102U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47102  53.0000   0.0000 0001234  91.0000  144.000  15.0600 481020" },
  { name: "STARLINK-47103", noradId: 47103, tle1: "1 47103U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47103  53.0000   0.0000 0001234  91.5000  216.000  15.0600 481037" },
  { name: "STARLINK-47104", noradId: 47104, tle1: "1 47104U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47104  53.0000   0.0000 0001234  92.0000  288.000  15.0600 481044" },
  { name: "STARLINK-47105", noradId: 47105, tle1: "1 47105U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47105  53.0000  60.0000 0001234  90.0000   0.0000  15.0600 481052" },
  { name: "STARLINK-47106", noradId: 47106, tle1: "1 47106U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47106  53.0000  60.0000 0001234  90.5000  72.0000  15.0600 481068" },
  { name: "STARLINK-47107", noradId: 47107, tle1: "1 47107U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47107  53.0000  60.0000 0001234  91.0000  144.000  15.0600 481076" },
  { name: "STARLINK-47108", noradId: 47108, tle1: "1 47108U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47108  53.0000  60.0000 0001234  91.5000  216.000  15.0600 481083" },
  { name: "STARLINK-47109", noradId: 47109, tle1: "1 47109U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47109  53.0000  60.0000 0001234  92.0000  288.000  15.0600 481090" },
  { name: "STARLINK-47110", noradId: 47110, tle1: "1 47110U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47110  53.0000  120.000 0001234  90.0000   0.0000  15.0600 481101" },
  { name: "STARLINK-47111", noradId: 47111, tle1: "1 47111U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47111  53.0000  120.000 0001234  90.5000  72.0000  15.0600 481117" },
  { name: "STARLINK-47112", noradId: 47112, tle1: "1 47112U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47112  53.0000  120.000 0001234  91.0000  144.000  15.0600 481125" },
  { name: "STARLINK-47113", noradId: 47113, tle1: "1 47113U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47113  53.0000  120.000 0001234  91.5000  216.000  15.0600 481132" },
  { name: "STARLINK-47114", noradId: 47114, tle1: "1 47114U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47114  53.0000  120.000 0001234  92.0000  288.000  15.0600 481149" },
  { name: "STARLINK-47115", noradId: 47115, tle1: "1 47115U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47115  53.0000  180.000 0001234  90.0000   0.0000  15.0600 481157" },
  { name: "STARLINK-47116", noradId: 47116, tle1: "1 47116U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47116  53.0000  180.000 0001234  90.5000  72.0000  15.0600 481163" },
  { name: "STARLINK-47117", noradId: 47117, tle1: "1 47117U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47117  53.0000  180.000 0001234  91.0000  144.000  15.0600 481171" },
  { name: "STARLINK-47118", noradId: 47118, tle1: "1 47118U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47118  53.0000  180.000 0001234  91.5000  216.000  15.0600 481188" },
  { name: "STARLINK-47119", noradId: 47119, tle1: "1 47119U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47119  53.0000  180.000 0001234  92.0000  288.000  15.0600 481195" },
  { name: "STARLINK-47120", noradId: 47120, tle1: "1 47120U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47120  53.0000  240.000 0001234  90.0000   0.0000  15.0600 481206" },
  { name: "STARLINK-47121", noradId: 47121, tle1: "1 47121U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47121  53.0000  240.000 0001234  90.5000  72.0000  15.0600 481212" },
  { name: "STARLINK-47122", noradId: 47122, tle1: "1 47122U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47122  53.0000  240.000 0001234  91.0000  144.000  15.0600 481220" },
  { name: "STARLINK-47123", noradId: 47123, tle1: "1 47123U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47123  53.0000  240.000 0001234  91.5000  216.000  15.0600 481237" },
  { name: "STARLINK-47124", noradId: 47124, tle1: "1 47124U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47124  53.0000  240.000 0001234  92.0000  288.000  15.0600 481244" },
  { name: "STARLINK-47125", noradId: 47125, tle1: "1 47125U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47125  53.0000  300.000 0001234  90.0000   0.0000  15.0600 481253" },
  { name: "STARLINK-47126", noradId: 47126, tle1: "1 47126U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47126  53.0000  300.000 0001234  90.5000  72.0000  15.0600 481269" },
  { name: "STARLINK-47127", noradId: 47127, tle1: "1 47127U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47127  53.0000  300.000 0001234  91.0000  144.000  15.0600 481277" },
  { name: "STARLINK-47128", noradId: 47128, tle1: "1 47128U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47128  53.0000  300.000 0001234  91.5000  216.000  15.0600 481284" },
  { name: "STARLINK-47129", noradId: 47129, tle1: "1 47129U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47129  53.0000  300.000 0001234  92.0000  288.000  15.0600 481291" },
  { name: "STARLINK-47130", noradId: 47130, tle1: "1 47130U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47130  53.2000   0.0000 0001234  90.0000   0.0000  15.0800 481306" },
  { name: "STARLINK-47131", noradId: 47131, tle1: "1 47131U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47131  53.2000   0.0000 0001234  90.5000  72.0000  15.0800 481312" },
  { name: "STARLINK-47132", noradId: 47132, tle1: "1 47132U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47132  53.2000   0.0000 0001234  91.0000  144.000  15.0800 481320" },
  { name: "STARLINK-47133", noradId: 47133, tle1: "1 47133U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47133  53.2000   0.0000 0001234  91.5000  216.000  15.0800 481337" },
  { name: "STARLINK-47134", noradId: 47134, tle1: "1 47134U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47134  53.2000   0.0000 0001234  92.0000  288.000  15.0800 481344" },
  { name: "STARLINK-47135", noradId: 47135, tle1: "1 47135U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47135  53.2000  90.0000 0001234  90.0000   0.0000  15.0800 481355" },
  { name: "STARLINK-47136", noradId: 47136, tle1: "1 47136U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47136  53.2000  90.0000 0001234  90.5000  72.0000  15.0800 481361" },
  { name: "STARLINK-47137", noradId: 47137, tle1: "1 47137U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47137  53.2000  90.0000 0001234  91.0000  144.000  15.0800 481379" },
  { name: "STARLINK-47138", noradId: 47138, tle1: "1 47138U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47138  53.2000  90.0000 0001234  91.5000  216.000  15.0800 481386" },
  { name: "STARLINK-47139", noradId: 47139, tle1: "1 47139U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47139  53.2000  90.0000 0001234  92.0000  288.000  15.0800 481393" },
  { name: "STARLINK-47140", noradId: 47140, tle1: "1 47140U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47140  53.2000  180.000 0001234  90.0000   0.0000  15.0800 481407" },
  { name: "STARLINK-47141", noradId: 47141, tle1: "1 47141U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47141  53.2000  180.000 0001234  90.5000  72.0000  15.0800 481413" },
  { name: "STARLINK-47142", noradId: 47142, tle1: "1 47142U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47142  53.2000  180.000 0001234  91.0000  144.000  15.0800 481421" },
  { name: "STARLINK-47143", noradId: 47143, tle1: "1 47143U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47143  53.2000  180.000 0001234  91.5000  216.000  15.0800 481438" },
  { name: "STARLINK-47144", noradId: 47144, tle1: "1 47144U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47144  53.2000  180.000 0001234  92.0000  288.000  15.0800 481445" },
  { name: "STARLINK-47145", noradId: 47145, tle1: "1 47145U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47145  53.2000  270.000 0001234  90.0000   0.0000  15.0800 481457" },
  { name: "STARLINK-47146", noradId: 47146, tle1: "1 47146U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47146  53.2000  270.000 0001234  90.5000  72.0000  15.0800 481463" },
  { name: "STARLINK-47147", noradId: 47147, tle1: "1 47147U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47147  53.2000  270.000 0001234  91.0000  144.000  15.0800 481471" },
  { name: "STARLINK-47148", noradId: 47148, tle1: "1 47148U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47148  53.2000  270.000 0001234  91.5000  216.000  15.0800 481488" },
  { name: "STARLINK-47149", noradId: 47149, tle1: "1 47149U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47149  53.2000  270.000 0001234  92.0000  288.000  15.0800 481495" },
  { name: "STARLINK-47150", noradId: 47150, tle1: "1 47150U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47150  43.0000   0.0000 0001234  90.0000   0.0000  15.1200 481502" },
  { name: "STARLINK-47151", noradId: 47151, tle1: "1 47151U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47151  43.0000   0.0000 0001234  90.5000  72.0000  15.1200 481518" },
  { name: "STARLINK-47152", noradId: 47152, tle1: "1 47152U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47152  43.0000   0.0000 0001234  91.0000  144.000  15.1200 481526" },
  { name: "STARLINK-47153", noradId: 47153, tle1: "1 47153U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47153  43.0000   0.0000 0001234  91.5000  216.000  15.1200 481533" },
  { name: "STARLINK-47154", noradId: 47154, tle1: "1 47154U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47154  43.0000   0.0000 0001234  92.0000  288.000  15.1200 481540" },
  { name: "STARLINK-47155", noradId: 47155, tle1: "1 47155U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47155  43.0000  120.000 0001234  90.0000   0.0000  15.1200 481555" },
  { name: "STARLINK-47156", noradId: 47156, tle1: "1 47156U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47156  43.0000  120.000 0001234  90.5000  72.0000  15.1200 481561" },
  { name: "STARLINK-47157", noradId: 47157, tle1: "1 47157U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47157  43.0000  120.000 0001234  91.0000  144.000  15.1200 481579" },
  { name: "STARLINK-47158", noradId: 47158, tle1: "1 47158U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47158  43.0000  120.000 0001234  91.5000  216.000  15.1200 481586" },
  { name: "STARLINK-47159", noradId: 47159, tle1: "1 47159U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47159  43.0000  120.000 0001234  92.0000  288.000  15.1200 481593" },
  { name: "STARLINK-47160", noradId: 47160, tle1: "1 47160U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47160  43.0000  240.000 0001234  90.0000   0.0000  15.1200 481600" },
  { name: "STARLINK-47161", noradId: 47161, tle1: "1 47161U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47161  43.0000  240.000 0001234  90.5000  72.0000  15.1200 481616" },
  { name: "STARLINK-47162", noradId: 47162, tle1: "1 47162U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47162  43.0000  240.000 0001234  91.0000  144.000  15.1200 481624" },
  { name: "STARLINK-47163", noradId: 47163, tle1: "1 47163U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47163  43.0000  240.000 0001234  91.5000  216.000  15.1200 481631" },
  { name: "STARLINK-47164", noradId: 47164, tle1: "1 47164U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47164  43.0000  240.000 0001234  92.0000  288.000  15.1200 481648" },
  { name: "STARLINK-47165", noradId: 47165, tle1: "1 47165U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47165  70.0000   0.0000 0001234  90.0000   0.0000  15.0400 481655" },
  { name: "STARLINK-47166", noradId: 47166, tle1: "1 47166U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47166  70.0000   0.0000 0001234  90.5000  72.0000  15.0400 481661" },
  { name: "STARLINK-47167", noradId: 47167, tle1: "1 47167U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47167  70.0000   0.0000 0001234  91.0000  144.000  15.0400 481679" },
  { name: "STARLINK-47168", noradId: 47168, tle1: "1 47168U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47168  70.0000   0.0000 0001234  91.5000  216.000  15.0400 481686" },
  { name: "STARLINK-47169", noradId: 47169, tle1: "1 47169U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47169  70.0000   0.0000 0001234  92.0000  288.000  15.0400 481693" },
  { name: "STARLINK-47170", noradId: 47170, tle1: "1 47170U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9999", tle2: "2 47170  70.0000  120.000 0001234  90.0000   0.0000  15.0400 481700" },
  { name: "STARLINK-47171", noradId: 47171, tle1: "1 47171U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9990", tle2: "2 47171  70.0000  120.000 0001234  90.5000  72.0000  15.0400 481716" },
  { name: "STARLINK-47172", noradId: 47172, tle1: "1 47172U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9991", tle2: "2 47172  70.0000  120.000 0001234  91.0000  144.000  15.0400 481724" },
  { name: "STARLINK-47173", noradId: 47173, tle1: "1 47173U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9992", tle2: "2 47173  70.0000  120.000 0001234  91.5000  216.000  15.0400 481731" },
  { name: "STARLINK-47174", noradId: 47174, tle1: "1 47174U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9993", tle2: "2 47174  70.0000  120.000 0001234  92.0000  288.000  15.0400 481748" },
  { name: "STARLINK-47175", noradId: 47175, tle1: "1 47175U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9994", tle2: "2 47175  70.0000  240.000 0001234  90.0000   0.0000  15.0400 481753" },
  { name: "STARLINK-47176", noradId: 47176, tle1: "1 47176U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9995", tle2: "2 47176  70.0000  240.000 0001234  90.5000  72.0000  15.0400 481769" },
  { name: "STARLINK-47177", noradId: 47177, tle1: "1 47177U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9996", tle2: "2 47177  70.0000  240.000 0001234  91.0000  144.000  15.0400 481777" },
  { name: "STARLINK-47178", noradId: 47178, tle1: "1 47178U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9997", tle2: "2 47178  70.0000  240.000 0001234  91.5000  216.000  15.0400 481784" },
  { name: "STARLINK-47179", noradId: 47179, tle1: "1 47179U 19074A   26222.50000000  .00001500  00000+0  92631-4 0  9998", tle2: "2 47179  70.0000  240.000 0001234  92.0000  288.000  15.0400 481791" },
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

const STARLINK_SAMPLE = 500;
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
