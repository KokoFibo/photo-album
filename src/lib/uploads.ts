import { reactive } from "vue";
import { api } from "./api";

export type Status = "queued" | "preparing" | "uploading" | "done" | "failed" | "duplicate" | "canceled";
export interface UploadItem { id: string; file: File; preview: string; status: Status; progress: number; error: string; albumId?: string }
/** Module-level state: it survives page navigation, so uploads keep running while you browse. */
export const uploads = reactive<{ items: UploadItem[] }>({ items: [] });

// exifr is a CommonJS package: load it on demand in the browser so named-export interop and server rendering never matter
async function loadExifr(): Promise<any> { const m: any = await import("exifr"); return m.default ?? m; }

const ACCEPT = /^image\/(jpeg|png|webp)$/, MAX = 2, VARIANTS = [["thumbnail", 320, 0.8], ["small", 640, 0.82], ["medium", 1280, 0.86], ["large", 3072, 0.9]] as const;   // [name, longest side px, quality]
const aborts = new Map<string, () => void>();
let running = 0, seq = 0;

export function enqueue(files: FileList | File[], albumId?: string): string[] {
  const skipped: string[] = [];
  for (const f of Array.from(files)) {
    if (!ACCEPT.test(f.type)) { skipped.push(f.name); continue; }
    uploads.items.push({ id: `u${++seq}`, file: f, preview: URL.createObjectURL(f), status: "queued", progress: 0, error: "", albumId });
  }
  pump();
  return skipped;
}
export function retry(id: string) { const i = uploads.items.find((x) => x.id === id); if (i) { i.status = "queued"; i.progress = 0; i.error = ""; pump(); } }
export function cancel(id: string) { const i = uploads.items.find((x) => x.id === id); if (i && ["queued", "preparing", "uploading"].includes(i.status)) { i.status = "canceled"; aborts.get(id)?.(); } }
export function remove(id: string) { const n = uploads.items.findIndex((x) => x.id === id); if (n >= 0) { URL.revokeObjectURL(uploads.items[n].preview); uploads.items.splice(n, 1); } }
export function clearFinished() { [...uploads.items].filter((i) => ["done", "duplicate", "canceled"].includes(i.status)).forEach((i) => remove(i.id)); }

function pump() {
  while (running < MAX) {
    const next = uploads.items.find((i) => i.status === "queued");
    if (!next) return;
    running++; next.status = "preparing";
    run(next).finally(() => { running--; pump(); });
  }
}

async function run(it: UploadItem) {
  let init: { photoId: string; urls: Record<string, string>; completeToken: string } | null = null;
  try {
    const prep = await prepare(it.file);
    if (it.status === "canceled") return;
    init = await api("/api/uploads/init", { method: "POST", body: { filename: it.file.name, mimeType: it.file.type, size: it.file.size, sha256: prep.sha, width: prep.width, height: prep.height, takenAt: prep.takenAt, exif: prep.exif, gps: prep.gps, variantMime: prep.vmime, variants: Object.fromEntries(Object.entries(prep.blobs).map(([k, b]) => [k, b.size])) } });
    if (it.status === "canceled") throw new Error("canceled");
    it.status = "uploading";
    const parts: [string, Blob][] = [["original", it.file], ...Object.entries(prep.blobs)];
    const total = parts.reduce((s, [, b]) => s + b.size, 0); let sent = 0;
    for (const [kind, blob] of parts) {
      await put(it, init!.urls[kind], blob, (n) => (it.progress = Math.round(((sent + n) / total) * 100)));
      sent += blob.size;
    }
    await api("/api/uploads/complete", { method: "POST", body: { token: init!.completeToken } });
    if (it.albumId) await api(`/api/albums/${it.albumId}/photos`, { method: "POST", body: { ids: [init!.photoId] } });
    it.status = "done"; it.progress = 100; init = null;
    window.dispatchEvent(new Event("photos-changed"));
  } catch (e: any) {
    if (init) api("/api/uploads/abort", { method: "POST", body: { token: init.completeToken } }).catch(() => {});   // free the quota reservation
    if (it.status === "canceled") return;
    if (/already in your library/i.test(e.message)) { it.status = "duplicate"; it.error = "Already in your library."; }
    else { it.status = "failed"; it.error = e.message || "Upload failed."; }
  }
}

function put(it: UploadItem, url: string, blob: Blob, onProgress: (n: number) => void, attempt = 1): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url); x.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => { if (x.status >= 200 && x.status < 300) return resolve(); let m = "Upload failed."; try { m = JSON.parse(x.responseText).error ?? m; } catch {} reject(new Error(m)); };
    x.onerror = x.ontimeout = () => reject(new Error("The connection was interrupted."));
    x.onabort = () => reject(new Error("canceled"));
    aborts.set(it.id, () => x.abort()); x.send(blob);
  }).catch(async (e) => {   // retry interrupted connections; the signed URL stays valid and R2 overwrites safely
    if (attempt < 3 && it.status !== "canceled" && /interrupted/.test(e.message)) { await new Promise((r) => setTimeout(r, 1000 * attempt)); return put(it, url, blob, onProgress, attempt + 1); }
    throw e;
  });
}

async function prepare(file: File) {
  const [bmp, sha, meta] = await Promise.all([createImageBitmap(file), sha256(file), readMeta(file)]);
  const blobs: Record<string, Blob> = {}; let vmime = "image/webp";
  for (const [kind, max, quality] of VARIANTS) { const r = await resize(bmp, max, vmime, quality); vmime = r.type; blobs[kind] = r; }
  const out = { sha, width: bmp.width, height: bmp.height, blobs, vmime, ...meta };
  bmp.close();
  return out;
}

async function resize(bmp: ImageBitmap, max: number, mime: string, quality: number): Promise<Blob> {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext("2d")!; ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const enc = (t: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, t, q));
  let b = await enc(mime, quality);
  if (!b || b.type !== mime) b = await enc("image/jpeg", Math.min(0.92, quality + 0.03));   // Safari cannot encode WebP: fall back to JPEG
  if (!b) throw new Error("This image could not be processed.");
  return b;
}

async function sha256(f: File) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((x) => x.toString(16).padStart(2, "0")).join(""); }

async function readMeta(file: File) {
  const fallback = new Date(file.lastModified).toISOString();
  try {
    const ex = await loadExifr();
    const x: any = (await ex.parse(file, ["DateTimeOriginal", "CreateDate", "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO", "FocalLength"])) ?? {};
    const g: any = await ex.gps(file).catch(() => null);
    const d = x.DateTimeOriginal ?? x.CreateDate;
    const exif = { make: x.Make, model: x.Model, lens: x.LensModel, aperture: x.FNumber, exposure: x.ExposureTime, iso: x.ISO, focalLength: x.FocalLength };
    return { takenAt: d instanceof Date && !isNaN(+d) ? d.toISOString() : fallback, exif, gps: g && typeof g.latitude === "number" ? { lat: g.latitude, lng: g.longitude } : null };
  } catch { return { takenAt: fallback, exif: {}, gps: null }; }
}
