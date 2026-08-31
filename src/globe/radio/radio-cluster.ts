// Direct port of GEV's cluster/singleton candidate selection and identity
// reconciliation. Source: src/data/radio.js lines 494-649, 847-905.
// Pure: no Cesium, no DOM. The angular-distance ranking uses plain math.

import type {
  RadioClusterCandidate,
  RadioSingletonCandidate,
  RadioStation,
} from "./radio-types";
import { filterRadioStations } from "./radio-categories";
import { isEnglishRadioStation, normalizeRadioTag } from "./radio-categories";
import { normalizeRadioCountryInput } from "./radio-country";

export const RADIO_OVERLAY_COHORT_LIMIT = 64;
export const RADIO_SINGLETON_GLOBAL_LIMIT = 16;
export const RADIO_SINGLETON_MID_LIMIT = 32;
export const RADIO_SINGLETON_NEAR_LIMIT = 48;
export const GLOBAL_RADIO_ALTITUDE_M = 2_000_000;

/** Return the bounded singleton-label allowance for the current camera scale. */
export function radioSingletonLabelLimit(
  cameraHeightM: number,
): number {
  const height = Math.max(0, Number(cameraHeightM) || 0);
  if (height >= GLOBAL_RADIO_ALTITUDE_M) return RADIO_SINGLETON_GLOBAL_LIMIT;
  if (height >= 250_000) return RADIO_SINGLETON_MID_LIMIT;
  return RADIO_SINGLETON_NEAR_LIMIT;
}

/** Rank visible singleton stations by camera distance and stable station id. */
export function selectRadioSingletonCandidates(
  candidates: RadioSingletonCandidate[],
  limit: number = RADIO_SINGLETON_NEAR_LIMIT,
): RadioSingletonCandidate[] {
  const distance = (candidate: RadioSingletonCandidate): number => {
    const value = Number(candidate?.distanceM);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  return [...(candidates || [])]
    .sort(
      (a, b) =>
        distance(a) - distance(b) ||
        String(a?.station?.id || a?.id || "").localeCompare(
          String(b?.station?.id || b?.id || ""),
        ),
    )
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}

/** Rank and cap ambient Radio clusters before shared-host entry allocation. */
export function selectRadioClusterCandidates(
  candidates: RadioClusterCandidate[],
  limit: number = RADIO_OVERLAY_COHORT_LIMIT,
): RadioClusterCandidate[] {
  return [...(candidates || [])]
    .sort(
      (a, b) =>
        (Number(b?.stationCount) || 0) - (Number(a?.stationCount) || 0) ||
        String(a?.id || "").localeCompare(String(b?.id || "")),
    )
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}

/**
 * Preserve one-to-one overlay identity for overlapping clusters.
 * Direct port of reconcileRadioClusterCandidates (mutual-best inheritance).
 */
export function reconcileRadioClusterCandidates(
  candidates: RadioClusterCandidate[],
  previous: RadioClusterCandidate[] = [],
  createId: ((candidate: RadioClusterCandidate, index: number) => string) | null = null,
): RadioClusterCandidate[] {
  const current = (Array.isArray(candidates) ? candidates : []).map(
    (candidate, index) => {
      const stationIds = [
        ...new Set((candidate?.stationIds || []).map((id) => String(id))),
      ].sort();
      const membershipId = String(
        candidate?.id || `membership:${stationIds.join("|")}`,
      );
      return {
        ...candidate,
        _reconcileIndex: index,
        _reconcileMembershipId: membershipId,
        _reconcileCanonicalKey: `${membershipId}\u0000${stationIds.join("\u0000")}`,
        stationIds,
      };
    },
  );
  const priorMembershipsByIdentity = new Map<string, Set<string>>();
  for (const candidate of Array.isArray(previous) ? previous : []) {
    const identityId = String(candidate?.identityId || candidate?.id || "");
    if (!identityId) continue;
    if (!priorMembershipsByIdentity.has(identityId)) {
      priorMembershipsByIdentity.set(identityId, new Set());
    }
    const membership = priorMembershipsByIdentity.get(identityId)!;
    for (const stationId of candidate?.stationIds || [])
      membership.add(String(stationId));
  }
  const prior = [...priorMembershipsByIdentity]
    .map(([identityId, stationIds]) => ({
      identityId,
      stationIds: [...stationIds].sort(),
    }))
    .filter((candidate) => candidate.stationIds.length)
    .sort((a, b) => a.identityId.localeCompare(b.identityId));
  const priorByStation = new Map<string, number[]>();
  for (let priorIndex = 0; priorIndex < prior.length; priorIndex += 1) {
    for (const stationId of prior[priorIndex].stationIds) {
      if (!priorByStation.has(stationId))
        priorByStation.set(stationId, []);
      priorByStation.get(stationId)!.push(priorIndex);
    }
  }

  const edges: {
    currentIndex: number;
    priorIndex: number;
    overlap: number;
    score: number;
    similarity: number;
  }[] = [];
  const greatestOverlapByCurrent = new Map<number, number>();
  const greatestOverlapByPrior = new Map<number, number>();
  for (
    let currentIndex = 0;
    currentIndex < current.length;
    currentIndex += 1
  ) {
    const overlapByPrior = new Map<number, number>();
    for (const stationId of current[currentIndex].stationIds) {
      for (const priorIndex of priorByStation.get(stationId) || []) {
        overlapByPrior.set(
          priorIndex,
          (overlapByPrior.get(priorIndex) || 0) + 1,
        );
      }
    }
    for (const [priorIndex, overlap] of overlapByPrior) {
      const union =
        current[currentIndex].stationIds.length +
        prior[priorIndex].stationIds.length -
        overlap;
      const smaller = Math.min(
        current[currentIndex].stationIds.length,
        prior[priorIndex].stationIds.length,
      );
      const score = smaller > 0 ? overlap / smaller : 0;
      const similarity = union > 0 ? overlap / union : 0;
      edges.push({ currentIndex, priorIndex, overlap, score, similarity });
      greatestOverlapByCurrent.set(
        currentIndex,
        Math.max(greatestOverlapByCurrent.get(currentIndex) || 0, overlap),
      );
      greatestOverlapByPrior.set(
        priorIndex,
        Math.max(greatestOverlapByPrior.get(priorIndex) || 0, overlap),
      );
    }
  }
  const eligibleEdges = edges.filter(
    (edge) =>
      edge.overlap === greatestOverlapByCurrent.get(edge.currentIndex) &&
      edge.overlap === greatestOverlapByPrior.get(edge.priorIndex),
  );
  eligibleEdges.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      b.score - a.score ||
      b.similarity - a.similarity ||
      current[a.currentIndex]._reconcileCanonicalKey.localeCompare(
        current[b.currentIndex]._reconcileCanonicalKey,
      ) ||
      prior[a.priorIndex].identityId.localeCompare(
        prior[b.priorIndex].identityId,
      ),
  );

  const inheritedByCurrent = new Map<number, string>();
  const usedPriorIdentities = new Set<string>();
  for (const edge of eligibleEdges) {
    const identityId = prior[edge.priorIndex].identityId;
    if (
      inheritedByCurrent.has(edge.currentIndex) ||
      usedPriorIdentities.has(identityId)
    )
      continue;
    inheritedByCurrent.set(edge.currentIndex, identityId);
    usedPriorIdentities.add(identityId);
  }

  const generatedByCurrent = new Map<number, string>();
  if (typeof createId === "function") {
    const freshIndices = current
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ index }) => !inheritedByCurrent.has(index))
      .sort((a, b) =>
        a.candidate._reconcileCanonicalKey.localeCompare(
          b.candidate._reconcileCanonicalKey,
        ),
      );
    for (const { candidate, index } of freshIndices) {
      generatedByCurrent.set(index, String(createId(candidate, index) || ""));
    }
  }

  return current.map((candidate, index) => {
    const membershipId = candidate._reconcileMembershipId;
    const inherited = inheritedByCurrent.get(index);
    const generated = generatedByCurrent.get(index) || "";
    const identityId = inherited || generated || membershipId;
    const {
      _reconcileIndex,
      _reconcileMembershipId,
      _reconcileCanonicalKey,
      ...rest
    } = candidate;
    void _reconcileIndex;
    void _reconcileMembershipId;
    void _reconcileCanonicalKey;
    return { ...rest, membershipId, identityId, id: identityId };
  });
}

/** Classify a globe-scale Radio view without flapping on height round-off. */
export function radioViewIsGlobal(altitudeM: number): boolean {
  return (
    Number.isFinite(altitudeM) &&
    Math.round(altitudeM) >= GLOBAL_RADIO_ALTITUDE_M
  );
}

function radioAngularDistance(
  station: RadioStation,
  anchor: { lat: number; lon: number },
): number {
  const lat1 = (Math.PI / 180) * Number(anchor?.lat);
  const lon1 = (Math.PI / 180) * Number(anchor?.lon);
  const lat2 = (Math.PI / 180) * Number(station?.lat);
  const lon2 = (Math.PI / 180) * Number(station?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite))
    return Number.POSITIVE_INFINITY;
  const deltaLat = lat2 - lat1;
  const deltaLon = lon2 - lon1;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, haversine))));
}

/** Rank a copied station list by viewport distance, English-first tier optional. */
export function rankRadioStationsForViewport(
  stations: RadioStation[],
  anchor: { lat: number; lon: number } | null,
  { preferEnglish = false }: { preferEnglish?: boolean } = {},
): RadioStation[] {
  return (Array.isArray(stations) ? stations : [])
    .map((station, index) => ({
      station,
      index,
      distance: anchor ? radioAngularDistance(station, anchor) : 0,
      languageTier: preferEnglish && !isEnglishRadioStation(station) ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        a.languageTier - b.languageTier ||
        a.distance - b.distance ||
        a.index - b.index,
    )
    .map(({ station }) => station);
}

/** Rank stations for an explicit request without moving the camera. */
export function rankRadioStationsForRequest(
  stations: RadioStation[],
  {
    categoryId = "all",
    anchor = null,
    country = "",
    stationQuery = "",
  }: {
    categoryId?: string;
    anchor?: { lat: number; lon: number } | null;
    country?: string;
    stationQuery?: string;
  } = {},
): RadioStation[] {
  const countryFilter = normalizeRadioCountryInput(country);
  if (!countryFilter.valid) return [];
  const query = normalizeRadioTag(stationQuery);
  let matches = filterRadioStations(stations, categoryId);
  if (countryFilter.code || countryFilter.name) {
    matches = matches.filter((station) => {
      const stationCode = String(station?.countryCode || "")
        .trim()
        .toUpperCase();
      const stationCountry = normalizeRadioCountryInput(station?.country);
      return (
        (countryFilter.code && stationCode === countryFilter.code) ||
        (countryFilter.code &&
          stationCountry.valid &&
          stationCountry.code === countryFilter.code)
      );
    });
  }
  if (query) {
    matches = matches.filter((station) =>
      [
        station?.id,
        station?.name,
        station?.state,
        station?.country,
        station?.countryCode,
        ...(Array.isArray(station?.tags) ? station.tags : []),
      ].some((value) => normalizeRadioTag(value).includes(query)),
    );
  }
  return anchor
    ? rankRadioStationsForViewport(matches, anchor)
    : matches.slice();
}
