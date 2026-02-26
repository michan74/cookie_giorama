import { GoogleGenAI, Modality } from "@google/genai";

function buildCookieImagePrompt(userInputText: string): string {
  return `You are a creative pastry chef AI.
Create one cute sweet based on the user input text "${userInputText}".

Generation rules:
1. Motif: Represent the meaning of "${userInputText}" with shape/color. Do not draw letters directly.
2. Safety fallback: If the user input includes inappropriate, offensive, or broadcast-prohibited expressions, ignore that motif and generate a bear-shaped sweet instead.
3. Sweet type: Choose one suitable type such as icing cookie, macaron, candy, or cupcake.
4. Visual style: Cute decorations with pastel icing, colorful sprinkles, and sugar candy details.
5. Texture: Photorealistic macro food photography.
6. Composition: Isolated subject centered on a solid pure white background, with no shadows.
7. Output: PNG style image suitable for compositing after background post-processing.
8. Aspect ratio: 1:1.`;
}

function buildCookieImagePromptFromPhoto(): string {
  return `You are a creative pastry chef AI.
Create one cute sweet inspired by the main subject in the input photo.

Generation rules:
1. Motif: Identify the primary subject in the photo and express it as a sweet shape/color motif. Do not draw letters.
2. Safety fallback: If the photo includes inappropriate, offensive, or unsafe content, ignore it and generate a bear-shaped sweet instead.
3. Sweet type: Choose one suitable type such as icing cookie, macaron, candy, or cupcake.
4. Visual style: Cute decorations with pastel icing, colorful sprinkles, and sugar candy details.
5. Texture: Photorealistic macro food photography.
6. Composition: Isolated subject centered on a solid pure white background, with no shadows.
7. Output: PNG style image suitable for compositing after background post-processing.
8. Aspect ratio: 1:1.`;
}

function normalizeInputImageMimeType(mimeType: string | undefined): string {
  if (!mimeType) {
    return "image/jpeg";
  }

  const lower = mimeType.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg" || lower === "image/png" || lower === "image/webp") {
    return lower === "image/jpg" ? "image/jpeg" : lower;
  }
  return "image/jpeg";
}

function extractImageBase64(response: unknown): { base64: string; mimeType: string } {
  const responseWithData = response as { data?: string };
  if (responseWithData.data) {
    return { base64: responseWithData.data, mimeType: "image/png" };
  }

  const responseWithCandidates = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  };

  const parts = responseWithCandidates.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inlineData = part.inlineData;
    if (inlineData?.data) {
      return {
        base64: inlineData.data,
        mimeType: inlineData.mimeType ?? "image/png",
      };
    }
  }

  throw new Error("Gemini response does not contain inline image data");
}

async function generateCookieImageWithRetry(params: {
  genaiApiKey: string;
  model: string;
  prompt: string;
  inputImage?: {
    bytes: Buffer;
    mimeType?: string;
  };
}): Promise<{ imageBytes: Buffer; mimeType: string; prompt: string }> {
  const { genaiApiKey, model, prompt, inputImage } = params;
  const ai = new GoogleGenAI({ apiKey: genaiApiKey });

  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: inputImage
          ? [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: normalizeInputImageMimeType(inputImage.mimeType),
                    data: inputImage.bytes.toString("base64"),
                  },
                },
              ],
            },
          ]
          : prompt,
        config: {
          responseModalities: [Modality.IMAGE],
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
      });

      const { base64, mimeType } = extractImageBase64(response);
      const imageBytes = Buffer.from(base64, "base64");
      if (imageBytes.length === 0) {
        throw new Error("Generated image bytes are empty");
      }

      return { imageBytes, mimeType, prompt };
    } catch (error) {
      lastError = error;
      const errorWithMeta = error as { status?: number };
      const isRateLimited = errorWithMeta.status === 429;
      const hasNextAttempt = attempt < maxAttempts;
      if (!isRateLimited || !hasNextAttempt) {
        break;
      }

      const backoffMs = 1000 * 2 ** (attempt - 1);
      const jitterMs = Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
    }
  }

  const errorWithMeta = lastError as { name?: string; status?: number; message?: string };
  throw new Error(
    `GenAI image generation failed (model=${model}): ` +
    `${errorWithMeta.name ?? "Error"} status=${errorWithMeta.status ?? "unknown"} ` +
    `${errorWithMeta.message ?? "unknown error"}`,
  );
}

export async function generateCookieImage(
  userInputText: string,
  genaiApiKey: string,
  model: string,
): Promise<{ imageBytes: Buffer; mimeType: string; prompt: string }> {
  const prompt = buildCookieImagePrompt(userInputText);
  return generateCookieImageWithRetry({
    genaiApiKey,
    model,
    prompt,
  });
}

export async function generateCookieImageFromPhoto(
  sourceImageBytes: Buffer,
  sourceImageMimeType: string | undefined,
  genaiApiKey: string,
  model: string,
): Promise<{ imageBytes: Buffer; mimeType: string; prompt: string }> {
  const prompt = buildCookieImagePromptFromPhoto();
  return generateCookieImageWithRetry({
    genaiApiKey,
    model,
    prompt,
    inputImage: {
      bytes: sourceImageBytes,
      mimeType: sourceImageMimeType,
    },
  });
}
