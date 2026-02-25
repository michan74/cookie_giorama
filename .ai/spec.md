# 仕様書：LINE連携 AIクッキー画像生成バックエンド

## 1. 目的
LINE Messaging APIを通じてユーザーから送信されたテキストを元に、AIを用いて「その文字の形をしたおかし画像」を生成し、リアルタイムWebアプリに反映させるためのデータベース（Firebase）へ格納する。

## 2. システム構成
- **Runtime**: Firebase Cloud Functions (Node.js 20+, TypeScript)
- **API連携**: 
    - LINE Messaging API (Webhook受取)
    - google genai: gemini-flash-2.5-image
- **Database/Storage**:
    - Firebase Realtime Database (画像パス・座標データの保存)
    - Firebase Storage (生成された画像ファイルの保存)
- **ローカル実行**:
    - Firebase Emulator Suite
    - Docker / Docker Compose（任意）

## 3. 処理詳細フロー

### ① LINE Webhook 受付
- LINEからのPOSTリクエストを受け取り、署名検証（`X-Line-Signature`）を行う。
- 署名検証に失敗した場合は `401` を返却して処理を終了する。
- 対象イベントは `message` のみとする。
- メッセージタイプが `text` であることを確認し、文字列を抽出する。

### ② 画像生成プロンプト構築
- ユーザー入力をAIが理解しやすい英語プロンプトに変換。
- 禁止用語の厳密判定はコードで行わず、プロンプトの指示で対応する。
- 放送禁止用語や不適切表現が含まれる場合は、生成モチーフを「くまの形」にするよう指示する。
- **プロンプトテンプレート例**:
  ```
  あなたは創造力豊かなパティシエAIです。
  ユーザーが入力したテキスト「{user_input_text}」から連想されるモチーフを使って、可愛らしいお菓子を1つ作成してください。

  **生成のルール:**
  1.  **モチーフ:** テキスト「{user_input_text}」の内容を形や色で表現する（例：「いちご」なら苺型のクッキー、「星」なら星型のマカロン）。文字そのものは書かないこと。
  2.  **種類:** アイシングクッキー、マカロン、キャンディ、カップケーキなどから最適なものを1つ選ぶ。
  3.  **見た目:** パステルカラーのアイシング、カラフルなスプリンクル、砂糖菓子などで可愛くデコレーションする。
  4.  **質感:** 本物そっくりのリアルな質感（フォトリアリスティックなマクロ撮影）。
  5.  **背景:** 合成用に、背景は透過（transparent background）とし、不要な影を落とさないこと。被写体は中央に孤立させる。
  6.  **出力形式:** PNG形式（透過情報を保持できる形式）を指定する。
  ```

### ③ AIによる画像生成 
- 生成APIを呼び出し、画像URL（一時的）を取得。
- 画像のアスペクト比は `1:1` とする。
- 出力形式は `PNG` を指定し、背景透過で生成させる。

### ④ 画像の永続化 (Storage)
- 生成された一時URLから画像をダウンロード。
- Firebase Storageの `/cookies/{timestamp}_{user_id}.png` へ保存。
- `user_id` は LINE の `source.userId` をそのまま利用する。
- 保存した画像の「公開URL（ダウンロードURL）」を取得し、恒久公開として利用する。

### ⑤ データベース登録 (Realtime Database)
- Webアプリ側が検知できるよう、以下の構造でデータを `push()` する。
- 保存先パスは `cookies` 直下とする。
- `posX` は `0.0 ~ 1.0` の範囲でランダム生成する。
- `rotation` は `-20 ~ +20` 度の範囲でランダム生成する。
- **データ構造例**:
  ```json
  {
    "cookies": {
      "unique_id_1": {
        "imageUrl": "[https://firebasestorage.googleapis.com/](https://firebasestorage.googleapis.com/)...",
        "text": "おめでとう",
        "createdAt": 1708848000000,
        "posX": 0.5, // Web側でランダム配置するための初期値（0~1）
        "rotation": 15 // 傾き
      }
    }
  }
  ```

### ⑥ LINEへの返信
- 生成成功時はLINEに `reply` で以下を返す。
  - 「つくったよ」メッセージ
  - 生成した画像
- 生成失敗時はLINEにエラーメッセージを `reply` する。