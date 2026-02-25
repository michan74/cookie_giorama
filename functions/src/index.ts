import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

export const webhook = onRequest({ region: "asia-northeast1" }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Task 2以降でLINE署名検証・イベント処理を実装する。
  logger.info("Webhook endpoint reached", { method: req.method });
  res.status(200).send("Webhook endpoint is ready");
});
