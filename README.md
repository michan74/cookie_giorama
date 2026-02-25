# cookie_giorama backend

LINEのテキスト入力からAIクッキー画像を生成し、Firebaseへ保存する Firebase Cloud Functions（Node.js/TypeScript）バックエンドです。

## Prerequisites

- Node.js 20+
- Firebase CLI（`npm i -g firebase-tools`）
- Docker / Docker Compose（任意: ローカル確認をコンテナで行う場合）

## Setup

```bash
cp .env.example .env
npm --prefix functions install
```

`.env` に以下を設定してください。

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GENAI_API_KEY`
- `GENAI_IMAGE_MODEL`（例: `gemini-2.5-flash-image`）
- `DATABASE_URL`
- `STORAGE_BUCKET`

## Local run (Firebase Emulator)

```bash
npm --prefix functions run build
firebase emulators:start --only functions --config firebase.json
```

## Local run (Docker)

```bash
docker compose up --build
```

## Deploy (Firebase Cloud Functions)

```bash
firebase deploy --only functions
```

> Firebase Cloud Functions は Docker イメージを直接デプロイする方式ではなく、`firebase deploy` で配備します。
