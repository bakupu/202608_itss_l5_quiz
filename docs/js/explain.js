/**
 * 回答後の解説描画。
 *
 * 方針: 正解・不正解にかかわらず、ア〜エすべてを同じ密度で説明する。
 *       「別概念です」で済ませると、誤答選択肢が何なのかを学べない。
 * データ: 概念そのものの説明は concepts.json（用語辞書）が持ち、
 *         「この設問で適切／不適切な理由」だけが設問側（choice_reasons）にある。
 *         同じ用語の説明を設問ごとに複製しないための分担なので、ここで文言を足さない。
 */

import { escapeHtml, formatText, CHOICE_MARKS } from './text.js';

function row(label, value) {
  if (!value) return '';
  return `<div class="ex-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function relatedRow(concept, concepts) {
  // related（辞書内の概念）と related_terms（辞書外の語）は同じ語を重複して持ちうるため、
  // 表示時に一意化する。データ側の重複を直しても、他の概念で再発するので描画側で吸収する。
  const names = [
    ...new Set([
      ...(concept.related || []).map((id) => concepts.get(id)?.term).filter(Boolean),
      ...(concept.related_terms || []),
    ]),
  ].filter((n) => n !== concept.term);
  if (!names.length) return '';
  const chips = names.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join('');
  return `<div class="ex-row"><dt>関連語</dt><dd class="chips">${chips}</dd></div>`;
}

function badges(index, correctIndex, chosenIndex) {
  const out = [];
  if (index === correctIndex) out.push('<span class="ex-badge good">正解</span>');
  if (index === chosenIndex) out.push('<span class="ex-badge chosen">あなたの回答</span>');
  return out.join('');
}

function card(question, index, concepts, chosenIndex, focusOnly) {
  const conceptId = question.choice_concept_ids?.[index];
  const concept = conceptId ? concepts.get(conceptId) : null;
  const isCorrect = index === question.correct_choice;
  const reason = question.choice_reasons?.[index] || '';

  // 用語の見出し。略語なら英語正式名称を併記する（RTO → Recovery Time Objective）。
  const heading = concept
    ? `<div class="ex-term"><strong>${escapeHtml(concept.term)}</strong>${
        concept.full_name ? `<span class="ex-fullname">${escapeHtml(concept.full_name)}</span>` : ''
      }</div>`
    : '';

  // 用語カードが付く選択肢では「この設問での扱い」（用語一般の説明との差分）、
  // 用語が無い選択肢（過去問の文章選択肢）では単に「解説」と呼ぶ。
  // 見出しが指すものが違うので、同じ語を使うと用語の説明だと誤読される。
  const body = concept
    ? heading +
      '<dl class="ex-rows">' +
      row('日本語', concept.japanese) +
      row('意味', concept.meaning) +
      row('試験ポイント', concept.exam_tip) +
      row('この設問での扱い', reason) +
      row('補足', concept.note) +
      relatedRow(concept, concepts) +
      '</dl>'
    : reason
      ? `<dl class="ex-rows">${row('解説', reason)}</dl>`
      : // 解説が未執筆の設問。空の枠を出すと「解説が壊れている」ように見えるので、
        // 正解／自分の回答の印だけを出す。
        '';

  const head = `<header class="ex-head">
        <span class="ex-mark">${CHOICE_MARKS[index]}</span>
        <p class="ex-choice exam-text">${formatText(question.choices[index])}</p>
      </header>
      <div class="ex-badges">${badges(index, question.correct_choice, chosenIndex)}</div>`;

  // 「自分の回答と正解だけ開く」設定のときだけ、それ以外を畳む。
  // ⚠️ 既定は全開のまま。誤答選択肢が何の説明なのかを読ませるのがこの画面の目的で、
  //    畳むのはスクロールを短くしたい人のための選択肢にすぎない。
  const collapsed = focusOnly && !isCorrect && index !== chosenIndex && body;
  if (collapsed) {
    return `
    <details class="ex-card">
      <summary>${head}</summary>
      ${body}
    </details>`;
  }
  return `
    <section class="ex-card${isCorrect ? ' is-correct' : ''}">
      ${head}
      ${body}
    </section>`;
}

/**
 * 設問の主題となる用語のカード。
 *
 * 過去問は選択肢が文章なので、選択肢ごとの用語解説が付かない。
 * そこで「この設問が何を問うているか」を1枚だけ先頭に出す。
 * ⚠️ 自作問では主題の用語が選択肢の中に必ず現れるため、出すと同じ説明が2度並ぶ。
 *    選択肢が1つも用語へ解決できなかったときだけ出す。
 */
function subjectCard(question, concepts) {
  const concept = question.concept_id ? concepts.get(question.concept_id) : null;
  if (!concept) return '';
  if (question.choice_concept_ids?.some(Boolean)) return '';

  return `
    <section class="ex-card is-subject">
      <div class="ex-badges"><span class="ex-badge subject">この設問の主題</span></div>
      <div class="ex-term"><strong>${escapeHtml(concept.term)}</strong>${
        concept.full_name ? `<span class="ex-fullname">${escapeHtml(concept.full_name)}</span>` : ''
      }</div>
      <dl class="ex-rows">
        ${row('日本語', concept.japanese)}
        ${row('意味', concept.meaning)}
        ${row('試験ポイント', concept.exam_tip)}
        ${row('補足', concept.note)}
        ${relatedRow(concept, concepts)}
      </dl>
    </section>`;
}

/**
 * 解説カードを描画する。
 * @param {HTMLElement} container 描画先
 * @param {object} question questions-v3.json の1件
 * @param {number} chosenIndex 利用者が選んだ選択肢（未回答なら -1）
 * @param {Map<string,object>} concepts concept_id → 概念
 * @param {{focusOnly?: boolean}} [opts] focusOnly=true で、自分の回答と正解以外を畳む
 */
export function renderExplanation(container, question, chosenIndex, concepts, opts = {}) {
  container.innerHTML =
    subjectCard(question, concepts) +
    question.choices
      .map((_, i) => card(question, i, concepts, chosenIndex, Boolean(opts.focusOnly)))
      .join('');
}
