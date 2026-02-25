import { randomUUID } from "node:crypto";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

function getOrInitFirebaseApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp({
    storageBucket: process.env.STORAGE_BUCKET,
    databaseURL: process.env.DATABASE_URL,
  });
}

export async function uploadCookieImage(imageBytes: Buffer, userId: string): Promise<string> {
  const app = getOrInitFirebaseApp();
  const bucket = getStorage(app).bucket();

  const timestamp = Date.now();
  const safeUserId = userId || "unknown";
  const objectPath = `cookies/${timestamp}_${safeUserId}.png`;
  const downloadToken = randomUUID();

  const file = bucket.file(objectPath);
  await file.save(imageBytes, {
    metadata: {
      contentType: "image/png",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    resumable: false,
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
}
