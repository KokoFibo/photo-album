// R2 through its S3-compatible API, exposing the small part of the Worker R2 binding that the app uses
// (put, get, head, delete, list). This lets the same API code run on a normal server.
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export function createR2(o: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
  const s3 = new S3Client({
    region: "auto", endpoint: `https://${o.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",   // R2 does not support the newer default checksums
  } as any);
  const Bucket = o.bucket;
  const missing = (e: any) => e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
  const toBytes = async (v: unknown): Promise<Uint8Array> =>
    typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v as any).arrayBuffer());

  return {
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const Body = await toBytes(value);   // uploads are limited to 50 MB, so buffering is fine
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body, ContentLength: Body.length, ContentType: opts?.httpMetadata?.contentType }));
    },
    async head(key: string) {
      try { const r = await s3.send(new HeadObjectCommand({ Bucket, Key: key })); return { key, size: r.ContentLength ?? 0, httpMetadata: { contentType: r.ContentType } }; }
      catch (e) { if (missing(e)) return null; throw e; }
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      try {
        const Range = opts?.range ? `bytes=${opts.range.offset}-${opts.range.offset + opts.range.length - 1}` : undefined;
        const r = await s3.send(new GetObjectCommand({ Bucket, Key: key, Range }));
        const b: any = r.Body;
        return {
          key, size: r.ContentLength ?? 0, httpMetadata: { contentType: r.ContentType },
          get body() { return b.transformToWebStream() as ReadableStream; },
          async arrayBuffer() { const u: Uint8Array = await b.transformToByteArray(); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
          async text() { return (await b.transformToString()) as string; },
        };
      } catch (e) { if (missing(e)) return null; throw e; }
    },
    async delete(keys: string | string[]) {
      const all = ([] as string[]).concat(keys);
      for (let i = 0; i < all.length; i += 1000)
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: all.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
    },
    async list(opts?: { prefix?: string; limit?: number }) {
      const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: opts?.prefix, MaxKeys: opts?.limit ?? 1000 }));
      return { objects: (r.Contents ?? []).map((x) => ({ key: x.Key!, size: x.Size ?? 0 })), truncated: !!r.IsTruncated };
    },
  };
}
