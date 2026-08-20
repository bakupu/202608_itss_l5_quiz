import { SyncManager } from './sync.js';
import { loadContent, loadStateV3, blankState, STORAGE_KEY_V3 } from './content.js';
import { renderExplanation } from './explain.js';
import { renderGlossary } from './glossary.js';
import { formatText, CHOICE_MARKS } from './text.js';
import { sourceHtml } from './source.js';
import { initSettings, getSetting } from './settings.js';

const STORAGE_KEY = STORAGE_KEY_V3;
const DAY = 86400000;
let questions = [];
let state = blankState();
let concepts = new Map();
const glossaryFilters = { query: '', domain: 'ALL', sort: 'STANDARD', weakOnly: false };
const glossaryOpened = new Set();
let session = null;
let installPrompt = null;
let syncManager = null;

const $ = (id) => document.getElementById(id);
const views = [...document.querySelectorAll('.view')];

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function isoDay(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function defaultP() {
  return {
    starred: false,
    star_updated_at: null,
    attempt_count: 0,
    correct_count: 0,
    wrong_count: 0,
    correct_streak: 0,
    mastery_level: 0,
    recovery_count: 0,
    last_answered_at: null,
    last_wrong_at: null,
    next_review_at: null,
    correct_days: [],
    served_at: [], // 直近7日にこの問題を出した時刻。出題の重みを半減させるために使う
  };
}
function getP(id) {
  return state.progress[id] || defaultP();
}
function setP(id, p, { sync = true } = {}) {
  state.progress[id] = p;
  saveState();
  if (sync) syncManager?.scheduleSync();
}
// 領域の並びと表示名。⚠️ index.html の domainSelect の並びと揃えること。
// PM・AUDIT はIPA過去問の取り込みで増えた領域で、自作の用語辞書はまだ3領域しか持たない。
const DOMAINS = ['STRATEGY', 'ARCHITECTURE', 'SECURITY', 'PM', 'AUDIT'];
const DOMAIN_LABEL = {
  STRATEGY: 'ストラテジ',
  ARCHITECTURE: 'アーキテクト',
  SECURITY: 'セキュリティ',
  PM: 'プロジェクト管理',
  AUDIT: 'システム監査',
};
function domainLabel(d) {
  return DOMAIN_LABEL[d] || d;
}
function typeLabel(t) {
  return (
    {
      TERM_TO_MEANING: '用語 → 意味',
      MEANING_TO_TERM: '意味 → 用語',
      SCENARIO: '午前問題型',
      PAST: 'IPA過去問',
    }[t] || t
  );
}

function masteryAfterAt(p, correct, at) {
  const now = at instanceof Date ? at : new Date(at);
  const today = isoDay(now);
  const days = [...new Set([...(p.correct_days || []), ...(correct ? [today] : [])])];
  let level = p.mastery_level || 0;
  if ((p.attempt_count || 0) + 1 >= 1) level = Math.max(level, 1);
  if (correct) level = Math.max(level, 2);
  if (correct && (p.correct_streak || 0) + 1 >= 2 && days.length >= 2) level = Math.max(level, 3);
  const last = p.last_answered_at ? new Date(p.last_answered_at).getTime() : null;
  if (correct && level >= 3 && last && now.getTime() - last >= 7 * DAY) level = 4;
  if (!correct && level >= 3) level = 2;
  return { level, days };
}
function masteryAfter(p, correct) {
  return masteryAfterAt(p, correct, new Date());
}
function reviewInterval(level, correct) {
  if (!correct) return 1;
  return { 0: 1, 1: 2, 2: 4, 3: 9, 4: 21 }[level] || 3;
}

function applyAttemptToProgress(p, attempt) {
  const correct = Boolean(attempt.correct),
    before = p.mastery_level || 0,
    at = new Date(attempt.answered_at);
  const m = masteryAfterAt(p, correct, at),
    wasWrong = (p.wrong_count || 0) > 0;
  return {
    ...p,
    attempt_count: (p.attempt_count || 0) + 1,
    correct_count: (p.correct_count || 0) + (correct ? 1 : 0),
    wrong_count: (p.wrong_count || 0) + (correct ? 0 : 1),
    correct_streak: correct ? (p.correct_streak || 0) + 1 : 0,
    mastery_level: m.level,
    correct_days: m.days,
    last_answered_at: at.toISOString(),
    last_wrong_at: correct ? p.last_wrong_at : at.toISOString(),
    next_review_at: new Date(at.getTime() + reviewInterval(m.level, correct) * DAY).toISOString(),
    recovery_count:
      (p.recovery_count || 0) + (correct && wasWrong && before < 3 && m.level >= 3 ? 1 : 0),
  };
}

function rebuildStateFromAttempts(attempts, starMap = {}) {
  const rebuilt = blankState();
  for (const [qid, s] of Object.entries(starMap || {})) {
    rebuilt.progress[qid] = {
      ...defaultP(),
      starred: Boolean(s.starred),
      star_updated_at: s.star_updated_at || null,
    };
  }
  for (const a of [...(attempts || [])].sort(
    (x, y) => new Date(x.answered_at) - new Date(y.answered_at),
  )) {
    if (!a?.question_id || !a?.answered_at) continue;
    const p = rebuilt.progress[a.question_id] || defaultP();
    rebuilt.progress[a.question_id] = applyAttemptToProgress(p, a);
    const day = isoDay(new Date(a.answered_at));
    rebuilt.daily[day] = {
      count: (rebuilt.daily[day]?.count || 0) + 1,
      correct: (rebuilt.daily[day]?.correct || 0) + (a.correct ? 1 : 0),
    };
  }
  rebuilt.attempts = [...(attempts || [])].sort(
    (x, y) => new Date(x.answered_at) - new Date(y.answered_at),
  );
  state = rebuilt;
  saveState();
  renderCurrentView();
  return rebuilt;
}

function recordAnswer(q, choice) {
  const p = getP(q.id),
    correct = choice === q.correct_choice,
    before = p.mastery_level || 0,
    now = new Date();
  const m = masteryAfter(p, correct),
    wasWrong = p.wrong_count > 0;
  const np = {
    ...p,
    attempt_count: p.attempt_count + 1,
    correct_count: p.correct_count + (correct ? 1 : 0),
    wrong_count: p.wrong_count + (correct ? 0 : 1),
    correct_streak: correct ? p.correct_streak + 1 : 0,
    mastery_level: m.level,
    correct_days: m.days,
    last_answered_at: now.toISOString(),
    last_wrong_at: correct ? p.last_wrong_at : now.toISOString(),
    next_review_at: new Date(now.getTime() + reviewInterval(m.level, correct) * DAY).toISOString(),
    recovery_count: p.recovery_count + (correct && wasWrong && before < 3 && m.level >= 3 ? 1 : 0),
  };
  state.progress[q.id] = np;
  const attempt = {
    id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
    question_id: q.id,
    answered_at: now.toISOString(),
    correct,
    choice,
    domain: q.domain,
    mastery_before: before,
    mastery_after: m.level,
  };
  state.attempts.push(attempt);
  state.daily[isoDay(now)] = {
    count: (state.daily[isoDay(now)]?.count || 0) + 1,
    correct: (state.daily[isoDay(now)]?.correct || 0) + (correct ? 1 : 0),
  };
  saveState();
  syncManager?.scheduleSync();
  return attempt;
}
function isDue(q) {
  const p = getP(q.id);
  return p.next_review_at && new Date(p.next_review_at) <= new Date();
}
/**
 * 出題の重み。判断は adr-0004（20_adr/0004-30-app_出題の選び方と習得指標の扱い.md）。
 *
 * 🔥 出した回数で半減させるのが要点。以前は「一度でも誤答した」に永久 +45 を与えており、
 *    誤答は next_review_at の短縮でも処理されているため二重計上だった。
 *    その結果、同じ日に20問×4本回すと4本目は既出100%（出た実数は381問中28問）になっていた。
 * ⚠️ 点数そのものを保存して半減させてはいけない。回復手段が無く、10回出た問題が二度と出なくなる。
 *    保存するのは「出した時刻」だけにし、7日で捨てる（= 放っておけば重みが戻る）。
 */
function serveCount(p) {
  const cutoff = Date.now() - 7 * DAY;
  return (p.served_at || []).filter((t) => new Date(t).getTime() >= cutoff).length;
}
function servedToday(q) {
  return (getP(q.id).served_at || []).some((t) => isoDay(new Date(t)) === isoDay());
}
function questionWeight(q) {
  const p = getP(q.id);
  // 1 から始める。0にすると抽選の母数が消え、習得済みの問題が永久に出なくなる。
  let base = 1;
  if (isDue(q)) {
    const over = (Date.now() - new Date(p.next_review_at).getTime()) / DAY;
    base += 80 + Math.min(20, Math.max(0, over));
  }
  if (p.starred) base += 25;
  if (p.attempt_count === 0) base += 20;
  // 「直前の回答が誤答」。正解すれば消えるので、昔の誤答が居座らない。
  if (p.attempt_count > 0 && (p.correct_streak || 0) === 0) base += 25;
  base += (4 - Math.min(4, p.mastery_level || 0)) * 5;
  return base * Math.pow(0.5, serveCount(p));
}
/** 重みに比例した抽選（同じ配列から1件引く）。 */
function drawIndex(list) {
  const w = list.map((q) => Math.max(0.0001, questionWeight(q)));
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return list.length - 1;
}
/**
 * 候補から n 問選ぶ。⌈n/3⌉ は重みの高い順、残りは抽選。
 * 抽選からは当日すでに出した問題を外す（外すと足りない場合だけ戻す）。
 */
function pickQuestions(pool, n) {
  const picked = [],
    slots = Math.max(1, Math.ceil(n / 3));
  for (const q of [...pool].sort((a, b) => questionWeight(b) - questionWeight(a))) {
    if (picked.length >= Math.min(slots, n)) break;
    picked.push(q);
  }
  const rest = pool.filter((q) => !picked.includes(q));
  let candidates = rest.filter((q) => !servedToday(q));
  if (candidates.length < n - picked.length) candidates = rest;
  while (picked.length < n && candidates.length) {
    picked.push(candidates.splice(drawIndex(candidates), 1)[0]);
  }
  return picked;
}
/** 出題した事実を記録する。⚠️ 選んだ時点ではなく、画面に出した時点で記録する。 */
function recordServe(q) {
  const cutoff = Date.now() - 7 * DAY,
    p = { ...getP(q.id) };
  p.served_at = [
    ...(p.served_at || []).filter((t) => new Date(t).getTime() >= cutoff),
    new Date().toISOString(),
  ];
  // 同期しない。出題の散らし方は端末ごとの都合で、学習履歴ではない。
  setP(q.id, p, { sync: false });
}
/** 今日の3問。スコア1問（⌈3/3⌉）＋ 抽選2問。 */
function chooseDaily() {
  return pickQuestions(questions, 3);
}
function filteredQuestions() {
  const domain = $('domainSelect').value,
    filter = $('filterSelect').value,
    type = $('typeSelect').value;
  return questions.filter((q) => {
    const p = getP(q.id);
    if (domain !== 'ALL' && q.domain !== domain) return false;
    if (type !== 'ALL' && q.question_type !== type) return false;
    if (filter === 'WRONG' && p.wrong_count === 0) return false;
    if (filter === 'STARRED' && !p.starred) return false;
    if (filter === 'DUE' && !isDue(q)) return false;
    if (filter === 'UNMASTERED' && p.mastery_level >= 4) return false;
    if (filter === 'NEW' && p.attempt_count > 0) return false;
    return true;
  });
  // ⚠️ ここで並べ替えない。並べて上位から取ると、同じ顔ぶれが毎回出る（adr-0004）。
  //    選ぶのは pickQuestions（スコア枠＋抽選）。
}
function startSession(list, mode = 'custom') {
  if (!list.length) {
    alert('条件に該当する問題がありません。');
    return;
  }
  session = {
    questions: list,
    index: 0,
    answers: [],
    mode,
    masteredBefore: masteredCount(),
    reachBefore: currentReachAvg(),
  };
  showView('quizView');
  renderQuestion();
}
function renderQuestion() {
  const q = session.questions[session.index];
  recordServe(q);
  const p = getP(q.id);
  $('progressText').textContent = `${session.index + 1} / ${session.questions.length}`;
  const bar = $('progressBar');
  bar.style.width = `${(session.index / session.questions.length) * 100}%`;
  if (session.index > 0) {
    bar.classList.remove('flash');
    void bar.offsetWidth;
    bar.classList.add('flash');
  }
  document.querySelector('.quiz-card').classList.remove('good', 'bad');
  $('stamp').classList.remove('show');
  $('stamp').innerHTML = '';
  $('domainBadge').textContent = domainLabel(q.domain);
  $('typeBadge').textContent = typeLabel(q.question_type);
  // 過去問には改行や上付き・下付きの記法が入る。textContent だと記法が生のまま出るため整形する。
  $('questionStem').innerHTML = formatText(q.stem);
  // 🔥 出典と改変の旨はIPAの利用条件。回答前から見える位置に出す（explain.js 側だけに置かない）。
  $('sourceNote').innerHTML = sourceHtml(q);
  setStar(p.starred);
  $('feedback').classList.add('hidden');
  $('choices').innerHTML = '';
  q.choices.forEach((text, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    // 記号は本番と同じ ア〜エ。キーボードで答えられるよう、数字も小さく併記する。
    b.innerHTML =
      `<span class="mark">${CHOICE_MARKS[i]}<small>${i + 1}</small></span>` +
      `<span class="exam-text">${formatText(text)}</span>`;
    b.style.setProperty('--i', String(i)); // 回答後、下から順に色が付く順番
    b.onclick = () => answer(i);
    $('choices').appendChild(b);
  });
}
function setStar(on) {
  $('starBtn').textContent = on ? '★' : '☆';
  $('starBtn').classList.toggle('on', Boolean(on));
}
function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/**
 * 朱の採点マーク。正誤が出た瞬間に一筆で描かれる。
 * stroke-dasharray の長さを図形ごとに渡す（円周と線長が違うため、共通値だと描き切れない）。
 */
function verdictMarkHtml(correct) {
  return correct
    ? `<svg class="vmark good" viewBox="0 0 48 48" aria-hidden="true"><circle class="vstroke" style="--len:114" cx="24" cy="24" r="18"/></svg>`
    : `<svg class="vmark" viewBox="0 0 48 48" aria-hidden="true"><path class="vstroke" style="--len:37" d="M12 12 L36 36"/><path class="vstroke d2" style="--len:37" d="M36 12 L12 36"/></svg>`;
}
/**
 * 正答時に画面中央へ押す採点印。
 * ⚠️ 情報はここに載せない（消えても #judge に結果が残る）。
 *    誤答には出さない。出すと1問ごとに叱られる画面になる。
 */
function showStamp() {
  const el = $('stamp');
  if (reduceMotion()) return;
  el.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="ring" cx="60" cy="60" r="50"/>
      <text class="word" x="60" y="60" dx="-0.8" text-anchor="middle" dominant-baseline="central">正解</text>
    </svg>`;
  el.classList.remove('show');
  void el.offsetWidth; // 連続正解でも毎回再生させる
  el.classList.add('show');
  el.addEventListener(
    'animationend',
    () => {
      el.classList.remove('show');
      el.innerHTML = '';
    },
    { once: true },
  );
}
/** 習得Lvの階段。上がった段だけ光らせる。 */
function ladderHtml(before, after) {
  const steps = [1, 2, 3, 4]
    .map(
      (n) => `<i class="${after >= n ? 'on' : ''}${after >= n && before < n ? ' lit' : ''}"></i>`,
    )
    .join('');
  const move = after > before ? `Lv${before} → Lv${after}` : `Lv${after}`;
  return `<span class="ladder-label">習得Lv</span>${steps}<span class="ladder-text">${move}</span>`;
}
function answer(choice) {
  const q = session.questions[session.index],
    att = recordAnswer(q, choice);
  session.answers.push(att);
  [...$('choices').children].forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct_choice) b.classList.add('correct');
    if (i === choice && i !== q.correct_choice) b.classList.add('wrong');
  });
  // 正答は縁が一度発光し、誤答は小さく振れる。⚠️ 付け直す前に必ず外す
  // （同じ判定が続くとアニメーションが再生されない）。
  const card = document.querySelector('.quiz-card');
  card.classList.remove('good', 'bad');
  void card.offsetWidth;
  card.classList.add(att.correct ? 'good' : 'bad');
  if (att.correct) showStamp();
  $('verdictMark').innerHTML = verdictMarkHtml(att.correct);
  $('judge').textContent = att.correct
    ? '正解'
    : `不正解 — 正解は ${CHOICE_MARKS[q.correct_choice]}`;
  $('judge').className = `judge ${att.correct ? 'good' : 'bad'}`;
  $('lvLadder').innerHTML = ladderHtml(att.mastery_before, att.mastery_after);
  renderExplanation($('explainCards'), q, choice, concepts, {
    focusOnly: getSetting('explain') === 'focus',
  });
  $('feedback').classList.remove('hidden');
  $('nextBtn').textContent = session.index === session.questions.length - 1 ? '結果を見る' : '次へ';
  // 判定と解説の先頭を画面に入れる。選択肢の位置に留まると、何が起きたか見えない。
  $('feedback').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
}
/**
 * 出題中のキーボード操作。1〜4 で選択、Enter / Space / → で次へ。
 * ⚠️ 入力欄（辞書の検索など）に文字を打っているときは何もしない。
 */
function onKeydown(e) {
  if (!$('quizView').classList.contains('active') || !session) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const answered = !$('feedback').classList.contains('hidden');
  if (!answered && /^[1-9]$/.test(e.key)) {
    const b = $('choices').children[Number(e.key) - 1];
    if (b) {
      e.preventDefault();
      b.click();
    }
    return;
  }
  if (answered && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
    e.preventDefault();
    $('nextBtn').click();
  }
}
function endOrNext() {
  if (session.index >= session.questions.length - 1) {
    renderResult();
    showView('resultView');
  } else {
    session.index++;
    renderQuestion();
  }
}
function masteredCount() {
  return questions.filter((q) => getP(q.id).mastery_level >= 4).length;
}
function streak() {
  const days = Object.keys(state.daily)
    .filter((d) => state.daily[d].count > 0)
    .sort()
    .reverse();
  if (!days.length) return 0;
  let n = 0,
    d = new Date();
  if (!days.includes(isoDay(d))) d = new Date(Date.now() - DAY);
  while (days.includes(isoDay(d))) {
    n++;
    d = new Date(d.getTime() - DAY);
  }
  return n;
}
/**
 * 領域ごとの到達度（平均習得Lv ÷ 4）。0〜1。
 * ⚠️ ダッシュボードの「習得率」（Lv4に達した問題の割合）とは別の指標。
 *    Lv4は7日空けた正解が要るので初日は必ず0になり、五角の到達印が何日も空のままになる。
 *    毎日の手応えを映すのはこちらで、名前も「到達度」と分けている。
 */
function domainReach(d) {
  const qs = questions.filter((q) => q.domain === d);
  if (!qs.length) return 0;
  const sum = qs.reduce((s, q) => s + Math.min(4, getP(q.id).mastery_level || 0), 0);
  return sum / (qs.length * 4);
}
/** 五角の到達印。5領域＝試験制度の区分そのものなので、5軸の形が意味を持つ。 */
function renderSeal() {
  const cx = 100,
    cy = 92,
    R = 62,
    labels = ['戦略', '設計', 'セキュリティ', 'PM', '監査'],
    reach = DOMAINS.map(domainReach),
    pt = (i, r) => {
      const a = (-90 + i * 72) * (Math.PI / 180);
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    },
    poly = (r) =>
      [0, 1, 2, 3, 4]
        .map((i) =>
          pt(i, r)
            .map((n) => n.toFixed(1))
            .join(','),
        )
        .join(' ');
  const rings = [0.25, 0.5, 0.75, 1]
    .map((k) => `<polygon class="seal-ring" points="${poly(R * k)}"/>`)
    .join('');
  const spokes = [0, 1, 2, 3, 4]
    .map((i) => {
      const [x, y] = pt(i, R);
      return `<line class="seal-spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    })
    .join('');
  // まだ何も無いときは面も点も描かない。中心に潰れた図形は「汚れ」に見え、
  // 「0%だ」とも「壊れている」とも読めてしまう。0%は枠だけで示す。
  const any = reach.some((v) => v > 0);
  const area = any
    ? `<polygon class="seal-area" points="${reach
        .map((v, i) =>
          pt(i, R * Math.max(0.02, v))
            .map((n) => n.toFixed(1))
            .join(','),
        )
        .join(' ')}"/>`
    : '';
  const dots = reach
    .map((v, i) => {
      if (!v) return '';
      const [x, y] = pt(i, R * Math.max(0.02, v));
      return `<circle class="seal-dot${v >= 1 ? ' full' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>`;
    })
    .join('');
  const text = labels
    .map((l, i) => {
      const [x, y] = pt(i, R + 16),
        anchor = i === 0 || i === 3 ? 'middle' : x > cx ? 'start' : 'end';
      return `<text class="seal-label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}">${l}</text>`;
    })
    .join('');
  const avg = reach.reduce((s, v) => s + v, 0) / reach.length;
  // セッション直後だけ、前回の広さから今の広さへ広げる（何が増えたのかを見せる）。
  const grow = sealGrowFrom !== null && avg > sealGrowFrom && !reduceMotion();
  const from = grow ? Math.max(0.25, sealGrowFrom / avg) : 1;
  sealGrowFrom = null;
  $('sealSvg').innerHTML =
    `<title id="sealTitle">5領域の到達度 ${Math.round(avg * 100)}%</title>` +
    rings +
    spokes +
    `<g class="${grow ? 'seal-grow' : ''}" style="--from:${from.toFixed(3)}">${area}${dots}</g>` +
    text;
  $('sealPct').textContent = `${Math.round(avg * 100)}%`;
}
/** 到達印を広げるときの開始値（セッション開始時の平均到達度）。null なら演出しない。 */
let sealGrowFrom = null;
function currentReachAvg() {
  const r = DOMAINS.map(domainReach);
  return r.reduce((a, b) => a + b, 0) / r.length;
}
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
function renderHome() {
  renderSeal();
  const mastered = masteredCount(),
    due = questions.filter(isDue).length,
    fresh = questions.filter((q) => getP(q.id).attempt_count === 0).length,
    answeredEver = state.attempts.length;
  $('masteredCount').textContent = mastered;
  $('masteredDenom').textContent = `/ ${questions.length}`;
  $('streakCount').textContent = streak();
  $('reviewDueCount').textContent = due;

  const today = state.daily[isoDay()]?.count || 0;
  $('todayFlag').textContent = today ? `今日は ${today} 問` : '今日はまだ';
  $('todayFlag').classList.toggle('done', today > 0);
  $('todayHeadline').textContent = today ? 'もう1セットいく' : '3問だけ、はじめる';
  $('dailyStartBtn').textContent = today ? 'つづけて3問' : '3問はじめる';
  $('todayStatus').textContent = answeredEver
    ? `要復習 ${due}問・未回答 ${fresh}問 から選びます。`
    : '1問答えるとその問題が習得Lv1になり、翌日から復習に並びます。';

  const last7 = [...Array(7)].map((_, i) => {
      const d = new Date(Date.now() - (6 - i) * DAY);
      return { count: state.daily[isoDay(d)]?.count || 0, day: WEEKDAY[d.getDay()] };
    }),
    max = Math.max(3, ...last7.map((x) => x.count)),
    total7 = last7.reduce((s, x) => s + x.count, 0);
  $('weekDots').innerHTML = last7
    .map(
      (x, i) =>
        `<div class="${i === 6 ? 'is-today' : ''}" title="${x.count}問"><i class="${x.count ? 'on' : ''}"></i><small>${x.day}</small></div>`,
    )
    .join('');
  $('weekSummary').textContent = total7 ? `7日で ${total7} 問` : 'まだ記録なし';
  // 全部0のとき棒グラフを出すと、空の枠が「何かが壊れている」ように見える。
  $('miniBars').classList.toggle('hidden', total7 === 0);
  $('weekEmpty').classList.toggle('hidden', total7 > 0);
  $('miniBars').innerHTML = last7
    .map(
      (x) =>
        `<div class="mini-bar${x.count ? '' : ' zero'}" title="${x.day} ${x.count}問" style="height:${Math.max(3, (x.count / max) * 100)}%"></div>`,
    )
    .join('');
}
/**
 * 数字を 0 から to へ数え上げる。
 * ⚠️ 表示は必ず to で終える（途中で止まった値が残ると、間違った成績を見せる）。
 */
function countUp(el, to, format) {
  if (reduceMotion() || !to) {
    el.textContent = format(to);
    return;
  }
  const dur = 420,
    t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = format(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
    else el.textContent = format(to);
  };
  requestAnimationFrame(step);
}
function renderResult() {
  const correct = session.answers.filter((a) => a.correct).length,
    delta = masteredCount() - session.masteredBefore;
  countUp($('resultCorrect'), correct, (v) => `${v}/${session.answers.length}`);
  countUp($('resultRate'), Math.round((correct / session.answers.length) * 100), (v) => `${v}%`);
  $('resultMasteredDelta').textContent = `+${Math.max(0, delta)}`;
  $('resultTitle').textContent =
    correct === session.answers.length ? '全問正解' : 'おつかれさまでした';
  $('resultList').innerHTML = session.answers
    .map((a, i) => {
      const q = session.questions[i],
        lv =
          a.mastery_after > a.mastery_before
            ? `習得Lv ${a.mastery_before} → ${a.mastery_after}`
            : `習得Lv ${a.mastery_after}`;
      return `<div class="result-item"><span class="rmark ${a.correct ? 'good' : 'bad'}">${a.correct ? '○' : '×'}</span><strong class="exam-text">${formatText(q.stem)}</strong><br><small>${domainLabel(q.domain)} · ${lv}</small></div>`;
    })
    .join('');
}
function renderDashboard() {
  const cutoff = Date.now() - 30 * DAY,
    attempts = state.attempts.filter((a) => new Date(a.answered_at).getTime() >= cutoff),
    correct = attempts.filter((a) => a.correct).length,
    recovery = Object.values(state.progress).reduce((s, p) => s + (p.recovery_count || 0), 0);
  $('kpiGrid').innerHTML = [
    ['習得（Lv4）', `${masteredCount()} / ${questions.length}`],
    ['30日回答', attempts.length],
    ['30日正答率', attempts.length ? `${Math.round((correct / attempts.length) * 100)}%` : '—'],
    ['誤答→習得', recovery],
  ]
    .map(([l, v]) => `<div class="kpi"><small>${l}</small><strong>${v}</strong></div>`)
    .join('');
  $('kpiNote').textContent =
    '習得（Lv4）は、Lv3に達した問題を7日以上空けて正解できたもの。最短で8日目から増えます。' +
    'その日の手応えは下の内訳（Lv1〜3）と「30日正答率」で見てください。';
  // 何も記録が無いとき、0が4つ並ぶだけでは「壊れている」のか「まだやっていない」のか分からない。
  const empty = state.attempts.length === 0;
  $('dashEmpty').classList.toggle('hidden', !empty);
  if (empty)
    $('dashEmpty').textContent =
      'まだ記録がありません。ホームの「3問はじめる」を回すと、正答率・領域別の習得率・日別の回答数がここに出ます。';
  // 🔥 「習得」= Lv4 は7日空けた正解が要るため、初週は必ず 0/381 のままになる。
  //    Lv4だけの棒を出すと、毎日やっても何も動かない画面になり「壊れている」と読まれる（実測で指摘された）。
  //    そこで Lv1〜4 の内訳を積み上げで出し、Lv4 はその一部として示す。判定のロジックは変えない。
  $('domainProgress').innerHTML =
    DOMAINS.filter((d) => questions.some((q) => q.domain === d))
      .map((d) => {
        const qs = questions.filter((q) => q.domain === d),
          lv = [0, 0, 0, 0, 0];
        for (const q of qs) lv[Math.min(4, getP(q.id).mastery_level || 0)]++;
        const seg = [1, 2, 3, 4]
          .map((n) => `<i class="lv${n}" style="width:${(lv[n] / qs.length) * 100}%"></i>`)
          .join('');
        return `<div class="domain-row"><div class="domain-label"><span>${domainLabel(d)}</span><span>習得 ${lv[4]} · 着手 ${qs.length - lv[0]} / ${qs.length}</span></div><div class="stack">${seg}</div></div>`;
      })
      .join('') +
    '<div class="legend"><span><i class="lv1"></i>Lv1 答えた</span><span><i class="lv2"></i>Lv2 正解した</span><span><i class="lv3"></i>Lv3 別の日に2連続</span><span><i class="lv4"></i>Lv4 7日後も正解＝習得</span></div>';
  const days = [...Array(14)].map((_, i) => {
      const d = new Date(Date.now() - (13 - i) * DAY),
        key = isoDay(d);
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, count: state.daily[key]?.count || 0 };
    }),
    max = Math.max(3, ...days.map((x) => x.count));
  $('activityChart').innerHTML = days
    .map(
      (x) =>
        `<div class="bar-col" title="${x.label}: ${x.count}問"><div class="bar${x.count ? '' : ' zero'}" style="height:${Math.max(2, (x.count / max) * 118)}px"></div><small>${x.label}</small></div>`,
    )
    .join('');
}
function renderReview() {
  // ⚠️ 出題の重みで並べない。抽選のゆらぎが入ると、再描画のたびに並びが変わって読めない。
  //    期限到来 → 誤答の多い順 → 習得Lvの低い順 の決定的な並びにする。
  const rank = (q) => {
    const p = getP(q.id);
    return [isDue(q) ? 0 : 1, -(p.wrong_count || 0), p.mastery_level || 0];
  };
  const list = questions
    .filter((q) => getP(q.id).starred || getP(q.id).wrong_count > 0 || isDue(q))
    .sort((a, b) => {
      const x = rank(a),
        y = rank(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  $('reviewCountLabel').textContent = `${list.length}件`;
  $('reviewList').innerHTML = list.length
    ? list
        .map((q) => {
          const p = getP(q.id);
          return `<div class="review-item"><div><strong class="exam-text">${p.starred ? '★ ' : ''}${formatText(q.stem)}</strong><br><small>${domainLabel(q.domain)} · 誤答 ${p.wrong_count} · 習得Lv ${p.mastery_level}${isDue(q) ? ' · 要復習' : ''}</small></div><button class="ghost one-question" data-id="${q.id}">解く</button></div>`;
        })
        .join('')
    : '<p class="empty-note">まだ復習対象はありません。3問解くと、翌日からここに並びます。★を付けた問題もここに集まります。</p>';
  document
    .querySelectorAll('.one-question')
    .forEach(
      (b) =>
        (b.onclick = () => startSession([questions.find((q) => q.id === b.dataset.id)], 'review')),
    );
}
function renderGlossaryView() {
  const shown = renderGlossary({
    container: $('glossaryList'),
    concepts,
    questions,
    getP,
    filters: glossaryFilters,
    opened: glossaryOpened,
  });
  $('glossaryCountLabel').textContent = `${shown} / ${concepts.size}語`;

  $('glossaryList')
    .querySelectorAll('[data-toggle]')
    .forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.toggle;
        // 開いている項目を覚えておかないと、検索や並び替えのたびに閉じてしまう。
        if (glossaryOpened.has(id)) glossaryOpened.delete(id);
        else glossaryOpened.add(id);
        renderGlossaryView();
      };
    });

  $('glossaryList')
    .querySelectorAll('.gl-practice')
    .forEach((b) => {
      b.onclick = () => {
        const list = questions.filter((q) => q.concept_id === b.dataset.concept);
        startSession(list, 'concept');
      };
    });
}
function showView(id) {
  views.forEach((v) => v.classList.toggle('active', v.id === id));
  document
    .querySelectorAll('.nav-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'homeView') renderHome();
  if (id === 'dashboardView') renderDashboard();
  if (id === 'reviewView') renderReview();
  if (id === 'glossaryView') renderGlossaryView();
  window.scrollTo(0, 0);
}
function renderCurrentView() {
  const v = views.find((x) => x.classList.contains('active'))?.id;
  if (v === 'homeView') renderHome();
  else if (v === 'dashboardView') renderDashboard();
  else if (v === 'reviewView') renderReview();
  else if (v === 'glossaryView') renderGlossaryView();
}
function updateSyncStatus(info) {
  const el = $('syncStatus');
  if (!el) return;
  el.textContent = info.text;
  el.className = `sync-status ${info.kind || 'local'}`;
}
function updateAuthUI(user) {
  const signed = Boolean(user);
  $('authSignedOut').classList.toggle('hidden', signed);
  $('authSignedIn').classList.toggle('hidden', !signed);
  if (signed) $('userEmail').textContent = user.email || 'ログイン中';
}

async function init() {
  const content = await loadContent();
  questions = content.questions;
  concepts = content.concepts;
  state = loadStateV3(content.legacyMap).state;
  // 見た目の設定。解説の開きかたを変えたときは、いま出ている解説にも即座に反映する。
  initSettings((name) => {
    if (name === 'explain' && session && !$('feedback').classList.contains('hidden')) {
      const q = session.questions[session.index],
        last = session.answers[session.answers.length - 1];
      renderExplanation($('explainCards'), q, last?.choice ?? -1, concepts, {
        focusOnly: getSetting('explain') === 'focus',
      });
    }
  });
  document.addEventListener('keydown', onKeydown);
  renderHome();
  $('dailyStartBtn').onclick = () => startSession(chooseDaily(), 'daily');
  $('customStartBtn').onclick = () => {
    const n = Math.max(1, Math.min(100, Number($('countInput').value) || 20));
    startSession(pickQuestions(filteredQuestions(), n), 'custom');
  };
  $('nextBtn').onclick = endOrNext;
  const backHome = () => {
    // 到達印を「前回の広さ」から広げるための基準値。セッションを開いた時点の値を使う。
    if (session) sealGrowFrom = session.reachBefore;
    showView('homeView');
  };
  $('quitBtn').onclick = backHome;
  $('resultHomeBtn').onclick = backHome;
  $('starBtn').onclick = () => {
    const q = session.questions[session.index],
      p = { ...getP(q.id) };
    p.starred = !p.starred;
    p.star_updated_at = new Date().toISOString();
    setP(q.id, p);
    setStar(p.starred);
  };
  $('exportBtn').onclick = () => {
    const blob = new Blob(
        [JSON.stringify({ exported_at: new Date().toISOString(), state }, null, 2)],
        { type: 'application/json' },
      ),
      a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `itss-study-${isoDay()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  document
    .querySelectorAll('.nav-btn')
    .forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  $('glossarySearch').oninput = (e) => {
    glossaryFilters.query = e.target.value;
    renderGlossaryView();
  };
  $('glossaryDomain').onchange = (e) => {
    glossaryFilters.domain = e.target.value;
    renderGlossaryView();
  };
  $('glossarySort').onchange = (e) => {
    glossaryFilters.sort = e.target.value;
    renderGlossaryView();
  };
  $('glossaryWeakOnly').onchange = (e) => {
    glossaryFilters.weakOnly = e.target.checked;
    renderGlossaryView();
  };

  syncManager = new SyncManager({
    getState: () => state,
    rebuildState: rebuildStateFromAttempts,
    onStatus: updateSyncStatus,
    onAuth: updateAuthUI,
  });
  if (!syncManager.isConfigured()) $('syncSetupHint').classList.remove('hidden');
  $('loginBtn').onclick = async () => {
    const email = $('emailInput').value.trim();
    if (!email) return alert('メールアドレスを入力してください。');
    try {
      await syncManager.signIn(email);
      alert('ログイン用メールを送信しました。メール内のリンクを開いてください。');
    } catch (e) {
      alert(`ログインメール送信に失敗しました: ${e.message}`);
    }
  };
  $('syncNowBtn').onclick = async () => {
    try {
      await syncManager.syncNow();
    } catch (e) {
      alert(`同期に失敗しました: ${e.message}`);
    }
  };
  $('logoutBtn').onclick = () => syncManager.signOut();
  await syncManager.init();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('installBtn').classList.remove('hidden');
  });
  $('installBtn').onclick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt = null;
      $('installBtn').classList.add('hidden');
    }
  };
}
init();
