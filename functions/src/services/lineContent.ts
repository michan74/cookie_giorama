export async function fetchLineImageContent(params: {
  messageId: string;
  channelAccessToken: string;
}): Promise<{ imageBytes: Buffer; mimeType: string | undefined }> {
  const { messageId, channelAccessToken } = params;

  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LINE content fetch failed: ${response.status} ${errorBody}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const imageBytes = Buffer.from(arrayBuffer);
  if (imageBytes.length === 0) {
    throw new Error("LINE content fetch returned empty image");
  }

  const mimeType = response.headers.get("content-type") ?? undefined;
  return { imageBytes, mimeType };
}
