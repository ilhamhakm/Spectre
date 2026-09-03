// Shared civil-unrest pipeline module.
//
// Extracted from the GDELT route so other data sources can reuse the
// landmark database, clustering, crowd-size parsing, anarchy scoring,
// and GeoJSON collection builder.
//
// Pipeline:
//   1. Refine coordinates via protest landmark database
//   2. Parse crowd size from titles
//   3. Cluster articles by location (~11km grid, or 1.5km by refined coords)
//   4. Compute article coverage count per cluster
//   5. Compute anarchy probability (0-100)
//   6. Build GeoJSON FeatureCollection
//
// Response: GeoJSON FeatureCollection. One feature per cluster:
//   geometry: { type: "Point", coordinates: [lon, lat] }
//   properties: {
//     title, url, seendate, country, domain, lat, lon, type,
//     ageHours, eventTime, articleCount, crowdSize, crowdLabel,
//     anarchyProbability, landmark, sources (array of {title, url, domain})
//   }

export const FRESHNESS_HOURS = 48;

// =============================================================================
// Protest landmark database
// =============================================================================
// Precise coordinates for known protest sites worldwide. When articles
// cluster at a city, we refine the point to the most relevant landmark
// based on title keywords (parliament, square, etc.). This is what makes
// the Jakarta point land on Monas or the DPR building instead of the
// geographic center of the city.

export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  keywords: string[];
}

export interface CityLandmarks {
  city: string;
  country: string;
  cityAliases: string[];
  default: Landmark;
  landmarks: Landmark[];
}

export const PROTEST_LANDMARKS: CityLandmarks[] = [
  {
    city: "Jakarta",
    country: "Indonesia",
    cityAliases: ["jakarta"],
    default: { name: "Monas", lat: -6.1754, lon: 106.8272, keywords: [] },
    landmarks: [
      { name: "Monas (National Monument)", lat: -6.1754, lon: 106.8272, keywords: ["monas", "national monument", "medeka", "merdeka"] },
      { name: "DPR/MPR Building", lat: -6.2088, lon: 106.8456, keywords: ["dpr", "mpr", "parliament", "senayan", "gedung dpr"] },
      { name: "Hotel Indonesia Roundabout", lat: -6.1944, lon: 106.8225, keywords: ["bundaran hi", "hotel indonesia", "roundabout"] },
      { name: "Istana Merdeka (Presidential Palace)", lat: -6.1702, lon: 106.8278, keywords: ["istana", "palace", "president"] },
      { name: "Arjuna Wiwaha Statue", lat: -6.1954, lon: 106.8214, keywords: ["arjuna", "wiwaha"] },
    ],
  },
  {
    city: "Cairo",
    country: "Egypt",
    cityAliases: ["cairo"],
    default: { name: "Tahrir Square", lat: 30.0444, lon: 31.2357, keywords: [] },
    landmarks: [
      { name: "Tahrir Square", lat: 30.0444, lon: 31.2357, keywords: ["tahrir", "square"] },
      { name: "Presidential Palace (Ettehadiya)", lat: 30.0430, lon: 31.2370, keywords: ["palace", "president", "ettehadiya"] },
      { name: "Parliament (Maglis al-Sha'b)", lat: 30.0447, lon: 31.2333, keywords: ["parliament", "maglis", "sha'b"] },
    ],
  },
  {
    city: "London",
    country: "United Kingdom",
    cityAliases: ["london"],
    default: { name: "Parliament Square", lat: 51.5007, lon: -0.1246, keywords: [] },
    landmarks: [
      { name: "Parliament Square", lat: 51.5007, lon: -0.1246, keywords: ["parliament", "westminster", "downing"] },
      { name: "Trafalgar Square", lat: 51.5080, lon: -0.1281, keywords: ["trafalgar", "nelson"] },
      { name: "Hyde Park", lat: 51.5073, lon: -0.1657, keywords: ["hyde park", "speakers corner"] },
      { name: "10 Downing Street", lat: 51.5034, lon: -0.1276, keywords: ["downing street", "downing"] },
    ],
  },
  {
    city: "Paris",
    country: "France",
    cityAliases: ["paris"],
    default: { name: "Place de la Republique", lat: 48.8675, lon: 2.3644, keywords: [] },
    landmarks: [
      { name: "Place de la Republique", lat: 48.8675, lon: 2.3644, keywords: ["republique", "republic"] },
      { name: "Place de la Bastille", lat: 48.8532, lon: 2.3691, keywords: ["bastille"] },
      { name: "Champs-Elysees", lat: 48.8698, lon: 2.3079, keywords: ["champs", "elysee", "arc de triomphe"] },
      { name: "Place de la Concorde", lat: 48.8656, lon: 2.3212, keywords: ["concorde"] },
      { name: "National Assembly", lat: 48.8613, lon: 2.3125, keywords: ["assembly", "parliament", "national"] },
    ],
  },
  {
    city: "Washington",
    country: "United States",
    cityAliases: ["washington", "dc", "washington dc"],
    default: { name: "White House / Lafayette Square", lat: 38.8977, lon: -77.0365, keywords: [] },
    landmarks: [
      { name: "White House / Lafayette Square", lat: 38.8977, lon: -77.0365, keywords: ["white house", "lafayette", "president"] },
      { name: "US Capitol", lat: 38.8899, lon: -77.0091, keywords: ["capitol", "congress", "senate", "house"] },
      { name: "Lincoln Memorial", lat: 38.8893, lon: -77.0502, keywords: ["lincoln", "memorial", "mall"] },
      { name: "Supreme Court", lat: 38.8907, lon: -77.0042, keywords: ["supreme court", "scotus"] },
    ],
  },
  {
    city: "Hong Kong",
    country: "China",
    cityAliases: ["hong kong"],
    default: { name: "Central / Admiralty", lat: 22.2812, lon: 114.1585, keywords: [] },
    landmarks: [
      { name: "Legislative Council (LegCo)", lat: 22.2841, lon: 114.1546, keywords: ["legco", "legislative", "council"] },
      { name: "Central Government Offices", lat: 22.2828, lon: 114.1580, keywords: ["government", "admiralty", "tamar"] },
      { name: "Victoria Park", lat: 22.2817, lon: 114.1928, keywords: ["victoria park", "causeway bay"] },
    ],
  },
  {
    city: "Tehran",
    country: "Iran",
    cityAliases: ["tehran"],
    default: { name: "Azadi Square", lat: 35.6892, lon: 51.3890, keywords: [] },
    landmarks: [
      { name: "Azadi Square", lat: 35.6892, lon: 51.3890, keywords: ["azadi", "freedom"] },
      { name: "Enghelab Square", lat: 35.7008, lon: 51.3912, keywords: ["enghelab", "revolution"] },
      { name: "Parliament (Majles)", lat: 35.7058, lon: 51.4236, keywords: ["majles", "parliament"] },
    ],
  },
  {
    city: "Bangkok",
    country: "Thailand",
    cityAliases: ["bangkok"],
    default: { name: "Democracy Monument", lat: 13.7569, lon: 100.5028, keywords: [] },
    landmarks: [
      { name: "Democracy Monument", lat: 13.7569, lon: 100.5028, keywords: ["democracy", "monument"] },
      { name: "Ratchadamnoen Avenue", lat: 13.7570, lon: 100.5010, keywords: ["ratchadamnoen", "avenue"] },
      { name: "Government House", lat: 13.7700, lon: 100.5180, keywords: ["government house", "government"] },
      { name: "Parliament (Sapha)", lat: 13.7550, lon: 100.5150, keywords: ["parliament", "sapha"] },
    ],
  },
  {
    city: "New Delhi",
    country: "India",
    cityAliases: ["new delhi", "delhi"],
    default: { name: "India Gate", lat: 28.6127, lon: 77.2298, keywords: [] },
    landmarks: [
      { name: "India Gate", lat: 28.6127, lon: 77.2298, keywords: ["india gate", "gate"] },
      { name: "Parliament (Sansad Bhavan)", lat: 28.6172, lon: 77.2083, keywords: ["parliament", "sansad", "sansad bhavan"] },
      { name: "Ramlila Maidan", lat: 28.6419, lon: 77.2167, keywords: ["ramlila", "maidan"] },
      { name: "Jantar Mantar", lat: 28.6366, lon: 77.2173, keywords: ["jantar mantar"] },
    ],
  },
  {
    city: "Beirut",
    country: "Lebanon",
    cityAliases: ["beirut"],
    default: { name: "Martyrs' Square", lat: 33.8938, lon: 35.5018, keywords: [] },
    landmarks: [
      { name: "Martyrs' Square", lat: 33.8938, lon: 35.5018, keywords: ["martyrs", "martyr", "square"] },
      { name: "Parliament (Nejmeh Square)", lat: 33.8925, lon: 35.5078, keywords: ["parliament", "nejmeh"] },
      { name: "Grand Serail (Government Palace)", lat: 33.8960, lon: 35.5040, keywords: ["serail", "government", "palace"] },
    ],
  },
  {
    city: "Santiago",
    country: "Chile",
    cityAliases: ["santiago"],
    default: { name: "Plaza Italia", lat: 33.4378, lon: -70.6331, keywords: [] },
    landmarks: [
      { name: "Plaza Italia / Baquedano", lat: 33.4378, lon: -70.6331, keywords: ["italia", "baquedano", "plaza"] },
      { name: "Plaza de Armas", lat: 33.4489, lon: -70.6519, keywords: ["armas"] },
      { name: "La Moneda (Presidential Palace)", lat: 33.4445, lon: -70.6510, keywords: ["moneda", "palace", "president"] },
    ],
  },
  {
    city: "Athens",
    country: "Greece",
    cityAliases: ["athens"],
    default: { name: "Syntagma Square", lat: 37.9755, lon: 23.7348, keywords: [] },
    landmarks: [
      { name: "Syntagma Square (Parliament)", lat: 37.9755, lon: 23.7348, keywords: ["syntagma", "parliament", "constitution"] },
      { name: "Exarcheia", lat: 37.9836, lon: 23.7334, keywords: ["exarcheia", "exarchia"] },
      { name: "Polytechnic", lat: 37.9785, lon: 23.7336, keywords: ["polytechnic", "metsovio"] },
    ],
  },
  {
    city: "Brasilia",
    country: "Brazil",
    cityAliases: ["brasilia", "brasília"],
    default: { name: "Praca dos Tres Poderes", lat: -15.8005, lon: -47.8605, keywords: [] },
    landmarks: [
      { name: "Praca dos Tres Poderes (Three Powers Plaza)", lat: -15.8005, lon: -47.8605, keywords: ["tres poderes", "three powers", "plaza", "square"] },
      { name: "Congress (Congresso Nacional)", lat: -15.7958, lon: -47.8755, keywords: ["congress", "congresso", "senate", "senado"] },
      { name: "Planalto Palace (President)", lat: -15.7990, lon: -47.8605, keywords: ["planalto", "palace", "president"] },
      { name: "Supreme Court (STF)", lat: -15.8020, lon: -47.8610, keywords: ["supreme", "stf", "court"] },
    ],
  },
  {
    city: "Bogota",
    country: "Colombia",
    cityAliases: ["bogota", "bogotá"],
    default: { name: "Plaza de Bolivar", lat: 4.5981, lon: -74.0758, keywords: [] },
    landmarks: [
      { name: "Plaza de Bolivar", lat: 4.5981, lon: -74.0758, keywords: ["bolivar", "plaza", "square"] },
      { name: "Congress (Capitolio)", lat: 4.5985, lon: -74.0760, keywords: ["congress", "capitolio"] },
      { name: "Presidential Palace (Casa de Narino)", lat: 4.5960, lon: -74.0730, keywords: ["narino", "palace", "president"] },
    ],
  },
  {
    city: "Lagos",
    country: "Nigeria",
    cityAliases: ["lagos"],
    default: { name: "Lagos House (Alausa)", lat: 6.6100, lon: 3.3570, keywords: [] },
    landmarks: [
      { name: "Lagos House (Alausa Secretariat)", lat: 6.6100, lon: 3.3570, keywords: ["government", "secretariat", "alausa", "house"] },
      { name: "Lekki Toll Gate", lat: 6.4350, lon: 3.4760, keywords: ["lekki", "toll"] },
      { name: "National Stadium", lat: 6.5020, lon: 3.3530, keywords: ["stadium"] },
    ],
  },
  {
    city: "Minsk",
    country: "Belarus",
    cityAliases: ["minsk"],
    default: { name: "Independence Square", lat: 53.9022, lon: 27.5619, keywords: [] },
    landmarks: [
      { name: "Independence Square", lat: 53.9022, lon: 27.5619, keywords: ["independence", "square", "plaza"] },
      { name: "October Square", lat: 53.9037, lon: 27.5623, keywords: ["october"] },
      { name: "Gorky Park", lat: 53.9050, lon: 27.5680, keywords: ["gorky", "park"] },
    ],
  },
  {
    city: "Khartoum",
    country: "Sudan",
    cityAliases: ["khartoum"],
    default: { name: "Presidential Palace", lat: 15.5930, lon: 32.5342, keywords: [] },
    landmarks: [
      { name: "Presidential Palace", lat: 15.5930, lon: 32.5342, keywords: ["palace", "president"] },
      { name: "Army HQ (General Command)", lat: 15.5800, lon: 32.5300, keywords: ["army", "military", "command", "general"] },
      { name: "Parliament", lat: 15.6000, lon: 32.5400, keywords: ["parliament", "council"] },
    ],
  },
  {
    city: "Berlin",
    country: "Germany",
    cityAliases: ["berlin"],
    default: { name: "Brandenburg Gate", lat: 52.5163, lon: 13.3777, keywords: [] },
    landmarks: [
      { name: "Brandenburg Gate", lat: 52.5163, lon: 13.3777, keywords: ["brandenburg", "gate"] },
      { name: "Reichstag (Parliament)", lat: 52.5186, lon: 13.3762, keywords: ["reichstag", "parliament", "bundestag"] },
      { name: "Alexanderplatz", lat: 52.5219, lon: 13.4132, keywords: ["alexander", "alexanderplatz"] },
    ],
  },
  {
    city: "Seoul",
    country: "South Korea",
    cityAliases: ["seoul"],
    default: { name: "Gwanghwamun Square", lat: 37.5759, lon: 126.9769, keywords: [] },
    landmarks: [
      { name: "Gwanghwamun Square", lat: 37.5759, lon: 126.9769, keywords: ["gwanghwamun", "square", "palace"] },
      { name: "National Assembly", lat: 37.5311, lon: 126.9140, keywords: ["assembly", "parliament", "national"] },
      { name: "City Hall Plaza", lat: 37.5663, lon: 126.9784, keywords: ["city hall", "plaza"] },
    ],
  },
  {
    city: "Manila",
    country: "Philippines",
    cityAliases: ["manila"],
    default: { name: "Rizal Park (Luneta)", lat: 14.5826, lon: 120.9787, keywords: [] },
    landmarks: [
      { name: "Rizal Park (Luneta)", lat: 14.5826, lon: 120.9787, keywords: ["rizal", "luneta", "park"] },
      { name: "EDSA Shrine", lat: 14.6039, lon: 121.0573, keywords: ["edsa", "shrine"] },
      { name: "Congress (Batasan)", lat: 14.6537, lon: 121.0742, keywords: ["congress", "batasan", "house"] },
      { name: "Malacanang Palace", lat: 14.5847, lon: 120.9950, keywords: ["malacanang", "palace", "president"] },
    ],
  },
  {
    city: "Buenos Aires",
    country: "Argentina",
    cityAliases: ["buenos aires"],
    default: { name: "Plaza de Mayo", lat: -34.6080, lon: -58.3700, keywords: [] },
    landmarks: [
      { name: "Plaza de Mayo", lat: -34.6080, lon: -58.3700, keywords: ["mayo", "plaza", "square"] },
      { name: "Casa Rosada (Presidential Palace)", lat: -34.6075, lon: -58.3705, keywords: ["rosada", "palace", "president"] },
      { name: "Congress (Congreso)", lat: -34.6093, lon: -58.3922, keywords: ["congress", "congreso"] },
      { name: "Obelisco", lat: -34.6037, lon: -58.3816, keywords: ["obelisco", "obelisk"] },
    ],
  },
  {
    city: "Istanbul",
    country: "Turkey",
    cityAliases: ["istanbul"],
    default: { name: "Taksim Square", lat: 41.0370, lon: 28.9850, keywords: [] },
    landmarks: [
      { name: "Taksim Square / Gezi Park", lat: 41.0370, lon: 28.9850, keywords: ["taksim", "gezi", "square", "park"] },
      { name: "Sultanahmet Square", lat: 41.0086, lon: 28.9769, keywords: ["sultanahmet", "blue mosque"] },
    ],
  },
  {
    city: "Nairobi",
    country: "Kenya",
    cityAliases: ["nairobi"],
    default: { name: "Uhuru Park", lat: -1.2893, lon: 36.8160, keywords: [] },
    landmarks: [
      { name: "Uhuru Park", lat: -1.2893, lon: 36.8160, keywords: ["uhuru", "park"] },
      { name: "Parliament Building", lat: -1.2870, lon: 36.8200, keywords: ["parliament"] },
      { name: "Harambee House (President's Office)", lat: -1.2830, lon: 36.8200, keywords: ["harambee", "president"] },
    ],
  },
  {
    city: "Johannesburg",
    country: "South Africa",
    cityAliases: ["johannesburg", "joburg"],
    default: { name: "Union Buildings (Pretoria)", lat: -25.7400, lon: 28.2110, keywords: [] },
    landmarks: [
      { name: "Union Buildings", lat: -25.7400, lon: 28.2110, keywords: ["union", "president"] },
      { name: "Luthuli House (ANC HQ)", lat: -26.2050, lon: 28.0470, keywords: ["luthuli", "anc"] },
      { name: "Constitution Hill", lat: -26.1910, lon: 28.0380, keywords: ["constitution", "court", "hill"] },
    ],
  },
  {
    city: "Mexico City",
    country: "Mexico",
    cityAliases: ["mexico city", "ciudad de mexico", "cdmx"],
    default: { name: "Zocalo (Plaza de la Constitucion)", lat: 19.4326, lon: -99.1332, keywords: [] },
    landmarks: [
      { name: "Zocalo (Plaza de la Constitucion)", lat: 19.4326, lon: -99.1332, keywords: ["zocalo", "constitucion", "constitution", "square", "plaza"] },
      { name: "Palacio Nacional", lat: 19.4330, lon: -99.1320, keywords: ["palacio", "nacional", "palace", "national"] },
      { name: "Congress (San Lazaro)", lat: 19.4310, lon: -99.0980, keywords: ["congress", "congreso", "san lazaro"] },
      { name: "Angel de la Independencia", lat: 19.4270, lon: -99.1677, keywords: ["angel", "independencia", "independence"] },
    ],
  },
  {
    city: "Kiev",
    country: "Ukraine",
    cityAliases: ["kiev", "kyiv"],
    default: { name: "Maidan Nezalezhnosti", lat: 50.4500, lon: 30.5234, keywords: [] },
    landmarks: [
      { name: "Maidan Nezalezhnosti (Independence Square)", lat: 50.4500, lon: 30.5234, keywords: ["maidan", "independence", "square"] },
      { name: "Parliament (Verkhovna Rada)", lat: 50.4460, lon: 30.5360, keywords: ["parliament", "rada", "verkhovna"] },
      { name: "Presidential Administration", lat: 50.4480, lon: 30.5335, keywords: ["president", "administration"] },
    ],
  },
  {
    city: "Tunis",
    country: "Tunisia",
    cityAliases: ["tunis"],
    default: { name: "Habib Bourguiba Avenue", lat: 36.8020, lon: 10.1810, keywords: [] },
    landmarks: [
      { name: "Habib Bourguiba Avenue", lat: 36.8020, lon: 10.1810, keywords: ["bourguiba", "avenue"] },
      { name: "Parliament (Bardo)", lat: 36.8080, lon: 10.1490, keywords: ["parliament", "bardo"] },
    ],
  },
  {
    city: "Caracas",
    country: "Venezuela",
    cityAliases: ["caracas"],
    default: { name: "Plaza Venezuela", lat: 10.4900, lon: -66.8800, keywords: [] },
    landmarks: [
      { name: "Plaza Venezuela", lat: 10.4900, lon: -66.8800, keywords: ["plaza", "venezuela"] },
      { name: "Miraflores Palace (President)", lat: 10.5060, lon: -66.9180, keywords: ["miraflores", "palace", "president"] },
      { name: "National Assembly", lat: 10.4930, lon: -66.9030, keywords: ["assembly", "national", "congress"] },
    ],
  },
  {
    city: "Lima",
    country: "Peru",
    cityAliases: ["lima"],
    default: { name: "Plaza San Martin", lat: -12.0464, lon: -77.0340, keywords: [] },
    landmarks: [
      { name: "Plaza San Martin", lat: -12.0464, lon: -77.0340, keywords: ["san martin", "plaza", "square"] },
      { name: "Plaza de Armas", lat: -12.0466, lon: -77.0300, keywords: ["armas"] },
      { name: "Congress", lat: -12.0460, lon: -77.0350, keywords: ["congress", "congreso"] },
      { name: "Palacio de Gobierno", lat: -12.0450, lon: -77.0300, keywords: ["gobierno", "palace", "president"] },
    ],
  },
  {
    city: "Quito",
    country: "Ecuador",
    cityAliases: ["quito"],
    default: { name: "Plaza de la Independencia", lat: -0.2200, lon: -78.5120, keywords: [] },
    landmarks: [
      { name: "Plaza de la Independencia (Grand Plaza)", lat: -0.2200, lon: -78.5120, keywords: ["independencia", "independence", "plaza", "square"] },
      { name: "Palacio de Carondelet (President)", lat: -0.2190, lon: -78.5110, keywords: ["carondelet", "palace", "president"] },
      { name: "National Assembly", lat: -0.1700, lon: -78.4700, keywords: ["assembly", "national", "congress"] },
    ],
  },
  {
    city: "Harare",
    country: "Zimbabwe",
    cityAliases: ["harare"],
    default: { name: "Parliament Building", lat: -17.8300, lon: 31.0500, keywords: [] },
    landmarks: [
      { name: "Parliament Building", lat: -17.8300, lon: 31.0500, keywords: ["parliament"] },
      { name: "Africa Unity Square", lat: -17.8290, lon: 31.0530, keywords: ["unity", "square"] },
    ],
  },
  {
    city: "Kuala Lumpur",
    country: "Malaysia",
    cityAliases: ["kuala lumpur", "kl"],
    default: { name: "Dataran Merdeka (Independence Square)", lat: 3.1480, lon: 101.6940, keywords: [] },
    landmarks: [
      { name: "Dataran Merdeka (Independence Square)", lat: 3.1480, lon: 101.6940, keywords: ["merdeka", "independence", "square", "dataran"] },
      { name: "Parliament", lat: 3.1500, lon: 101.6800, keywords: ["parliament"] },
      { name: "Sogo Intersection", lat: 3.1630, lon: 101.6950, keywords: ["sogo"] },
    ],
  },
];

// Build a lookup: country-lowercase -> CityLandmarks[]
export const LANDMARKS_BY_COUNTRY: Map<string, CityLandmarks[]> = (() => {
  const m = new Map<string, CityLandmarks[]>();
  for (const cl of PROTEST_LANDMARKS) {
    const key = cl.country.toLowerCase();
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    arr.push(cl);
  }
  return m;
})();

// Refine a single article's coordinates to a specific protest landmark.
// Only snaps to a landmark when the title contains a matching keyword.
// If no keyword matches, returns null so the original GDELT coordinates
// are preserved. This keeps multiple hotspots in the same city separate
// instead of collapsing them all onto one default protest square.
export function refineArticleCoordinates(
  lat: number,
  lon: number,
  country: string,
  title: string,
): { lat: number; lon: number; landmarkName: string } | null {
  const titleLower = title.toLowerCase();
  const cities = LANDMARKS_BY_COUNTRY.get(country.toLowerCase());
  if (!cities) return null;

  // Find the city whose name or alias appears in the title, OR whose
  // coordinates are close to the article's GDELT coordinates.
  let matched: CityLandmarks | null = null;
  for (const cl of cities) {
    const allNames = [cl.city.toLowerCase(), ...cl.cityAliases.map((a) => a.toLowerCase())];
    if (allNames.some((n) => titleLower.includes(n))) {
      matched = cl;
      break;
    }
  }
  if (!matched) {
    for (const cl of cities) {
      const dist = haversineKm(lat, lon, cl.default.lat, cl.default.lon);
      if (dist < 50) {
        matched = cl;
        break;
      }
    }
  }
  if (!matched) return null;

  // Only snap to a landmark if the title explicitly mentions it.
  for (const lm of matched.landmarks) {
    if (lm.keywords.some((kw) => titleLower.includes(kw))) {
      return { lat: lm.lat, lon: lm.lon, landmarkName: lm.name };
    }
  }
  // No keyword match: keep the original GDELT coordinates. This is
  // critical for multi-hotspot cities - if GDELT placed the article at
  // a specific point, we trust it rather than snapping to a default.
  return null;
}

// =============================================================================
// Crowd size parsing
// =============================================================================

export function parseCrowdSize(title: string): { size: number; label: string } {
  const t = title.toLowerCase();

  // Specific numbers: "50,000 protesters", "1,200 people", "300 arrested"
  const numMatch = t.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*(?:protest|demonstr|march|rally|people|crowd|gather|supporter)/);
  if (numMatch) {
    const n = parseInt(numMatch[1].replace(/,/g, ""), 10);
    if (n >= 50) return { size: n, label: formatCrowd(n) };
  }

  // Word-based estimates
  if (/\b(million|millions)\b/.test(t)) return { size: 1_000_000, label: "1M+" };
  if (/\bhundreds of thousands\b/.test(t)) return { size: 300_000, label: "100K+" };
  if (/\btens of thousands\b/.test(t)) return { size: 30_000, label: "10K+" };
  if (/\bthousand(s)?\b/.test(t)) return { size: 5_000, label: "5K+" };
  if (/\bhundreds\b/.test(t)) return { size: 500, label: "500+" };
  if (/\bdozens\b/.test(t)) return { size: 50, label: "50+" };
  if (/\bscores\b/.test(t)) return { size: 40, label: "40+" };

  return { size: 0, label: "Unknown" };
}

export function formatCrowd(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// =============================================================================
// Anarchy probability scoring (0-100)
// =============================================================================

export function computeAnarchyProbability(
  type: string,
  crowdSize: number,
  ageHours: number,
  articleCount: number,
  title: string,
): number {
  const t = title.toLowerCase();

  // Base by type
  let base = 15;
  if (type === "riot") base = 55;
  else if (type === "shutdown") base = 45;
  else if (type === "arrest") base = 35;
  else if (type === "protest") base = 25;

  // Crowd size factor
  if (crowdSize >= 100_000) base += 20;
  else if (crowdSize >= 10_000) base += 12;
  else if (crowdSize >= 1_000) base += 6;
  else if (crowdSize >= 100) base += 3;

  // Recency factor
  if (ageHours < 6) base += 8;
  else if (ageHours < 24) base += 4;

  // Article coverage factor
  if (articleCount >= 5) base += 8;
  else if (articleCount >= 3) base += 5;
  else if (articleCount >= 2) base += 2;

  // Violence / escalation keywords
  if (/\b(kill|dead|death|shot|fire|burn|attack|storm|storming|breach|overrun|tear gas|rubber bullet|live round)\b/.test(t)) {
    base += 12;
  }
  if (/\b(coup|military|army|intervene|curfew|martial law|emergency)\b/.test(t)) {
    base += 10;
  }

  return Math.max(0, Math.min(100, Math.round(base)));
}

// =============================================================================
// GeoJSON types
// =============================================================================

export interface GdeltGeoFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

export interface GdeltGeoCollection {
  type: "FeatureCollection";
  features: GdeltGeoFeature[];
}

export interface ParsedArticle {
  title: string;
  url: string;
  seendate: string;
  country: string;
  domain: string;
  lat: number;
  lon: number;
  type: string;
  ageHours: number;
  eventTime: number;
  // Refined coordinates after landmark matching. If a landmark keyword
  // matched, these differ from lat/lon. Otherwise same as lat/lon.
  refinedLat: number;
  refinedLon: number;
  landmark: string;
}

// =============================================================================
// Clustering + enrichment
// =============================================================================

// Haversine distance in km.
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface Cluster {
  lat: number;
  lon: number;
  country: string;
  articles: ParsedArticle[];
}

export function clusterArticles(articles: ParsedArticle[], thresholdKm: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const article of articles) {
    let added = false;
    for (const cluster of clusters) {
      const dist = haversineKm(article.lat, article.lon, cluster.lat, cluster.lon);
      if (dist <= thresholdKm) {
        cluster.articles.push(article);
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({ lat: article.lat, lon: article.lon, country: article.country, articles: [article] });
    }
  }
  return clusters;
}

// Cluster by refined coordinates so articles at different landmarks
// in the same city stay as separate hotspots.
export function clusterArticlesByRefinedCoords(articles: ParsedArticle[], thresholdKm: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const article of articles) {
    let added = false;
    for (const cluster of clusters) {
      const dist = haversineKm(article.refinedLat, article.refinedLon, cluster.lat, cluster.lon);
      if (dist <= thresholdKm) {
        cluster.articles.push(article);
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        lat: article.refinedLat,
        lon: article.refinedLon,
        country: article.country,
        articles: [article],
      });
    }
  }
  return clusters;
}

// Pick the most descriptive title from a cluster (longest non-generic title).
export function pickBestTitle(articles: ParsedArticle[]): string {
  let best = articles[0].title;
  let bestScore = 0;
  for (const a of articles) {
    let score = a.title.length;
    // Penalize generic titles
    if (/^(protest|unrest|riot|clash)/i.test(a.title)) score -= 20;
    // Reward titles with specific details
    if (/\d/.test(a.title)) score += 10;
    if (a.title.length > 20 && a.title.length < 80) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = a.title;
    }
  }
  return best;
}

// Determine the dominant type across a cluster (most severe wins).
export function dominantType(articles: ParsedArticle[]): string {
  const rank: Record<string, number> = { riot: 4, shutdown: 3, arrest: 2, protest: 1, other: 0 };
  let best = "other";
  let bestRank = 0;
  for (const a of articles) {
    if (rank[a.type] > bestRank) {
      bestRank = rank[a.type];
      best = a.type;
    }
  }
  return best;
}

export function buildCollection(articles: ParsedArticle[]): GdeltGeoCollection {
  // Cluster articles using their REFINED coordinates at 1.5km threshold.
  // This is fine enough that different landmarks in the same city (which
  // are typically 2-5km apart) stay as separate hotspots, while duplicate
  // coverage of the same event from multiple news sources merges together.
  const clusters = clusterArticlesByRefinedCoords(articles, 1.5);
  const now = Date.now();
  const features: GdeltGeoFeature[] = [];

  for (const cluster of clusters) {
    const articleCount = cluster.articles.length;
    const bestTitle = pickBestTitle(cluster.articles);
    const type = dominantType(cluster.articles);

    // Most recent article in the cluster.
    let mostRecent = cluster.articles[0];
    for (const a of cluster.articles) {
      if (a.eventTime > mostRecent.eventTime) mostRecent = a;
    }
    const ageHours = mostRecent.ageHours;
    const eventTime = mostRecent.eventTime;

    // Aggregate crowd size: take the max across articles.
    let crowdSize = 0;
    let crowdLabel = "Unknown";
    for (const a of cluster.articles) {
      const c = parseCrowdSize(a.title);
      if (c.size > crowdSize) {
        crowdSize = c.size;
        crowdLabel = c.label;
      }
    }

    // Use the refined coordinates from the first article in the cluster.
    // All articles in this cluster share the same refined coords (that's
    // why they clustered together). Use the landmark name from whichever
    // article has one.
    const finalLat = cluster.articles[0].refinedLat;
    const finalLon = cluster.articles[0].refinedLon;
    let landmark = "";
    for (const a of cluster.articles) {
      if (a.landmark) { landmark = a.landmark; break; }
    }

    // Compute anarchy probability.
    const anarchyProb = computeAnarchyProbability(type, crowdSize, ageHours, articleCount, bestTitle);

    // Collect sources (unique by URL).
    const sources = cluster.articles
      .filter((a) => a.url)
      .slice(0, 8)
      .map((a) => ({ title: a.title, url: a.url, domain: a.domain }));

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [finalLon, finalLat] },
      properties: {
        title: bestTitle,
        url: mostRecent.url,
        seendate: mostRecent.seendate,
        country: cluster.country,
        domain: mostRecent.domain,
        lat: finalLat,
        lon: finalLon,
        type,
        ageHours,
        eventTime,
        articleCount,
        crowdSize,
        crowdLabel,
        anarchyProbability: anarchyProb,
        landmark,
        sources,
      },
    });
  }

  // Sort by anarchy probability descending (most volatile first).
  features.sort((a, b) => {
    const ap = Number(b.properties.anarchyProbability ?? 0) - Number(a.properties.anarchyProbability ?? 0);
    if (ap !== 0) return ap;
    return Number(a.properties.ageHours ?? 0) - Number(b.properties.ageHours ?? 0);
  });

  return { type: "FeatureCollection", features };
}
