import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

function getOrInitFirebaseApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp({
    storageBucket: process.env.STORAGE_BUCKET,
    databaseURL: process.env.DATABASE_URL,
  });
}

function randomPosX(): number {
  return Math.round(Math.random() * 1000) / 1000;
}

function randomRotation(): number {
  return Math.floor(Math.random() * 41) - 20;
}

export async function createCookieRecord(input: {
  imageUrl: string;
  text: string;
}): Promise<void> {
  const app = getOrInitFirebaseApp();
  const db = getDatabase(app);

  await db.ref("cookies").push({
    imageUrl: input.imageUrl,
    text: input.text,
    createdAt: Date.now(),
    posX: randomPosX(),
    rotation: randomRotation(),
  });
}
