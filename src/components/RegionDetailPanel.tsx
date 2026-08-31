"use client";

import { useEffect, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";
import { polygonAreaKm2 } from "@/globe/region-index";
import type { RegionHit, CountryInfo, StateInfo, CityInfo } from "@/globe/region-index";
import { fetchWikiSummary, fetchRestCountry, fetchGeoStats, fetchCityBoundary, type WikiSummary, type RestCountry, type GeoStats, type RegionBoundary } from "@/lib/region-info";

// Region detail card: renders in the right rail while a region (country /
// state / city) is click-selected via the borders layer.
//
// Enrichment (cached, fetched on selection):
//   - Wikipedia REST summary: thumbnail + first-paragraph extract.
//   - REST Countries (countries): languages, currency.
//   - World Bank (countries): GDP, GDP/capita.
//   - Open-Meteo (all): elevation, current weather.
//   - Nominatim (cities): boundary polygon -> area.

const WHITE = "#ffffff";
const DIM = "rgba(255,255,255,0.35)";
const SECONDARY = "rgba(255,255,255,0.6)";

interface WBIndicators {
  gdp?: number;
  gdpPerCapita?: number;
  gdpGrowth?: number;
  inflation?: number;
  unemployment?: number;
  lifeExpectancy?: number;
  debtToGdp?: number;
  reserves?: number;
  year?: number;
}

const wbCache = new Map<string, WBIndicators>();

async function fetchWorldBank(iso2: string): Promise<WBIndicators | null> {
  if (wbCache.has(iso2)) return wbCache.get(iso2) ?? null;
  const indicators = [
    "NY.GDP.MKTP.CD",
    "NY.GDP.PCAP.CD",
    "NY.GDP.MKTP.KD.ZG",
    "FP.CPI.TOTL.ZG",
    "SL.UEM.TOTL.ZS",
    "SP.DYN.LE00.IN",
    "GC.DOD.TOTL.GD.ZS",
    "FI.RES.TOTL.CD",
  ].join(",");
  const url = `https://api.worldbank.org/v2/country/${iso2}/indicator/${indicators}?format=json&per_page=100&date=2010:2024`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return null;
    const obs = data[1] as Array<{ indicator: { id: string }; value: number | null; date: string }>;
    const latest: Record<string, { value: number; year: number }> = {};
    for (const o of obs) {
      if (o.value == null) continue;
      const y = parseInt(o.date, 10);
      if (!latest[o.indicator.id] || y > latest[o.indicator.id].year) {
        latest[o.indicator.id] = { value: o.value, year: y };
      }
    }
    const result: WBIndicators = {
      gdp: latest["NY.GDP.MKTP.CD"]?.value,
      gdpPerCapita: latest["NY.GDP.PCAP.CD"]?.value,
      gdpGrowth: latest["NY.GDP.MKTP.KD.ZG"]?.value,
      inflation: latest["FP.CPI.TOTL.ZG"]?.value,
      unemployment: latest["SL.UEM.TOTL.ZS"]?.value,
      lifeExpectancy: latest["SP.DYN.LE00.IN"]?.value,
      debtToGdp: latest["GC.DOD.TOTL.GD.ZS"]?.value,
      reserves: latest["FI.RES.TOTL.CD"]?.value,
      year: Math.max(...Object.values(latest).map((v) => v.year), 0),
    };
    wbCache.set(iso2, result);
    return result;
  } catch {
    return null;
  }
}

function formatCompact(num: number | undefined): string | null {
  if (num == null || !isFinite(num)) return null;
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function SectionHeader({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 8,
        color: DIM,
        letterSpacing: 2,
        marginBottom: 4,
        marginTop: 8,
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
      }}
    >
      {text}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "3px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: DIM,
          letterSpacing: 1,
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          color: WHITE,
          textAlign: "right",
          fontWeight: 600,
          maxWidth: "65%",
          wordBreak: "break-word",
          lineHeight: 1.3,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function wikipediaUrl(name: string): string {
  return `https://en.wikipedia.org/wiki/${name.replace(/ /g, "_")}`;
}

function centroid(rings: number[][][]): { lat: number; lon: number } | null {
  let lonSum = 0;
  let latSum = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      lonSum += lon;
      latSum += lat;
      n++;
    }
  }
  if (n === 0) return null;
  return { lat: latSum / n, lon: lonSum / n };
}

export default function RegionDetailPanel() {
  const selectedRegion = useGlobeStore((s) => s.selectedRegion);
  const selectedRegionRings = useGlobeStore((s) => s.selectedRegionRings);
  const bordersEnabled = useGlobeStore((s) => s.bordersEnabled);
  const clearRegion = useGlobeStore((s) => s.clearRegion);
  const [wb, setWb] = useState<WBIndicators | null>(null);
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [rest, setRest] = useState<RestCountry | null>(null);
  const [geo, setGeo] = useState<GeoStats | null>(null);
  const [cityArea, setCityArea] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setWb(null);
    setWiki(null);
    setRest(null);
    setGeo(null);
    setCityArea(null);
    if (!selectedRegion) return;
    setLoading(true);
    const tasks: Promise<void>[] = [];
    let wikiName = "";
    let geoCoord: { lat: number; lon: number } | null = null;
    if (selectedRegion.level === "country") {
      const c = selectedRegion.info as CountryInfo;
      wikiName = c.name;
      geoCoord = centroid(selectedRegionRings ?? []);
      if (c.iso2) {
        tasks.push(
          fetchRestCountry(c.iso2).then(setRest).catch(() => {}),
          fetchWorldBank(c.iso2).then(setWb).catch(() => {}),
        );
      }
    } else if (selectedRegion.level === "state") {
      const s = selectedRegion.info as StateInfo;
      wikiName = s.nameEn || s.name;
      geoCoord = centroid(selectedRegionRings ?? []);
    } else {
      const c = selectedRegion.info as CityInfo;
      wikiName = c.name;
      geoCoord = { lat: c.lat, lon: c.lon };
      // Fetch city boundary for area. The highlight + fly-to are handled
      // by the click handler; here we just grab the area for the panel.
      tasks.push(
        fetchCityBoundary(c.name, c.country)
          .then((b: RegionBoundary | null) => {
            if (b) setCityArea(b.areaKm2);
          })
          .catch(() => {}),
      );
    }
    if (wikiName) {
      tasks.push(fetchWikiSummary(wikiName).then(setWiki).catch(() => {}));
    }
    if (geoCoord) {
      tasks.push(fetchGeoStats(geoCoord.lat, geoCoord.lon).then(setGeo).catch(() => {}));
    }
    Promise.all(tasks).finally(() => setLoading(false));
  }, [selectedRegion, selectedRegionRings]);

  if (!selectedRegion || !bordersEnabled) return null;

  const tag =
    selectedRegion.level === "country"
      ? "COUNTRY"
      : selectedRegion.level === "state"
        ? "STATE / PROVINCE"
        : "CITY";

  let name = "";
  let flagEmoji: string | null = null;
  let wikiName = "";

  // --- Build the stat rows: aim for ~10 interesting ones ---

  // GEOGRAPHY: area, elevation, pop density
  const geoRows: { label: string; value: string }[] = [];

  // PEOPLE: population, capital
  const peopleRows: { label: string; value: string }[] = [];

  // ECONOMY: GDP, GDP per capita (countries)
  const economyRows: { label: string; value: string }[] = [];

  // CULTURE: languages, currency (countries)
  const cultureRows: { label: string; value: string }[] = [];

  // WEATHER: current temp + conditions
  const weatherRows: { label: string; value: string }[] = [];

  if (selectedRegion.level === "country") {
    const c = selectedRegion.info as CountryInfo;
    name = c.name;
    flagEmoji = c.flagEmoji;
    wikiName = c.name;

    // Area
    if (typeof c.areaKm2 === "number") {
      geoRows.push({ label: "AREA", value: `${c.areaKm2.toLocaleString()} km^2` });
    }
    // Elevation
    if (geo?.elevationM != null) {
      geoRows.push({ label: "ELEVATION", value: `${Math.round(geo.elevationM)} m` });
    }
    // Pop density
    if (typeof c.population === "number" && typeof c.areaKm2 === "number" && c.areaKm2 > 0) {
      geoRows.push({ label: "DENSITY", value: `${Math.round(c.population / c.areaKm2).toLocaleString()} / km^2` });
    }

    // Population
    if (typeof c.population === "number") {
      peopleRows.push({ label: "POPULATION", value: c.population.toLocaleString() });
    }
    // Capital
    if (c.capital) {
      peopleRows.push({ label: "CAPITAL", value: c.capital });
    }

    // Economy
    if (wb?.gdp != null) economyRows.push({ label: "GDP", value: formatCompact(wb.gdp) ?? "" });
    if (wb?.gdpPerCapita != null) economyRows.push({ label: "GDP / CAPITA", value: formatCompact(wb.gdpPerCapita) ?? "" });

    // Culture
    if (rest?.languages.length) cultureRows.push({ label: "LANGUAGES", value: rest.languages.join(", ") });
    if (rest?.currencies.length) cultureRows.push({ label: "CURRENCY", value: rest.currencies.join(", ") });
  } else if (selectedRegion.level === "state") {
    const s = selectedRegion.info as StateInfo;
    name = s.nameEn && s.nameEn.toLowerCase() !== s.name.toLowerCase()
      ? `${s.nameEn} (${s.name})`
      : s.name;
    wikiName = s.nameEn || s.name;

    const areaKm2 = polygonAreaKm2(selectedRegionRings ?? []);
    if (areaKm2 > 0) geoRows.push({ label: "AREA", value: `${areaKm2.toLocaleString()} km^2` });
    if (geo?.elevationM != null) geoRows.push({ label: "ELEVATION", value: `${Math.round(geo.elevationM)} m` });
    if (typeof s.population === "number" && areaKm2 > 0) {
      geoRows.push({ label: "DENSITY", value: `${Math.round(s.population / areaKm2).toLocaleString()} / km^2` });
    }

    if (typeof s.population === "number") peopleRows.push({ label: "POPULATION", value: s.population.toLocaleString() });
    if (s.capital) peopleRows.push({ label: "CAPITAL", value: s.capital });
    if (s.admin) peopleRows.push({ label: "COUNTRY", value: s.admin });
  } else {
    const c = selectedRegion.info as CityInfo;
    name = c.name;
    wikiName = c.name;

    // Area from Nominatim boundary (async, may not be ready yet)
    if (cityArea != null) {
      geoRows.push({ label: "AREA", value: `${cityArea.toLocaleString()} km^2` });
    }
    if (geo?.elevationM != null) geoRows.push({ label: "ELEVATION", value: `${Math.round(geo.elevationM)} m` });
    if (typeof c.population === "number" && cityArea != null && cityArea > 0) {
      geoRows.push({ label: "DENSITY", value: `${Math.round(c.population / cityArea).toLocaleString()} / km^2` });
    }

    if (typeof c.population === "number") peopleRows.push({ label: "POPULATION", value: c.population.toLocaleString() });
    if (c.country) peopleRows.push({ label: "COUNTRY", value: c.country });
  }

  // Weather (all levels)
  if (geo) {
    const parts: string[] = [];
    if (geo.weatherDesc) parts.push(geo.weatherDesc);
    if (geo.tempC != null) parts.push(`${geo.tempC.toFixed(0)}C`);
    if (parts.length) weatherRows.push({ label: "NOW", value: parts.join(", ") });
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 240,
        height: "100%",
        overflowY: "auto",
        paddingBottom: 80,
        background: "transparent",
        zIndex: 70,
        pointerEvents: "auto",
        paddingTop: 40,
        paddingLeft: 12,
        paddingRight: 12,
        fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: WHITE,
          letterSpacing: 2,
          marginBottom: 4,
          fontWeight: 700,
          textShadow: "0 0 8px rgba(255,255,255,0.3)",
        }}
      >
        {tag}
      </div>

      {/* Header: flag + name */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        {flagEmoji && (
          <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{flagEmoji}</span>
        )}
        <div
          style={{
            fontSize: 15,
            color: WHITE,
            fontWeight: 800,
            textAlign: "right",
            flex: 1,
            lineHeight: 1.15,
          }}
        >
          {name}
        </div>
      </div>

      {/* Wikipedia thumbnail */}
      {wiki?.thumbnailUrl && (
        <img
          src={wiki.thumbnailUrl}
          alt=""
          style={{
            width: "100%",
            maxHeight: 110,
            objectFit: "cover",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)",
            marginBottom: 6,
          }}
        />
      )}
      {/* Wikipedia extract (short) */}
      {wiki?.extract && (
        <div
          style={{
            fontSize: 10,
            color: SECONDARY,
            lineHeight: 1.45,
            marginBottom: 6,
            fontFamily: "var(--font-sans, Inter, sans-serif)",
          }}
        >
          {wiki.extract.length > 200
            ? `${wiki.extract.slice(0, 200).trimEnd()}...`
            : wiki.extract}
        </div>
      )}
      {loading && (
        <div style={{ fontSize: 8, color: DIM, letterSpacing: 1, marginBottom: 4 }}>
          LOADING...
        </div>
      )}

      {/* Geography: area, elevation, density */}
      {geoRows.length > 0 && (
        <>
          <SectionHeader text="GEOGRAPHY" />
          {geoRows.filter((r) => r.value).map((r, i) => (
            <DataRow key={i} label={r.label} value={r.value} />
          ))}
        </>
      )}

      {/* People: population, capital */}
      {peopleRows.length > 0 && (
        <>
          <SectionHeader text="PEOPLE" />
          {peopleRows.filter((r) => r.value).map((r, i) => (
            <DataRow key={i} label={r.label} value={r.value} />
          ))}
        </>
      )}

      {/* Economy: GDP, GDP per capita */}
      {economyRows.length > 0 && (
        <>
          <SectionHeader text="ECONOMY" />
          {economyRows.filter((r) => r.value).map((r, i) => (
            <DataRow key={i} label={r.label} value={r.value} />
          ))}
        </>
      )}

      {/* Culture: languages, currency */}
      {cultureRows.length > 0 && (
        <>
          <SectionHeader text="CULTURE" />
          {cultureRows.filter((r) => r.value).map((r, i) => (
            <DataRow key={i} label={r.label} value={r.value} />
          ))}
        </>
      )}

      {/* Weather */}
      {weatherRows.length > 0 && (
        <>
          <SectionHeader text="WEATHER" />
          {weatherRows.map((r, i) => (
            <DataRow key={i} label={r.label} value={r.value} />
          ))}
        </>
      )}

      <button
        onClick={() => window.open(wikipediaUrl(wikiName), "_blank", "noopener")}
        style={{
          width: "100%",
          padding: "7px 8px",
          background: "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(255, 255, 255, 0.3)",
          borderRadius: 6,
          color: WHITE,
          fontSize: 10,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "center",
          marginTop: 10,
          letterSpacing: 1,
          fontWeight: 700,
        }}
      >
        WIKIPEDIA
      </button>

      <button
        onClick={clearRegion}
        style={{
          width: "100%",
          padding: "7px 8px",
          background: "rgba(255, 80, 80, 0.06)",
          border: "1px solid rgba(255, 80, 80, 0.3)",
          borderRadius: 6,
          color: "#ff5050",
          fontSize: 10,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "center",
          marginTop: 6,
          letterSpacing: 1,
          fontWeight: 700,
        }}
      >
        CLOSE
      </button>
    </div>
  );
}
