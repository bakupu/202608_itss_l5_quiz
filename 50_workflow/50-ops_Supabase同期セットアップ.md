# Supabase 同期セットアップ

検証ステータス: **未検証**（M2 実装時の想定手順。Supabase 側の画面表記は変わりうるため公式ドキュメントを真実源とする）。

⚠️ この機能は現在**保留**。`docs/js/supabase-config.js` の `url` / `anonKey` が空のあいだ、
アプリは localStorage のみで正常に動作する。
着手の解除条件は「**PCとスマホの2端末で同一の学習履歴を使いたくなったとき**」（→ [CLAUDE.md](../CLAUDE.md)）。

## 1. プロジェクトとDBを作る

1. Supabase Dashboard で新規 Project を作成
2. SQL Editor で `infra/supabase_m2.sql` を丸ごと実行

作成されるテーブル:

- `attempts`: 回答履歴。同期の基準となるイベントデータ
- `user_question_state`: ★や現在の習得状態のスナップショット

両方とも **RLS（Row Level Security / 行レベルセキュリティ）** を有効にし、
`auth.uid() = user_id` の本人だけがアクセスできる。

## 2. Auth を設定する

Authentication で Email provider を有効にする。
続いて URL Configuration を設定する。**Site URL と Redirect URLs は別項目**なので、両方を設定する。

- Site URL: `https://bakupu.github.io/202608_itss_l5_quiz/`
- Redirect URLs: 上記に加えて `http://localhost:8000/` も登録する

`sync.js` はログイン時のリダイレクト先に `location.origin + location.pathname` を渡す。
つまり**アプリを開いたURLそのものが Redirect URLs に登録されている必要がある**。
ローカル確認のポート番号を 8000 から変えた場合は、その URL も登録する。

## 3. 公開キーを設定する

`docs/js/supabase-config.js` を編集する。

```js
export const SUPABASE_CONFIG = {
  url: 'https://xxxx.supabase.co',
  anonKey: 'YOUR_ANON_OR_PUBLISHABLE_KEY'
};
```

⚠️ **`url` と `anonKey` の両方に実値を入れる。** 片方をプレースホルダのまま残すと、
`sync.js` の設定判定を通過して「設定済み」と扱われ、接続に失敗して
「Supabase接続失敗：ローカル保存で継続」になる。

🔥 **`service_role` キー・DBパスワード・秘密鍵を `docs/` 配下へ置かない。** GitHub Pages はそのままブラウザへ配る。
データ保護を担っているのは公開キーではなく RLS である。

## 4. 公開サイトへ反映する

`supabase-config.js` はリポジトリのファイルなので、**commit して push しないと公開サイトには反映されない**。

```bash
git add docs/js/supabase-config.js
git commit -m "chore: Supabase接続設定を有効化"
git push github main
```

⚠️ これは anon（公開）キーをリポジトリへ載せる操作である。
anon キーは権限境界ではなく、実際の保護は RLS が担う前提で意図的にそうしている。
それでも公開したくない場合は、GitHub Pages 配信のままでは同期を有効にできない。

## 5. 使い方

1. PC でメールアドレスを入力し「メールでログイン」→ 届いた Magic Link（ログイン用の使い捨てリンク）を開く
2. 「同期済み」表示を確認
3. スマホで同じURLを開き、同じメールアドレスでログイン

通常は回答・★変更・オンライン復帰後に自動同期する。「今すぐ同期」で手動同期もできる。

## 同期設計（トラブル時の判断材料）

回答履歴 `attempts` を主データとして扱い、各回答にクライアントで UUID を振る。
同期時は、サーバの履歴を取得 → UUID でマージ → 未アップロード分を upsert → ★を更新日時でマージ →
全回答を時系列に並べて習得度・復習日・日次実績を再計算 → `user_question_state` へ保存する。

そのため、**PCとスマホで別々に回答しても履歴を失いにくい**。逆に、履歴がおかしいときは
`attempts` を直せば習得状態は再計算で復旧する。

⚠️ Supabase の JS クライアントは CDN から動的ロードする。初回のログイン・同期にはネット接続が必要。
学習UI本体は Service Worker がキャッシュするためオフラインでも回答できる。
