export type VerificationLevel = 'confirmed' | 'multi' | 'unconfirmed';
export type EventType = 'protest' | 'riot' | 'arrest' | 'shutdown' | 'fire' | 'earthquake' | 'other';
export type PrivacyTier = 'open' | 'anonymous-only' | 'ip-stripped';

export interface ProtestEvent {
  id: string;
  type: EventType;
  title: string;
  description?: string;
  locationName?: string;
  lat: number;
  lon: number;
  province?: string;
  eventTime: string; // ISO
  createdAt?: string;
  confidence: number; // 0-100
  verificationLevel: VerificationLevel;
  verified: boolean; // true if ACLED-confirmed
  actor?: string;
  estimatedCrowdSize?: number;
  casualtyCount?: number;
  expiresAt?: string | null; // ISO, NULL for verified events
  isAnonymous: boolean;
  sources: EventSource[];
}

export interface EventSource {
  id: string;
  sourceType: 'gdelt' | 'rss' | 'acled' | 'telegram' | 'anonymous' | 'kontras' | 'cctv' | 'bmkg' | 'ooni' | 'ucdp' | 'reliefweb' | 'civicus' | 'firms';
  sourceName: string;
  sourceUrl?: string;
  narrative?: 'state' | 'civil_society' | 'international' | 'social' | 'official';
  reportedCasualties?: number;
  reportedCrowdSize?: number;
  ingestedAt: string;
  archivedUrl?: string;
  archivedAt?: string;
}

// Alias kept for downstream modules that already import under the shorter name.
export type Source = EventSource;
