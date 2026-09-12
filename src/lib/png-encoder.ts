/**
 * Minimal PNG encoder for RGBA8 images (bit depth 8, color type 6, no interlace).
 *
 * Uses DEFLATE "stored" blocks (BTYPE=00): valid zlib output with zero compression, so
 * no inflate/deflate implementation is needed — only the framing bytes plus Adler-32 and
 * per-chunk CRC-32 checksums. Output size is ~1:1 with raw pixels, which is acceptable
 * for prototype-scale floor-plan images (~1000×800 px ≈ 3 MB).
 *
 * Pure TypeScript with no dependencies on purpose: the same code path runs in Hermes and
 * can be exercised directly under Node for verification.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    // Loop bounds guarantee both index accesses are in range.
    c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    // Loop bounds guarantee the index access is in range.
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUInt32BE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function writeUInt16LE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

/** One PNG chunk: length(4 BE) + type(4 ASCII) + data + CRC-32(type+data). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUInt32BE(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  writeUInt32BE(out, 8 + data.length, crc);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encodes an RGBA8 buffer as a PNG file's byte sequence.
 * @param width Image width in pixels.
 * @param height Image height in pixels.
 * @param rgba Raw pixel data, row-major, exactly width*height*4 bytes (R,G,B,A per pixel).
 */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(`Invalid PNG dimensions: ${width}×${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `RGBA buffer size mismatch: expected ${width * height * 4} bytes, got ${rgba.length}`,
    );
  }

  // IHDR: width, height, bit depth 8, color type 6 (RGBA), compression 0, filter 0, no interlace.
  const ihdr = new Uint8Array(13);
  writeUInt32BE(ihdr, 0, width);
  writeUInt32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;

  // Raw scanlines: each row prefixed with filter byte 0 (None).
  const stride = width * 4 + 1;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }

  // zlib stream: header (0x78 0x01 — valid CMF/FLG pair) + stored blocks + Adler-32.
  const MAX_BLOCK = 65535;
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
    const end = Math.min(offset + MAX_BLOCK, raw.length);
    const length = end - offset;
    const block = new Uint8Array(5 + length);
    // BFINAL bit set on the last block; BTYPE=00 (stored).
    block[0] = end === raw.length ? 0x01 : 0x00;
    writeUInt16LE(block, 1, length);
    writeUInt16LE(block, 3, 0xffff - length);
    block.set(raw.subarray(offset, end), 5);
    blocks.push(block);
  }
  const adler = new Uint8Array(4);
  writeUInt32BE(adler, 0, adler32(raw));
  const idat = concat([new Uint8Array([0x78, 0x01]), ...blocks, adler]);

  return concat([
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
