import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { validateSignature } from "@line/bot-sdk";
import { generateCookieImage } from "./services/imageGeneration";
import { uploadCookieImage } from "./services/storage";

type LineWebhookEvent = {
  type: string;
  replyToken?: string;
  source?: {
    userId?: string;
  };
  message?: {
    type?: string;
    text?: string;
  };
};

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

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
  const vertexProject = process.env.VERTEX_PROJECT_ID
    ?? process.env.GCP_PROJECT_ID
    ?? process.env.GCLOUD_PROJECT;
  if (!vertexProject) {
    logger.error("VERTEX_PROJECT_ID or GCP_PROJECT_ID (or GCLOUD_PROJECT) is not configured");
    res.status(500).send("Server configuration error");
    return;
  }
  const vertexLocation = process.env.VERTEX_LOCATION ?? "asia-northeast1";
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
  const textMessages: Array<{ text: string; userId: string | null; replyToken: string | null }> = [];

  for (const event of events) {
    if (event.type !== "message") {
      continue;
    }

    if (event.message?.type !== "text") {
      continue;
    }

    const text = event.message.text?.trim();
    if (!text) {
      continue;
    }

    textMessages.push({
      text,
      userId: event.source?.userId ?? null,
      replyToken: event.replyToken ?? null,
    });
  }

  logger.info("LINE webhook processed", {
    totalEvents: events.length,
    textMessageCount: textMessages.length,
  });

  for (const message of textMessages) {
    if (!message.replyToken) {
      logger.warn("Reply token is missing");
      continue;
    }

    try {
      const generated = await generateCookieImage(message.text, vertexProject, vertexLocation);
      const imageUrl = await uploadCookieImage(generated.imageBytes, message.userId ?? "unknown");
      logger.info("Image generated", {
        mimeType: generated.mimeType,
        imageBytes: generated.imageBytes.length,
        imageUrl,
      });

      await replySuccessWithImage(message.replyToken, imageUrl, channelAccessToken);
    } catch (error) {
      logger.error("Failed in image generation flow", { error });
      await replyText(message.replyToken, "画像生成でエラーが発生しました。", channelAccessToken);
    }
  }

  res.status(200).send("OK");
});
