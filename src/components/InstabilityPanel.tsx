"use client";

import { useMemo } from "react";
import { useGlobeStore } from "@/store/globe-store";
import { INDONESIAN_PROVINCES } from "@/lib/indonesia";
import type { EventType } from "@/lib/types";

const TYPE_WEIGHTS: Record<EventType, number> = {
  protest: 1,
  riot: 3,
  arrest: 0.5,
  shutdown: 2,
  fire: 1.5,
  earthquake: 0,
  other: 0.5,
};

interface RegionScore {
  name: string;
  score: number;
  eventCount: number;
  topType: EventType;
  casualties: number;
  recentEventTitle: string;
  lat: number;
  lon: number;
}

function scoreEvent(ev: {
  type: EventType;
  confidence: number;
  verified: boolean;
  casualtyCount?: number;
  estimatedCrowdSize?: number;
  eventTime: string;
}): number {
  const base = TYPE_WEIGHTS[ev.type] ?? 0.5;
  let mult = 1;
  if (ev.casualtyCount && ev.casualtyCount > 0) mult *= 2;
  if (ev.estimatedCrowdSize && ev.estimatedCrowdSize > 1000) mult *= 1.5;
  if (ev.verified) mult *= 1.3;
  const hoursAgo = (Date.now() - new Date(ev.eventTime).getTime()) / 3_600_000;
  if (hoursAgo < 24) mult *= 1.5;
  else if (hoursAgo < 48) mult *= 1.2;
  else if (hoursAgo > 168) mult *= 0.5;
  const confMult = 0.5 + (ev.confidence / 100) * 0.5;
  return base * mult * confMult;
}

function isIndonesianProvince(name: string): boolean {
  return (INDONESIAN_PROVINCES as readonly string[]).some(
    (p) => p.toLowerCase() === name.toLowerCase(),
  );
}

function inferCountry(province: string | undefined, locationName: string | undefined): string {
  if (province && isIndonesianProvince(province)) return "Indonesia";
  const txt = `${province ?? ""} ${locationName ?? ""}`.toLowerCase();
  if (txt.includes("palestine") || txt.includes("gaza") || txt.includes("west bank")) return "Palestine";
  if (txt.includes("myanmar") || txt.includes("yangon")) return "Myanmar";
  if (txt.includes("sudan") || txt.includes("khartoum")) return "Sudan";
  if (txt.includes("ukraine") || txt.includes("kyiv")) return "Ukraine";
  if (txt.includes("russia") || txt.includes("moscow")) return "Russia";
  if (txt.includes("china") || txt.includes("beijing")) return "China";
  if (txt.includes("iran") || txt.includes("tehran")) return "Iran";
  if (txt.includes("india") || txt.includes("delhi")) return "India";
  if (txt.includes("pakistan") || txt.includes("islamabad")) return "Pakistan";
  if (txt.includes("bangladesh") || txt.includes("dhaka")) return "Bangladesh";
  if (txt.includes("thailand") || txt.includes("bangkok")) return "Thailand";
  if (txt.includes("philippines") || txt.includes("manila")) return "Philippines";
  if (txt.includes("usa") || txt.includes("united states") || txt.includes("washington")) return "USA";
  if (txt.includes("france") || txt.includes("paris")) return "France";
  if (txt.includes("germany") || txt.includes("berlin")) return "Germany";
  if (txt.includes("uk") || txt.includes("london") || txt.includes("britain")) return "UK";
  if (txt.includes("israel")) return "Israel";
  if (txt.includes("lebanon") || txt.includes("beirut")) return "Lebanon";
  if (txt.includes("syria") || txt.includes("damascus")) return "Syria";
  if (txt.includes("yemen") || txt.includes("sanaa")) return "Yemen";
  if (txt.includes("ethiopia") || txt.includes("addis ababa")) return "Ethiopia";
  if (txt.includes("nigeria") || txt.includes("lagos") || txt.includes("abuja")) return "Nigeria";
  if (txt.includes("kenya") || txt.includes("nairobi")) return "Kenya";
  if (txt.includes("south africa") || txt.includes("johannesburg")) return "South Africa";
  if (txt.includes("brazil") || txt.includes("brasilia")) return "Brazil";
  if (txt.includes("argentina") || txt.includes("buenos aires")) return "Argentina";
  if (txt.includes("mexico") || txt.includes("mexico city")) return "Mexico";
  if (txt.includes("colombia") || txt.includes("bogota")) return "Colombia";
  if (txt.includes("peru") || txt.includes("lima")) return "Peru";
  if (txt.includes("chile") || txt.includes("santiago")) return "Chile";
  if (txt.includes("venezuela") || txt.includes("caracas")) return "Venezuela";
  if (txt.includes("haiti") || txt.includes("port-au-prince")) return "Haiti";
  if (txt.includes("cuba") || txt.includes("havana")) return "Cuba";
  if (txt.includes("turkey") || txt.includes("ankara") || txt.includes("istanbul")) return "Turkey";
  if (txt.includes("egypt") || txt.includes("cairo")) return "Egypt";
  if (txt.includes("iraq") || txt.includes("baghdad")) return "Iraq";
  if (txt.includes("afghanistan") || txt.includes("kabul")) return "Afghanistan";
  return "Other";
}

export default function InstabilityPanel() {
  const eventsOn = useGlobeStore((s) => s.layerVisibility.events ?? false);
  const events = useGlobeStore((s) => s.events);
  const toggleLayer = useGlobeStore((s) => s.toggleLayer);
  const cameraAltitude = useGlobeStore((s) => s.cameraAltitude);

  const { regions, totalScore, groupBy } = useMemo(() => {
    if (events.length === 0) {
      return { regions: [] as RegionScore[], totalScore: 0, groupBy: "country" as const };
    }
    // Group by province when zoomed in (< 2,000km), by country when zoomed out.
    const groupBy: "province" | "country" = cameraAltitude < 2_000_000 ? "province" : "country";
    const map = new Map<string, RegionScore>();
    for (const ev of events) {
      const regionName =
        groupBy === "province"
          ? (ev.province ?? ev.locationName ?? "Unknown")
          : inferCountry(ev.province, ev.locationName);
      const score = scoreEvent(ev);
      const existing = map.get(regionName);
      if (existing) {
        existing.score += score;
        existing.eventCount += 1;
        existing.casualties += ev.casualtyCount ?? 0;
        if (TYPE_WEIGHTS[ev.type] > TYPE_WEIGHTS[existing.topType]) {
          existing.topType = ev.type;
        }
        if (new Date(ev.eventTime).getTime() > new Date(existing.recentEventTitle).getTime()) {
          existing.recentEventTitle = ev.title;
        }
        existing.lat = (existing.lat * (existing.eventCount - 1) + ev.lat) / existing.eventCount;
        existing.lon = (existing.lon * (existing.eventCount - 1) + ev.lon) / existing.eventCount;
      } else {
        map.set(regionName, {
          name: regionName,
          score,
          eventCount: 1,
          topType: ev.type,
          casualties: ev.casualtyCount ?? 0,
          recentEventTitle: ev.title,
          lat: ev.lat,
          lon: ev.lon,
        });
      }
    }
    const regions = Array.from(map.values()).sort((a, b) => b.score - a.score);
    const totalScore = regions.reduce((sum, r) => sum + r.score, 0);
    return { regions, totalScore, groupBy };
  }, [events, cameraAltitude]);

  if (!eventsOn) return null;

  const scoreColor = (s: number) =>
    s > 20 ? "#FF3D3D" : s > 10 ? "#FF7A3D" : s > 5 ? "#FFD24D" : "#7FE5FF";
  const topScore = regions.length > 0 ? regions[0].score : 1;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 240,
        height: "100%",
        overflowY: "auto",
        zIndex: 60,
        fontFamily: "JetBrains Mono, monospace",
        pointerEvents: "auto",
        background: "transparent",
        borderLeft: "none",
        borderTopLeftRadius: 18,
        borderBottomLeftRadius: 18,
        color: "#9fe9ff",
        paddingBottom: 120,
      }}
    >
      <div style={{ padding: "40px 12px 0 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: "#FF7A3D" }}>
            INSTABILITY
          </div>
          <button
            onClick={() => toggleLayer("events")}
            style={{
              padding: "6px 8px",
              background: "rgba(0, 212, 255, 0.03)",
              border: "1px solid rgba(0, 212, 255, 0.3)",
              color: "#5ab3d4",
              fontSize: 10,
              fontFamily: "inherit",
              cursor: "pointer",
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {regions.length === 0 ? (
          <div style={{ fontSize: 9, color: "#5ab3d4", opacity: 0.7 }}>
            No civil unrest events in current view.
          </div>
         ) : (
          <>
            <div
              style={{
                fontSize: 8,
                letterSpacing: 1.5,
                marginBottom: 6,
                color: "#7ac4e0",
              }}
            >
              {groupBy === "province" ? "BY PROVINCE" : "BY COUNTRY"} · TOTAL{" "}
              {totalScore.toFixed(1)}
            </div>
            <div
              className="scrollbar"
              style={{ display: "flex", flexDirection: "column", maxHeight: 264, overflowY: "auto" }}
            >
            {regions.slice(0, 6).map((r, i) => {
              const bar = Math.max(2, (r.score / topScore) * 100);
              return (
                <button
                  key={r.name}
                  onClick={() => {
                    const v = (window as unknown as { __viewer?: { camera: { flyTo: (o: unknown) => void } } }).__viewer;
                    if (v) {
                      import("cesium").then((Cesium) => {
                        v.camera.flyTo({
                          destination: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 200_000),
                          orientation: {
                            heading: 0,
                            pitch: Cesium.Math.toRadians(-50),
                            roll: 0,
                          },
                          duration: 1.5,
                        });
                      });
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    marginBottom: 4,
                    background: "rgba(0, 212, 255, 0.03)",
                    border: "1px solid rgba(0, 212, 255, 0.2)",
                    color: "#9fe9ff",
                    fontSize: 10,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                    borderRadius: 6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i + 1}. {r.name.toUpperCase()}
                    </span>
                    <span style={{ color: scoreColor(r.score), fontWeight: 700, fontSize: 11 }}>
                      {r.score.toFixed(1)}
                    </span>
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 3,
                      background: "rgba(0, 212, 255, 0.1)",
                      borderRadius: 1,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${bar}%`,
                        height: "100%",
                        background: scoreColor(r.score),
                        borderRadius: 1,
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, fontSize: 8, color: "#5ab3d4", opacity: 0.8 }}>
                    <span>{r.eventCount} EV</span>
                    {r.casualties > 0 && <span style={{ color: "#FF3D3D" }}>{r.casualties} CAS</span>}
                    <span style={{ textTransform: "uppercase" }}>{r.topType}</span>
                  </div>
                </button>
              );
            })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
