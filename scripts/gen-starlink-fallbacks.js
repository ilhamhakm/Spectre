// Generates Starlink fallback TLEs spread across the main orbital shells.
// Run: node scripts/gen-starlink-fallbacks.js
//
// Matches the format of the existing working fallback TLEs:
//   2 44713  53.0533  24.5000 0001234  70.0000 290.0000 15.0640 25000
// Fields: inc/raan/argPer/MA all 7 chars (F7.4), ecc 7 chars, MM 7 chars (F7.4),
// rev 5 chars. Single space between fields, extra leading space before inc.
//
// Shells:
//   53.0 deg (main v1 shell, ~550km)    - 30 sats, 6 planes x 5 sats
//   53.2 deg (v1.5 shell, ~540km)       - 20 sats, 4 planes x 5 sats
//   43.0 deg (lower inclination shell)  - 15 sats, 3 planes x 5 sats
//   70.0 deg (polar shell, ~570km)      - 15 sats, 3 planes x 5 sats
//
// Each plane has a different RAAN (spread evenly around Earth), and each
// sat in a plane has a different mean anomaly (spread evenly around the
// orbit). This makes the cluster look like a real distributed constellation
// instead of 80 sats bunched at one point.

const SHELLS = [
  { inc: 53.0, meanMotion: 15.06, sats: 30, planes: 6, altLabel: "550" },
  { inc: 53.2, meanMotion: 15.08, sats: 20, planes: 4, altLabel: "540" },
  { inc: 43.0, meanMotion: 15.12, sats: 15, planes: 3, altLabel: "530" },
  { inc: 70.0, meanMotion: 15.04, sats: 15, planes: 3, altLabel: "570" },
];

let noradId = 47100;

function checksum(line) {
  let sum = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c >= "0" && c <= "9") sum += parseInt(c, 10);
    else if (c === "-") sum += 1;
  }
  return sum % 10;
}

function f74(num) {
  const s = num.toFixed(4);
  if (s.length <= 7) return " " + s.padStart(7, " ");
  return " " + s.slice(0, 7);
}

const epoch = "26222.50000000";
const ndot = "  .00001500";
const nddot = " 00000+0";
const bstar = " 92631-4";
const ephemerisType = "0";

const out = [];

for (const shell of SHELLS) {
  const { inc, meanMotion, sats, planes } = shell;
  const satsPerPlane = sats / planes;
  const raanStep = 360 / planes;
  const maStep = 360 / satsPerPlane;

  for (let p = 0; p < planes; p++) {
    const raan = p * raanStep;
    for (let s = 0; s < satsPerPlane; s++) {
      const ma = s * maStep;
      const id = noradId++;
      const idStr = String(id).padStart(5, " ");
      const ecc = "0001234";
      const argPerigee = f74(90 + s * 0.5);
      const rev = String((id % 90000) + 1000).padStart(5, "0");

      const line1Raw =
        `1 ${idStr}U 19074A   ${epoch}${ndot} ${nddot} ${bstar} ${ephemerisType}  999`;
      const line1 = line1Raw + checksum(line1Raw);

      const line2Raw =
        `2 ${idStr} ${f74(inc)} ${f74(raan)} ${ecc} ${argPerigee} ${f74(ma)} ${f74(meanMotion)} ${rev}`;
      const line2 = line2Raw + checksum(line2Raw);

      out.push({
        name: `STARLINK-${id}`,
        noradId: id,
        tle1: line1,
        tle2: line2,
      });
    }
  }
}

console.log("const FALLBACK_STARLINK_TLES = [");
for (const s of out) {
  console.log(
    `  { name: "${s.name}", noradId: ${s.noradId}, tle1: "${s.tle1}", tle2: "${s.tle2}" },`,
  );
}
console.log("];");
console.log(`\n// Total: ${out.length} sats`);
console.log(
  "// Shells: " + SHELLS.map((s) => `${s.inc}deg(${s.sats})`).join(", "),
);
