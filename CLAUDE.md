# ITSS L5 Study — 作業コンテキスト

ITSS レベル5相当（ITストラテジスト / システムアーキテクト / 情報処理安全確保支援士）の午前対策を、
戦略・アーキテクチャ・セキュリティの3領域に絞って自習するための PWA。
**本業の傍らで低負荷に回すことを最優先**とし、サーバ運用もビルドも持たない。
GitHub Pages の静的配信 + ブラウザの localStorage だけで成立する構成を維持する。

- 公開URL: https://bakupu.github.io/202608_itss_l5_quiz/
- リポジトリ: `bakupu/202608_itss_l5_quiz`

## 現在地と次アクション

- 現在フェーズ: **M3 完了（ステップ1: 解説拡充と永久ID移行 / ステップ2: 用語辞書ビュー）→ 問題追加が次**
  - M2 で実装済み: 81問（36概念×2方向 + シナリオ9）、領域・形式・復習条件フィルタ、習得Lv・復習予定、ダッシュボード、PWA、Supabase同期コード（未設定＝無効）
  - 2026-08-19: ディレクトリ構造を移行（配信物を `docs/` へ集約）。`docs/` を Prettier で全面整形
  - 2026-08-19: M3ステップ1 完了。用語辞書 `concepts.json`（36概念）を分離し、
    4選択肢すべてに「用語 / 英語正式名称 / 日本語 / 意味 / 試験ポイント / この設問での扱い / 関連語」を表示。
    問題IDを永久ID（`security.oauth2.term_to_meaning.001` 形式）へ移行し、履歴を v3 へ変換
  - 2026-08-19: M3ステップ2 完了。用語辞書ビュー（検索・領域絞り込み・苦手順・未習得のみ・概念単位の出題）を追加
- 次アクション:
  - [ ] 🔥 GitHub Pages の設定変更（👤 本人操作が必要）
    - 公開元を `agent/m2-supabase-sync` ブランチ `/` → **`main` ブランチ `/docs`** へ変更
    - 変更前に `main` へマージすること。順序を誤ると一時的に 404 になる
  - [ ] 👤 公開URLで実機確認。⚠️ **反映前にアプリのJSONエクスポートで履歴を退避**しておく
  - [ ] 概念と問題を増やす（M3で作った辞書の上に積む）→ 新しい計画を `30_plan/` へ起こす
  - [ ] 36概念の説明品質レビュー（試験ポイントを出題語で書き直す）→ `30_plan/10-overview_M3実装計画.md`
- 保留中: Supabase 同期（コードは存在するが `docs/js/supabase-config.js` の `url` / `anonKey` が空で無効）
  - 解除条件: **PCとスマホの2端末で同一の学習履歴を使いたくなったとき**。それまではローカル保存のみで運用する

## ディレクトリ構造

標準ディレクトリは**リポジトリルート直下**に置く。

```
README.md              プロジェクトの入口
CLAUDE.md              このファイル（作業コンテキスト・真実源）
docs/                  ★GitHub Pages の配信ルート。ここだけがブラウザへ配られる
  index.html  styles.css  manifest.webmanifest  sw.js
  js/         app.js  sync.js  supabase-config.js
              content.js（読み込みと履歴移行）  explain.js（解説描画）
              glossary.js（用語辞書ビュー）
  data/       concepts.json      用語辞書。★解説を直すときはここ
              questions-v3.json  設問。説明は concept_id 参照
              legacy-id-map.json 旧IDから永久IDへの対応表
              questions.json     M2の確定データ。生成の入力であり配信はしない
tools/                 生成・検証スクリプト（道具＝コード）
infra/                 Supabase スキーマ等の基盤定義
10_memo/ 20_adr/ 30_plan/ 40_spec/ 50_workflow/ 90_ref/
package.json           開発ツールのみ（Prettier / Playwright）。配信物はビルドしない
```

よく使うコマンド（詳細は `50_workflow/`）:

- `npm run build` — `concepts.json` から `questions-v3.json` と対応表を生成
- `npm test` — 履歴移行テスト（14件）と辞書機能テスト（12件）。🔥 `content.js` を触ったら必ず通す
- `npm run shoot -- <ラベル>` — スマホ幅・PC幅で主要画面を撮影
- `npm run format` — Prettier で `docs/` と `tools/` を整形

⚠️ **`docs/` はドキュメント置き場ではない。配信サイト本体である。**
GitHub Pages のブランチ配信で選べるフォルダが `/` か `/docs` のみという制約による命名で、
文書は `10_memo`〜`90_ref` に置く。この2つを混同すると配信物に文書が混ざる。

### `docs/` を触るときの制約

- 参照はすべて**相対パス**。`docs/` ごと移動しても壊れない状態を保つ
- `fetch()` の相対パスは**モジュールではなく `index.html` の位置**を基準に解決される（`data/questions-v3.json`）
- 🔥 **`docs/` 配下のファイル配置を変えたら `sw.js` の `CACHE` 名を必ず上げる**（現在 `itss-l5-v5`）。
  上げないと Service Worker が旧パスを配り続け、オフライン時に壊れる
- `docs/js/supabase-config.js` に `service_role` キーを置かない。ブラウザへ配られる

## カテゴリ定義（全ディレクトリ共通）

| CC | カテゴリ | 対象 |
|----|----------|------|
| `10` | `overview` | プロジェクト全体の基盤（構造、方針、横断的な検討、引き継ぎ） |
| `20` | `content` | 学習コンテンツ（概念の選定、設問、解説、出典方針） |
| `30` | `app` | アプリ実装（UI、出題ロジック、PWA、オフライン） |
| `40` | `data` | データモデル（ID体系、履歴、localStorage、マイグレーション） |
| `50` | `ops` | 公開・運用（GitHub Pages、Supabase、ローカル確認） |

カテゴリの追加は 10 刻みで行う。

### ファイル命名ルール

ファイル名は **prefix（拡張子より前）** と **拡張子** を別レイヤで判定する。
category と内容の区切りは **`_`（アンダースコア）** に統一する。

#### 新規ファイル名の付け方（canonical パターン）

- `NNNN` = 4桁の通し連番（そのディレクトリ内で時系列に増やす）
- `CC` = 上表のカテゴリ番号2桁

| ディレクトリ | パターン | ソート優先 |
|------------|---------|-----------|
| `10_memo` | `NNNN-CC-category_内容` | 時系列 |
| `20_adr` | `NNNN-CC-category_内容` | 時系列 |
| `30_plan` | `CC-category_内容` | カテゴリ |
| `40_spec` | `CC-category_内容` | カテゴリ |
| `50_workflow` | `CC-category_内容` | カテゴリ |
| `90_ref` | `CC-category_内容` | カテゴリ |

例: `20_adr/0001-10-overview_ディレクトリ構造とPages配信方式.md`

#### 上記に従わなくてよい特例ファイル名（prefix allowlist）

- `README.md`（任意。必須ではない。そこにしか無い判断基準があるときだけ置く）
- `_template.md`

#### 置いてよい拡張子（拡張子 trusted set）

- 全ディレクトリ共通: `md`, `html`
- `50_workflow` の追加: `sh`, `ps1`

⚠️ `docs/` `tools/` `infra/` は canonical 命名・拡張子チェックの**対象外**（実行系のため）。

### クロスリファレンス

前提となる別文書があるときは冒頭にリンクを1行で書く。開かなくても何の文書か分かる形にする。

形式: `ディレクトリ略称-NNNN-CC-category_先頭数文字`（Markdown の相対リンクにする）

ディレクトリ略称: `10_memo`→`memo` / `20_adr`→`adr` / `30_plan`→`plan` / `40_spec`→`spec` / `50_workflow`→`workflow` / `90_ref`→`ref`

例: `前提: [spec-40-data_M3コンテンツモデル](40_spec/40-data_M3コンテンツモデルと互換性.md)`

## 変更してはいけないこと（履歴保護）

学習履歴は localStorage にしか無く、失うと復元できない。

- `itss-l5-study-state-v2` / `v1` を削除・上書きしない（M3 では v3 を新設し、v2/v1 は残す）
- 問題データを並べ替えて旧IDを再採番しない。`state.progress` のキーと `attempt.question_id` が参照キー
- 問題の**改訂**（`revision` を上げる）と**別問題化**（新ID採番）を区別する。詳細は `40_spec/40-data_M3コンテンツモデルと互換性.md`
