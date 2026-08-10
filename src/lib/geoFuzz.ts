import { PRIVACY_TIER_BY_PROVINCE } from "./indonesia";
import type { PrivacyTier } from "./types";

function fuzzLocation(
  lat: number,
  lon: number,
  meters: number = 500
): { lat: number; lon: number } {
  const rounded = Math.round(lat * 1000) / 1000;
  const roundedLon = Math.round(lon * 1000) / 1000;
  const jitterLat = (Math.random() - 0.5) * 0.004;
  const jitterLon = (Math.random() - 0.5) * 0.004;
  return {
    lat: Math.round((rounded + jitterLat) * 1000) / 1000,
    lon: Math.round((roundedLon + jitterLon) * 1000) / 1000,
  };
}

export function getPrivacyTier(province: string | undefined): PrivacyTier {
  if (!province) return "open";
  return PRIVACY_TIER_BY_PROVINCE[province] ?? "open";
}

export function shouldForceAnonymous(province: string | undefined): boolean {
  const tier = getPrivacyTier(province);
  return tier === "anonymous-only" || tier === "ip-stripped";
}

export function getExpiryHours(province: string | undefined): number {
  const tier = getPrivacyTier(province);
  if (tier === "ip-stripped") return 24;
  if (tier === "anonymous-only") return 24 * 3;
  return 24 * 7;
}

export function fuzzCoordsForProvince(
  lat: number,
  lon: number,
  province: string | undefined,
  isAnonymous: boolean
): { lat: number; lon: number } {
  const tier = getPrivacyTier(province);
  if (tier === "anonymous-only" || tier === "ip-stripped" || isAnonymous) {
    return fuzzLocation(lat, lon);
  }
  return { lat, lon };
}
