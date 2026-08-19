# ローカル確認と GitHub Pages 公開

検証ステータス: ローカル確認手順は 2026-08-19 に実行して確認済み。Pages 設定変更は **未検証**（👤 本人操作待ち）。

## ローカル確認

`file://` の直開きでは ES モジュールと Service Worker が動かないため、必ず HTTP で開く。
**リポジトリのルートから**実行する。

```bash
cd docs
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開く。
ポート 8000 は Supabase の Redirect URLs にも登録する値なので、変える場合は
[Supabase 同期セットアップ](50-ops_Supabase同期セットアップ.md)の設定も合わせる。

確認ポイント（開発者ツールの表記は Chrome / Edge 系のもの）:

- 問題が出題される（読み込み失敗なら `docs/data/questions.json` のパスを疑う）
- Console にエラーが無い
- Application → Service Workers に `sw.js` が activated で登録されている
- Application → **Cache Storage** に `itss-l5-v3` がある（キャッシュ名はここでしか見えない。Service Workers パネルに出るのはスクリプトURLとスコープ）

⚠️ **配置を変えたのに古い画面が出るときは Service Worker のキャッシュ**。
`sw.js` の `CACHE` 名を上げたか確認し、開発者ツールの Application → Storage → Clear site data で消す。
⚠️ Clear site data は **localStorage の学習履歴も消す**。先にアプリの JSON エクスポートで退避する。

## GitHub Pages 公開設定

公開URL: `https://bakupu.github.io/202608_itss_l5_quiz/`

現在の設定（移行前）: ブランチ `agent/m2-supabase-sync` / フォルダ `/`
目標の設定（移行後）: ブランチ `main` / フォルダ `/docs`

手順（順序を守る。逆にすると一時的に 404 になる）:

1. 作業ブランチを `main` へマージして push する
   ⚠️ このリポジトリの remote 名は `origin` ではなく **`github`**
   ```bash
   git switch main
   git merge agent/m2-supabase-sync
   git push github main
   ```
2. GitHub の Settings → Pages → Build and deployment → Source: `Deploy from a branch`
3. Branch を `main`、フォルダを `/docs` に変更して Save
4. 数分待ってから公開URLを開き、問題が出題されることを確認する
5. スマホで開き、必要なら「ホーム画面に追加」

⚠️ 手順4で古い画面が出たら、それは公開の失敗ではなく**その端末に残った Service Worker のキャッシュ**の可能性が高い。
上の「Clear site data」の注意（学習履歴も消えるので先にエクスポート）がそのまま当てはまる。

⚠️ 手順 2〜3 の画面表記は GitHub の UI 変更で変わりうる。表記が違う場合は公式ドキュメントを真実源とする。

## 配信対象の原則

**ブラウザへ配られるのは `docs/` 配下だけ**。`tools/` `infra/` `10_memo` 〜 `90_ref` は配信されない。
逆に、配信したくないもの（メモ、鍵、作業ファイル）を `docs/` へ置かない。
