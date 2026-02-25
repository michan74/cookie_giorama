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

function randomPosY(): number {
  return Math.round(Math.random() * 1000) / 1000;
}

function randomRotation(): number {
  return Math.floor(Math.random() * 41) - 20;
}

function randomScale(): number {
  // 0.8〜1.2の範囲でサイズ変化を持たせる。
  return Math.round((0.8 + Math.random() * 0.4) * 1000) / 1000;
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
    posY: randomPosY(),
    rotation: randomRotation(),
    scale: randomScale(),
  });
}
