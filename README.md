# ITSS L5 Study — M2 Supabase Sync

戦略・アーキテクチャ・セキュリティ寄りの午前I/II対策用PWAです。
M1のローカル学習機能に、Supabase Auth + PostgreSQLによるPC/スマホ間同期を追加しています。

## M2で実装済み
- PC / スマホ対応レスポンシブPWA
- 今日の3問、任意問題数、領域・形式・復習条件フィルタ
- 正誤、短い解説、全選択肢メモ、関連語
- ★重点マーク
- 習得Lv 0〜4、復習予定、連続学習日数、誤答→習得
- ダッシュボードとJSONエクスポート
- Supabase Email Magic Link / OTPログイン
- `attempts` と `user_question_state` の端末間同期
- RLSで本人のデータだけ読書き可能
- M1 localStorage (`itss-l5-study-state-v1`) からM2へ自動移行
- オフライン時はlocalStorageへ保存し、オンライン復帰後に再同期
- 複数端末の回答履歴をIDでマージし、習得状態を履歴から再計算
- PWAオフラインキャッシュ
- オリジナル問題 81問

## 1. Supabaseプロジェクトを作る
Supabase Dashboardで新規Projectを作成します。

## 2. DBを作る
Supabaseの SQL Editor で `supabase_m2.sql` を丸ごと実行します。

作成される主なテーブル:
- `attempts`: 回答履歴。同期の基準となるイベントデータ
- `user_question_state`: ★や現在の習得状態のスナップショット

両方ともRLSを有効にし、`auth.uid() = user_id` の本人だけアクセス可能です。

## 3. Authを設定する
AuthenticationでEmail providerを有効にします。

URL Configurationで、実際のGitHub Pages URLを許可してください。
例:

```
https://YOUR_GITHUB_NAME.github.io/YOUR_REPOSITORY/
```

ローカル確認もするなら、Redirect URLsに以下も追加します。

```
http://localhost:8000/
```

メールテンプレートが `ConfirmationURL` を使う標準Magic Link形式なら、受信メールのリンクを押すだけでログインできます。

## 4. 公開キーを設定する
`supabase-config.js` を編集します。

```js
export const SUPABASE_CONFIG = {
  url: 'https://xxxx.supabase.co',
  anonKey: 'YOUR_ANON_OR_PUBLISHABLE_KEY'
};
```

Project URL と、ブラウザ用の anon/public(publishable) key を指定します。

**service_role key は絶対にGitHub Pagesへ置かないでください。**

設定が空のままでもアプリはM1同様、localStorageのみで動作します。

## 5. ローカル確認
`file://` 直開きではなくHTTPで開きます。

```bash
python -m http.server 8000
```

ブラウザで:

```
http://localhost:8000/
```

## 6. GitHub Pagesへ公開
このディレクトリ一式をGitHubリポジトリへ置き、Settings → Pages から公開します。
スマホからGitHub Pages URLを開き、必要なら「ホーム画面に追加」してください。

## 同期の使い方
1. PCでメールアドレスを入力し「メールでログイン」
2. 届いたMagic Linkを開く
3. 「同期済み」と表示されることを確認
4. スマホでも同じGitHub Pages URLを開く
5. 同じメールアドレスでログイン
6. 回答履歴、★、習得状態、グラフが同期される

「今すぐ同期」でも手動同期できます。通常は回答・★変更・オンライン復帰後に自動同期します。

## 同期設計
回答履歴 `attempts` を主データとして扱います。
各回答にはクライアントでUUIDを振り、Supabase側でも同じIDを保持します。

同期時は:
1. サーバの回答履歴を取得
2. 端末の回答履歴とUUIDでマージ
3. 未アップロード回答をSupabaseへupsert
4. ★状態を更新日時でマージ
5. 全回答を時系列に並べて習得度・復習日・日次実績を再計算
6. `user_question_state` に最新スナップショットを保存

この方式により、PCとスマホで別々に回答しても履歴をできるだけ失わない構成です。

## オフライン
ネット接続がない場合も回答できます。回答はlocalStorageへ残ります。
オンラインへ戻りログイン状態なら自動同期を試みます。

SupabaseのJSクライアント自体はCDNから動的ロードします。そのため、初回のSupabaseログイン/同期にはネット接続が必要です。学習UI本体はService Workerでキャッシュします。

## M1からの移行
同じブラウザにM1の `itss-l5-study-state-v1` が残っていれば、M2初回起動時に `itss-l5-study-state-v2` へコピーします。
その後Supabaseへログインすると、既存回答履歴をクラウド側へマージします。

## セキュリティ上の前提
- GitHub Pagesは静的配信のみ
- DBアクセスはSupabase Authのユーザーセッション経由
- RLSでユーザーIDごとに分離
- 公開用キーは権限境界ではなく、RLSが実際のデータ保護を担当
- `service_role` / DB password / private key はクライアントへ置かない

## 次のM3候補
- GitHub Actions等で問題DBの検証
- IPA過去問インポータ（出典・年度・問題番号付き）
- ChatGPT Scheduled Tasksから毎日3問への導線
- 問題検索 / 苦手用語一覧
- 同期状態・最終同期時刻の詳細画面
