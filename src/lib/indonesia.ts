export const INDONESIA_BBOX = { west: 95, south: -11, east: 141, north: 6 } as const;
export const INDONESIAN_PROVINCES = [
  'Aceh','Sumatera Utara','Sumatera Barat','Riau','Kepulauan Riau','Jambi','Sumatera Selatan','Bangka Belitung','Bengkulu','Lampung',
  'DKI Jakarta','Jawa Barat','Banten','Jawa Tengah','DI Yogyakarta','Jawa Timur',
  'Bali','Nusa Tenggara Barat','Nusa Tenggara Timur',
  'Kalimantan Barat','Kalimantan Tengah','Kalimantan Selatan','Kalimantan Timur','Kalimantan Utara',
  'Sulawesi Utara','Gorontalo','Sulawesi Tengah','Sulawesi Barat','Sulawesi Selatan','Sulawesi Tenggara',
  'Maluku','Maluku Utara',
  'Papua','Papua Barat','Papua Selatan','Papua Tengah','Papua Pegunungan','Papua Barat Daya'
] as const;
export const PRIVACY_TIER_BY_PROVINCE: Record<string, 'open'|'anonymous-only'|'ip-stripped'> = {
  'DKI Jakarta': 'open',
  'Papua': 'anonymous-only',
  'Papua Barat': 'anonymous-only',
  'Papua Selatan': 'anonymous-only',
  'Papua Tengah': 'anonymous-only',
  'Papua Pegunungan': 'anonymous-only',
  'Papua Barat Daya': 'anonymous-only',
  'Aceh': 'anonymous-only',
};

// Returns true when [lon, lat] falls inside the Indonesia bounding box.
// Uses @turf/turf for a proper point-in-bbox check (handles edge cases).
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { bboxPolygon } from '@turf/turf';

const INDONESIA_BBOX_POLYGON = bboxPolygon([
  INDONESIA_BBOX.west,
  INDONESIA_BBOX.south,
  INDONESIA_BBOX.east,
  INDONESIA_BBOX.north,
]);

export function isInIndonesia(lon: number, lat: number): boolean {
  return booleanPointInPolygon([lon, lat], INDONESIA_BBOX_POLYGON);
}
