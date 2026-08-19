/**
 * 過去問の出典・改変の旨・図表の文章化の表示。
 *
 * 🔥 これは装飾ではなく、IPA が公表している過去問題を使うための条件そのものである。
 *    条件（2026-08-19 時点でIPAサイトを確認）:
 *      1. 出典を明記する（年度・期・試験区分・時間区分・問番号）
 *      2. 問題を改変した場合はその旨も明記する
 *      3. 著作権はIPAが放棄していない
 *    ⚠️ この表示を消す・畳んで見えなくすると、利用条件を満たさなくなる。
 *       「見た目がうるさい」を理由に隠さない。畳んでよいのは figure_text（原本の図表の文章化）だけで、
 *       出典と改変の旨は常に開いた状態で出す。
 *
 * データの出どころ: docs/data/questions-v3.json の source_refs / modification_label /
 *                   modification_note / figure_text。tools/build_content.py が付与する。
 */

import { escapeHtml, formatText } from './text.js';

/**
 * 出典まわりのHTMLを返す。過去問でなければ空文字。
 * @param {object} q questions-v3.json の1件
 * @returns {string} innerHTML へ入れる文字列
 */
export function sourceHtml(q) {
  const ref = q.source_refs;
  if (!ref) return '';

  const parts = [
    `<p class="src-line"><span class="src-tag">出典</span>${escapeHtml(ref.label)}（${escapeHtml(ref.publisher)}）</p>`,
  ];

  if (q.modification_label) {
    const note = q.modification_note
      ? `<br /><small>${escapeHtml(q.modification_note)}</small>`
      : '';
    parts.push(
      `<p class="src-mod"><span class="src-tag warn">改変あり</span>${escapeHtml(q.modification_label)}${note}</p>`,
    );
  }

  if (q.figure_text) {
    // 🔥 既定で開く。問題文が「図のとおり」と書いていて図が畳まれていると、その設問は解けない
    //    （実測: 令和6年度秋期PM問5はアローダイアグラムが無いと日数を出せない）。
    //    畳めるのは、読み終えた図を邪魔にせず選択肢へ進めるようにするためであって、
    //    既定で隠すためではない。
    parts.push(
      `<details class="src-figure" open><summary>原本の図表を文にしたもの</summary><div>${formatText(q.figure_text)}</div></details>`,
    );
  }

  parts.push('<p class="src-foot">問題の著作権はIPAに帰属します。</p>');
  return `<div class="src-note">${parts.join('')}</div>`;
}
