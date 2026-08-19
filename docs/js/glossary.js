/**
 * 用語辞書ビュー（一覧・検索・苦手順・概念単位の復習）。
 *
 * 役割: concepts.json の全概念を、学習状況と突き合わせて一覧する。
 *       「苦手用語ビュー」は独立した画面にせず、この一覧の並び替えとして持たせている。
 *       同じ一覧を2画面に分けると、検索と絞り込みを両方に実装することになるため。
 *
 * 依存: 概念ごとの学習状況は、その概念に属する設問の progress を集計して出す。
 *       設問側の進捗が真実源で、概念側に状態を持たせない（二重管理を避ける）。
 */

// ⚠️ docs/js/app.js の DOMAIN_LABEL と同じ内容を持つ。
//    app.js は設問の領域、こちらは概念の領域を表示するため、参照が別経路になっている。
const DOMAIN_LABEL = {
  STRATEGY: 'ストラテジ',
  ARCHITECTURE: 'アーキテクト',
  SECURITY: 'セキュリティ',
  PM: 'プロジェクト管理',
  AUDIT: 'システム監査',
};

const MAX_MASTERY = 4;

// 標準の並び順で使う領域の順序。app.js の DOMAINS と揃える。
const DOMAIN_ORDER = ['STRATEGY', 'ARCHITECTURE', 'SECURITY', 'PM', 'AUDIT'];

// 🔥 285語あるので、並びが読み込み順のままだと目で探せない。
//    領域でまとめ、その中は用語の五十音／アルファベット順にする。
//    ⚠️ ここを崩すと、検索語を思いつけない利用者に一覧を辿る手段が無くなる。
function standardOrder(a, b) {
  const da = DOMAIN_ORDER.indexOf(a.concept.domain);
  const db = DOMAIN_ORDER.indexOf(b.concept.domain);
  if (da !== db) return da - db;
  return a.concept.term.localeCompare(b.concept.term, 'ja');
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>'"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
}

/**
 * 概念ごとの学習状況を集計する。
 * mastery は「その概念の設問の平均習得Lv」。1問でも未回答なら未着手扱いにはせず、
 * 未回答を Lv0 として平均に含める（解いていない設問がある限り習得済みにしない）。
 */
export function conceptStats(concept, questions, getP) {
  const qs = questions.filter((q) => q.concept_id === concept.id);
  const stats = {
    total: qs.length,
    answered: 0,
    wrong: 0,
    starred: 0,
    mastery: 0,
    questions: qs,
  };
  if (!qs.length) return stats;
  let masterySum = 0;
  for (const q of qs) {
    const p = getP(q.id);
    if (p.attempt_count > 0) stats.answered += 1;
    stats.wrong += p.wrong_count || 0;
    if (p.starred) stats.starred += 1;
    masterySum += p.mastery_level || 0;
  }
  stats.mastery = masterySum / qs.length;
  return stats;
}

/** 苦手順の並び。誤答が多い順、次に習得が低い順、次に未回答が多い順。 */
function weakScore(stats) {
  const unanswered = stats.total - stats.answered;
  return stats.wrong * 10 + (MAX_MASTERY - stats.mastery) * 3 + unanswered * 2;
}

function matches(concept, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    concept.term,
    concept.full_name,
    concept.japanese,
    concept.meaning,
    concept.exam_tip,
    concept.note,
    ...(concept.aliases || []),
    ...(concept.related_terms || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function masteryBar(stats) {
  const pct = stats.total ? Math.round((stats.mastery / MAX_MASTERY) * 100) : 0;
  return `<div class="gl-track" title="平均習得Lv ${stats.mastery.toFixed(1)} / ${MAX_MASTERY}"><div class="gl-fill" style="width:${pct}%"></div></div>`;
}

function detail(concept, stats, concepts) {
  const related = [
    ...new Set([
      ...(concept.related || []).map((id) => concepts.get(id)?.term).filter(Boolean),
      ...(concept.related_terms || []),
    ]),
  ].filter((n) => n !== concept.term);

  const rows = [
    ['日本語', concept.japanese],
    ['意味', concept.meaning],
    ['試験ポイント', concept.exam_tip],
    ['補足', concept.note],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="ex-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');

  const chips = related.length
    ? `<div class="ex-row"><dt>関連語</dt><dd class="chips">${related
        .map((n) => `<span class="chip">${escapeHtml(n)}</span>`)
        .join('')}</dd></div>`
    : '';

  // 設問が1問も無い語（関連語として辞書に載せたもの）では、押しても何も起きないので出さない。
  const practice = stats.total
    ? `<button class="ghost gl-practice" data-concept="${escapeHtml(concept.id)}">
        この用語の問題を解く（${stats.total}問）
      </button>`
    : '<p class="muted gl-noquestion">この用語の設問はまだありません。</p>';

  return `
    <div class="gl-detail">
      <dl class="ex-rows">${rows}${chips}</dl>
      ${practice}
    </div>`;
}

function item(concept, stats, concepts, isOpen) {
  const unanswered = stats.total - stats.answered;
  const marks = [
    stats.starred ? `<span class="gl-tag star">★${stats.starred}</span>` : '',
    stats.wrong ? `<span class="gl-tag bad">誤答${stats.wrong}</span>` : '',
    unanswered ? `<span class="gl-tag">未回答${unanswered}</span>` : '',
  ].join('');

  return `
    <article class="gl-item${isOpen ? ' is-open' : ''}">
      <button class="gl-head" data-toggle="${escapeHtml(concept.id)}" aria-expanded="${isOpen}">
        <span class="gl-title">
          <strong>${escapeHtml(concept.term)}</strong>
          ${concept.full_name ? `<span class="gl-fullname">${escapeHtml(concept.full_name)}</span>` : ''}
        </span>
        <span class="gl-meta">
          <span class="gl-domain">${escapeHtml(DOMAIN_LABEL[concept.domain] || concept.domain)}</span>
          ${marks}
        </span>
        ${masteryBar(stats)}
      </button>
      ${isOpen ? detail(concept, stats, concepts) : ''}
    </article>`;
}

/**
 * 辞書一覧を描画する。
 * @param {object} opts
 * @param {HTMLElement} opts.container 描画先
 * @param {Map<string,object>} opts.concepts concept_id → 概念
 * @param {Array} opts.questions 出題データ
 * @param {(id:string)=>object} opts.getP 設問IDから進捗を取る関数
 * @param {object} opts.filters {query, domain, sort, weakOnly}
 * @param {Set<string>} opts.opened 展開中の concept_id
 * @returns {number} 表示件数
 */
export function renderGlossary({ container, concepts, questions, getP, filters, opened }) {
  const list = [...concepts.values()]
    .map((c) => ({ concept: c, stats: conceptStats(c, questions, getP) }))
    .filter(({ concept }) => filters.domain === 'ALL' || concept.domain === filters.domain)
    .filter(({ concept }) => matches(concept, filters.query))
    // 「未習得のみ」では設問の無い語を除く。設問が無い語は平均習得Lv 0 のまま動かないので、
    // 残すと未習得の一覧が「解きようのない語」で埋まってしまう。
    .filter(({ stats }) => !filters.weakOnly || (stats.total > 0 && stats.mastery < MAX_MASTERY));

  if (filters.sort === 'WEAK') {
    list.sort((a, b) => weakScore(b.stats) - weakScore(a.stats));
  } else {
    list.sort(standardOrder);
  }

  container.innerHTML = list.length
    ? list
        .map(({ concept, stats }) => item(concept, stats, concepts, opened.has(concept.id)))
        .join('')
    : '<p class="muted">条件に該当する用語がありません。</p>';

  return list.length;
}
