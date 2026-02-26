import sharp from "sharp";

const WHITE_THRESHOLD = 242;
const STRICT_CHROMA_THRESHOLD = 18;
const FEATHER_WHITE_THRESHOLD = 220;
const FEATHER_CHROMA_THRESHOLD = 35;

function isNearWhite(r: number, g: number, b: number, whiteThreshold: number, chromaThreshold: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold && (max - min) <= chromaThreshold;
}

function forEachBorderPixel(width: number, height: number, callback: (pixelIndex: number) => void): void {
  for (let x = 0; x < width; x += 1) {
    callback(x);
    callback((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    callback(y * width);
    callback(y * width + (width - 1));
  }
}

export async function makeNearWhiteTransparent(inputPngBytes: Buffer): Promise<{
  outputPngBytes: Buffer;
  whiteToTransparentPixels: number;
  inputBytes: number;
  outputBytes: number;
  threshold: number;
}> {
  const { data, info } = await sharp(inputPngBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const backgroundMask = new Uint8Array(pixelCount);
  const stack: number[] = [];
  let whiteToTransparentPixels = 0;

  // Extract only edge-connected near-white area as background.
  const trySeed = (pixelIndex: number): void => {
    if (visited[pixelIndex] === 1) {
      return;
    }
    visited[pixelIndex] = 1;
    const offset = pixelIndex * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a === 0 || !isNearWhite(r, g, b, WHITE_THRESHOLD, STRICT_CHROMA_THRESHOLD)) {
      return;
    }
    stack.push(pixelIndex);
  };

  forEachBorderPixel(width, height, trySeed);

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    backgroundMask[current] = 1;

    const x = current % width;
    const y = Math.floor(current / width);
    if (x > 0) {
      trySeed(current - 1);
    }
    if (x < width - 1) {
      trySeed(current + 1);
    }
    if (y > 0) {
      trySeed(current - width);
    }
    if (y < height - 1) {
      trySeed(current + width);
    }
  }

  // Remove extracted background.
  for (let p = 0; p < pixelCount; p += 1) {
    if (backgroundMask[p] === 0) {
      continue;
    }
    const alphaIndex = p * channels + 3;
    if (data[alphaIndex] !== 0) {
      data[alphaIndex] = 0;
      whiteToTransparentPixels += 1;
    }
  }

  // Soften borders slightly to reduce white fringe.
  for (let p = 0; p < pixelCount; p += 1) {
    if (backgroundMask[p] === 1) {
      continue;
    }
    const offset = p * channels;
    const alphaIndex = offset + 3;
    if (data[alphaIndex] === 0) {
      continue;
    }

    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    if (!isNearWhite(r, g, b, FEATHER_WHITE_THRESHOLD, FEATHER_CHROMA_THRESHOLD)) {
      continue;
    }

    const x = p % width;
    const y = Math.floor(p / width);
    let bgNeighbors = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        const neighborIndex = ny * width + nx;
        if (backgroundMask[neighborIndex] === 1) {
          bgNeighbors += 1;
        }
      }
    }

    if (bgNeighbors > 0) {
      const softenedAlpha = Math.max(96, 255 - bgNeighbors * 24);
      data[alphaIndex] = Math.min(data[alphaIndex], softenedAlpha);
    }
  }

  const outputPngBytes = await sharp(data, {
    raw: {
      width,
      height,
      channels,
    },
  })
    .png()
    .toBuffer();

  return {
    outputPngBytes,
    whiteToTransparentPixels,
    inputBytes: inputPngBytes.length,
    outputBytes: outputPngBytes.length,
    threshold: WHITE_THRESHOLD,
  };
}
