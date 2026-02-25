import sharp from "sharp";

const WHITE_THRESHOLD = 245;

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

  let whiteToTransparentPixels = 0;

  // RGBA pixel walk: set near-white pixels fully transparent.
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alphaIndex = i + 3;

    if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
      if (data[alphaIndex] !== 0) {
        data[alphaIndex] = 0;
        whiteToTransparentPixels += 1;
      }
    }
  }

  const outputPngBytes = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
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
