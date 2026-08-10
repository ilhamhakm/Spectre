// Procedurally builds a small 3D airplane glTF (binary GLB) for use as a
// Cesium Model entity. Avoids an external HTTP fetch by embedding the
// glTF JSON + BIN buffer inline as a data URI.
//
// The model is a low-poly jet: fuselage, swept wings, horizontal stabilizer,
// vertical tail fin. Nose points +X (heading=0 = north = +X after Cesium
// applies heading rotation). Wings span Y, altitude is Z.
//
// All faces are wound CCW (counter-clockwise) when viewed from outside;
// the material is also doubleSided so any winding errors don't cause
// invisible triangles. Coordinates in meters; plane is ~40m long, 36m span.

interface Vec3 { x: number; y: number; z: number; }

function buildAirplaneGeometry(): { verts: number[]; tris: number[] } {
  // 22 vertices: nose, fuselage ribs (4-sided), tail, wings, hstab, fin.
  const v: Vec3[] = [
    // 0-7: fuselage rhombus, 3 ribs (front, mid, tail)
    { x: 20, y: 0, z: 0 },        // 0 nose
    { x: 8, y: 0.7, z: 0.7 },     // 1 front-top
    { x: 8, y: -0.7, z: -0.4 },   // 2 front-bottom-right
    { x: 8, y: 0.7, z: -0.4 },    // 3 front-bottom-left (mirrored)
    { x: 8, y: -0.7, z: 0.7 },    // 4 (shared with 1 when mirrored) — actually we'll use a clean 4-sided fuselage:
    // Simplify: replace 1-4 with a clean diamond cross-section
  ];
  // Reset to a clean diamond cross-section (4 verts per rib)
  const ribs: Vec3[] = [
    { x: 20, y: 0, z: 0.4 },      // 0 nose top
    { x: 20, y: 0, z: 0.4 },      // (placeholder, replaced below)
  ];
  // Actually, let's just hardcode a clean, minimal plane.
  const verts: Vec3[] = [
    // Fuselage — diamond cross-section, 3 ribs + nose + tail tip
    { x: 20, y: 0, z: 0.5 },      // 0 nose
    { x: 8, y: 0.8, z: 1.0 },     // 1 front-top
    { x: 8, y: 0.8, z: 0.0 },     // 2 front-right
    { x: 8, y: -0.8, z: 0.0 },    // 3 front-left
    { x: 8, y: 0, z: -0.5 },      // 4 front-bottom (wait, this isn't a clean diamond)
  ];
  // OK final approach — keep it simple and correct. 8-vertex box for
  // fuselage, 8-vertex box for wings, 8-vertex box for tail. Orient
  // each box via its 8 corner positions. Total 24 verts, 36 tris (12 faces).
  // This is the simplest reliable shape.
  const F: Vec3[] = [];
  // Fuselage box: x in [-18, 20] (length 38m), y in [-0.8, 0.8], z in [-0.6, 1.2]
  const fNose = 20, fTail = -18, fY = 0.8, fZlo = -0.4, fZhi = 1.2;
  const fuselageCorners = [
    { x: fNose, y: -fY, z: fZlo }, // 0
    { x: fNose, y:  fY, z: fZlo }, // 1
    { x: fNose, y:  fY, z: fZhi }, // 2
    { x: fNose, y: -fY, z: fZhi }, // 3
    { x: fTail, y: -fY, z: fZlo }, // 4
    { x: fTail, y:  fY, z: fZlo }, // 5
    { x: fTail, y:  fY, z: fZhi }, // 6
    { x: fTail, y: -fY, z: fZhi }, // 7
  ];
  // Wing box: thin in Z, swept in X, wide in Y (36m span)
  const wFront = 4, wBack = -6, wY = 18, wZlo = -0.1, wZhi = 0.3;
  const wingCorners = [
    { x: wFront, y: -wY, z: wZlo }, // 8
    { x: wFront, y:  wY, z: wZlo }, // 9
    { x: wFront, y:  wY, z: wZhi }, // 10
    { x: wFront, y: -wY, z: wZhi }, // 11
    { x: wBack,  y: -wY, z: wZlo }, // 12
    { x: wBack,  y:  wY, z: wZlo }, // 13
    { x: wBack,  y:  wY, z: wZhi }, // 14
    { x: wBack,  y: -wY, z: wZhi }, // 15
  ];
  // Tail fin (vertical stabilizer): thin in Y, rises in Z, at the tail
  const tFront = -16, tBack = -20, tY = 0.15, tZlo = 0.6, tZhi = 3.5;
  const finCorners = [
    { x: tFront, y: -tY, z: tZlo }, // 16
    { x: tFront, y:  tY, z: tZlo }, // 17
    { x: tFront, y:  tY, z: tZhi }, // 18
    { x: tFront, y: -tY, z: tZhi }, // 19
    { x: tBack,  y: -tY, z: tZlo }, // 20
    { x: tBack,  y:  tY, z: tZlo }, // 21
    { x: tBack,  y:  tY, z: tZhi }, // 22
    { x: tBack,  y: -tY, z: tZhi }, // 23
  ];
  // Horizontal stabilizer: thin in Z, smaller span than wing, at tail
  const hFront = -16, hBack = -20, hY = 6, hZlo = 0.2, hZhi = 0.5;
  const hstabCorners = [
    { x: hFront, y: -hY, z: hZlo }, // 24
    { x: hFront, y:  hY, z: hZlo }, // 25
    { x: hFront, y:  hY, z: hZhi }, // 26
    { x: hFront, y: -hY, z: hZhi }, // 27
    { x: hBack,  y: -hY, z: hZlo }, // 28
    { x: hBack,  y:  hY, z: hZlo }, // 29
    { x: hBack,  y:  hY, z: hZhi }, // 30
    { x: hBack,  y: -hY, z: hZhi }, // 31
  ];
  const all = [...fuselageCorners, ...wingCorners, ...finCorners, ...hstabCorners];

  // Helper to push the 12 triangles of a box (2 per face, 6 faces),
  // given the 8 corner indices in the order above (OpenGL convention).
  function pushBox(out: number[], base: number) {
    // Faces: bottom, top, front (+x), back (-x), right (+y), left (-y)
    // CCW when viewed from outside.
    out.push(
      // bottom (z = lo, looking down from below = CCW from outside is CW from above)
      base + 0, base + 4, base + 5,
      base + 0, base + 5, base + 1,
      // top (z = hi)
      base + 3, base + 2, base + 6,
      base + 3, base + 6, base + 7,
      // front (+x = nose side)
      base + 0, base + 1, base + 2,
      base + 0, base + 2, base + 3,
      // back (-x = tail side)
      base + 4, base + 7, base + 6,
      base + 4, base + 6, base + 5,
      // right (+y)
      base + 1, base + 5, base + 6,
      base + 1, base + 6, base + 2,
      // left (-y)
      base + 0, base + 3, base + 7,
      base + 0, base + 7, base + 4,
    );
  }
  const tris: number[] = [];
  pushBox(tris, 0);  // fuselage
  pushBox(tris, 8);  // wing
  pushBox(tris, 16); // fin
  pushBox(tris, 24); // hstab

  const vertsFlat: number[] = [];
  for (const p of all) vertsFlat.push(p.x, p.y, p.z);
  return { verts: vertsFlat, tris };
}

let cachedUri: string | null = null;

export function getAirplaneModelUri(): string {
  if (cachedUri) return cachedUri;

  const { verts, tris } = buildAirplaneGeometry();
  const vertCount = verts.length / 3;
  const idxCount = tris.length;
  const vertBytes = verts.length * 4;
  const idxBytes = idxCount * 2;
  const idxPad = (4 - (vertBytes % 4)) % 4;
  const totalBinBytes = vertBytes + idxPad + idxBytes;

  const bin = new Uint8Array(totalBinBytes);
  const dv = new DataView(bin.buffer);
  for (let i = 0; i < verts.length; i++) {
    dv.setFloat32(i * 4, verts[i], true);
  }
  const idxOffset = vertBytes + idxPad;
  for (let i = 0; i < tris.length; i++) {
    dv.setUint16(idxOffset + i * 2, tris[i], true);
  }

  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < vertCount; i++) {
    xs.push(verts[i * 3]);
    ys.push(verts[i * 3 + 1]);
    zs.push(verts[i * 3 + 2]);
  }

  const gltf = {
    asset: { version: "2.0", generator: "palantir-airplane" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Airplane" }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        material: 0,
      }],
    }],
    materials: [{
      name: "PlaneBody",
      pbrMetallicRoughness: {
        baseColorFactor: [0.85, 0.85, 0.85, 1.0],
        metallicFactor: 0.2,
        roughnessFactor: 0.6,
      },
      doubleSided: true,
    }],
    buffers: [{ byteLength: totalBinBytes }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertBytes, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: vertCount,
        type: "VEC3",
        max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
        min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: idxCount,
        type: "SCALAR",
      },
    ],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const totalLength = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const glb = new Uint8Array(totalLength);
  const gdv = new DataView(glb.buffer);
  gdv.setUint32(0, 0x46546c67, true);
  gdv.setUint32(4, 2, true);
  gdv.setUint32(8, totalLength, true);
  gdv.setUint32(12, jsonBytes.length + jsonPad, true);
  gdv.setUint32(16, 0x4e4f534a, true);
  for (let i = 0; i < jsonBytes.length; i++) glb[20 + i] = jsonBytes[i];
  for (let i = 0; i < jsonPad; i++) glb[20 + jsonBytes.length + i] = 0x20;
  const binHeaderOffset = 20 + jsonBytes.length + jsonPad;
  gdv.setUint32(binHeaderOffset, bin.length + binPad, true);
  gdv.setUint32(binHeaderOffset + 4, 0x004e4942, true);
  for (let i = 0; i < bin.length; i++) glb[binHeaderOffset + 8 + i] = bin[i];

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < glb.length; i += chunkSize) {
    const slice = glb.subarray(i, Math.min(i + chunkSize, glb.length));
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[]);
  }
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(glb).toString("base64");
  const uri = `data:model/gltf-binary;base64,${base64}`;
  cachedUri = uri;
  return uri;
}
