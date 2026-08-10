// Verify a sample of the new generated TLEs parse and propagate.
const satellite = require("satellite.js");

const SAMPLES = [
  {
    label: "new 53.0 shell",
    tle1: "1 47100U 19074A   24220.50000000 .00001500  00000+0  92631-4 0  9998",
    tle2: "2 47100 53.0000  0.0000 0001234 90.0000  0.0000 15.0600 481006",
  },
  {
    label: "new 70.0 shell",
    tle1: "1 47179U 19074A   24220.50000000 .00001500  00000+0  92631-4 0  9994",
    tle2: "2 47179 70.0000 240.0000 0001234 92.0000 288.0000 15.0400 481792",
  },
  {
    label: "existing fallback",
    tle1: "1 44713U 19074A   24220.50000000  .00001500  00000+0  92631-4 0  9991",
    tle2: "2 44713  53.0533  24.5000 0001234  70.0000 290.0000 15.0640 25000",
  },
];

const now = new Date();
for (const t of SAMPLES) {
  try {
    const satrec = satellite.twoline2satrec(t.tle1, t.tle2);
    const pv = satellite.propagate(satrec, now);
    if (pv && pv.position && typeof pv.position !== "boolean") {
      const gmst = satellite.gstime(now);
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      console.log(
        `${t.label}: alt=${geo.height.toFixed(0)}km, ` +
          `lat=${((geo.latitude * 180) / Math.PI).toFixed(2)}, ` +
          `lon=${((geo.longitude * 180) / Math.PI).toFixed(2)}, ` +
          `error=${satrec.error}`,
      );
    } else {
      console.log(`${t.label}: no position, error=${satrec.error}`);
    }
  } catch (e) {
    console.log(`${t.label}: threw ${e.message}`);
  }
}
