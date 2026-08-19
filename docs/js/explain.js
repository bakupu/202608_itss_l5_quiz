/**
 * 回答後の解説描画。
 *
 * 方針: 正解・不正解にかかわらず、A〜Dすべてを同じ密度で説明する。
 *       「別概念です」で済ませると、誤答選択肢が何なのかを学べない。
 * データ: 概念そのものの説明は concepts.json（用語辞書）が持ち、
 *         「この設問で適切／不適切な理由」だけが設問側（choice_reasons）にある。
 *         同じ用語の説明を設問ごとに複製しないための分担なので、ここで文言を足さない。
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function escapeHtml(s) {
  return String(s).replace(
    /[&<>'"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
}

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

function card(question, index, concepts, chosenIndex) {
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
    : `<dl class="ex-rows">${row('この設問での扱い', reason)}</dl>`;

  return `
    <section class="ex-card${isCorrect ? ' is-correct' : ''}">
      <header class="ex-head">
        <span class="ex-mark">${LETTERS[index]}</span>
        <p class="ex-choice">${escapeHtml(question.choices[index])}</p>
      </header>
      <div class="ex-badges">${badges(index, question.correct_choice, chosenIndex)}</div>
      ${body}
    </section>`;
}

/**
 * 解説カードを描画する。
 * @param {HTMLElement} container 描画先
 * @param {object} question questions-v3.json の1件
 * @param {number} chosenIndex 利用者が選んだ選択肢（未回答なら -1）
 * @param {Map<string,object>} concepts concept_id → 概念
 */
export function renderExplanation(container, question, chosenIndex, concepts) {
  container.innerHTML = question.choices
    .map((_, i) => card(question, i, concepts, chosenIndex))
    .join('');
}
