import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { validateSignature } from "@line/bot-sdk";

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
      await replyText(message.replyToken, message.text, channelAccessToken);
    } catch (error) {
      logger.error("Failed to send LINE reply", { error });
    }
  }

  res.status(200).send("OK");
});
