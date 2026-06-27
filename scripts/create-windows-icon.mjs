import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "assets", "local-flow-icon.ico");

const sizes = [16, 24, 32, 48, 64, 128, 256];
const colors = {
  background: [0x10, 0x18, 0x20, 0xff],
  cream: [0xf6, 0xf4, 0xef, 0xff],
  teal: [0x2d, 0xb7, 0xa3, 0xff],
  gold: [0xf2, 0xb8, 0x4b, 0xff],
  transparent: [0, 0, 0, 0]
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPolyline(px, py, points) {
  let distance = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index];
    distance = Math.min(distance, distanceToSegment(px, py, ax, ay, bx, by));
  }
  return distance;
}

function roundedRect(x, y, width, height, radius, px, py) {
  const cx = clamp(px, x + radius, x + width - radius);
  const cy = clamp(py, y + radius, y + height - radius);
  return Math.hypot(px - cx, py - cy) <= radius;
}

function stroke(points, width, px, py) {
  return distanceToPolyline(px, py, points) <= width / 2;
}

function sampleIcon(logicalX, logicalY) {
  let color = colors.transparent;

  if (roundedRect(0, 0, 64, 64, 14, logicalX, logicalY)) {
    color = colors.background;
  }

  if (stroke([[13, 27], [10.5, 32], [10, 36], [10.5, 40], [13, 45]], 4, logicalX, logicalY)) {
    color = colors.gold;
  }
  if (stroke([[51, 27], [53.5, 32], [54, 36], [53.5, 40], [51, 45]], 4, logicalX, logicalY)) {
    color = colors.gold;
  }

  if (roundedRect(23, 13, 18, 31, 9, logicalX, logicalY)) {
    color = colors.cream;
  }
  if (roundedRect(27, 17, 10, 23, 5, logicalX, logicalY)) {
    color = colors.teal;
  }

  const micArc = [[18, 32], [18, 35], [20, 41], [24, 46], [32, 49], [40, 46], [44, 41], [46, 35], [46, 32]];
  if (stroke(micArc, 4, logicalX, logicalY)) {
    color = colors.cream;
  }
  if (stroke([[32, 49], [32, 56]], 4, logicalX, logicalY)) {
    color = colors.cream;
  }
  if (stroke([[24, 56], [40, 56]], 4, logicalX, logicalY)) {
    color = colors.cream;
  }

  return color;
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = size <= 24 ? 3 : 4;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rgba = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const logicalX = ((x + (sx + 0.5) / samples) / size) * 64;
          const logicalY = ((y + (sy + 0.5) / samples) / size) * 64;
          const sample = sampleIcon(logicalX, logicalY);
          for (let channel = 0; channel < 4; channel += 1) {
            rgba[channel] += sample[channel];
          }
        }
      }

      const divisor = samples * samples;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(rgba[0] / divisor);
      pixels[offset + 1] = Math.round(rgba[1] / divisor);
      pixels[offset + 2] = Math.round(rgba[2] / divisor);
      pixels[offset + 3] = Math.round(rgba[3] / divisor);
    }
  }

  return pixels;
}

function createDibImage(size) {
  const pixels = renderIcon(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  header.writeInt32LE(0, 24);
  header.writeInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);

  const xorBitmap = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const sourceOffset = (sourceY * size + x) * 4;
      const targetOffset = (y * size + x) * 4;
      xorBitmap[targetOffset] = pixels[sourceOffset + 2];
      xorBitmap[targetOffset + 1] = pixels[sourceOffset + 1];
      xorBitmap[targetOffset + 2] = pixels[sourceOffset];
      xorBitmap[targetOffset + 3] = pixels[sourceOffset + 3];
    }
  }

  const maskRowSize = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(maskRowSize * size);
  return Buffer.concat([header, xorBitmap, andMask]);
}

export function writeIco(iconSizes = sizes) {
  const images = iconSizes.map((size) => ({
    size,
    data: createDibImage(size)
  }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const entryOffset = index * 16;
    directory[entryOffset] = image.size === 256 ? 0 : image.size;
    directory[entryOffset + 1] = image.size === 256 ? 0 : image.size;
    directory[entryOffset + 2] = 0;
    directory[entryOffset + 3] = 0;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.data.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += image.data.length;
  }

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, writeIco());
console.log(JSON.stringify({ ok: true, outputPath, sizes }));
