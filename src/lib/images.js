const sharp = require('sharp');

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const MAX_INPUT_PIXELS = 50_000_000; // refuse "decompression bomb" images
const FULL_SIZE = 1600;
const THUMB_SIZE = 480;

class ImageError extends Error {}

/**
 * Turn an uploaded file into clean WebP images.
 *
 * The browser's claimed type is ignored: the bytes must decode as a real image. Re-encoding drops
 * every byte of the original file, including EXIF metadata such as GPS location, camera serials and
 * embedded scripts. Orientation is applied first so photos still display the right way up.
 */
async function processImage(buffer) {
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageError("That file isn't an image we can read.");
  }
  if (!ACCEPTED_FORMATS.has(meta.format)) throw new ImageError('Photos must be JPEG, PNG, WebP or GIF.');

  const base = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 }).rotate();
  const full = await base()
    .resize({ width: FULL_SIZE, height: FULL_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'cover' })
    .webp({ quality: 78 })
    .toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

module.exports = { processImage, ImageError };
