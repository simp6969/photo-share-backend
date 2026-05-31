import sharp from "sharp";
import convert from "heic-convert";

const HEIF_MIMES = new Set([
  "image/heif",
  "image/heic",
  "image/heif-sequence",
  "image/heic-sequence",
]);

const HEIF_EXT = /\.(heif|heic)$/i;

export function isHeifFormat(contentType, filename) {
  if (contentType && HEIF_MIMES.has(contentType.toLowerCase())) return true;
  if (filename && HEIF_EXT.test(filename)) return true;
  return false;
}

async function heicToJpegBuffer(buffer) {
  const converted = await convert({
    buffer,
    format: "JPEG",
    quality: 0.92,
  });
  return Buffer.from(converted);
}

/**
 * Normalize any supported upload (incl. HEIF/HEIC) to WebP for storage and display.
 * @param {{ width?: number, quality?: number }} [options] - omit width for full-size (max 1920)
 */
export async function processToWebp(buffer, mimetype, filename, options = {}) {
  const { width, quality = 80 } = options;
  const isHeif =
    isHeifFormat(mimetype, filename) ||
    (await sharp(buffer)
      .metadata()
      .then((m) => m.format === "heif")
      .catch(() => false));

  let input = buffer;

  if (isHeif) {
    try {
      input = await heicToJpegBuffer(buffer);
    } catch (heicError) {
      console.warn("heic-convert failed, trying sharp directly:", heicError.message);
    }
  }

  let pipeline = sharp(input, { failOn: "none" }).rotate();

  if (width) {
    pipeline = pipeline.resize({
      width: clampInt(width, 64, 1920),
      fit: "inside",
      withoutEnlargement: true,
    });
  } else {
    pipeline = pipeline.resize({
      width: 1920,
      height: 1080,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const q = clampInt(quality, 40, 95);
  return pipeline.webp({ quality: q, effort: width ? 2 : 4 }).toBuffer();
}

function clampInt(value, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

export function parseImageQuery(query) {
  const width = query.w ? clampInt(query.w, 64, 1920) : null;
  const quality = query.q ? clampInt(query.q, 40, 95) : width ? 68 : 80;
  return { width, quality };
}

export async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
