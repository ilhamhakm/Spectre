// City spatial index for city-level hover popups.
//
// RightPanel's CONTINENTS data is flattened and registered here on mount via
// registerCities() (through region-index). The hover handler calls
// resolveCity(lon, lat) when the camera is below CITY_VIEW_ALTITUDE to find
// the nearest city within a radius. Population figures are sourced from UN
// World Urbanization Prospects (2018) and national census data (city proper
// or metro, whichever is more commonly cited).

export interface CityInfo {
  name: string;
  country: string;
  population: number | null;
  lat: number;
  lon: number;
}

export interface CityRecord {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

// Population lookup by city name. Values are approximate (latest available
// census or UN estimate). null = no reliable figure.
const CITY_POPULATIONS: Record<string, number | null> = {
  // North America - USA
  "New York": 8336817,
  "Washington": 689545,
  "Los Angeles": 3979576,
  "San Francisco": 873965,
  "Chicago": 2693976,
  "Las Vegas": 651319,
  "Miami": 467963,
  "Seattle": 753675,
  "Boston": 692600,
  "Houston": 2320268,
  "Philadelphia": 1584064,
  "Atlanta": 506811,
  "Denver": 727211,
  "San Diego": 1394928,
  "Portland": 654741,
  // Canada
  "Toronto": 2731571,
  "Vancouver": 675218,
  "Montreal": 1762949,
  "Calgary": 1335719,
  "Ottawa": 994837,
  "Quebec City": 542298,
  // Mexico
  "Mexico City": 9209944,
  "Guadalajara": 1495182,
  "Monterrey": 1135512,
  "Cancun": 888797,
  // Cuba
  "Havana": 2106146,
  "Santiago de Cuba": 444851,
  // South America - Brazil
  "Rio de Janeiro": 6747815,
  "Sao Paulo": 12325232,
  "Brasilia": 3055149,
  "Salvador": 2886698,
  "Fortaleza": 2686612,
  // Argentina
  "Buenos Aires": 3075646,
  "Cordoba": 1454536,
  "Mendoza": 115041,
  "Ushuaia": 75000,
  // Peru
  "Lima": 9674755,
  "Cusco": 428450,
  "Arequipa": 1008290,
  // Colombia
  "Bogota": 7412566,
  "Medellin": 2569007,
  "Cartagena": 914672,
  // Chile
  "Santiago": 6160000,
  "Valparaiso": 296655,
  "Pucon": 22000,
  // Ecuador
  "Quito": 1822302,
  "Guayaquil": 2723665,
  "Galapagos": 25000,
  // Bolivia
  "La Paz": 812799,
  "Sucre": 360544,
  "Santa Cruz": 1545648,
  // Oceania - New Zealand
  "Auckland": 1657200,
  "Wellington": 215100,
  "Christchurch": 381500,
  "Queenstown": 16060,
  // Australia
  "Sydney": 5312163,
  "Melbourne": 5078193,
  "Brisbane": 2582229,
  "Perth": 2059484,
  "Adelaide": 1345777,
  "Gold Coast": 679127,
  "Canberra": 426704,
  "Darwin": 148564,
  "Hobart": 240935,
  // Europe - Spain
  "Barcelona": 1620343,
  "Madrid": 3223334,
  "Valencia": 791413,
  "Seville": 688711,
  "Bilbao": 345821,
  // France
  "Paris": 2161000,
  "Marseille": 868277,
  "Nice": 342669,
  "Lyon": 522969,
  "Bordeaux": 257068,
  // Italy
  "Rome": 2872800,
  "Milan": 1396059,
  "Naples": 967069,
  "Florence": 382258,
  "Venice": 261905,
  "Turin": 870952,
  // UK
  "London": 8982000,
  "Manchester": 547627,
  "Edinburgh": 488050,
  "Glasgow": 633120,
  "Liverpool": 498042,
  // Germany
  "Berlin": 3669491,
  "Munich": 1471508,
  "Hamburg": 1841179,
  "Frankfurt": 753056,
  "Cologne": 1085664,
  // Netherlands
  "Amsterdam": 872680,
  "Rotterdam": 651446,
  // Portugal
  "Lisbon": 547631,
  "Porto": 237591,
  // Greece
  "Athens": 664046,
  "Thessaloniki": 325182,
  // Switzerland
  "Zurich": 415367,
  "Geneva": 201818,
  // Austria
  "Vienna": 1897491,
  "Salzburg": 156272,
  "Innsbruck": 132236,
  // Ireland
  "Dublin": 544107,
  "Cork": 210000,
  // Czech Republic
  "Prague": 1335084,
  "Brno": 379527,
  // Sweden
  "Stockholm": 975551,
  "Gothenburg": 583056,
  "Malmo": 344166,
  // Norway
  "Oslo": 693491,
  "Bergen": 285911,
  "Trondheim": 199039,
  // Finland
  "Helsinki": 656229,
  // Denmark
  "Copenhagen": 626508,
  "Aarhus": 280534,
  // Belgium
  "Brussels": 1209000,
  "Antwerp": 523248,
  "Bruges": 118509,
  // Switzerland
  "Basel": 172258,
  // Iceland
  "Reykjavik": 131136,
  "Akureyri": 19219,
  // Poland
  "Warsaw": 1790658,
  // Russia
  "Moscow": 12506468,
  "Saint Petersburg": 5384342,
  "Novosibirsk": 1625631,
  "Yekaterinburg": 1493600,
  "Vladivostok": 606653,
  "Kazan": 1257391,
  // Asia - Japan
  "Tokyo": 13960000,
  "Osaka": 2691185,
  "Kyoto": 1475183,
  "Yokohama": 3760000,
  "Nagoya": 2320361,
  "Sapporo": 1952356,
  "Fukuoka": 1538681,
  // China
  "Beijing": 21540000,
  "Shanghai": 24870000,
  "Hong Kong": 7482000,
  "Guangzhou": 18676605,
  "Shenzhen": 17560000,
  "Chengdu": 16330000,
  "Xi'an": 12953000,
  "Nanjing": 8505500,
  "Hangzhou": 10360000,
  // South Korea
  "Seoul": 9776000,
  "Busan": 3413841,
  "Incheon": 2954955,
  "Daegu": 2166556,
  // India
  "Mumbai": 20410000,
  "Delhi": 32980000,
  "Bangalore": 8436675,
  "Chennai": 4646732,
  "Kolkata": 4496694,
  "Hyderabad": 6809970,
  "Agra": 1585704,
  "Jaipur": 3073350,
  "Varanasi": 1201815,
  "Goa": 1450000,
  // Thailand
  "Bangkok": 10539000,
  "Chiang Mai": 1270000,
  "Phuket": 793308,
  "Pattaya": 1195329,
  // Vietnam
  "Hanoi": 7785000,
  "Ho Chi Minh City": 8993082,
  "Da Nang": 1232000,
  "Hue": 455230,
  // Singapore
  "Singapore": 5685807,
  // Indonesia
  "Jakarta": 10770487,
  "Bali": 4400000,
  "Surabaya": 2874314,
  "Bandung": 2444160,
  "Medan": 2435252,
  "Makassar": 1432189,
  "Yogyakarta": 422732,
  "Semarang": 1650596,
  // Malaysia
  "Kuala Lumpur": 1808000,
  "George Town": 708127,
  "Johor Bahru": 858118,
  // Philippines
  "Manila": 1780148,
  "Cebu": 922611,
  "Davao": 1776949,
  // Taiwan
  "Taipei": 2641312,
  "Kaohsiung": 2773533,
  // Turkey
  "Istanbul": 15462452,
  "Ankara": 5663322,
  "Izmir": 2937349,
  "Antalya": 1432173,
  // UAE
  "Dubai": 3331420,
  "Abu Dhabi": 1482816,
  "Sharjah": 1684669,
  // Saudi Arabia
  "Mecca": 2042000,
  "Medina": 1488782,
  "Riyadh": 7676654,
  "Jeddah": 4697000,
  // Pakistan
  "Karachi": 16093786,
  "Lahore": 12189871,
  "Islamabad": 1095998,
  "Faisalabad": 3203846,
  // Bangladesh
  "Dhaka": 9540000,
  "Chittagong": 5200000,
  // Sri Lanka
  "Colombo": 757994,
  "Kandy": 125400,
  "Galle": 99000,
  // Cambodia
  "Phnom Penh": 2100000,
  "Siem Reap": 230714,
  // Myanmar
  "Yangon": 5200000,
  "Mandalay": 1225553,
  "Naypyidaw": 924608,
  // Mongolia
  "Ulaanbaatar": 1444669,
  // Israel
  "Tel Aviv": 460613,
  "Jerusalem": 952024,
  "Haifa": 285316,
  // Iran
  "Tehran": 8693706,
  // Qatar
  "Doha": 2382000,
  // Nepal
  "Kathmandu": 1442271,
  // Africa - Egypt
  "Cairo": 9540000,
  "Alexandria": 5163750,
  "Luxor": 422407,
  "Aswan": 290327,
  // South Africa
  "Cape Town": 4617560,
  "Johannesburg": 5635127,
  "Durban": 3442361,
  "Pretoria": 741651,
  // Nigeria
  "Lagos": 14862111,
  "Abuja": 3464123,
  "Kano": 3848885,
  // Kenya
  "Nairobi": 4397073,
  "Mombasa": 1208333,
  // Morocco
  "Casablanca": 3359818,
  "Marrakech": 928850,
  "Fes": 1112072,
  "Tangier": 947662,
  "Rabat": 577827,
  // Ethiopia
  "Addis Ababa": 3603896,
  "Lalibela": 17000,
  // Ghana
  "Accra": 2291352,
  "Kumasi": 2069350,
  // Senegal
  "Dakar": 1146053,
  // Tanzania
  "Dar es Salaam": 6368000,
  "Zanzibar": 223033,
  "Arusha": 416442,
  // Tunisia
  "Tunis": 638845,
  "Sfax": 330440,
  "Carthage": 24597,
  // Algeria
  "Algiers": 3415111,
  "Oran": 859000,
  "Constantine": 448028,
};

// Haversine distance in km between two lat/lon points.
function haversineKm(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface IndexedCity extends CityInfo {
  bbox: [number, number, number, number];
}

let indexedCities: IndexedCity[] = [];

// Max distance (km) from the cursor point to consider a city "nearby" for
// hover purposes. 100 km covers metro areas without matching distant cities.
const CITY_HOVER_RADIUS_KM = 100;

/**
 * Register the flat city list from RightPanel's CONTINENTS. Called once on
 * mount via region-index.registerCities().
 */
export function setCityData(cities: CityRecord[]): void {
  indexedCities = cities.map((c) => {
    const pop = CITY_POPULATIONS[c.name] ?? null;
    return {
      name: c.name,
      country: c.country,
      population: pop,
      lat: c.lat,
      lon: c.lon,
      bbox: [c.lon - 1, c.lat - 1, c.lon + 1, c.lat + 1],
    };
  });
}

/**
 * Find the nearest city within CITY_HOVER_RADIUS_KM of the given point.
 * Returns null if no city is close enough.
 */
export function resolveCity(lon: number, lat: number): CityInfo | null {
  if (indexedCities.length === 0) return null;
  let best: { info: CityInfo; dist: number } | null = null;
  for (const c of indexedCities) {
    const [minLon, minLat, maxLon, maxLat] = c.bbox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    const dist = haversineKm(lon, lat, c.lon, c.lat);
    if (dist > CITY_HOVER_RADIUS_KM) continue;
    if (!best || dist < best.dist) {
      best = {
        info: {
          name: c.name,
          country: c.country,
          population: c.population,
          lat: c.lat,
          lon: c.lon,
        },
        dist,
      };
    }
  }
  return best?.info ?? null;
}
