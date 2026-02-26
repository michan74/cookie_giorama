import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { validateSignature } from "@line/bot-sdk";
import { generateCookieImage, generateCookieImageFromPhoto } from "./services/imageGeneration";
import { uploadCookieImage } from "./services/storage";
import { createCookieRecord } from "./services/database";
import { makeNearWhiteTransparent } from "./services/imagePostProcess";
import { fetchLineImageContent } from "./services/lineContent";

type LineWebhookEvent = {
  type: string;
  replyToken?: string;
  source?: {
    userId?: string;
  };
  message?: {
    type?: string;
    text?: string;
    id?: string;
  };
};

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

type ProcessMessage =
  | {
    kind: "text";
    text: string;
    userId: string | null;
    replyToken: string | null;
  }
  | {
    kind: "image";
    messageId: string;
    userId: string | null;
    replyToken: string | null;
  };

function toErrorInfo(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  status?: number;
} {
  if (error instanceof Error) {
    const errorWithStatus = error as Error & { status?: number };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      status: errorWithStatus.status,
    };
  }

  const fallback = String(error);
  return {
    name: "UnknownError",
    message: fallback,
  };
}

async function replyText(replyToken: string, text: string, channelAccessToken: string): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LINE reply failed: ${response.status} ${errorBody}`);
  }
}

async function replySuccessWithImage(
  replyToken: string,
  imageUrl: string,
  channelAccessToken: string,
): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: "つくったよ！",
        },
        {
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LINE image reply failed: ${response.status} ${errorBody}`);
  }
}

export const webhook = onRequest({ region: "asia-northeast1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    logger.error("LINE_CHANNEL_SECRET is not configured");
    res.status(500).send("Server configuration error");
    return;
  }
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) {
    logger.error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
    res.status(500).send("Server configuration error");
    return;
  }
  const genaiApiKey = process.env.GENAI_API_KEY;
  if (!genaiApiKey) {
    logger.error("GENAI_API_KEY is not configured");
    res.status(500).send("Server configuration error");
    return;
  }
  const genaiImageModel = process.env.GENAI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  const storageBucket = process.env.STORAGE_BUCKET;
  if (!storageBucket) {
    logger.error("STORAGE_BUCKET is not configured");
    res.status(500).send("Server configuration error");
    return;
  }

  const signatureHeader = req.header("x-line-signature");
  const requestBodyText = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});

  if (!signatureHeader || !validateSignature(requestBodyText, channelSecret, signatureHeader)) {
    logger.warn("Invalid LINE signature");
    res.status(401).send("Unauthorized");
    return;
  }

  const body = (req.body ?? {}) as LineWebhookBody;
  const events = Array.isArray(body.events) ? body.events : [];
  const processMessages: ProcessMessage[] = [];

  for (const event of events) {
    if (event.type !== "message") {
      continue;
    }

    if (event.message?.type === "text") {
      const text = event.message.text?.trim();
      if (!text) {
        continue;
      }

      processMessages.push({
        kind: "text",
        text,
        userId: event.source?.userId ?? null,
        replyToken: event.replyToken ?? null,
      });
      continue;
    }

    if (event.message?.type !== "image") {
      continue;
    }

    const messageId = event.message.id;
    if (!messageId) {
      continue;
    }

    processMessages.push({
      kind: "image",
      messageId,
      userId: event.source?.userId ?? null,
      replyToken: event.replyToken ?? null,
    });
  }

  logger.info("LINE webhook processed", {
    totalEvents: events.length,
    processMessageCount: processMessages.length,
    textMessageCount: processMessages.filter((message) => message.kind === "text").length,
    imageMessageCount: processMessages.filter((message) => message.kind === "image").length,
  });

  for (const message of processMessages) {
    if (!message.replyToken) {
      logger.warn("Reply token is missing");
      continue;
    }

    let stage = "generate_image";
    try {
      let generated: { imageBytes: Buffer; mimeType: string; prompt: string };
      let sourceTextForRecord = "[image]";

      if (message.kind === "text") {
        generated = await generateCookieImage(
          message.text,
          genaiApiKey,
          genaiImageModel,
        );
        sourceTextForRecord = message.text;
      } else {
        stage = "fetch_line_image";
        const lineImage = await fetchLineImageContent({
          messageId: message.messageId,
          channelAccessToken,
        });
        stage = "generate_image";
        generated = await generateCookieImageFromPhoto(
          lineImage.imageBytes,
          lineImage.mimeType,
          genaiApiKey,
          genaiImageModel,
        );
      }

      stage = "postprocess_transparency";
      let imageBytesForUpload = generated.imageBytes;
      try {
        const postProcessed = await makeNearWhiteTransparent(generated.imageBytes);
        imageBytesForUpload = postProcessed.outputPngBytes;
        logger.info("Image post-processed", {
          threshold: postProcessed.threshold,
          whiteToTransparentPixels: postProcessed.whiteToTransparentPixels,
          inputBytes: postProcessed.inputBytes,
          outputBytes: postProcessed.outputBytes,
        });
      } catch (postProcessError) {
        const postProcessErrorInfo = toErrorInfo(postProcessError);
        logger.warn("Image post-process failed; using original image", {
          errorName: postProcessErrorInfo.name,
          errorMessage: postProcessErrorInfo.message,
        });
      }

      stage = "upload_storage";
      const imageUrl = await uploadCookieImage(imageBytesForUpload, message.userId ?? "unknown");
      stage = "db_register";
      await createCookieRecord({
        imageUrl,
        text: sourceTextForRecord,
      });

      logger.info("Image generated", {
        mimeType: generated.mimeType,
        imageBytes: generated.imageBytes.length,
        uploadImageBytes: imageBytesForUpload.length,
        imageUrl,
        genaiImageModel,
      });

      stage = "reply_line";
      await replySuccessWithImage(message.replyToken, imageUrl, channelAccessToken);
    } catch (error) {
      const errorInfo = toErrorInfo(error);
      logger.error("Failed in image generation flow", {
        stage,
        messageKind: message.kind,
        errorName: errorInfo.name,
        errorMessage: errorInfo.message,
        errorStatus: errorInfo.status,
        errorStack: errorInfo.stack,
        genaiImageModel,
      });
      if (stage === "fetch_line_image") {
        await replyText(message.replyToken, "画像の取得に失敗しました。もう一度送ってください。", channelAccessToken);
      } else {
        await replyText(message.replyToken, "画像生成でエラーが発生しました。", channelAccessToken);
      }
    }
  }

  res.status(200).send("OK");
});
