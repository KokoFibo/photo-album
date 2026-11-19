import { Env, HttpError, Route, Ctx, UUID, limited } from "./http";
import { withUser, asService, pgCode } from "./db";

const enc = new TextEncoder();
const KINDS = ["thumbnail", "small", "medium", "large"] as const;
const MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const VARIANT_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};
const MAX_ORIGINAL = 50 * 1024 * 1024,
  MAX_VARIANT = 8 * 1024 * 1024;

const b64u = (b: Uint8Array | ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const hmacKey = (env: Env) =>
  crypto.subtle.importKey(
    "raw",
    enc.encode(env.MEDIA_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
async function mint(env: Env, payload: object) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64u(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body)))}`;
}
async function unmint<T>(env: Env, token: string): Promise<T> {
  let p: any;
  try {
    const [body, sig] = (token ?? "").split(".");
    if (
      !body ||
      !sig ||
      !(await crypto.subtle.verify(
        "HMAC",
        await hmacKey(env),
        unb64u(sig),
        enc.encode(body),
      ))
    )
      throw new Error("bad signature");
    p = JSON.parse(new TextDecoder().decode(unb64u(body)));
  } catch {
    throw new HttpError(403, "This link is not valid.");
  } // a malformed token must answer 403, never a server error
  if (!(p.exp >= Date.now() / 1000))
    throw new HttpError(403, "This link has expired.");
  return p as T;
}
/** Short-lived media URL. Stable within a 10-minute window so browsers can cache it. */
export async function mediaUrl(
  env: Env,
  origin: string,
  key: string,
  o: { fn?: string; ct?: string; until?: number } = {},
) {
  const exp = Math.min(
    (Math.floor(Date.now() / 600_000) + 2) * 600,
    o.until ?? Infinity,
  ); // `until` caps the URL at a guest link's expiry
  return `${origin}/api/media/${await mint(env, { k: key, fn: o.fn, ct: o.ct, exp })}`;
}

export function magicOk(b: Uint8Array, mime: string) {
  if (mime === "image/jpeg")
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png")
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return (
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  );
}
const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const text = (v: unknown) =>
  typeof v === "string" ? v.slice(0, 100) : undefined;
function cleanExif(x: any) {
  const o: Record<string, unknown> = {
    make: text(x?.make),
    model: text(x?.model),
    lens: text(x?.lens),
    aperture: num(x?.aperture, 0, 100) ?? undefined,
    exposure: num(x?.exposure, 0, 10000) ?? undefined,
    iso: num(x?.iso, 0, 10_000_000) ?? undefined,
    focalLength: num(x?.focalLength, 0, 10000) ?? undefined,
  };
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  );
}

type Meta = {
  photoId: string;
  uid: string;
  mime: string;
  size: number;
  keys: Record<string, string>;
  variants: Record<string, number>;
  vmime: string;
  lat: number | null;
  lng: number | null;
  exp: number;
};
type PutTok = { key: string; size: number; mime: string; exp: number };

async function init(c: Ctx) {
  const env = c.env,
    me = c.user!;
  if (limited(`up:${me.id}`, 120))
    throw new HttpError(429, "Too many uploads at once. Please wait a moment.");
  const b = await c.body();
  const mime = String(b.mimeType ?? ""),
    ext = MIME[mime];
  if (!ext)
    throw new HttpError(
      400,
      /hei[cf]/.test(mime)
        ? "HEIC photos are not supported yet. Please export them as JPEG."
        : "Only JPEG, PNG and WebP photos are supported.",
    );
  const size = num(b.size, 1, MAX_ORIGINAL);
  if (!size) throw new HttpError(400, "Each photo must be smaller than 50 MB.");
  const vmime = String(b.variantMime ?? "image/webp");
  if (!VARIANT_MIME[vmime]) throw new HttpError(400, "Invalid image format.");
  const variants: Record<string, number> = {};
  let total = size;
  for (const k of KINDS) {
    const s = num(b.variants?.[k], 1, MAX_VARIANT);
    if (!s) throw new HttpError(400, "Invalid image sizes.");
    variants[k] = s;
    total += s;
  }
  const width = num(b.width, 1, 100000),
    height = num(b.height, 1, 100000);
  const sha = /^[0-9a-f]{64}$/.test(String(b.sha256)) ? String(b.sha256) : null;
  const taken =
    b.takenAt && !isNaN(Date.parse(b.takenAt))
      ? new Date(b.takenAt).toISOString()
      : new Date().toISOString();
  const lat = num(b.gps?.lat, -90, 90),
    lng = num(b.gps?.lng, -180, 180);
  const filename = String(b.filename ?? "photo")
    .replace(/[\\/\0]/g, "_")
    .slice(0, 200);

  let reservation: string;
  try {
    reservation = (
      await withUser(env, me.id, (q) =>
        q.query("select app.reserve_upload($1::bigint) as id", [total]),
      )
    ).rows[0].id;
  } catch (e: any) {
    // quota check under a row lock
    throw new HttpError(
      /Not enough storage/.test(e?.message) ? 413 : 403,
      /Not enough storage/.test(e?.message)
        ? "Not enough storage space. Free some space or ask the administrator for more."
        : "Uploads are not available for this account.",
    );
  }

  const photoId = crypto.randomUUID(),
    d = new Date();
  const keys: Record<string, string> = {
    original: `users/${me.id}/originals/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${photoId}.${ext}`,
  };
  for (const k of KINDS)
    keys[k] = `users/${me.id}/variants/${photoId}/${k}.${VARIANT_MIME[vmime]}`;
  const create = () =>
    asService(env, (q) =>
      q.query(
        "select app.create_pending_photo($1, $2::uuid, $3, $4, $5::bigint, $6::int, $7::int, $8, $9::timestamptz, $10::jsonb, $11, $12::uuid)",
        [
          me.id,
          photoId,
          filename,
          mime,
          size,
          width,
          height,
          sha,
          taken,
          JSON.stringify(cleanExif(b.exif)),
          keys.original,
          reservation,
        ],
      ),
    );
  try {
    await create();
  } catch (e) {
    let recovered = false;
    if (pgCode(e) === "23505" && sha) {
      // a leftover "pending" row from an interrupted upload must not block the same photo forever
      const old = (
        await asService(env, (q) =>
          q.query(
            "select id, created_at from app.find_pending_duplicate($1, $2)",
            [me.id, sha],
          ),
        )
      ).rows[0];
      if (old && Date.now() - +new Date(old.created_at) > 5 * 60_000) {
        await asService(env, (q) =>
          q.query("select app.abort_upload($1::uuid)", [old.id]),
        );
        try {
          await create();
          recovered = true;
        } catch {
          /* fall through */
        }
      }
    }
    if (!recovered) {
      await asService(env, (q) =>
        q.query("select app.abort_reservation($1::uuid)", [reservation]),
      ).catch(() => {});
      if (pgCode(e) === "23505")
        throw new HttpError(409, "This photo is already in your library.");
      throw e;
    }
  }

  const exp = Math.floor(Date.now() / 1000) + 3600,
    urls: Record<string, string> = {};
  const parts: Record<string, [number, string]> = {
    original: [size, mime],
    ...Object.fromEntries(
      KINDS.map((k) => [k, [variants[k], vmime] as [number, string]]),
    ),
  };
  for (const [kind, [s, m]] of Object.entries(parts))
    urls[kind] =
      `${c.url.origin}/api/uploads/put/${await mint(env, { key: keys[kind], size: s, mime: m, exp } satisfies PutTok)}`;
  const completeToken = await mint(env, {
    photoId,
    uid: me.id,
    mime,
    size,
    keys,
    variants,
    vmime,
    lat,
    lng,
    exp,
  } satisfies Meta);
  return { photoId, urls, completeToken };
}

async function put(req: Request, env: Env, token: string) {
  const t = await unmint<PutTok>(env, token);
  if (!req.body || Number(req.headers.get("Content-Length")) !== t.size)
    throw new HttpError(400, "Unexpected file size.");
  await env.PHOTOS.put(t.key, req.body, {
    httpMetadata: { contentType: t.mime },
  });
  return { ok: true };
}

const cleanup = async (env: Env, m: Meta) => {
  await env.PHOTOS.delete(Object.values(m.keys)).catch(() => {});
  await asService(env, (q) =>
    q.query("select app.abort_upload($1::uuid)", [m.photoId]),
  ).catch(() => {});
};

async function complete(c: Ctx) {
  const env = c.env,
    m = await unmint<Meta>(env, ((await c.body()) as any).token);
  if (m.uid !== c.user!.id) throw new HttpError(403, "Not allowed.");
  const files = [
    { kind: "original", key: m.keys.original, size: m.size, mime: m.mime },
    ...KINDS.map((k) => ({
      kind: k as string,
      key: m.keys[k],
      size: m.variants[k],
      mime: m.vmime,
    })),
  ];
  try {
    let total = 0;
    for (const f of files) {
      const head = await env.PHOTOS.head(f.key);
      if (!head || head.size !== f.size)
        throw new HttpError(400, "The upload did not finish. Please retry.");
      const part = await env.PHOTOS.get(f.key, {
        range: { offset: 0, length: 12 },
      });
      if (!part || !magicOk(new Uint8Array(await part.arrayBuffer()), f.mime))
        throw new HttpError(400, "This file is not a valid image.");
      total += head.size;
    }
    const variants = files
      .filter((f) => f.kind !== "original")
      .map((f) => ({ kind: f.kind, key: f.key, size: f.size }));
    try {
      await asService(env, (q) =>
        q.query(
          "select app.finalize_upload($1::uuid, $2::jsonb, $3::bigint, $4::double precision, $5::double precision)",
          [m.photoId, JSON.stringify(variants), total, m.lat, m.lng],
        ),
      );
    } catch {
      throw new HttpError(
        409,
        "The upload could not be completed. Your storage may be full.",
      );
    }
  } catch (e) {
    await cleanup(env, m);
    throw e;
  }
  return { ok: true, photoId: m.photoId };
}

async function abort(c: Ctx) {
  const m = await unmint<Meta>(c.env, ((await c.body()) as any).token);
  if (m.uid !== c.user!.id) throw new HttpError(403, "Not allowed.");
  await cleanup(c.env, m);
  return { ok: true };
}

// URLs only for photos this member may see: Row Level Security filters the query
async function signUrls(c: Ctx) {
  const me = c.user!;
  if (limited(`sign:${me.id}`, 300))
    throw new HttpError(429, "Too many requests. Please wait a moment.");
  const b = await c.body(),
    kind = String(b.kind ?? "small"),
    download = b.download === true;
  const ids: string[] = Array.isArray(b.ids)
    ? [...new Set<string>(b.ids)].filter((i) => UUID.test(i)).slice(0, 100)
    : [];
  if (!ids.length || ![...KINDS, "original"].includes(kind))
    return { urls: {} };
  const rows = (
    await withUser(c.env, me.id, (q) =>
      q.query(
        "select p.id, p.owner_id, p.original_key, p.filename, p.mime_type, (select v.object_key from public.photo_variants v where v.photo_id = p.id and v.kind = $2) as vkey from public.photos p where p.id = any($1::uuid[])",
        [ids, kind],
      ),
    )
  ).rows;
  const urls: Record<string, string> = {};
  for (const p of rows) {
    if (kind === "original" && p.owner_id !== me.id) continue; // sharing permissions arrive with the sharing phase
    const key: string | null = kind === "original" ? p.original_key : p.vkey;
    if (!key || !key.startsWith(`users/${p.owner_id}/`)) continue; // never serve another member's objects
    urls[p.id] = await mediaUrl(
      c.env,
      c.url.origin,
      key,
      kind === "original"
        ? { fn: download ? p.filename : undefined, ct: p.mime_type }
        : {},
    );
  }
  return { urls };
}

async function media(env: Env, token: string) {
  const t = await unmint<{ k: string; fn?: string; ct?: string }>(env, token);
  const obj = await env.PHOTOS.get(t.k);
  if (!obj) throw new HttpError(404, "Not found.");
  const h = new Headers({
    "Content-Type":
      t.ct ?? obj.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "private, max-age=600",
    "X-Content-Type-Options": "nosniff",
  });
  if (t.fn)
    h.set(
      "Content-Disposition",
      `attachment; filename="${t.fn.replace(/["\\\r\n]/g, "_")}"`,
    );
  return new Response(obj.body, { headers: h });
}

export const uploadRoutes: Route[] = [
  ["POST", /^\/api\/uploads\/init$/, "user", init],
  [
    "PUT",
    /^\/api\/uploads\/put\/([^/]+)$/,
    "public",
    (c) => put(c.req, c.env, c.params[0]),
  ],
  ["POST", /^\/api\/uploads\/complete$/, "user", complete],
  ["POST", /^\/api\/uploads\/abort$/, "user", abort],
  ["POST", /^\/api\/media\/sign$/, "user", signUrls],
  [
    "GET",
    /^\/api\/media\/([^/]+)$/,
    "public",
    (c) => media(c.env, c.params[0]),
  ],
];
