"use client";

import { useEffect, useState } from "react";
import type { CctvCamera } from "@/lib/sources/cctv";
import type { FlightState } from "@/lib/sources/opensky";
import type { MilitaryFlight } from "@/lib/sources/airplanes-live";
import type { ProtestEvent, VerificationLevel, EventType } from "@/lib/types";
import type { RegionHit } from "@/globe/region-index";

type Props = {
  cctvCamera?: CctvCamera | null;
  events?: ProtestEvent[];
  privateFlight?: FlightState | null;
  privateFlightDetail?: {
    lastFlight: {
      origin: string | null;
      destination: string | null;
      firstSeen: number | null;
      lastSeen: number | null;
      callsign: string | null;
    } | null;
    personName: string | null;
  } | null;
  militaryFlight?: MilitaryFlight | null;
  region?: RegionHit | null;
  building?: {
    name: string | null;
    height: number | null;
    building: string | null;
    elementId: string | null;
    addrStreet: string | null;
    addrHouse: string | null;
  } | null;
  satellite?: {
    id: string;
    name: string;
    emoji: string;
    category: string;
    description: string;
    lat: number;
    lon: number;
    alt: number;
    velocity: number;
    period: number;
    inclination: number;
  } | null;
  x?: number;
  y?: number;
};

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

function formatYears(num: number | undefined): string | null {
  if (num == null || !isFinite(num)) return null;
  return `${num.toFixed(1)} yrs`;
}

const VERIFICATION_LABEL: Record<VerificationLevel, string> = {
  confirmed: "CONFIRMED",
  multi: "MULTI-SOURCE",
  unconfirmed: "UNCONFIRMED",
};

const VERIFICATION_COLOR: Record<VerificationLevel, string> = {
  confirmed: "#ff4d4d",
  multi: "#ffaa33",
  unconfirmed: "#ffdd44",
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  protest: "PROTEST",
  riot: "RIOT",
  arrest: "ARREST",
  shutdown: "SHUTDOWN",
  fire: "FIRE",
  earthquake: "EARTHQUAKE",
  other: "OTHER",
};

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
  } catch {
    return iso;
  }
}

function EventEntry({ event, index, total }: { event: ProtestEvent; index: number; total: number }) {
  const vColor =
    VERIFICATION_COLOR[event.verificationLevel] ?? VERIFICATION_COLOR.unconfirmed;
  const vLabel =
    VERIFICATION_LABEL[event.verificationLevel] ?? VERIFICATION_LABEL.unconfirmed;
  const typeLabel = EVENT_TYPE_LABEL[event.type] ?? EVENT_TYPE_LABEL.other;

  // Prefer archived URL when available (snapshot of source at ingest time),
  // else fall back to the live sourceUrl.
  const linkSources = event.sources
    .map((s) => ({
      label: s.sourceName,
      href: s.archivedUrl || s.sourceUrl,
    }))
    .filter((s) => s.href);

  return (
    <div
      style={{
        borderTop: index > 0 ? "1px solid #1a1a1a" : "none",
        paddingTop: index > 0 ? 8 : 0,
        marginTop: index > 0 ? 8 : 0,
      }}
    >
      {total > 1 && (
        <div style={{ fontSize: 7, color: "#5a606c", letterSpacing: 1, marginBottom: 3 }}>
          EVENT {index + 1} / {total}
        </div>
      )}
      <div style={{ fontSize: 8, color: vColor, letterSpacing: 2, marginBottom: 3 }}>
        ◉ {typeLabel} · {vLabel}
      </div>
      <div style={{ fontSize: 12, color: "#fff", fontWeight: 700, marginBottom: 3 }}>
        {event.title}
      </div>
      {event.description && (
        <div
          style={{
            fontSize: 10,
            color: "#aab0bb",
            marginBottom: 5,
            lineHeight: 1.4,
            maxHeight: 72,
            overflow: "hidden",
          }}
        >
          {event.description}
        </div>
      )}
      <div style={{ fontSize: 9, color: "#888", marginBottom: 3 }}>
        {event.locationName && <span>{event.locationName}</span>}
        {event.locationName && event.province && " · "}
        {event.province}
      </div>
      <div style={{ fontSize: 8, color: "#666", marginBottom: 3 }}>
        {formatEventTime(event.eventTime)}
        {event.actor && ` · ${event.actor}`}
      </div>
      <div style={{ fontSize: 8, color: "#555", marginBottom: 5 }}>
        {typeof event.estimatedCrowdSize === "number" &&
          `~${event.estimatedCrowdSize.toLocaleString()} protesters · `}
        {typeof event.casualtyCount === "number" &&
          event.casualtyCount > 0 &&
          `${event.casualtyCount} casualties · `}
        {`conf ${event.confidence}/100`}
      </div>

      {linkSources.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          {linkSources.map((s, i) => (
            <a
              key={`${i}-${s.href}`}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                fontSize: 9,
                color: "#00D4FF",
                textDecoration: "none",
                padding: "3px 6px",
                marginBottom: 3,
                border: "1px solid #00D4FF22",
                borderRadius: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={s.href}
            >
              {s.label} →
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EventPopup({ events }: { events: ProtestEvent[] }) {
  if (events.length === 0) return null;
  const first = events[0];

  // Header uses the highest verification level across all events in the
  // cluster for the accent color.
  const topV = events.reduce((best, e) =>
    VERIFICATION_COLOR[e.verificationLevel] &&
    (best === null || e.verificationLevel === "confirmed" ||
     (e.verificationLevel === "multi" && best !== "confirmed"))
      ? e.verificationLevel
      : best,
    first.verificationLevel as (typeof first.verificationLevel) | null,
  );
  const headerColor = topV
    ? VERIFICATION_COLOR[topV] ?? VERIFICATION_COLOR.unconfirmed
    : VERIFICATION_COLOR.unconfirmed;

  return (
    <>
      <div style={{ fontSize: 8, color: headerColor, letterSpacing: 2, marginBottom: 4 }}>
        ◉ CIVIL UNREST · {events.length} {events.length === 1 ? "EVENT" : "EVENTS"}
      </div>
      <div style={{ fontSize: 8, color: "#555", marginBottom: 6 }}>
        {first.lat.toFixed(4)}°, {first.lon.toFixed(4)}°
        {first.province && ` · ${first.province}`}
      </div>
      {events.map((ev, i) => (
        <EventEntry key={ev.id} event={ev} index={i} total={events.length} />
      ))}
    </>
  );
}

function PrivateFlightPopup({ flight, detail }: { flight: FlightState; detail?: Props["privateFlightDetail"] }) {
  const altKm = flight.altitude != null ? `${(flight.altitude / 1000).toFixed(1)} km` : "—";
  const velKmh = flight.velocity != null
    ? `${Math.round(flight.velocity * 3.6)} km/h`
    : "—";
  const sourceUrl = `https://opensky-network.org/aircraft-profile?icao24=${encodeURIComponent(flight.icao24)}`;
  const lastFlight = detail?.lastFlight;
  const personName = detail?.personName;
  const fmtTime = (ts: number | null) => {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  return (
    <>
      <div style={{ fontSize: 8, color: "#f0f0f0", letterSpacing: 2, marginBottom: 4 }}>
        ◉ PRIVATE FLIGHT · ICAO24 {flight.icao24.toUpperCase()}
      </div>
      {personName && (
        <div style={{ fontSize: 12, color: "#FFD700", fontWeight: 700, marginBottom: 3 }}>
          {personName}
        </div>
      )}
      <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
        {flight.callsign || "Unknown callsign"}
      </div>
      <div style={{ fontSize: 9, color: "#888", marginBottom: 6 }}>
        {flight.originCountry || "Unknown origin country"}
        {flight.onGround ? " · ON GROUND" : " · AIRBORNE"}
      </div>
      <div style={{ fontSize: 8, color: "#666", marginBottom: 6 }}>
        ALT {altKm} · VEL {velKmh} · HDG {Math.round(flight.heading)}°
      </div>
      <div style={{ fontSize: 8, color: "#555", marginBottom: 6 }}>
        {flight.latitude.toFixed(4)}°, {flight.longitude.toFixed(4)}°
      </div>
      {lastFlight && (lastFlight.origin || lastFlight.destination) && (
        <div style={{ fontSize: 8, color: "#aaa", marginBottom: 6, padding: "4px 6px", background: "rgba(255,215,0,0.05)", borderRadius: 4, border: "1px solid rgba(255,215,0,0.15)" }}>
          <div style={{ color: "#FFD700", marginBottom: 2, letterSpacing: 1, fontSize: 7 }}>
            LAST FLIGHT
          </div>
          <div>
            {lastFlight.origin || "?"} → {lastFlight.destination || "?"}
          </div>
          <div style={{ color: "#666", marginTop: 2 }}>
            {fmtTime(lastFlight.firstSeen)} - {fmtTime(lastFlight.lastSeen)}
          </div>
        </div>
      )}
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          fontSize: 9,
          color: "#00D4FF",
          textDecoration: "none",
          textAlign: "center",
          padding: "4px 8px",
          border: "1px solid #00D4FF33",
          borderRadius: 6,
          marginTop: 4,
        }}
      >
        VIEW ON OPENSKY →
      </a>
      <div style={{ fontSize: 7, color: "#444", marginTop: 4, fontStyle: "italic" }}>
        Click icon to see trajectory + airports
      </div>
    </>
  );
}

function MilitaryFlightPopup({ flight }: { flight: MilitaryFlight }) {
  const altKm = flight.altitude != null ? `${(flight.altitude / 1000).toFixed(1)} km` : "—";
  const velKmh = flight.velocity != null
    ? `${Math.round(flight.velocity * 3.6)} km/h`
    : "—";
  const sourceUrl = `https://www.airplanes.live/view/?icao=${encodeURIComponent(flight.icao24)}`;
  return (
    <>
      <div style={{ fontSize: 8, color: "#ff5533", letterSpacing: 2, marginBottom: 4 }}>
        ◉ MILITARY FLIGHT · HEX {flight.icao24.toUpperCase()}
      </div>
      <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
        {flight.callsign || "Unknown callsign"}
      </div>
      <div style={{ fontSize: 9, color: "#888", marginBottom: 4 }}>
        {flight.description || flight.type || "Unknown type"}
      </div>
      {flight.operator && (
        <div style={{ fontSize: 9, color: "#888", marginBottom: 4 }}>
          {flight.operator}
        </div>
      )}
      {flight.registration && (
        <div style={{ fontSize: 8, color: "#666", marginBottom: 4 }}>
          REG {flight.registration}
          {flight.squawk && ` · SQK ${flight.squawk}`}
          {flight.emergency && ` · EMERG ${flight.emergency}`}
        </div>
      )}
      <div style={{ fontSize: 8, color: "#666", marginBottom: 6 }}>
        ALT {altKm} · VEL {velKmh} · HDG {Math.round(flight.heading)}°
        {flight.onGround ? " · ON GROUND" : " · AIRBORNE"}
      </div>
      <div style={{ fontSize: 8, color: "#555", marginBottom: 6 }}>
        {flight.latitude.toFixed(4)}°, {flight.longitude.toFixed(4)}°
      </div>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          fontSize: 9,
          color: "#00D4FF",
          textDecoration: "none",
          textAlign: "center",
          padding: "4px 8px",
          border: "1px solid #00D4FF33",
          borderRadius: 6,
          marginTop: 4,
        }}
      >
        VIEW ON AIRPLANES.LIVE →
      </a>
      <div style={{ fontSize: 7, color: "#444", marginTop: 4, fontStyle: "italic" }}>
        Click icon to see trajectory
      </div>
    </>
  );
}

function CctvSnapshot({ camera }: { camera: CctvCamera }) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let revoked = false;
    setSrc(null);
    setStatus("loading");

    fetch(`/api/cctv/snapshot?id=${encodeURIComponent(camera.id)}`)
      .then((res) => {
        if (!res.ok) {
          if (!revoked) setStatus("error");
          return null;
        }
        return res.blob();
      })
      .then((blob) => {
        if (revoked || !blob) return;
        const url = URL.createObjectURL(blob);
        setSrc(url);
        setStatus("ok");
      })
      .catch(() => {
        if (!revoked) setStatus("error");
      });

    return () => {
      revoked = true;
      if (src) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id]);

  if (status === "loading") {
    return (
      <div
        style={{
          width: "100%",
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080808",
          border: "1px solid #00D4FF33",
          borderRadius: 8,
          color: "#00D4FF",
          fontSize: 9,
          letterSpacing: 1,
        }}
      >
        FETCHING SNAPSHOT…
      </div>
    );
  }

  if (status === "error" || !src) {
    return (
      <div
        style={{
          width: "100%",
          height: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080808",
          border: "1px solid #1a1a1a",
          borderRadius: 8,
          color: "#5a606c",
          fontSize: 9,
          fontStyle: "italic",
        }}
      >
        No snapshot available
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={camera.name}
      style={{
        width: "100%",
        display: "block",
        borderRadius: 8,
        border: "1px solid #00D4FF33",
      }}
    />
  );
}

function BuildingPopup({ building }: { building: NonNullable<Props["building"]> }) {  const parts: string[] = [];
  if (building.building) parts.push(building.building.toUpperCase());
  if (typeof building.height === "number" && building.height > 0) {
    parts.push(`${building.height.toFixed(0)} m`);
  }
  const address = building.addrHouse
    ? `${building.addrHouse}${building.addrStreet ? ` ${building.addrStreet}` : ""}`
    : building.addrStreet;
  return (
    <>
      <div style={{ fontSize: 8, color: "#ffc82a", letterSpacing: 2, marginBottom: 4 }}>
        ◉ BUILDING · OSM
      </div>
      <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
        {building.name || "Unnamed building"}
      </div>
      {parts.length > 0 && (
        <div style={{ fontSize: 9, color: "#888", marginBottom: 4 }}>
          {parts.join(" · ")}
        </div>
      )}
      {address && (
        <div style={{ fontSize: 9, color: "#888", marginBottom: 4 }}>{address}</div>
      )}
      {building.elementId && (
        <div style={{ fontSize: 8, color: "#555", marginBottom: 4 }}>
          OSM element {building.elementId}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 7, color: "#5a606c", letterSpacing: 1, marginBottom: 1 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#fff",
          fontWeight: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
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
            border: "1px solid #ffffff22",
            flexShrink: 0,
            background: "#0a0c12",
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 8, color: "#00D4FF", letterSpacing: 2, marginBottom: 2 }}>
          {tag}
        </div>
        <div
          style={{
            fontSize: 15,
            color: "#fff",
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
      </div>
    </div>
  );
}

function RegionPopup({ region }: { region: NonNullable<Props["region"]> }) {
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
          style={{ fontSize: 8, color: "#5a606c", letterSpacing: 1, marginTop: 6 }}
        >
          PART OF <span style={{ color: "#c4c8cf" }}>{s.admin}</span>
        </div>
      )}
    </>
  );
}

export default function HoverPopup({ cctvCamera, events, privateFlight, privateFlightDetail, militaryFlight, region, building, satellite, x, y }: Props) {
  const hasEvents = events && events.length > 0;
  if ((!cctvCamera && !hasEvents && !privateFlight && !militaryFlight && !region && !building && !satellite) || x == null || y == null) return null;

  const left = Math.min(x + 14, window.innerWidth - 360);
  const top = Math.min(y + 14, window.innerHeight - 320);

  // Pick the popup background based on what's hovered. Hover content like
  // private/military flight info needs a SOLID background so the text stays
  // legible against the globe imagery behind it. The transparent + blur
  // style was making text unreadable.
  function bgFor(): string {
    if (privateFlight) return "rgba(20, 16, 6, 0.96)";    // dark gold tint
    if (militaryFlight) return "rgba(22, 8, 6, 0.96)";     // dark red tint
    if (satellite) return "rgba(6, 14, 20, 0.96)";         // dark cyan tint
    if (region) return "rgba(8, 12, 18, 0.96)";            // dark blue
    if (building) return "rgba(20, 14, 4, 0.96)";          // dark yellow
    if (hasEvents) return "rgba(18, 6, 6, 0.96)";          // dark red
    if (cctvCamera) return "rgba(6, 14, 20, 0.96)";        // dark cyan
    return "rgba(8, 10, 14, 0.96)";                        // near-black
  }
  function borderFor(): string {
    if (privateFlight) return "1px solid rgba(255, 215, 0, 0.4)";
    if (militaryFlight) return "1px solid rgba(255, 85, 51, 0.4)";
    if (satellite) return "1px solid rgba(0, 212, 255, 0.4)";
    if (region) return "1px solid rgba(0, 212, 255, 0.3)";
    if (building) return "1px solid rgba(255, 200, 42, 0.3)";
    if (hasEvents) return "1px solid rgba(255, 77, 77, 0.3)";
    if (cctvCamera) return "1px solid rgba(0, 212, 255, 0.3)";
    return "1px solid #1a1a1a";
  }

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 340,
        maxHeight: window.innerHeight - top - 20,
        overflowY: "auto",
        background: bgFor(),
        border: borderFor(),
        borderRadius: 8,
        padding: 10,
        zIndex: 1000,
        pointerEvents: "auto",
        fontFamily: "monospace",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.95)",
      }}
    >
      {hasEvents && <EventPopup events={events!} />}
      {privateFlight && <PrivateFlightPopup flight={privateFlight} detail={privateFlightDetail} />}
      {militaryFlight && <MilitaryFlightPopup flight={militaryFlight} />}
      {region && <RegionPopup region={region} />}
      {building && <BuildingPopup building={building} />}
      {satellite && (
        <div>
          <div style={{ fontSize: 8, color: "#00D4FF", letterSpacing: 2, marginBottom: 4 }}>
            ◉ SATELLITE · {satellite.category.toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
            {satellite.emoji} {satellite.name}
          </div>
          <div style={{ fontSize: 9, color: "#888", marginBottom: 6 }}>
            {satellite.description}
          </div>
          <div style={{ fontSize: 9, color: "#5ab3d4", lineHeight: 1.6 }}>
            <div>ALT {Math.round(satellite.alt)} km · {satellite.velocity.toFixed(1)} km/s</div>
            <div>PERIOD {Math.round(satellite.period)} min · INC {satellite.inclination.toFixed(1)}°</div>
            <div>LAT {satellite.lat.toFixed(4)}° · LON {satellite.lon.toFixed(4)}°</div>
          </div>
        </div>
      )}
      {cctvCamera && (
        <>
          <div style={{ fontSize: 8, color: "#00D4FF", letterSpacing: 2, marginBottom: 4 }}>
            ◉ CCTV · {cctvCamera.provider.toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, marginBottom: 4 }}>
            {cctvCamera.name}
          </div>
          <div style={{ fontSize: 9, color: "#888", marginBottom: 6 }}>
            {cctvCamera.region}
            {cctvCamera.category && ` · ${cctvCamera.category}`}
          </div>
          <div style={{ fontSize: 8, color: "#444", marginBottom: 6 }}>
            {cctvCamera.lat.toFixed(4)}°, {cctvCamera.lon.toFixed(4)}°
          </div>
          <CctvSnapshot key={cctvCamera.id} camera={cctvCamera} />
          {cctvCamera.embedUrl && (
            <a
              href={cctvCamera.embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                marginTop: 6,
                fontSize: 9,
                color: "#00D4FF",
                textDecoration: "none",
                textAlign: "center",
                padding: "4px 8px",
                border: "1px solid #00D4FF33",
                borderRadius: 6,
              }}
            >
              OPEN LIVE STREAM →
            </a>
          )}
        </>
      )}
    </div>
  );
}
