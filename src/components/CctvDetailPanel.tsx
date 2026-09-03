"use client";

import { useEffect, useRef, useState } from "react";
import { useGlobeStore } from "@/store/globe-store";
import type { CctvCamera } from "@/lib/sources/cctv";

// CCTV camera detail panel. Renders in the right rail when trackedCamera is
// set. Shows an auto-refreshing snapshot (10s interval), an inline live feed
// toggle (HLS via hls.js, MP4 via native video, or embed via iframe), and
// camera metadata. Mirrors FeatureDetailPanel visual language.

const WHITE = "#ffffff";
const DIM = "rgba(255,255,255,0.45)";
const ACCENT = "#00d4ff";

const SNAPSHOT_REFRESH_MS = 10_000;

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

function formatCoord(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const latH = lat >= 0 ? "N" : "S";
  const lonH = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)} deg ${latH}, ${Math.abs(lon).toFixed(4)} deg ${lonH}`;
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    palembang: "Palembang Diskominfo",
    osm: "OpenStreetMap",
    shodan: "Shodan",
    windy: "Windy Webcams",
    streetside: "Streetside Jakarta",
    otc: "OpenTrafficCamMap",
    atcs: "ATCS Indonesia",
    tfl: "TfL JamCams",
    caltrans: "Caltrans",
    "511ny": "511NY",
    lta: "LTA DataMall",
    tfnsw: "TfNSW",
    other: "Unknown",
  };
  return labels[provider] ?? provider;
}

// Detects the feed type from a CctvCamera's streamUrl/embedUrl.
function detectFeedType(cam: CctvCamera): "hls" | "mp4" | "embed" | "none" {
  if (cam.streamUrl) {
    if (cam.streamUrl.includes(".m3u8")) return "hls";
    if (cam.streamUrl.endsWith(".mp4") || cam.streamUrl.endsWith(".webm")) return "mp4";
  }
  if (cam.embedUrl) return "embed";
  return "none";
}

// Inline live feed player. Uses hls.js for HLS streams, native <video> for
// MP4, and <iframe> for embed URLs (e.g. ATCS player pages).
function LiveFeedPlayer({ cam }: { cam: CctvCamera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const feedType = detectFeedType(cam);

  useEffect(() => {
    if (feedType === "hls" && videoRef.current && cam.streamUrl) {
      let hls: import("hls.js").default | null = null;
      const video = videoRef.current;

      // Safari has native HLS support.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = cam.streamUrl;
        video.play().catch(() => {});
      } else if (typeof window !== "undefined") {
        // Dynamic import to keep hls.js out of the initial bundle.
        import("hls.js").then(({ default: Hls }) => {
          if (Hls.isSupported() && videoRef.current) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true });
            hls.loadSource(cam.streamUrl!);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {});
            });
          }
        }).catch(() => {});
      }

      return () => {
        if (hls) hls.destroy();
        video.removeAttribute("src");
      };
    }
  }, [feedType, cam.streamUrl]);

  if (feedType === "embed" && cam.embedUrl) {
    return (
      <iframe
        src={cam.embedUrl}
        style={{
          width: "100%",
          height: 220,
          border: `1px solid ${ACCENT}33`,
          borderRadius: 4,
          background: "#000",
        }}
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
    );
  }

  if (feedType === "none") {
    return (
      <div
        style={{
          padding: "12px 8px",
          textAlign: "center",
          fontSize: 10,
          color: DIM,
          border: `1px solid ${ACCENT}22`,
          borderRadius: 4,
        }}
      >
        NO LIVE STREAM AVAILABLE FOR THIS CAMERA
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      muted
      playsInline
      src={feedType === "mp4" ? cam.streamUrl : undefined}
      style={{
        width: "100%",
        height: 220,
        border: `1px solid ${ACCENT}33`,
        borderRadius: 4,
        background: "#000",
      }}
    />
  );
}

export default function CctvDetailPanel() {
  const trackedCamera = useGlobeStore((s) => s.trackedCamera);
  const untrackCamera = useGlobeStore((s) => s.untrackCamera);
  const selectedFlightId = useGlobeStore((s) => s.selectedFlightId);
  const trackedSatelliteId = useGlobeStore((s) => s.trackedSatelliteId);
  const trackedFeature = useGlobeStore((s) => s.trackedFeature);
  const trackedBuilding = useGlobeStore((s) => s.trackedBuilding);
  const selectedRegion = useGlobeStore((s) => s.selectedRegion);
  const [snapshotUrl, setSnapshotUrl] = useState<string>("");
  const [snapshotError, setSnapshotError] = useState(false);
  const [showLiveFeed, setShowLiveFeed] = useState(false);
  const [snapshotSource, setSnapshotSource] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [editLat, setEditLat] = useState("");
  const [editLon, setEditLon] = useState("");
  const [editHeading, setEditHeading] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Fetch snapshot on camera change + auto-refresh every 10s.
  useEffect(() => {
    if (!trackedCamera) {
      setSnapshotUrl("");
      setSnapshotError(false);
      setShowLiveFeed(false);
      setSnapshotSource("");
      return;
    }

    const fetchSnapshot = () => {
      // Pass camera metadata as query params so the frame endpoint can proxy
      // the snapshot URL directly without re-fetching the entire 45s catalog.
      const params = new URLSearchParams();
      params.set("t", String(Date.now()));
      if (trackedCamera.snapshotUrl) params.set("url", trackedCamera.snapshotUrl);
      if (trackedCamera.provider) params.set("provider", trackedCamera.provider);
      params.set("lat", String(trackedCamera.lat));
      params.set("lon", String(trackedCamera.lon));
      if (trackedCamera.headingDeg != null) params.set("heading", String(trackedCamera.headingDeg));
      if (trackedCamera.fovDeg != null) params.set("fov", String(trackedCamera.fovDeg));
      const url = `/api/cctv/frame/${encodeURIComponent(trackedCamera.id)}?${params.toString()}`;
      setSnapshotUrl(url);
      setSnapshotError(false);
    };

    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, SNAPSHOT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [trackedCamera?.id]);

  // Reset live feed toggle when camera changes.
  useEffect(() => {
    setShowLiveFeed(false);
  }, [trackedCamera?.id]);

  // Flights, satellites, and features keep priority over the CCTV card.
  if (!trackedCamera || selectedFlightId || trackedSatelliteId || trackedFeature || trackedBuilding || selectedRegion) return null;

  const cam = trackedCamera;
  const feedType = detectFeedType(cam);
  const hasFeed = feedType !== "none";

  const startEdit = () => {
    setEditLat(cam.lat.toFixed(6));
    setEditLon(cam.lon.toFixed(6));
    setEditHeading(cam.headingDeg != null ? cam.headingDeg.toFixed(0) : "");
    setEditing(true);
    setSaveMsg("");
  };

  const saveCorrection = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const body: Record<string, unknown> = { id: cam.id };
      if (editLat !== "") body.lat = parseFloat(editLat);
      if (editLon !== "") body.lon = parseFloat(editLon);
      if (editHeading !== "") body.headingDeg = parseFloat(editHeading);
      const res = await fetch("/api/cctv/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaveMsg("SAVED");
        setEditing(false);
      } else {
        setSaveMsg("FAILED");
      }
    } catch {
      setSaveMsg("ERROR");
    }
    setSaving(false);
  };

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
          color: ACCENT,
          letterSpacing: 2,
          marginBottom: 4,
          fontWeight: 700,
        }}
      >
        CCTV CAMERA
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
        {cam.name}
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
        {formatCoord(cam.lat, cam.lon)}
      </div>

      {/* Snapshot or Live Feed */}
      {showLiveFeed && hasFeed ? (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="LIVE FEED" />
          <LiveFeedPlayer cam={cam} />
          <button
            onClick={() => setShowLiveFeed(false)}
            style={{
              width: "100%",
              padding: "6px 8px",
              background: `${ACCENT}0F`,
              border: `1px solid ${ACCENT}55`,
              borderRadius: 4,
              color: ACCENT,
              fontSize: 10,
              fontFamily: "inherit",
              cursor: "pointer",
              textAlign: "center",
              marginTop: 6,
              letterSpacing: 1,
              fontWeight: 700,
            }}
          >
            BACK TO SNAPSHOT
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="SNAPSHOT" />
          {snapshotUrl && !snapshotError ? (
            <img
              src={snapshotUrl}
              alt={cam.name}
              onError={() => setSnapshotError(true)}
              style={{
                width: "100%",
                height: 220,
                objectFit: "cover",
                border: `1px solid ${ACCENT}33`,
                borderRadius: 4,
                background: "#000",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${ACCENT}22`,
                borderRadius: 4,
                background: "#0a0e14",
                fontSize: 10,
                color: DIM,
              }}
            >
              {snapshotError ? "SNAPSHOT UNAVAILABLE" : "LOADING..."}
            </div>
          )}
          {hasFeed && (
            <button
              onClick={() => setShowLiveFeed(true)}
              style={{
                width: "100%",
                padding: "7px 8px",
                background: `${ACCENT}0F`,
                border: `1px solid ${ACCENT}55`,
                borderRadius: 4,
                color: ACCENT,
                fontSize: 11,
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "center",
                marginTop: 8,
                letterSpacing: 1,
                fontWeight: 700,
              }}
            >
              VIEW LIVE FEED
            </button>
          )}
        </div>
      )}

      {/* Metadata */}
      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="LOCATION" />
        <DataRow label="COORDS" value={formatCoord(cam.lat, cam.lon)} />
        <DataRow label="REGION" value={cam.region} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <SectionHeader text="CAMERA DETAILS" />
        <DataRow label="PROVIDER" value={providerLabel(cam.provider)} />
        {cam.headingDeg != null && (
          <DataRow label="HEADING" value={`${cam.headingDeg.toFixed(0)} deg`} />
        )}
        {cam.fovDeg != null && (
          <DataRow label="FOV" value={`${cam.fovDeg.toFixed(0)} deg`} />
        )}
        <DataRow
          label="STATUS"
          value={cam.isOnline === false ? "OFFLINE" : "ONLINE"}
        />
        {cam.category && (
          <DataRow label="CATEGORY" value={cam.category.toUpperCase()} />
        )}
        <DataRow
          label="FEED TYPE"
          value={
            feedType === "hls" ? "HLS STREAM"
            : feedType === "mp4" ? "MP4 VIDEO"
            : feedType === "embed" ? "EMBEDDED PLAYER"
            : "SNAPSHOT ONLY"
          }
        />
      </div>

      {/* Edit position / heading */}
      {editing ? (
        <div style={{ marginBottom: 10 }}>
          <SectionHeader text="EDIT POSITION" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 9, color: DIM, letterSpacing: 1, fontWeight: 700 }}>
              LATITUDE
              <input
                type="text"
                value={editLat}
                onChange={(e) => setEditLat(e.target.value)}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  background: "rgba(0,0,0,0.4)",
                  border: `1px solid ${ACCENT}33`,
                  borderRadius: 3,
                  color: WHITE,
                  fontSize: 11,
                  fontFamily: "inherit",
                  marginTop: 2,
                  outline: "none",
                }}
              />
            </label>
            <label style={{ fontSize: 9, color: DIM, letterSpacing: 1, fontWeight: 700 }}>
              LONGITUDE
              <input
                type="text"
                value={editLon}
                onChange={(e) => setEditLon(e.target.value)}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  background: "rgba(0,0,0,0.4)",
                  border: `1px solid ${ACCENT}33`,
                  borderRadius: 3,
                  color: WHITE,
                  fontSize: 11,
                  fontFamily: "inherit",
                  marginTop: 2,
                  outline: "none",
                }}
              />
            </label>
            <label style={{ fontSize: 9, color: DIM, letterSpacing: 1, fontWeight: 700 }}>
              HEADING (deg)
              <input
                type="text"
                value={editHeading}
                onChange={(e) => setEditHeading(e.target.value)}
                placeholder="0-360"
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  background: "rgba(0,0,0,0.4)",
                  border: `1px solid ${ACCENT}33`,
                  borderRadius: 3,
                  color: WHITE,
                  fontSize: 11,
                  fontFamily: "inherit",
                  marginTop: 2,
                  outline: "none",
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button
                onClick={saveCorrection}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  background: `${ACCENT}0F`,
                  border: `1px solid ${ACCENT}55`,
                  borderRadius: 4,
                  color: ACCENT,
                  fontSize: 10,
                  fontFamily: "inherit",
                  cursor: saving ? "wait" : "pointer",
                  letterSpacing: 1,
                  fontWeight: 700,
                }}
              >
                {saving ? "SAVING..." : "SAVE"}
              </button>
              <button
                onClick={() => { setEditing(false); setSaveMsg(""); }}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 4,
                  color: DIM,
                  fontSize: 10,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  letterSpacing: 1,
                  fontWeight: 700,
                }}
              >
                CANCEL
              </button>
            </div>
            {saveMsg && (
              <div style={{ fontSize: 9, color: saveMsg === "SAVED" ? ACCENT : "#ff5050", textAlign: "center", fontWeight: 700, letterSpacing: 1 }}>
                {saveMsg}
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={startEdit}
          style={{
            width: "100%",
            padding: "6px 8px",
            background: `${ACCENT}0F`,
            border: `1px solid ${ACCENT}33`,
            borderRadius: 4,
            color: ACCENT,
            fontSize: 10,
            fontFamily: "inherit",
            cursor: "pointer",
            textAlign: "center",
            marginTop: 8,
            letterSpacing: 1,
            fontWeight: 700,
          }}
        >
          EDIT POSITION
        </button>
      )}

      <button
        onClick={untrackCamera}
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
