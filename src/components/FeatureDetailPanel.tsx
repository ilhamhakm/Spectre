"use client";

import { useGlobeStore, type TrackedFeature } from "@/store/globe-store";

// Tracked static feature detail card (dam / earthquake / data center).
// Renders in the right rail when trackedFeature is set, mirroring the
// SatelliteDetailPanel visual language: accent header, right-aligned name,
// SectionHeader + DataRow rows, CLOSE button. Tracking is a one-shot fly-to
// + info display (no live telemetry, unlike flights/satellites).

const WHITE = "#ffffff";
const DIM = "rgba(255,255,255,0.45)";

const KIND_LABEL: Record<TrackedFeature["kind"], string> = {
  dam: "DAM",
  earthquake: "EARTHQUAKE TRACKING",
  datacenter: "DATA CENTER",
  unrest: "CIVIL UNREST",
  building: "BUILDING",
};

const KIND_ACCENT: Record<TrackedFeature["kind"], string> = {
  dam: "#0088ff",
  earthquake: "#ff4d4d",
  datacenter: "#00ffff",
  unrest: "#ff7a3d",
  building: "#ffffff",
};

function SectionHeader({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        color: DIM,
        letterSpacing: 1,
        marginBottom: 4,
        fontWeight: 700,
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
        padding: "4px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ fontSize: 10, color: DIM, letterSpacing: 1, fontWeight: 700 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          color: WHITE,
          textAlign: "right",
          fontWeight: 700,
          maxWidth: "70%",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function clean(v: unknown): string {
  const t = String(v ?? "").trim();
  if (!t || t === "undefined" || t === "null") return "";
  return t;
}

function formatTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return "";
  }
}

function formatCoord(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const latH = lat >= 0 ? "N" : "S";
  const lonH = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)} deg ${latH}, ${Math.abs(lon).toFixed(3)} deg ${lonH}`;
}

function depthBandColor(depthKm: number): string {
  if (depthKm < 70) return "#ff4d4d";
  if (depthKm < 300) return "#ffaa33";
  return "#ffdd44";
}

function wikipediaUrl(tag: string): string | null {
  const t = clean(tag);
  if (!t) return null;
  const idx = t.indexOf(":");
  if (idx < 0) return `https://en.wikipedia.org/wiki/${t.replace(/ /g, "_")}`;
  const lang = t.slice(0, idx);
  const article = t.slice(idx + 1).replace(/ /g, "_");
  return `https://${lang}.wikipedia.org/wiki/${article}`;
}

function wikidataUrl(tag: string): string | null {
  const t = clean(tag);
  if (!t || !/^Q\d+$/.test(t)) return null;
  return `https://www.wikidata.org/wiki/${t}`;
}

function osmUrl(osmId: unknown): string | null {
  const id = Number(osmId);
  if (!Number.isFinite(id) || id === 0) return null;
  // Negative OSM IDs indicate ways in this dataset.
  if (id < 0) return `https://www.openstreetmap.org/way/${Math.abs(id)}`;
  return `https://www.openstreetmap.org/node/${id}`;
}

function InfoButton({ url, label, accent }: { url: string; label: string; accent: string }) {
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  return (
    <button
      onClick={() => window.open(url, "_blank", "noopener")}
      style={{
        width: "100%",
        padding: "7px 8px",
        background: `rgba(${r}, ${g}, ${b}, 0.06)`,
        border: `1px solid ${accent}55`,
        borderRadius: 4,
        color: accent,
        fontSize: 11,
        fontFamily: "inherit",
        cursor: "pointer",
        textAlign: "center",
        marginTop: 8,
        letterSpacing: 1,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
}

function DamRows({ f }: { f: TrackedFeature }) {
  const tags = (f.data.tags ?? {}) as Record<string, unknown>;
  const accent = KIND_ACCENT.dam;
  const river = clean(tags.associated_river) || clean(f.data.associated_river)
    || clean(tags.river) || clean(tags["river:name"]);
  const operator = clean(tags.operator) || clean(f.data.operator);
  const output = clean(tags["plant:output:electricity"]) || clean(f.data.output);
  const source = clean(tags["plant:source"]) || clean(f.data.source);
  const method = clean(tags["plant:method"]);
  const startDate = clean(tags.start_date);
  const altName = clean(tags.alt_name);
  const material = clean(tags.material);
  const website = clean(tags.website);
  const nidRef = clean(tags["ref:US:NID"]);
  const eiaRef = clean(tags["ref:US:EIA"]);
  const gnisRef = clean(tags["gnis:feature_id"]);
  const wiki = wikipediaUrl(clean(tags.wikipedia));
  const wikidata = wikidataUrl(clean(tags.wikidata));
  const osm = osmUrl(f.data.osm_id);
  // Engineering specs
  const voltage = clean(tags.voltage);
  const frequency = clean(tags.frequency);
  const generatorType = clean(tags["generator:type"]);
  const turbineType = clean(tags["generator:turbine:type"]);
  const construction = clean(tags.construction) || clean(tags["dam:type"]);
  // Physical dimensions
  const damHeight = clean(tags.dam_height) || clean(tags.height);
  const weirLength = clean(tags.weir_length);
  const baseThickness = clean(tags.base_thickness);
  const foundationDepth = clean(tags.foundation_depth);
  // Classification
  const importance = clean(tags.importance);
  const officialName = clean(tags.official_name);
  const architect = clean(tags.architect);
  const operatorWiki = wikidataUrl(clean(tags["operator:wikidata"]));
  const gnsId = clean(tags["GNS:id"]);

  // Priority: Wikipedia > Wikidata > OSM
  const infoUrl = wiki || wikidata || osm;
  const infoLabel = wiki ? "WIKIPEDIA ARTICLE" : wikidata ? "WIKIDATA ENTRY" : osm ? "OPENSTREETMAP" : "";

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="LOCATION" />
        <DataRow label="COORDS" value={formatCoord(f.lat, f.lon)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="DETAILS" />
        {output && output.toLowerCase() !== "yes" && <DataRow label="OUTPUT" value={output} />}
        {source && <DataRow label="SOURCE" value={source} />}
        {method && <DataRow label="METHOD" value={method} />}
        {river && <DataRow label="RIVER" value={river} />}
        {operator && <DataRow label="OPERATOR" value={operator} />}
        {material && <DataRow label="MATERIAL" value={material} />}
        {startDate && <DataRow label="BUILT" value={startDate} />}
        {altName && <DataRow label="ALT NAME" value={altName} />}
        {officialName && officialName !== f.name && <DataRow label="OFFICIAL" value={officialName} />}
      </div>
      {(voltage || frequency || generatorType || turbineType || construction) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="ENGINEERING" />
          {voltage && <DataRow label="VOLTAGE" value={voltage} />}
          {frequency && <DataRow label="FREQUENCY" value={frequency} />}
          {generatorType && <DataRow label="GENERATOR" value={generatorType} />}
          {turbineType && <DataRow label="TURBINE" value={turbineType} />}
          {construction && <DataRow label="TYPE" value={construction} />}
        </div>
      )}
      {(damHeight || weirLength || baseThickness || foundationDepth) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="DIMENSIONS" />
          {damHeight && <DataRow label="HEIGHT" value={damHeight} />}
          {weirLength && <DataRow label="WEIR LEN" value={weirLength} />}
          {baseThickness && <DataRow label="BASE THK" value={baseThickness} />}
          {foundationDepth && <DataRow label="FOUNDATION" value={foundationDepth} />}
        </div>
      )}
      {(importance || architect) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="CLASSIFICATION" />
          {importance && <DataRow label="IMPORTANCE" value={importance.toUpperCase()} />}
          {architect && <DataRow label="ARCHITECT" value={architect} />}
        </div>
      )}
      {(nidRef || eiaRef || gnisRef || gnsId || website) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="REFERENCES" />
          {nidRef && <DataRow label="NID" value={nidRef} />}
          {eiaRef && <DataRow label="EIA" value={eiaRef} />}
          {gnisRef && <DataRow label="GNIS" value={gnisRef} />}
          {gnsId && <DataRow label="GNS" value={gnsId} />}
          {website && <DataRow label="WEBSITE" value={website} />}
        </div>
      )}
      {infoUrl && <InfoButton url={infoUrl} label={infoLabel} accent={accent} />}
      {operatorWiki && <InfoButton url={operatorWiki} label="OPERATOR INFO" accent={accent} />}
    </>
  );
}

function EarthquakeRows({ f }: { f: TrackedFeature }) {
  const mag = Number(f.data.mag ?? 0);
  const depth = Number(f.data.depth ?? 0);
  const place = clean(f.data.place);
  const time = Number(f.data.time ?? 0);
  const usgsId = clean(f.data.usgsId);
  const magType = clean(f.data.magType);
  const tsunami = Number(f.data.tsunami ?? 0);
  const sig = Number(f.data.sig ?? 0);
  const felt = Number(f.data.felt ?? 0);
  const cdi = Number(f.data.cdi ?? 0);
  const mmi = Number(f.data.mmi ?? 0);
  const alert = clean(f.data.alert);
  const status = clean(f.data.status);
  const gap = Number(f.data.gap ?? 0);
  const rms = Number(f.data.rms ?? 0);
  const dmin = Number(f.data.dmin ?? 0);
  const nst = Number(f.data.nst ?? 0);
  const updated = Number(f.data.updated ?? 0);
  const accent = depthBandColor(depth);

  // GDELT DOC API search for earthquake news coverage.
  const newsQuery = `M${mag.toFixed(1)} earthquake ${place}`.trim();
  const newsUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(newsQuery)}&mode=ArtList&maxrecords=25&sort=datedesc&format=json`;

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="LOCATION" />
        <DataRow label="COORDS" value={formatCoord(f.lat, f.lon)} />
        {place && <DataRow label="PLACE" value={place} />}
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="EVENT" />
        <DataRow label="MAGNITUDE" value={mag ? `M${mag.toFixed(1)}` : "..."} />
        {magType && <DataRow label="MAG TYPE" value={magType.toUpperCase()} />}
        <DataRow
          label="DEPTH"
          value={Number.isFinite(depth) ? `${depth.toFixed(1)} km` : "..."}
        />
        <DataRow
          label="BAND"
          value={
            depth < 70 ? "SHALLOW" : depth < 300 ? "INTERMEDIATE" : "DEEP"
          }
        />
        <DataRow label="TIME" value={formatTime(time) || "..."} />
        {updated && <DataRow label="UPDATED" value={formatTime(updated) || "..."} />}
        {status && <DataRow label="STATUS" value={status.toUpperCase()} />}
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="IMPACT" />
        {tsunami === 1 && <DataRow label="TSUNAMI" value="WARNING ISSUED" />}
        {sig > 0 && <DataRow label="SIGNIFICANCE" value={String(sig)} />}
        {felt > 0 && <DataRow label="FELT REPORTS" value={String(felt)} />}
        {cdi > 0 && <DataRow label="CDI" value={`${cdi.toFixed(1)} (DYFI)`} />}
        {mmi > 0 && <DataRow label="MMI" value={`${mmi.toFixed(1)} (instrumental)`} />}
        {alert && <DataRow label="PAGER ALERT" value={alert.toUpperCase()} />}
      </div>
      {(gap > 0 || rms > 0 || dmin > 0 || nst > 0) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="SEISMIC QUALITY" />
          {nst > 0 && <DataRow label="STATIONS" value={String(nst)} />}
          {gap > 0 && <DataRow label="AZIMUTH GAP" value={`${gap.toFixed(0)} deg`} />}
          {rms > 0 && <DataRow label="RMS" value={`${rms.toFixed(2)} s`} />}
          {dmin > 0 && <DataRow label="MIN DIST" value={`${dmin.toFixed(2)} deg`} />}
        </div>
      )}
      {usgsId && <DataRow label="USGS ID" value={usgsId} />}
      {usgsId && (
        <InfoButton
          url={`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}`}
          label="USGS EVENT PAGE"
          accent={accent}
        />
      )}
      <InfoButton url={newsUrl} label="NEWS COVERAGE" accent={accent} />
    </>
  );
}

function DataCenterRows({ f }: { f: TrackedFeature }) {
  const tags = (f.data.tags ?? {}) as Record<string, unknown>;
  const accent = KIND_ACCENT.datacenter;
  const operator = clean(tags.operator) || clean(tags["operator:short"]) || clean(f.data.operator);
  const operatorShort = clean(tags["operator:short"]);
  const power = clean(tags["data_center:power"]) || clean(tags["capacity:it_load"])
    || clean(tags.it_load) || clean(tags.capacity);
  const buildingType = clean(tags.building);
  const levels = clean(tags["building:levels"]);
  const levelsUnderground = clean(tags["building:levels:underground"]);
  const height = clean(tags.height);
  const website = clean(tags.website) || clean(tags["contact:website"]);
  const description = clean(tags.description);
  const ref = clean(tags.ref);
  const startDate = clean(tags.start_date);
  const brand = clean(tags.brand);
  const branch = clean(tags.branch);
  const shortName = clean(tags.short_name);
  const fullName = clean(tags.full_name);
  const oldName = clean(tags.old_name);
  const nameEn = clean(tags["name:en"]);
  const manMade = clean(tags.man_made);
  const roofShape = clean(tags["roof:shape"]);
  const roofColour = clean(tags["roof:colour"]);
  const buildingColour = clean(tags["building:colour"]);
  const buildingMaterial = clean(tags["building:material"]);
  const note = clean(tags.note);
  const wiki = wikipediaUrl(clean(tags.wikipedia));
  const wikidata = wikidataUrl(clean(tags.wikidata));
  const operatorWiki = wikidataUrl(clean(tags["operator:wikidata"]));
  const operatorWikipedia = wikipediaUrl(clean(tags["operator:wikipedia"]));
  const osm = osmUrl(f.data.osm_id);

  // Priority: Wikipedia > Wikidata > OSM
  const infoUrl = wiki || wikidata || osm;
  const infoLabel = wiki ? "WIKIPEDIA ARTICLE" : wikidata ? "WIKIDATA ENTRY" : osm ? "OPENSTREETMAP" : "";

  // Operator info link: operator:wikidata > operator:wikipedia
  const operatorInfoUrl = operatorWiki || operatorWikipedia;
  const operatorInfoLabel = operatorWiki ? "OPERATOR (WIKIDATA)" : operatorWikipedia ? "OPERATOR (WIKIPEDIA)" : "";

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="LOCATION" />
        <DataRow label="COORDS" value={formatCoord(f.lat, f.lon)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="OPERATOR" />
        {operator && <DataRow label="OPERATOR" value={operator} />}
        {operatorShort && operatorShort !== operator && <DataRow label="SHORT" value={operatorShort} />}
        {brand && brand !== operator && <DataRow label="BRAND" value={brand} />}
        {branch && <DataRow label="BRANCH" value={branch} />}
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="DETAILS" />
        {power && <DataRow label="POWER" value={power} />}
        {ref && <DataRow label="REF" value={ref} />}
        {startDate && <DataRow label="BUILT" value={startDate} />}
        {nameEn && nameEn !== f.name && <DataRow label="EN NAME" value={nameEn} />}
        {shortName && shortName !== f.name && <DataRow label="SHORT NAME" value={shortName} />}
        {fullName && <DataRow label="FULL NAME" value={fullName} />}
        {oldName && <DataRow label="OLD NAME" value={oldName} />}
        {manMade && <DataRow label="CLASS" value={manMade} />}
      </div>
      {(buildingType || levels || levelsUnderground || height || roofShape || roofColour || buildingColour || buildingMaterial) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="BUILDING" />
          {buildingType && <DataRow label="TYPE" value={buildingType} />}
          {levels && <DataRow label="LEVELS" value={levels} />}
          {levelsUnderground && <DataRow label="UNDERGRND" value={levelsUnderground} />}
          {height && <DataRow label="HEIGHT" value={height} />}
          {roofShape && <DataRow label="ROOF" value={roofShape} />}
          {roofColour && <DataRow label="ROOF CLR" value={roofColour} />}
          {buildingColour && <DataRow label="BLDG CLR" value={buildingColour} />}
          {buildingMaterial && <DataRow label="MATERIAL" value={buildingMaterial} />}
        </div>
      )}
      {description && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="DESCRIPTION" />
          <div style={{ fontSize: 10, color: WHITE, lineHeight: 1.4, fontWeight: 400 }}>
            {description}
          </div>
        </div>
      )}
      {note && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="NOTES" />
          <div style={{ fontSize: 10, color: WHITE, lineHeight: 1.4, fontWeight: 400, whiteSpace: "pre-wrap" }}>
            {note}
          </div>
        </div>
      )}
      {website && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="REFERENCES" />
          <DataRow label="WEBSITE" value={website} />
        </div>
      )}
      {infoUrl && <InfoButton url={infoUrl} label={infoLabel} accent={accent} />}
      {operatorInfoUrl && <InfoButton url={operatorInfoUrl} label={operatorInfoLabel} accent={accent} />}
    </>
  );
}

function UnrestRows({ f }: { f: TrackedFeature }) {
  const title = clean(f.data.title) || f.name;
  const type = clean(f.data.type) || "other";
  const country = clean(f.data.country);
  const domain = clean(f.data.domain);
  const url = clean(f.data.url);
  const seendate = clean(f.data.seendate);
  const ageHours = Number(f.data.ageHours ?? 0);
  const eventTime = Number(f.data.eventTime ?? 0);
  const articleCount = Number(f.data.articleCount ?? 1);
  const crowdLabel = clean(f.data.crowdLabel) || "Unknown";
  const crowdSize = Number(f.data.crowdSize ?? 0);
  const anarchyProb = Number(f.data.anarchyProbability ?? 0);
  const landmark = clean(f.data.landmark);
  const sources = (f.data.sources ?? []) as Array<{ title: string; url: string; domain: string }>;

  const typeAccent: Record<string, string> = {
    riot: "#ff4d4d",
    shutdown: "#ff7a3d",
    arrest: "#ffdd44",
    protest: "#ffaa33",
    other: "#ffaa33",
  };
  const accent = typeAccent[type] ?? typeAccent.other;

  // Freshness label.
  let freshness = "";
  if (ageHours > 0) {
    if (ageHours < 1) freshness = "< 1 HR AGO";
    else if (ageHours < 24) freshness = `${Math.floor(ageHours)} HR AGO`;
    else freshness = `${Math.floor(ageHours / 24)} D ${Math.floor(ageHours % 24)} HR AGO`;
  }

  // Anarchy probability color: green < 30, yellow 30-60, orange 60-80, red > 80.
  const anarchyColor = anarchyProb >= 80 ? "#ff3d3d" : anarchyProb >= 60 ? "#ff7a3d" : anarchyProb >= 30 ? "#ffdd44" : "#66bb6a";
  const anarchyLabel = anarchyProb >= 80 ? "CRITICAL" : anarchyProb >= 60 ? "HIGH" : anarchyProb >= 30 ? "MODERATE" : "LOW";

  // GDELT DOC API search for broader coverage (same source as Spectre v1).
  const newsKeywords = title.slice(0, 80).replace(/[^\w\s]/g, " ").trim();
  const newsUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(newsKeywords)}&mode=ArtList&maxrecords=25&sort=datedesc&format=json`;

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="LOCATION" />
        <DataRow label="COORDS" value={formatCoord(f.lat, f.lon)} />
        {country && <DataRow label="COUNTRY" value={country.toUpperCase()} />}
        {landmark && <DataRow label="LANDMARK" value={landmark} />}
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="EVENT" />
        <DataRow label="TYPE" value={type.toUpperCase()} />
        {freshness && <DataRow label="SEEN" value={freshness} />}
        {eventTime > 0 && <DataRow label="TIME" value={formatTime(eventTime) || "..."} />}
        {seendate && <DataRow label="GDELT DATE" value={seendate} />}
      </div>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="ASSESSMENT" />
        <DataRow label="CROWD SIZE" value={crowdLabel} />
        <DataRow label="ARTICLES" value={`${articleCount} source${articleCount > 1 ? "s" : ""}`} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 0",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span style={{ fontSize: 10, color: DIM, letterSpacing: 1, fontWeight: 700 }}>ANARCHY PROB</span>
          <span style={{ fontSize: 13, color: anarchyColor, fontWeight: 800 }}>
            {anarchyProb}% {anarchyLabel}
          </span>
        </div>
        {/* Anarchy probability bar */}
        <div
          style={{
            width: "100%",
            height: 4,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 2,
            overflow: "hidden",
            marginTop: 2,
          }}
        >
          <div
            style={{
              width: `${anarchyProb}%`,
              height: "100%",
              background: anarchyColor,
              borderRadius: 2,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
      {(crowdSize > 0 || articleCount > 1) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="SCALE" />
          {crowdSize > 0 && <DataRow label="EST CROWD" value={crowdSize.toLocaleString()} />}
          {articleCount > 1 && <DataRow label="COVERAGE" value={`${articleCount} articles`} />}
        </div>
      )}
      {title && title !== f.name && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="HEADLINE" />
          <div style={{ fontSize: 10, color: WHITE, lineHeight: 1.4, fontWeight: 400 }}>
            {title}
          </div>
        </div>
      )}
      {sources.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text={`SOURCES (${Math.min(sources.length, 6)})`} />
          {sources.slice(0, 6).map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "3px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                fontSize: 9,
              }}
            >
              <span
                style={{
                  color: WHITE,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  marginRight: 6,
                  cursor: s.url ? "pointer" : "default",
                }}
                onClick={() => s.url && window.open(s.url, "_blank", "noopener")}
              >
                {s.domain || "source"}
              </span>
              <span style={{ color: DIM, fontSize: 8, flexShrink: 0 }}>
                {clean(s.title).slice(0, 20)}
              </span>
            </div>
          ))}
        </div>
      )}
      {url && <InfoButton url={url} label="SOURCE ARTICLE" accent={accent} />}
      <InfoButton url={newsUrl} label="NEWS COVERAGE" accent={accent} />
    </>
  );
}

function ageFromStartDate(tag: unknown): string {
  const s = clean(tag);
  if (!s) return "";
  // OSM start_date can be a year, a year-month, or a full date. Some entries
  // are ranges ("1880;1900") or approximate ("~1850", "C19"). Take the first
  // 4-digit year found.
  const m = s.match(/(\d{4})/);
  if (!m) return s;
  const year = parseInt(m[1], 10);
  if (!Number.isFinite(year)) return s;
  const now = new Date().getFullYear();
  const yrs = now - year;
  if (yrs <= 0) return `${year} (new)`;
  return `${year} (${yrs} yrs old)`;
}

function websiteUrl(tag: string): string | null {
  const t = clean(tag);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function BuildingRows({ f }: { f: TrackedFeature }) {
  const tags = (f.data ?? {}) as Record<string, unknown>;
  const accent = KIND_ACCENT.building;
  const buildingType = clean(tags.building) || clean(tags.man_made);
  const height = clean(tags.height);
  const estHeight = clean(tags["cesium#estimatedHeight"]);
  const levels = clean(tags["building:levels"]);
  const startDate = clean(tags.start_date);
  const operator = clean(tags.operator) || clean(tags.brand);
  const website = websiteUrl(clean(tags.website) || clean(tags["contact:website"]) || clean(tags.url));
  const wiki = wikipediaUrl(clean(tags.wikipedia));
  const wikidata = wikidataUrl(clean(tags.wikidata));
  const addrHouse = clean(tags["addr:housenumber"]);
  const addrStreet = clean(tags["addr:street"]);
  const addrCity = clean(tags["addr:city"]);
  const addrPostcode = clean(tags["addr:postcode"]);
  const addrState = clean(tags["addr:state"]);
  const addrCountry = clean(tags["addr:country"]);
  const buildingMaterial = clean(tags["building:material"]);
  const buildingColour = clean(tags["building:colour"]);
  const roofShape = clean(tags["roof:shape"]);
  const roofMaterial = clean(tags["roof:material"]);
  const roofColour = clean(tags["roof:colour"]);
  const roofLevels = clean(tags["roof:levels"]);
  const heritage = clean(tags.heritage);
  const historic = clean(tags.historic);
  const architect = clean(tags.architect);
  const description = clean(tags.description) || clean(tags["description:en"]);
  const phone = clean(tags["phone"]) || clean(tags["contact:phone"]);
  const openingHours = clean(tags.opening_hours);
  const flats = clean(tags["building:flats"]);
  const units = clean(tags["building:units"]);
  const area = clean(tags.area) || clean(tags["building:area"]);
  const useTag = clean(tags.building) === "residential"
    ? clean(tags["building:flats"]) ? `${flats} units` : null
    : clean(tags["building:units"]) ? `${units} units` : null;
  const nameTag = clean(tags.name) || clean(tags["name:en"]);

  // Info link priority: Wikipedia > Wikidata > OSM
  const osm = osmUrl(tags.elementId);
  const infoUrl = wiki || wikidata || osm;
  const infoLabel = wiki ? "WIKIPEDIA" : wikidata ? "WIKIDATA" : osm ? "OPENSTREETMAP" : "";

  // Height display: prefer explicit height tag, fall back to Cesium estimate
  const heightDisplay = height
    ? `${height} m`
    : estHeight ? `${Math.round(Number(estHeight))} m (est.)` : null;

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="BUILDING" />
        {buildingType && <DataRow label="TYPE" value={buildingType} />}
        {heightDisplay && <DataRow label="HEIGHT" value={heightDisplay} />}
        {levels && <DataRow label="FLOORS" value={levels} />}
        {area && <DataRow label="AREA" value={`${area} m\u00B2`} />}
        {useTag && <DataRow label="UNITS" value={useTag} />}
        {startDate && <DataRow label="BUILT" value={ageFromStartDate(startDate)} />}
        {architect && <DataRow label="ARCHITECT" value={architect} />}
        {buildingMaterial && <DataRow label="MATERIAL" value={buildingMaterial} />}
        {buildingColour && <DataRow label="COLOR" value={buildingColour} />}
      </div>

      {(roofShape || roofMaterial || roofColour || roofLevels) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="ROOF" />
          {roofShape && <DataRow label="SHAPE" value={roofShape} />}
          {roofMaterial && <DataRow label="MATERIAL" value={roofMaterial} />}
          {roofColour && <DataRow label="COLOR" value={roofColour} />}
          {roofLevels && <DataRow label="LEVELS" value={roofLevels} />}
        </div>
      )}

      {(addrHouse || addrStreet || addrCity || addrPostcode || addrState || addrCountry) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="ADDRESS" />
          {(addrHouse || addrStreet) && (
            <DataRow label="STREET" value={`${addrHouse} ${addrStreet}`.trim()} />
          )}
          {addrCity && <DataRow label="CITY" value={addrCity} />}
          {addrState && <DataRow label="STATE" value={addrState} />}
          {addrPostcode && <DataRow label="POSTCODE" value={addrPostcode} />}
          {addrCountry && <DataRow label="COUNTRY" value={addrCountry} />}
        </div>
      )}

      {operator && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="OPERATOR" />
          <DataRow label="NAME" value={operator} />
        </div>
      )}

      {(phone || openingHours) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="CONTACT" />
          {phone && <DataRow label="PHONE" value={phone} />}
          {openingHours && <DataRow label="HOURS" value={openingHours} />}
        </div>
      )}

      {(heritage || historic || description) && (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="HERITAGE" />
          {historic && <DataRow label="STATUS" value={historic} />}
          {heritage && <DataRow label="GRADE" value={heritage} />}
          {description && (
            <div style={{ fontSize: 9, color: DIM, marginTop: 4, lineHeight: 1.4 }}>
              {description}
            </div>
          )}
        </div>
      )}

      {website && <InfoButton url={website} label="WEBSITE" accent={accent} />}
      {infoUrl && <InfoButton url={infoUrl} label={infoLabel} accent={accent} />}
    </>
  );
}

export default function FeatureDetailPanel() {
  const trackedFeature = useGlobeStore((s) => s.trackedFeature);
  const untrackFeature = useGlobeStore((s) => s.untrackFeature);
  const trackedBuilding = useGlobeStore((s) => s.trackedBuilding);
  const untrackBuilding = useGlobeStore((s) => s.untrackBuilding);
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const trackedSatelliteId = useGlobeStore((s) => s.trackedSatelliteId);
  const trackedCamera = useGlobeStore((s) => s.trackedCamera);

  // Flights, satellites, and cameras keep priority over the feature card.
  // trackedBuilding (clicked OSM building) is rendered here too since it
  // shares the TrackedFeature shape.
  if (selectedFlightId || trackedSatelliteId || trackedCamera) return null;
  const feature = trackedFeature ?? trackedBuilding;
  if (!feature) return null;

  const isBuilding = feature.kind === "building";
  const accent = KIND_ACCENT[feature.kind];
  const onClose = isBuilding ? untrackBuilding : untrackFeature;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 240,
        height: "100%",
        overflowY: "auto",
        paddingBottom: 120,
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
          fontSize: 10,
          color: accent,
          letterSpacing: 2,
          marginBottom: 4,
          fontWeight: 700,
        }}
      >
        {KIND_LABEL[feature.kind]}
      </div>
      <div
        style={{
          fontSize: 14,
          color: WHITE,
          fontWeight: 800,
          marginBottom: 2,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {feature.name}
      </div>
      <div
        style={{
          fontSize: 9,
          color: DIM,
          marginBottom: 10,
          textAlign: "right",
          fontWeight: 700,
        }}
      >
        {formatCoord(feature.lat, feature.lon)}
      </div>

      {feature.kind === "dam" && <DamRows f={feature} />}
      {feature.kind === "earthquake" && <EarthquakeRows f={feature} />}
      {feature.kind === "datacenter" && <DataCenterRows f={feature} />}
      {feature.kind === "unrest" && <UnrestRows f={feature} />}
      {feature.kind === "building" && <BuildingRows f={feature} />}

      <button
        onClick={onClose}
        style={{
          width: "100%",
          padding: "7px 8px",
          background: "rgba(255, 80, 80, 0.06)",
          border: "1px solid rgba(255, 80, 80, 0.3)",
          borderRadius: 4,
          color: "#ff5050",
          fontSize: 11,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "center",
          marginTop: 8,
          letterSpacing: 1,
          fontWeight: 700,
        }}
      >
        CLOSE
      </button>
    </div>
  );
}
