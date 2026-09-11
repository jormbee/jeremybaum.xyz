import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const galleryDirectory = path.join(projectRoot, 'images', 'gallery');
const indexPath = path.join(projectRoot, 'index.html');
const startMarker = '<!-- gallery-items:start -->';
const endMarker = '<!-- gallery-items:end -->';
const supportedImage = /\.(?:jpe?g|png)$/i;

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const unescapeHtml = (value) => String(value)
  .replaceAll('&quot;', '"')
  .replaceAll('&gt;', '>')
  .replaceAll('&lt;', '<')
  .replaceAll('&amp;', '&');

const displayName = (filename) => filename
  .replace(/\.[^.]+$/, '')
  .split(/[-_]+/)
  .filter(Boolean)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

const jpegDimensions = (buffer) => {
  let offset = 2;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (startOfFrameMarkers.has(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (!segmentLength) break;
    offset += segmentLength + 2;
  }

  return null;
};

const imageDimensions = async (filePath) => {
  const buffer = await readFile(filePath);

  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return jpegDimensions(buffer);
  }

  return null;
};

const indexHtml = await readFile(indexPath, 'utf8');
const startIndex = indexHtml.indexOf(startMarker);
const endIndex = indexHtml.indexOf(endMarker);

if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
  throw new Error('Gallery markers are missing or out of order in index.html.');
}

const existingGallery = indexHtml.slice(startIndex + startMarker.length, endIndex);
const existingMetadata = new Map();
const buttonPattern = /<button\s+class="photo-thumb"[^>]*aria-label="([^"]*)"[^>]*data-location="([^"]*)"[^>]*>[\s\S]*?<img\s+src="images\/gallery\/([^"?]+)(?:\?[^"]*)?"/g;

for (const match of existingGallery.matchAll(buttonPattern)) {
  existingMetadata.set(match[3], {
    ariaLabel: unescapeHtml(match[1]),
    location: unescapeHtml(match[2]),
    src: match[0].match(/src="([^"]+)"/)?.[1] || `images/gallery/${match[3]}`,
  });
}

const filenames = (await readdir(galleryDirectory))
  .filter((filename) => supportedImage.test(filename))
  .sort((a, b) => a.localeCompare(b));

const items = await Promise.all(filenames.map(async (filename) => {
  const dimensions = await imageDimensions(path.join(galleryDirectory, filename));
  if (!dimensions) throw new Error(`Could not read image dimensions for ${filename}.`);

  const metadata = existingMetadata.get(filename);
  const fallbackName = displayName(filename);
  const aspectRatio = dimensions.width / dimensions.height;
  const equalAreaHeight = Math.min(62, Math.max(46, Math.sqrt(2850 / aspectRatio)));

  return [
    `                            <button class="photo-thumb" type="button" aria-label="${escapeHtml(metadata?.ariaLabel || `View ${fallbackName} photo`)}" data-location="${escapeHtml(metadata?.location || fallbackName)}" style="--thumb-height: ${equalAreaHeight.toFixed(1)}px">`,
    `                                <img src="${escapeHtml(metadata?.src || `images/gallery/${filename}`)}" alt="" width="${dimensions.width}" height="${dimensions.height}" loading="lazy">`,
    '                            </button>',
  ].join('\n');
}));

const updatedGallery = `${startMarker}\n${items.join('\n')}\n                            `;
const updatedIndex = `${indexHtml.slice(0, startIndex)}${updatedGallery}${indexHtml.slice(endIndex)}`;

if (updatedIndex !== indexHtml) {
  await writeFile(indexPath, updatedIndex);
  console.log(`Synced ${items.length} gallery photos.`);
} else {
  console.log(`Gallery already contains all ${items.length} photos.`);
}
