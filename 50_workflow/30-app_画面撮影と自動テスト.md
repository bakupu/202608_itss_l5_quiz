# 画面撮影と自動テスト

検証ステータス: 2026-08-19 に実行して確認済み（Node 24.8.0 / Playwright 1.62.1 / Chromium）。

前提: 初回のみ `npm install` と `npx playwright install chromium` が必要。

## 自動テスト（変更前に必ず通す）

```bash
npm test
```

Chromium を起動して実際の画面を操作する。終了コード 0 が全件成功。

- **履歴移行テスト**（`tools/test_migration.mjs`）: 旧形式（`itss-l5-study-state-v2`）の履歴を仕込んで起動し、
  永久ID（`security.oauth2.term_to_meaning.001` 形式の、問題を改訂しても変えないID）へ
  張り替えられたか、★・誤答数・習得Lv・日次実績が保持されたか、
  **旧データが削除されずに残っているか**を検証する
- **辞書機能テスト**（`tools/test_glossary.mjs`）: 一覧件数、検索（意味・英語正式名称・関連語）、
  領域絞り込み、苦手順の先頭、展開状態の保持、概念単位の出題数を検証する

🔥 **`docs/js/` を触ったら必ず実行する。** とくに `content.js`（学習コンテンツの読み込みと履歴移行）。
学習履歴は localStorage にしか無く、壊すと復元できない。
「動いたから大丈夫」では、履歴が静かに欠けたことに気づけない。

⚠️ 辞書機能テストは `app.js` と `glossary.js` の挙動も見ている。
`content.js` 以外を触ったときも発火させること。

## 画面撮影（変更前後の比較・目視確認）

```bash
npm run shoot -- <ラベル>      # 例: npm run shoot -- m3
```

`<ラベル>` は任意の文字列で、出力先ディレクトリ名になる。

- 出力: `60_shots/<ラベル>/<画面名>-<mobile|desktop>.png`（`60_shots/` は `.gitignore` 対象。コミットされない）
- ビューポートは 390×844（スマホ幅）と 1280×900（PC幅）の2種類、主要5画面
  - ⚠️ **PNGの寸法はこの値ではない。** `deviceScaleFactor: 2` かつ `fullPage` なので、
    横は2倍、縦はページ全長になる
- JSエラーが出た場合は、**幅ごとに撮影が終わった時点で**標準エラーへ一覧が出る（最大2回）
- ポートが衝突する場合は `PORT` 環境変数で変える（既定 8931）

### 変更前後を比べる

出題は `Math.random()` で選ばれるため、撮影スクリプトは**撮影中だけ固定シードの疑似乱数へ差し替える**。
これをしないと毎回違う問題が写り、比較が成立しない。

旧版と比べるときは、Git から取り出したものを `DOCS_DIR` で指定する。

```bash
mkdir -p /tmp/old                      # tar は展開先を作らない。無いと失敗する
git archive HEAD docs | tar -x -C /tmp/old
DOCS_DIR=/tmp/old/docs npm run shoot -- before
npm run shoot -- after
diff -r 60_shots/before 60_shots/after # 差分が出なければ見た目は変わっていない
```

同じ内容なら PNG はバイト単位で一致する。整形やリファクタで「見た目を変えていない」ことは、
目視ではなくこの一致で示す。

旧版に無い画面（あとから足したUI）は操作できないので、その画面だけ飛ばして
`⚠️ … 撮影を飛ばした` と標準エラーへ出す。**飛ばした画面は `diff` で「片方にしか無い」と出る**ので、
それが新規追加によるものか、撮影が壊れたのかは標準エラーの警告と突き合わせて判断する。

⚠️ `fullPage` 撮影では `position:fixed` の下部ナビがページ中央に写り込むため、
撮影時だけ `position:static` へ落としている。実機の見え方ではないので、そこだけは撮影結果で判断しない。

## コード整形（Prettier）

```bash
npm run format
```

`.prettierrc` の設定で、`docs/index.html` / `docs/styles.css` / `docs/js/*.js` / `tools/*.mjs` を整形する。

⚠️ **`docs/sw.js`・`docs/manifest.webmanifest`・`tools/*.py` は対象外。**
「`docs/` を整形する」と読むと、これらも整形済みだと誤認する。

整形は描画を変えないはずなので、疑わしいときは上の撮影比較で確かめる。
