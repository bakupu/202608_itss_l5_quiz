/**
 * 学習履歴の v2 → v3 移行テスト。
 *
 * 概要: docs/ を静的配信し、Chromium の localStorage に旧形式の履歴を仕込んでから
 *       アプリを起動し、永久IDへ張り替えられたか・旧データが残っているかを検証する。
 * 実行: node tools/test_migration.mjs
 * 終了コード: 0=全件成功、1=失敗あり（失敗内容は標準出力に出す）
 *
 * 🔥 このテストが守っているのは「★と誤答履歴を失わないこと」。
 *    localStorage にしか無く、失うと復元できない。移行ロジックを触ったら必ず実行する。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8942);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = join(DOCS, p === '/' ? 'index.html' : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': `${MIME[extname(file)] || 'text/plain'}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// 旧形式の履歴。★・誤答・習得Lvを持たせ、移行後も保持されることを確かめる。
const V2_STATE = {
  progress: {
    'sec-tm-02': {
      starred: true,
      star_updated_at: '2026-08-01T00:00:00.000Z',
      attempt_count: 5,
      correct_count: 2,
      wrong_count: 3,
      correct_streak: 1,
      mastery_level: 2,
      recovery_count: 1,
      last_answered_at: '2026-08-10T00:00:00.000Z',
      last_wrong_at: '2026-08-05T00:00:00.000Z',
      next_review_at: '2026-08-12T00:00:00.000Z',
      correct_days: ['2026-08-10'],
    },
    'str-mt-10': { starred: false, attempt_count: 1, wrong_count: 0, mastery_level: 4 },
    'ghost-99': { starred: true, attempt_count: 1, wrong_count: 1, mastery_level: 0 },
  },
  attempts: [
    { id: 'a1', question_id: 'sec-tm-02', correct: false, answered_at: '2026-08-05T00:00:00.000Z' },
    { id: 'a2', question_id: 'str-mt-10', correct: true, answered_at: '2026-08-10T00:00:00.000Z' },
  ],
  daily: { '2026-08-10': { count: 2 } },
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function openApp(browser, seed) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    if (s) localStorage.setItem('itss-l5-study-state-v2', JSON.stringify(s));
  }, seed);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const store = await page.evaluate(() => ({
    v3: JSON.parse(localStorage.getItem('itss-l5-study-state-v3') || 'null'),
    v2: JSON.parse(localStorage.getItem('itss-l5-study-state-v2') || 'null'),
  }));
  return { store, errors, context };
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
try {
  const map = JSON.parse(await readFile(join(DOCS, 'data', 'legacy-id-map.json'), 'utf-8'));

  // --- ケース1: 旧履歴あり ---
  {
    const { store, errors, context } = await openApp(browser, V2_STATE);
    check('移行時にJSエラーが出ない', errors.length === 0, errors.join(' / '));
    check('v3 が作られる', !!store.v3);

    const newId = map['sec-tm-02'];
    check('旧IDが対応表にある', !!newId, `sec-tm-02 -> ${newId}`);
    const moved = store.v3?.progress?.[newId];
    check('★が保持される', moved?.starred === true);
    check('誤答数が保持される', moved?.wrong_count === 3, `wrong_count=${moved?.wrong_count}`);
    check(
      '習得Lvが保持される',
      moved?.mastery_level === 2,
      `mastery_level=${moved?.mastery_level}`,
    );
    check('旧IDのキーは残らない', store.v3?.progress?.['sec-tm-02'] === undefined);

    const att = store.v3?.attempts?.find((a) => a.id === 'a1');
    check('回答履歴のquestion_idも張り替わる', att?.question_id === newId, att?.question_id);

    check(
      '進捗の件数が変わらない',
      Object.keys(store.v3?.progress || {}).length === Object.keys(V2_STATE.progress).length,
    );
    check('対応表に無いIDは捨てずに残す', store.v3?.progress?.['ghost-99']?.starred === true);
    check('日次実績が引き継がれる', store.v3?.daily?.['2026-08-10']?.count === 2);

    // 🔥 ロールバック可能であることの担保
    check(
      'v2 が削除されていない',
      JSON.stringify(store.v2) === JSON.stringify(V2_STATE),
      store.v2 ? '内容一致' : 'v2 が消えている',
    );
    await context.close();
  }

  // --- ケース2: 新規利用者（localStorage が空） ---
  {
    const { store, errors, context } = await openApp(browser, null);
    check('新規利用者でJSエラーが出ない', errors.length === 0, errors.join(' / '));
    check(
      '新規利用者では v3 を作らない',
      store.v3 === null,
      '空状態で保存すると同期が誤作動しうる',
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 件成功`);
process.exit(failed.length ? 1 : 0);
