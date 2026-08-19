# ITSS L5 Quiz — VS Code / Codex 申し送り事項

> ⚠️ **この文書は 2026-08-19 のディレクトリ移行より前に書かれた記録である。** 当時の状況を残すために本文は書き換えていない。
> 次の3点は現在の実態と異なるので、そのまま実行しないこと。
>
> - 「14. ファイル構成（現行M2）」のフラットな構成 → 現在は `docs/` `tools/` `infra/` に分かれている。現構造は [CLAUDE.md](../CLAUDE.md)
> - 「同梱の `M3_SPEC.md`」→ [40_spec/40-data_M3コンテンツモデルと互換性.md](../40_spec/40-data_M3コンテンツモデルと互換性.md) に改名・移動済み
> - 「12. 着手順」の `sw.js` の CACHE 名を **v3 へ**という指示 → 移行時にすでに v3 済み。M3 では v4 へ上げる。実行手順は [30_plan/10-overview_M3実装計画.md](../30_plan/10-overview_M3実装計画.md) が最新

作成日: 2026-08-19
対象リポジトリ: `bakupu/202608_itss_l5_quiz`
GitHub Pages: `https://bakupu.github.io/202608_itss_l5_quiz/`

## 1. 現在地

- M2まで実装済み。
- GitHub Pagesで公開済み。
- GitHub Pagesの公開元は `agent/m2-supabase-sync` ブランチの `/`。
- `main` と `agent/m2-supabase-sync` は会話中の確認時点では同一コミット `7928dedbf250bea34818d9ba256448b6c6f56083` を指していた。
- Supabase同期機能はコード実装済みだが、`supabase-config.js` の `url` / `anonKey` は空。したがって現状は localStorage のみで実用運用可能。
- Supabase連携は低優先度。まずはローカル保存版の問題・解説品質向上を優先する。

## 2. 現行機能

- 今日の3問
- 任意問題数のセッション
- 領域絞り込み: STRATEGY / ARCHITECTURE / SECURITY
- 問題形式絞り込み:
  - TERM_TO_MEANING
  - MEANING_TO_TERM
  - SCENARIO
- 復習対象:
  - 誤答歴あり
  - ★重点
  - 要復習
  - 未習得
  - 未回答
- 学習履歴 localStorage 保存
- ★、誤答数、正答数、連続正解、習得Lv、復習予定、回答履歴
- ダッシュボード
- PWA / Service Worker
- Supabase同期コード（任意）

## 3. 問題数・内容

現行問題数は **81問**。

内訳:
- 36概念 × 2方向問題 = 72問
- シナリオ問題 = 9問
- 合計 = 81問

36概念は以下の3領域に12概念ずつ。

### STRATEGY
SWOT分析, PEST分析, ファイブフォース分析, バリューチェーン, PPM, BSC, KGI, KPI, ROI, NPV, TCO, TOGAF

### ARCHITECTURE
非機能要件, 可用性, スケーラビリティ, 疎結合, CQRS, イベントソーシング, Sagaパターン, Circuit Breaker, キャッシュアサイド, 冪等性, RTO, RPO

### SECURITY
ゼロトラスト, 最小権限, 職務分離, 多要素認証, PKI, OCSP, OAuth 2.0, OpenID Connect, CSRF, SSRF, SIEM, CVSS

現在の問題はすべて `source_type: ORIGINAL`。IPA過去問本文を収録したものではない。
`make_questions.py` の種データから問題を生成している。

## 4. 最優先の次改修 = M3

ユーザー要望:

1. 回答解説を大幅に詳しくする。
2. キーワードについて以下を説明する。
   - 略語
   - 英語の正式名称
   - 日本語名称
   - 意味
   - 試験でのポイント
   - 関連語
3. 正解以外の3選択肢も、正解と区別せず丁寧に説明する。
4. 問題追加・改善時にも、既存の★・誤答履歴を壊さない。
5. 将来数百〜1,200問程度へ拡張しやすいモデルにする。

詳細仕様は同梱の `M3_SPEC.md` を参照。

## 5. M3で採用するデータモデル

問題データと用語辞書を分離する。

### concepts.json
概念の正規化辞書。
例:

```json
{
  "id": "security.oauth2",
  "term": "OAuth 2.0",
  "full_name": "OAuth 2.0 Authorization Framework",
  "japanese": "認可フレームワーク",
  "meaning": "...",
  "exam_tip": "認証ではなく認可が中心...",
  "related_concepts": ["security.oidc"]
}
```

### questions-v3.json
問題固有情報。

```json
{
  "id": "security.oauth2.term_to_meaning.001",
  "concept_id": "security.oauth2",
  "revision": 1,
  "is_active": true,
  "source_type": "ORIGINAL",
  "domain": "SECURITY",
  "question_type": "TERM_TO_MEANING",
  "stem": "...",
  "choices": ["..."],
  "choice_concept_ids": ["..."],
  "correct_choice": 1,
  "choice_reasons": ["..."],
  "difficulty": 2,
  "tags": []
}
```

### legacy-id-map.json
M2の81問の旧IDを永久IDへ変換するためのマップ。

例:

```json
{
  "sec-tm-07": "security.oauth2.term_to_meaning.001",
  "sec-mt-07": "security.oauth2.meaning_to_term.001"
}
```

## 6. IDポリシー

重要。履歴互換性の核。

- `concept_id`: 永久ID。並び順や表示名変更で変えない。
- `question.id`: 永久ID。
- 問題文・解説・誤字などの改善ではIDを変更しない。`revision` を上げる。
- 正解条件や問題の意味が変わる変更は新IDを採番する。
- 問題廃止時は削除せず `is_active:false` にする。
- `state.progress[question_id]` と `attempt.question_id` が履歴の参照キー。

現行M2のIDは `str-tm-01` 等の連番で、並び変更に弱い。81問のうちにM3へ移行する。

## 7. localStorage互換マイグレーション

現行キー:

- `itss-l5-study-state-v2`
- legacy: `itss-l5-study-state-v1`

M3では推奨:

- 新キー `itss-l5-study-state-v3`
- 初回起動時にv2/v1を読む
- `legacy-id-map.json` を用いて以下を変換
  - `state.progress` のキー
  - `state.attempts[].question_id`
- 変換後をv3へ保存
- v2/v1は削除しない（ロールバック用）

特に★、誤答履歴、mastery_level、recovery_countを失わないこと。

## 8. 解説UI仕様

回答後、A〜Dすべてについて同等の密度で表示する。

各選択肢カード:

- A/B/C/D + 選択肢本文
- 正解かどうか（色等のUIは可）
- 用語
- 略語の場合の正式英語名
- 日本語名
- 意味
- 試験ポイント
- この問題で適切/不適切な理由
- 関連語

例: RTO

- RTO
- Recovery Time Objective
- 目標復旧時間
- 障害発生後、何時間以内に業務/サービスを復旧させるかの目標
- RPOとの違いを問われやすい
- 関連: RPO, BCP, DR

正答だけ詳しくして、誤答を「別概念です」で済ませないこと。

## 9. 問題仕入れ方針

現状:
- AIが選定した代表概念 + オリジナル問題
- IPA過去問本文の収集ではない

今後の推奨:

1. IPAの公開シラバス・試験要綱を基準に対象概念を抽出
2. 実際のITストラテジスト / システムアーキテクト / 情報処理安全確保支援士の午前I/II過去問を分析
3. 過去問の「本文複製」ではなく、出題された概念・論点・ひっかけパターンを正規化
4. concepts.jsonに概念を追加
5. ORIGINAL問題を複数方向で生成
6. `source_refs` に根拠メタデータを持てるようにする

ターゲットは「戦略・アーキ・セキュリティ寄り」。DB/NW/PMなど午前I一般論を全面網羅する目的ではない。

## 10. 将来規模

- 300問: 最初の実用拡張
- 500〜700問: 過去問論点ベースを厚くした段階
- 800〜1,200問: 十分な本格版

この程度なら GitHub Pages + JSON + localStorage で問題なし。
数千問になったら、JSON分割 / IndexedDB / 検索インデックスを検討。

## 11. Supabase

M2コードに存在するが低優先。

`supabase-config.js`:

```js
export const SUPABASE_CONFIG = {
  url: '',
  anonKey: ''
};
```

この状態ではローカル保存で動作する。

将来同期を有効化する場合:
- Supabase Project URL
- browser用 publishable / anon key
- `supabase_m2.sql`

`service_role` をフロントエンドへ置かないこと。

## 12. Codexへの推奨着手順

1. 現行M2をそのまま起動し、81問・localStorage保存を確認
2. M3用ブランチを作る
3. 現行 `questions.json` / `make_questions.py` から永久IDマッピングを作る
4. `concepts.json`, `questions-v3.json`, `legacy-id-map.json` を追加
5. app.jsへv2→v3マイグレーションを実装
6. app.jsの解説レンダリングをconcepts参照方式へ変更
7. styles.cssで4選択肢の詳細カードUIを追加
8. sw.jsのCACHE名をv3へ更新し、新JSONをキャッシュ対象へ追加
9. 旧localStorageデータを作ってマイグレーションテスト
10. 新規ユーザーの空状態もテスト
11. GitHub Pagesでスマホ動作確認
12. 36概念の説明品質をレビュー・改善
13. その後、概念数と問題数を増やす

## 13. 注意点

- PWAのService Workerが古いJS/JSONをキャッシュしやすい。M3では必ずCACHE名を変更する。
- `questions.json` を単純に並べ替えて旧IDを再生成しないこと。
- localStorageのv2を削除しないこと。
- 既存★/誤答履歴を手動で消さないこと。
- 問題の改訂と別問題化を区別すること。
- 解説は正誤判定だけでなく、「なぜ他の選択肢が何なのか」を学習できることを重視する。

## 14. ファイル構成（現行M2）

- `index.html`
- `styles.css`
- `app.js`
- `sync.js`
- `supabase-config.js`
- `supabase_m2.sql`
- `questions.json`
- `make_questions.py`
- `manifest.webmanifest`
- `sw.js`
- `README.md`

M3追加予定:

- `concepts.json`
- `questions-v3.json`
- `legacy-id-map.json`
- 必要に応じて `scripts/` 配下へ生成・検証スクリプト

