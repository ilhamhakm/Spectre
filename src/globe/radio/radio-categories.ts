// Direct port of GEV's radio category logic: tag matchers, colors, cluster
// labels, station classification, category building, and filtering.
// Source: src/data/radio.js lines 77-145, 704-845.

import type {
  RadioCategory,
  RadioCategoryId,
  RadioStation,
} from "./radio-types";

const MUSIC_GENRES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ["alternative", "Alternative"],
  ["ambient", "Ambient"],
  ["blues", "Blues"],
  ["classical", "Classical"],
  ["country", "Country"],
  ["dance", "Dance"],
  ["electronic", "Electronic"],
  ["folk", "Folk"],
  ["funk", "Funk"],
  ["hip hop", "Hip-Hop"],
  ["house", "House"],
  ["indie", "Indie"],
  ["jazz", "Jazz"],
  ["latin", "Latin"],
  ["metal", "Metal"],
  ["oldies", "Oldies"],
  ["pop", "Pop"],
  ["punk", "Punk"],
  ["r&b", "R&B"],
  ["reggae", "Reggae"],
  ["rock", "Rock"],
  ["soul", "Soul"],
  ["techno", "Techno"],
  ["trance", "Trance"],
  ["world", "World"],
]);

const CATEGORY_MATCHERS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    news: ["news", "current affairs", "journalism"],
    talk: ["talk", "spoken word", "interview", "podcast"],
    weather: ["weather", "emergency", "noaa"],
    "public-safety": [
      "public safety",
      "scanner",
      "police",
      "fire",
      "ems",
      "dispatch",
      "emergency",
    ],
    "aviation-marine": [
      "aviation",
      "air traffic",
      "atc",
      "airport",
      "marine",
      "maritime",
      "coast guard",
    ],
    "traffic-transit": ["traffic", "transit", "transport", "rail", "metro"],
  });

export const RADIO_CATEGORY_COLORS: Readonly<Record<string, string>> =
  Object.freeze({
    all: "#b9fbff",
    news: "#44adff",
    talk: "#f2b84b",
    weather: "#ff5c78",
    "public-safety": "#ff8b4a",
    "aviation-marine": "#a87cff",
    "traffic-transit": "#ffd166",
    music: "#54d17a",
    other: "#9aa7b3",
  });

const RADIO_CLUSTER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  news: "NEWS",
  talk: "TALK",
  weather: "WEATHER",
  "public-safety": "SAFETY",
  "aviation-marine": "AIR / SEA",
  "traffic-transit": "TRANSIT",
  music: "MUSIC",
  other: "OTHER",
});

const RADIO_MARKER_CATEGORY_ORDER: readonly string[] = Object.freeze([
  "news",
  "public-safety",
  "weather",
  "aviation-marine",
  "traffic-transit",
  "talk",
  "music",
]);

export const DEFAULT_RADIO_FILTER: RadioCategoryId = "all";

/** Normalize one directory tag to a stable, lower-case display token. */
export function normalizeRadioTag(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function stationTags(station: RadioStation): string[] {
  if (Array.isArray(station?.tags))
    return station.tags.map(normalizeRadioTag).filter(Boolean);
  return String(station?.tags ?? "")
    .split(",")
    .map(normalizeRadioTag)
    .filter(Boolean);
}

function hasTag(station: RadioStation, needles: readonly string[]): boolean {
  const tags = stationTags(station);
  return needles.some((needle) =>
    tags.some((tag) => tag === needle || tag.includes(needle)),
  );
}

function detectedGenres(station: RadioStation): string[] {
  return MUSIC_GENRES.filter(([genre]) => hasTag(station, [genre])).map(
    ([genre]) => genre,
  );
}

/** Return whether a station belongs in a station-tag category. */
export function stationMatchesRadioCategory(
  station: RadioStation,
  categoryId: RadioCategoryId | string,
): boolean {
  if (categoryId === "all") return true;
  if (categoryId.startsWith("genre:")) {
    return detectedGenres(station).includes(categoryId.slice("genre:".length));
  }
  if (categoryId === "music") {
    return (
      detectedGenres(station).length > 0 ||
      hasTag(station, ["music", "hits", "songs"])
    );
  }
  if (categoryId === "other") {
    return (
      !Object.keys(CATEGORY_MATCHERS).some((id) =>
        stationMatchesRadioCategory(station, id),
      ) && !stationMatchesRadioCategory(station, "music")
    );
  }
  return hasTag(station, CATEGORY_MATCHERS[categoryId] || []);
}

/** Return the shared CSS color for a canonical or detected-genre category. */
export function radioCategoryColor(categoryId: string = "other"): string {
  const normalized = String(categoryId || "other");
  const canonical = normalized.startsWith("genre:") ? "music" : normalized;
  return RADIO_CATEGORY_COLORS[canonical] || RADIO_CATEGORY_COLORS.other;
}

/** Format the concise count/category badge shown above a Radio cluster. */
export function radioClusterBadgeText(
  categoryId: string = "other",
  count = 0,
): string {
  const normalized = String(categoryId || "other");
  const canonical = normalized.startsWith("genre:") ? "music" : normalized;
  const label = RADIO_CLUSTER_LABELS[canonical] || RADIO_CLUSTER_LABELS.other;
  const stationCount = Math.max(0, Math.floor(Number(count) || 0));
  return `${stationCount} ${label}`;
}

/** Choose the category advertised by a cluster in the active station-tag view. */
export function radioClusterCategoryId(
  stations: RadioStation[],
  activeFilter: RadioCategoryId | string = "all",
): string {
  const filter = String(activeFilter || "all");
  if (filter !== "all") {
    if (
      filter.startsWith("genre:") ||
      RADIO_MARKER_CATEGORY_ORDER.includes(filter) ||
      filter === "other"
    ) {
      return filter;
    }
    return "other";
  }
  const categoryCounts = new Map<string, number>();
  for (const station of Array.isArray(stations) ? stations : []) {
    const categoryId = radioStationCategoryId(station);
    categoryCounts.set(categoryId, (categoryCounts.get(categoryId) || 0) + 1);
  }
  let clusterCategory = "other";
  let clusterCategoryCount = 0;
  for (const categoryId of RADIO_MARKER_CATEGORY_ORDER) {
    const count = categoryCounts.get(categoryId) || 0;
    if (count > clusterCategoryCount) {
      clusterCategory = categoryId;
      clusterCategoryCount = count;
    }
  }
  if ((categoryCounts.get("other") || 0) > clusterCategoryCount)
    return "other";
  return clusterCategory;
}

/** Build the code-native four-corner bracket used by the selected station. */
export function radioSelectionBracketSvg(
  color: string = RADIO_CATEGORY_COLORS.other,
): string {
  const stroke = /^#[0-9a-f]{6}$/i.test(String(color))
    ? String(color)
    : RADIO_CATEGORY_COLORS.other;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M2 13V2H13 M27 2H38V13 M38 27V38H27 M13 38H2V27" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="square"/></svg>`;
}

/** Choose one stable display category for a station that may match several. */
export function radioStationCategoryId(station: RadioStation): string {
  return (
    RADIO_MARKER_CATEGORY_ORDER.find((categoryId) =>
      stationMatchesRadioCategory(station, categoryId),
    ) || "other"
  );
}

/** Build canonical and detected-genre categories from station-level tags. */
export function buildRadioCategories(stations: RadioStation[]): RadioCategory[] {
  const rows = Array.isArray(stations) ? stations : [];
  const categories: { id: RadioCategoryId; label: string }[] = [
    { id: "all", label: "All" },
    { id: "news", label: "News" },
    { id: "talk", label: "Talk" },
    { id: "weather", label: "Weather / Emergency" },
    { id: "public-safety", label: "Public Safety" },
    { id: "aviation-marine", label: "Aviation / Marine" },
    { id: "traffic-transit", label: "Traffic / Transit" },
    { id: "music", label: "Music" },
  ];

  for (const [genre, label] of MUSIC_GENRES) {
    const id = `genre:${genre}` as RadioCategoryId;
    if (rows.some((station) => stationMatchesRadioCategory(station, id))) {
      categories.push({ id, label });
    }
  }
  categories.push({ id: "other", label: "Other" });
  return categories.map((category) => ({
    ...category,
    color: radioCategoryColor(category.id),
    count: rows.filter((station) =>
      stationMatchesRadioCategory(station, category.id),
    ).length,
  }));
}

/** Filter stations without changing the active stream or selection. */
export function filterRadioStations(
  stations: RadioStation[],
  categoryId: RadioCategoryId | string = "all",
): RadioStation[] {
  return (Array.isArray(stations) ? stations : []).filter((station) =>
    stationMatchesRadioCategory(station, categoryId),
  );
}

/** Return whether Radio Browser metadata identifies a station as English. */
export function isEnglishRadioStation(station: RadioStation): boolean {
  const languages = Array.isArray(station?.languages)
    ? station.languages
    : [];
  return languages.some((language) => {
    const normalized = normalizeRadioTag(language);
    return (
      normalized === "en" ||
      normalized === "eng" ||
      normalized.startsWith("english")
    );
  });
}
