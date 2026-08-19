# 問題データの生成

検証ステータス: 2026-08-19 に Python 3.13.7 で実行して確認済み（自作81問 + 過去問300問 = 381問）。

過去問の側の手順は分けてある → [IPA過去問の取り込み](20-content_IPA過去問の取り込み.md)

## いま使うのはどちらか

配信されるのは **`questions-v3.json`**（永久ID・概念参照つき）で、アプリが読むのもこちら。

```bash
npm run build      # = python tools/build_content.py
```

次の2つを1本にまとめて `questions-v3.json` と `legacy-id-map.json` を生成する。

- `questions.json`（M2の確定データ）＋ `concepts.json`（用語辞書）→ 自作81問
- `content/exams/*.json`（転記・検算済みのIPA過去問）＋ `content/past-concepts.json`（主題の用語の対応表）
  → 出典つきの過去問300問

### 直すときにどこを触るか

- **解説の文言を直したいときは `docs/data/concepts.json` を直す。** 用語の説明は辞書側にあり、
  1か所直せば全設問の解説へ反映される。設問側にあるのは「この設問で適切／不適切な理由」だけ
- シナリオ問題が主題とする概念は `tools/build_content.py` の `SCENARIO_CONCEPT` で明示している。
  シナリオ問題を足したらここへ1行足す（自動判定できない）
- 過去問に主題の用語を結び付けるのは `content/past-concepts.json`。**ここに無い過去問があると
  `npm run build` が止まる**（黙って解説の無い問が混ざらないようにするため）
- 🔥 **既存81問は再生成せず変換している。** M2の選択肢は `random.sample` で選ばれたもので、
  再生成すると別の問題になり、問題IDに紐づいた学習履歴の意味が壊れる

生成後は `npm test`（履歴移行テスト）と `npm run shoot`（画面撮影）で確かめる
→ [画面撮影と自動テスト](30-app_画面撮影と自動テスト.md)

## M2の元データを作り直す（通常は不要）

以下は M2 の `questions.json` を種データから作り直す手順。
M3以降は `concepts.json` が用語の真実源なので、**通常この手順は使わない**。
81問の元データを再現する必要が生じたときだけ使う。

### 実行

**リポジトリのルートで実行する。**

```bash
python tools/make_questions.py
```

- 依存パッケージは無い（標準ライブラリのみ）
- 出力先はスクリプト自身の位置を基準に決まるため、**カレントディレクトリに依存しない**。別の場所から実行したい場合はスクリプトへのパスだけ読み替える
- 出力: `docs/data/questions.json`（**既存を無条件で上書きする**）
- 標準出力に「出力先の絶対パス」と「件数（現在 81）」の2行が出る

## 検証

生成は決定的（`random.seed(42)`、改行 LF 固定）なので、**種データを変えていなければ差分はゼロになる**。

```bash
python tools/make_questions.py
git diff --stat docs/data/questions.json
```

差分が出たら、種データを変えた覚えがあるかを確認する。覚えが無いのに差分が出る場合は
Python のバージョン差や改行の扱いを疑う。

⚠️ 生成後は必ず[ローカル起動](50-ops_ローカル確認とPages公開.md)して**出題と件数を目視確認**する。
JSON が壊れていても Service Worker のキャッシュで一見動いてしまうことがある。

## 変更してはいけないこと

🔥 **問題を並べ替えて旧IDを再生成しない。** `str-tm-01` 等の ID は localStorage の学習履歴
（`state.progress` のキーと `attempt.question_id`）の参照キーであり、ずれると ★ と誤答履歴が失われる。
M3 では永久ID体系へ移行する → `40_spec/40-data_M3コンテンツモデルと互換性.md`
