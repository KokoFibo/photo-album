// Removes GPS location data from a JPEG without touching the pixels or the other EXIF fields
// (orientation, camera, date stay). Used for original files that guests may download.
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const XMP = "http://ns.adobe.com/xap/1.0/";

export function wipeGps(src: Uint8Array): Uint8Array {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) return src;
  const b = src.slice();
  const drop: [number, number][] = [];
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) break;
    const marker = b[p + 1];
    if (marker === 0xff) { p++; continue; }
    if (marker === 0xda || marker === 0xd9) break;                       // image data starts: nothing more to inspect
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3], end = p + 2 + len;
    if (len < 2 || end > b.length) break;
    if (marker === 0xe1) {
      if (b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 && b[p + 8] === 0 && b[p + 9] === 0) wipeExif(b, p + 10, end);
      else if (latin1(b, p + 4, Math.min(end, p + 4 + XMP.length)) === XMP && latin1(b, p + 4, end).includes("GPS")) drop.push([p, end]);   // XMP block that carries a location
    }
    p = end;
  }
  if (!drop.length) return b;
  const parts: Uint8Array[] = []; let at = 0;
  for (const [s, e] of drop) { parts.push(b.subarray(at, s)); at = e; }
  parts.push(b.subarray(at));
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

const latin1 = (b: Uint8Array, s: number, e: number) => { let r = ""; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; };

function wipeExif(b: Uint8Array, t: number, tEnd: number) {
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return;
  const ok = (o: number, n: number) => o >= t && o + n <= tEnd;
  const u16 = (o: number) => (ok(o, 2) ? (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]) : -1);
  const u32 = (o: number) => (ok(o, 4) ? (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0) : -1);
  if (u16(t + 2) !== 42) return;
  const ifd0 = t + u32(t + 4), n = u16(ifd0);
  if (n < 0 || !ok(ifd0, 2 + n * 12)) return;
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== 0x8825) continue;                                   // GPSInfo pointer
    const gps = t + u32(e + 8), m = u16(gps);
    if (m < 0 || !ok(gps, 2 + m * 12)) return;
    for (let k = 0; k < m; k++) {
      const g = gps + 2 + k * 12, size = (SIZE[u16(g + 2)] ?? 1) * u32(g + 4);
      if (size > 4) { const v = t + u32(g + 8); if (ok(v, size)) b.fill(0, v, v + size); }   // values stored outside the entry
      b.fill(0, g, g + 12);
    }
    b[gps] = 0; b[gps + 1] = 0;                                        // the GPS block now has no entries
  }
}
