import { SyncManager } from './sync.js';
import { loadContent, loadStateV3, blankState, STORAGE_KEY_V3 } from './content.js';
import { renderExplanation } from './explain.js';

const STORAGE_KEY = STORAGE_KEY_V3;
const DAY = 86400000;
let questions = [];
let state = blankState();
let concepts = new Map();
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
function domainLabel(d) {
  return { STRATEGY: 'ストラテジ', ARCHITECTURE: 'アーキテクト', SECURITY: 'セキュリティ' }[d] || d;
}
function typeLabel(t) {
  return (
    { TERM_TO_MEANING: '用語 → 意味', MEANING_TO_TERM: '意味 → 用語', SCENARIO: '午前問題型' }[t] ||
    t
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
function scoreQuestion(q) {
  const p = getP(q.id);
  let s = Math.random() * 10;
  if (isDue(q)) s += 80;
  if (p.last_wrong_at) s += 45;
  if (p.starred) s += 35;
  if (p.mastery_level <= 2) s += 25;
  if (p.attempt_count === 0) s += 18;
  if (p.last_answered_at) {
    const age = (Date.now() - new Date(p.last_answered_at)) / DAY;
    s += Math.min(age, 20);
  }
  return s;
}
function chooseDaily() {
  const pool = [...questions],
    picked = [],
    groups = [
      (q) => isDue(q) || getP(q.id).last_wrong_at,
      (q) => getP(q.id).mastery_level <= 2,
      (q) => getP(q.id).attempt_count === 0,
    ];
  for (const test of groups) {
    const c = pool
      .filter((q) => !picked.includes(q) && test(q))
      .sort((a, b) => scoreQuestion(b) - scoreQuestion(a))[0];
    if (c) picked.push(c);
  }
  while (picked.length < 3) {
    const c = pool
      .filter((q) => !picked.includes(q))
      .sort((a, b) => scoreQuestion(b) - scoreQuestion(a))[0];
    if (!c) break;
    picked.push(c);
  }
  return picked;
}
function filteredQuestions() {
  const domain = $('domainSelect').value,
    filter = $('filterSelect').value,
    type = $('typeSelect').value;
  return questions
    .filter((q) => {
      const p = getP(q.id);
      if (domain !== 'ALL' && q.domain !== domain) return false;
      if (type !== 'ALL' && q.question_type !== type) return false;
      if (filter === 'WRONG' && p.wrong_count === 0) return false;
      if (filter === 'STARRED' && !p.starred) return false;
      if (filter === 'DUE' && !isDue(q)) return false;
      if (filter === 'UNMASTERED' && p.mastery_level >= 4) return false;
      if (filter === 'NEW' && p.attempt_count > 0) return false;
      return true;
    })
    .sort((a, b) => scoreQuestion(b) - scoreQuestion(a));
}
function startSession(list, mode = 'custom') {
  if (!list.length) {
    alert('条件に該当する問題がありません。');
    return;
  }
  session = { questions: list, index: 0, answers: [], mode, masteredBefore: masteredCount() };
  showView('quizView');
  renderQuestion();
}
function renderQuestion() {
  const q = session.questions[session.index],
    p = getP(q.id);
  $('progressText').textContent = `${session.index + 1} / ${session.questions.length}`;
  $('progressBar').style.width = `${(session.index / session.questions.length) * 100}%`;
  $('domainBadge').textContent = domainLabel(q.domain);
  $('typeBadge').textContent = typeLabel(q.question_type);
  $('questionStem').textContent = q.stem;
  $('starBtn').textContent = p.starred ? '★' : '☆';
  $('feedback').classList.add('hidden');
  $('choices').innerHTML = '';
  q.choices.forEach((text, i) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = `${String.fromCharCode(65 + i)}. ${text}`;
    b.onclick = () => answer(i);
    $('choices').appendChild(b);
  });
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
  $('judge').textContent = att.correct ? '正解' : '不正解';
  $('judge').className = `judge ${att.correct ? 'good' : 'bad'}`;
  renderExplanation($('explainCards'), q, choice, concepts);
  $('feedback').classList.remove('hidden');
  $('nextBtn').textContent = session.index === session.questions.length - 1 ? '結果を見る' : '次へ';
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
function renderHome() {
  $('masteredCount').textContent = masteredCount();
  $('masteredDenom').textContent = `/ ${questions.length}`;
  $('streakCount').textContent = streak();
  $('reviewDueCount').textContent = questions.filter(isDue).length;
  const today = state.daily[isoDay()]?.count || 0;
  $('todayStatus').textContent =
    today >= 3
      ? `今日は ${today} 問回答済み。追加学習もできます。`
      : '復習・未習得・新規から自動選出します。';
  const last7 = [...Array(7)].map((_, i) => {
      const d = new Date(Date.now() - (6 - i) * DAY);
      return state.daily[isoDay(d)]?.count || 0;
    }),
    max = Math.max(3, ...last7);
  $('miniBars').innerHTML = last7
    .map(
      (v) =>
        `<div class="mini-bar" title="${v}問" style="height:${Math.max(3, (v / max) * 100)}%"></div>`,
    )
    .join('');
}
function renderResult() {
  const correct = session.answers.filter((a) => a.correct).length,
    delta = masteredCount() - session.masteredBefore;
  $('resultCorrect').textContent = `${correct}/${session.answers.length}`;
  $('resultRate').textContent = `${Math.round((correct / session.answers.length) * 100)}%`;
  $('resultMasteredDelta').textContent = `+${Math.max(0, delta)}`;
  $('resultList').innerHTML = session.answers
    .map((a, i) => {
      const q = session.questions[i];
      return `<div class="result-item"><strong>${a.correct ? '○' : '×'} ${escapeHtml(q.stem)}</strong><br><small>${domainLabel(q.domain)} · 習得Lv ${a.mastery_before} → ${a.mastery_after}</small></div>`;
    })
    .join('');
}
function renderDashboard() {
  const cutoff = Date.now() - 30 * DAY,
    attempts = state.attempts.filter((a) => new Date(a.answered_at).getTime() >= cutoff),
    correct = attempts.filter((a) => a.correct).length,
    recovery = Object.values(state.progress).reduce((s, p) => s + (p.recovery_count || 0), 0);
  $('kpiGrid').innerHTML = [
    ['習得', `${masteredCount()} / ${questions.length}`],
    ['30日回答', attempts.length],
    ['30日正答率', attempts.length ? `${Math.round((correct / attempts.length) * 100)}%` : '—'],
    ['誤答→習得', recovery],
  ]
    .map(([l, v]) => `<div class="kpi"><small>${l}</small><strong>${v}</strong></div>`)
    .join('');
  $('domainProgress').innerHTML = ['STRATEGY', 'ARCHITECTURE', 'SECURITY']
    .map((d) => {
      const qs = questions.filter((q) => q.domain === d),
        m = qs.filter((q) => getP(q.id).mastery_level >= 4).length,
        pct = qs.length ? Math.round((m / qs.length) * 100) : 0;
      return `<div class="domain-row"><div class="domain-label"><span>${domainLabel(d)}</span><span>${m}/${qs.length} (${pct}%)</span></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
    })
    .join('');
  const days = [...Array(14)].map((_, i) => {
      const d = new Date(Date.now() - (13 - i) * DAY),
        key = isoDay(d);
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, count: state.daily[key]?.count || 0 };
    }),
    max = Math.max(3, ...days.map((x) => x.count));
  $('activityChart').innerHTML = days
    .map(
      (x) =>
        `<div class="bar-col" title="${x.label}: ${x.count}問"><div class="bar" style="height:${Math.max(2, (x.count / max) * 125)}px"></div><small>${x.label}</small></div>`,
    )
    .join('');
}
function renderReview() {
  const list = questions
    .filter((q) => getP(q.id).starred || getP(q.id).wrong_count > 0 || isDue(q))
    .sort((a, b) => scoreQuestion(b) - scoreQuestion(a));
  $('reviewCountLabel').textContent = `${list.length}件`;
  $('reviewList').innerHTML = list.length
    ? list
        .map((q) => {
          const p = getP(q.id);
          return `<div class="review-item"><div><strong>${p.starred ? '★ ' : ''}${escapeHtml(q.stem)}</strong><br><small>${domainLabel(q.domain)} · 誤答 ${p.wrong_count} · Lv ${p.mastery_level}${isDue(q) ? ' · 要復習' : ''}</small></div><button class="ghost one-question" data-id="${q.id}">解く</button></div>`;
        })
        .join('')
    : '<p class="muted">まだ復習対象はありません。</p>';
  document
    .querySelectorAll('.one-question')
    .forEach(
      (b) =>
        (b.onclick = () => startSession([questions.find((q) => q.id === b.dataset.id)], 'review')),
    );
}
function showView(id) {
  views.forEach((v) => v.classList.toggle('active', v.id === id));
  document
    .querySelectorAll('.nav-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'homeView') renderHome();
  if (id === 'dashboardView') renderDashboard();
  if (id === 'reviewView') renderReview();
  window.scrollTo(0, 0);
}
function renderCurrentView() {
  const v = views.find((x) => x.classList.contains('active'))?.id;
  if (v === 'homeView') renderHome();
  else if (v === 'dashboardView') renderDashboard();
  else if (v === 'reviewView') renderReview();
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>'"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
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
  renderHome();
  $('dailyStartBtn').onclick = () => startSession(chooseDaily(), 'daily');
  $('customStartBtn').onclick = () => {
    const n = Math.max(1, Math.min(100, Number($('countInput').value) || 20));
    startSession(filteredQuestions().slice(0, n), 'custom');
  };
  $('nextBtn').onclick = endOrNext;
  $('quitBtn').onclick = () => showView('homeView');
  $('resultHomeBtn').onclick = () => showView('homeView');
  $('starBtn').onclick = () => {
    const q = session.questions[session.index],
      p = { ...getP(q.id) };
    p.starred = !p.starred;
    p.star_updated_at = new Date().toISOString();
    setP(q.id, p);
    $('starBtn').textContent = p.starred ? '★' : '☆';
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
