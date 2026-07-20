# PUTTERSアプリ - プロジェクト概要

## オーナー
松本さん（PUTTERSジムオーナー、元ジャニーズ専属トレーナー）

## システム構成
- **フロントエンド**: Vercel（`liff-app-weld.vercel.app`）
- **バックエンド**: Google Apps Script (GAS)
- **データ**: Googleスプレッドシート
- **AI**: Claude API（Haiku）/ Anthropic
- **LINE連携**: LIFF SDKは読み込むが`liff.closeWindow()`だけ使用。**LINEログインは未実装**。お客さんはブラウザ(Safari等)で開き、**名前を手入力**して使う（本人確認＝打った名前をlocalStorage保存＋宿題シート照合）。「LINEログイン前提」で考えないこと

## 重要なURL・ID
- **GAS URL**: `https://script.google.com/macros/s/AKfycbwnDYL8RT3pFxetCwig3LtDIatUvruamQrGF2B99zPVDfVBeN6KgtZobpLFj2T8ZQfe/exec`
- **スプレッドシートID**: `1Me9JRGM8VKahuYrSSHskJ75z2OCcQSUg42zOojOTmf8`
- **Vercel URL**: `liff-app-weld.vercel.app`
- **GASファイル**: `Code.gs`（このリポジトリのルート）

## アプリの主な機能（ページ一覧）
| ページ | 説明 |
|--------|------|
| index.html | メインページ（食事記録・体重・体温・宿題） |
| admin.html | 管理画面（松本さん専用） |
| myset.html | マイセット管理（食材セット登録・PFC自動取得） |
| goals.html | 目標設定 |
| chart-full.html | グラフ（体重・体温・PFC推移） |
| schedule.html | 今月の予約 |
| book.html | 予約システム |
| body-map.html | 筋肉痛トラッキング（人体図） |
| brain.html | 脳トレ（松本大樹専用・漢字/地名/計算/人数） |
| recipe.html | 食材からレシピ提案 |
| feedback.html | 意見箱 |
| goods.html / supple.html / protein.html | アフィリエイト商品ページ |
| steps.html | 歩数ランキング（現在非表示） |

## APIエンドポイント（/api/）
- `pfc.js` — 食材名からPFC取得（Claude Haiku）
- `analyze-meal.js` — 食事写真解析（Claude）
- `brain-quiz.js` — 脳トレ問題生成（Claude Haiku）
- `recipe.js` — レシピ提案
- `google-fit.js` — Google Fit歩数取得
- `steps.js` — 歩数ランキング

## スプレッドシートのシート構成
- `宿題` — ユーザーごとの宿題（C列以降がタスク名、「ランダム宿題」で日替わり）
- `ランダム宿題` — A列:種目名、B列:動画URL
- `動画` — A列:種目名、B列:YouTube URL（固定・ランダム両対応）
- `記録` — ユーザーの日次記録
- `筋肉痛` — 筋肉痛トラッキング

## 重要な実装メモ
- **26時切り替え**: `now - 2時間` で日付判定（深夜2時まで前日扱い）
- **ユーザー識別**: `localStorage['putters_user_name']` に名前を保存
- **松本大樹専用機能**: JSで `if (userName === '松本大樹')` で制御
- **PFC API**: `/api/pfc` POST `{food: name}` → `{p, f, c, kcal}`
- **キャッシュキー**: `putters_cache`, `putters_mysets`, `putters_user_name`
- **GASデプロイ**: 変更後は「デプロイを管理」→「新しいデプロイ」は不要、「編集」で更新

## デプロイ方法
```bash
cd /home/poritan/secretary/liff-app
git add .
git commit -m "メッセージ"
git push
# → Vercelが自動デプロイ（1〜2分）
```

## アフィリエイト
- Amazon: `tag=index712-22`
- 楽天: `hb.afl.rakuten.co.jp`
- A8: `px.a8.net`

## 今後の予定
- **トレーニング教科書ページ（重要・忘れずに実装）**：動画を体系的に並べるページ。メニューから飛べる形式。YouTubeリンク形式。動画9本揃ってきたので着手タイミング。
- ヒートトレーニング機能（20秒×8本ランダム再生）→動画が揃ってから
- GBP API審査待ち（ケースID: 4-8355000040427）

## コンテンツ運用ルール
- **読み物と被る独り言は書かない／ブログに出さない**：独り言を新規に書く前、またはアプリ→ブログ化する前に、必ず `public/reasons.html` のカードタイトルをgrepして話題の被りをチェックする。被っていたらその独り言はスキップ（読み物側が正）。読み物と独り言を両方ブログに載せると重複コンテンツで食い合うため。判明済みの被り例：独り言「鉄サプリは測って」↔読み物「その"だるい"、鉄かもしれない」／独り言「9年プロテイン国産乗り換え」↔読み物「9年飲んだマイプロを国産に替えるか」／独り言「シナモン2種類」↔読み物「そのシナモン、実は2種類あります」。
