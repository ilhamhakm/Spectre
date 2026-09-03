"use client";

import { useEffect, useState } from "react";
import type { RegionHit } from "@/globe/region-index";
import type { CityInfo } from "@/globe/region-index";
import { useGlobeStore } from "@/store/globe-store";

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
      year: Math.max(
        ...Object.values(latest).map((v) => v.year),
        0,
      ),
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

function formatPct(num: number | undefined): string | null {
  if (num == null || !isFinite(num)) return null;
  return `${num.toFixed(1)}%`;
}

function Stat({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 7,
          color: "var(--text-dim)",
          letterSpacing: 1.5,
          marginBottom: 1,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-primary)",
          fontWeight: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function RegionHeader({
  tag,
  name,
  flagUrl,
}: {
  tag: string;
  name: string;
  flagUrl: string | null;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      {flagUrl && (
        <img
          src={flagUrl}
          alt=""
          style={{
            width: 46,
            height: 30,
            objectFit: "cover",
            borderRadius: 3,
            border: "1px solid var(--btn-border)",
            flexShrink: 0,
            background: "var(--bg-dark)",
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 8,
            color: "var(--accent)",
            letterSpacing: 2,
            marginBottom: 2,
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            textShadow: "0 0 8px var(--accent-glow)",
          }}
        >
          {tag}
        </div>
        <div
          style={{
            fontSize: 15,
            color: "var(--text-primary)",
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "var(--font-mono)",
          }}
        >
          {name}
        </div>
      </div>
    </div>
  );
}

function RegionPopup({ region }: { region: NonNullable<RegionHit> }) {
  // Fetch World Bank data when hovering over a country
  const [wb, setWb] = useState<WBIndicators | null>(null);
  const [loadingWb, setLoadingWb] = useState(false);

  useEffect(() => {
    if (region.level === "country" && region.info.iso2) {
      setLoadingWb(true);
      fetchWorldBank(region.info.iso2)
        .then(setWb)
        .catch(() => {})
        .finally(() => setLoadingWb(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  if (region.level === "continent") {
    const c = region.info;
    return (
      <>
        <RegionHeader tag="◉ CONTINENT" name={c.name} flagUrl={null} />
      </>
    );
  }

  if (region.level === "country") {
    const c = region.info;
    const popLabel =
      typeof c.population === "number"
        ? `${c.population.toLocaleString()}${c.popYear ? ` · ${c.popYear}` : ""}`
        : null;
    const areaLabel =
      typeof c.areaKm2 === "number" ? `${c.areaKm2.toLocaleString()} km²` : null;

    // Display economic metrics when available
    const metrics = [];
    if (wb && !loadingWb) {
      if (wb.gdp) metrics.push({ label: "GDP", value: formatCompact(wb.gdp) });
      if (wb.gdpPerCapita) metrics.push({ label: "GDP/CAPITA", value: formatCompact(wb.gdpPerCapita) });
      if (wb.gdpGrowth) metrics.push({ label: "GDP GROWTH", value: formatPct(wb.gdpGrowth) });
      if (wb.inflation) metrics.push({ label: "INFLATION", value: formatPct(wb.inflation) });
      if (wb.unemployment) metrics.push({ label: "UNEMPLOYMENT", value: formatPct(wb.unemployment) });
      if (wb.lifeExpectancy) metrics.push({ label: "LIFE EXPECTANCY", value: `${wb.lifeExpectancy} yrs` });
      if (wb.debtToGdp) metrics.push({ label: "DEBT/GDP", value: formatPct(wb.debtToGdp) });
      if (wb.reserves) metrics.push({ label: "RESERVES", value: formatCompact(wb.reserves) });
    }

    return (
      <>
        <RegionHeader tag="◉ COUNTRY" name={c.name} flagUrl={c.flagUrl} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
          <Stat label="POPULATION" value={popLabel} />
          <Stat label="AREA" value={areaLabel} />
          <Stat label="CAPITAL" value={c.capital} />
          {metrics.map((m, i) => <Stat key={i} label={m.label} value={m.value} />)}
        </div>
      </>
    );
  }
  if (region.level === "city") {
    const c: CityInfo = region.info;
    const popLabel =
      typeof c.population === "number"
        ? c.population.toLocaleString()
        : null;
    return (
      <>
        <RegionHeader tag="◉ CITY" name={c.name} flagUrl={null} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
          <Stat label="POPULATION" value={popLabel} />
          <Stat label="COUNTRY" value={c.country} />
        </div>
        <div
          style={{
            fontSize: 8,
            color: "var(--text-dim)",
            letterSpacing: 1.5,
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
          }}
        >
          COORDS{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            {Math.abs(c.lat).toFixed(4)}°{c.lat >= 0 ? "N" : "S"},{" "}
            {Math.abs(c.lon).toFixed(4)}°{c.lon >= 0 ? "E" : "W"}
          </span>
        </div>
      </>
    );
  }
  const s = region.info;
  const popLabel =
    typeof s.population === "number"
      ? `${s.population.toLocaleString()}${s.popYear ? ` · ${s.popYear}` : ""}`
      : null;
  const typeLabel = ((s.typeEn || s.type || "").toUpperCase()) || null;
  const displayName =
    s.nameEn && s.nameEn.toLowerCase() !== s.name.toLowerCase()
      ? `${s.nameEn} (${s.name})`
      : s.name;
  return (
    <>
      <RegionHeader
        tag={typeLabel ? `◉ STATE · ${typeLabel}` : "◉ STATE"}
        name={displayName}
        flagUrl={s.flagUrl || s.countryFlagUrl}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
        <Stat label="POPULATION" value={popLabel} />
        <Stat label="CAPITAL" value={s.capital} />
      </div>
      {s.admin && (
        <div
          style={{
            fontSize: 8,
            color: "var(--text-dim)",
            letterSpacing: 1.5,
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
          }}
        >
          PART OF <span style={{ color: "var(--text-secondary)" }}>{s.admin}</span>
        </div>
      )}
    </>
  );
}

export default function RegionPopupOverlay() {
  const hoveredRegion = useGlobeStore((s) => s.hoveredRegion);
  const hoverPos = useGlobeStore((s) => s.hoverPos);

  if (!hoveredRegion || !hoverPos) return null;

  const left = Math.min(hoverPos.x + 14, window.innerWidth - 360);
  const top = Math.min(hoverPos.y + 14, window.innerHeight - 320);

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 340,
        maxHeight: window.innerHeight - top - 20,
        overflowY: "auto",
        background: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(20px) saturate(1.4)",
        WebkitBackdropFilter: "blur(20px) saturate(1.4)",
        border: "1px solid var(--btn-border)",
        borderRadius: 12,
        padding: 12,
        zIndex: 1000,
        pointerEvents: "auto",
        fontFamily: "var(--font-mono)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
      }}
    >
      <RegionPopup region={hoveredRegion} />
    </div>
  );
}
