/**
 * Serves the production build (`dist/`) next to the API when the server is
 * started with `--serve-dist`: correct MIME types for the game's binary assets,
 * long-lived caching for hashed files and an index.html fallback for the SPA.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', // MediaPipe model bundles
  '.tflite': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a URL path inside `root`. Returns null for anything that would
 * escape the directory or is malformed.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

export interface StaticHandler {
  (urlPath: string, method: string): Promise<Response | null>;
}

export function createStaticHandler(distDir: string): StaticHandler {
  const root = path.resolve(distDir);
  const indexFile = path.join(root, 'index.html');

  const respond = (filePath: string, size: number, method: string, cache: string): Response => {
    const headers = new Headers({
      'content-type': mimeTypeFor(filePath),
      'content-length': String(size),
      'cache-control': cache,
    });
    if (method === 'HEAD') return new Response(null, { status: 200, headers });
    const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>;
    return new Response(stream, { status: 200, headers });
  };

  return async (urlPath: string, method: string) => {
    if (method !== 'GET' && method !== 'HEAD') return null;
    const target = resolveInside(root, urlPath);
    if (target === null) return new Response('Bad path', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });

    const wantsFile = path.extname(target) !== '';
    if (wantsFile) {
      const size = await fileSize(target);
      if (size !== null) {
        const isIndex = target === indexFile;
        // Vite puts content-hashed files in /assets/: they can be cached forever.
        const hashed = target.startsWith(path.join(root, 'assets') + path.sep);
        return respond(target, size, method, isIndex ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      }
      // A missing asset must be a real 404, not the HTML shell.
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    // Client-side routes and "/" get the SPA shell.
    const size = await fileSize(indexFile);
    if (size !== null) return respond(indexFile, size, method, 'no-cache');
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>PLUSH PORTAL</title><p>No production build found. Run <code>npm run build</code> first, then start the server again.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  };
}
