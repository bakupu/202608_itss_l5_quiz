/**
 * 用語辞書ビューの機能テスト（一覧・検索・絞り込み・苦手順・概念単位の復習）。
 *
 * 実行: node tools/test_glossary.mjs
 * 終了コード: 0=全件成功、1=失敗あり
 *
 * 検索や並び替えは「目で見れば分かる」ため検証が省かれやすいが、
 * 概念や設問を追加したときに静かに壊れる。件数と順序を機械的に確かめる。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8943);

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

// 「最小権限」に誤答を積んだ状態。苦手順で先頭に来ることの確認に使う。
const SEED_V2 = {
  progress: {
    'sec-tm-02': {
      starred: false,
      attempt_count: 4,
      correct_count: 0,
      wrong_count: 4,
      mastery_level: 1,
    },
  },
  attempts: [],
  daily: {},
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ ok });
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? ` — ${detail}` : ''}`);
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    localStorage.setItem('itss-l5-study-state-v2', JSON.stringify(s));
  }, SEED_V2);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.click('.nav-btn[data-view="glossaryView"]');
  await page.waitForTimeout(200);

  const conceptDoc = JSON.parse(await readFile(join(DOCS, 'data', 'concepts.json'), 'utf-8'));
  const total = conceptDoc.concepts.length;

  const count = () => page.locator('.gl-item').count();
  const label = () => page.locator('#glossaryCountLabel').textContent();
  const terms = () => page.locator('.gl-item .gl-title strong').allTextContents();

  check('全概念が一覧される', (await count()) === total, `${await count()} / ${total}`);
  check('件数ラベルが出る', (await label()).includes(`${total}語`), await label());

  // --- 検索: 用語名だけでなく意味・関連語も対象にする ---
  await page.fill('#glossarySearch', '証明書');
  await page.waitForTimeout(150);
  const hit = await terms();
  check('意味や関連語まで検索できる', hit.includes('PKI') && hit.includes('OCSP'), hit.join(', '));

  await page.fill('#glossarySearch', 'Recovery Time');
  await page.waitForTimeout(150);
  check('英語正式名称で検索できる', (await terms()).includes('RTO'), (await terms()).join(', '));

  await page.fill('#glossarySearch', 'zzz該当なし');
  await page.waitForTimeout(150);
  check('該当なしでも壊れない', (await count()) === 0);

  // --- 領域で絞り込む ---
  await page.fill('#glossarySearch', '');
  await page.selectOption('#glossaryDomain', 'SECURITY');
  await page.waitForTimeout(150);
  const secCount = conceptDoc.concepts.filter((c) => c.domain === 'SECURITY').length;
  check('領域で絞り込める', (await count()) === secCount, `${await count()} / ${secCount}`);

  // --- 苦手順 ---
  await page.selectOption('#glossaryDomain', 'ALL');
  await page.selectOption('#glossarySort', 'WEAK');
  await page.waitForTimeout(150);
  const first = (await terms())[0];
  check('苦手順で誤答の多い用語が先頭に来る', first === '最小権限', `先頭=${first}`);

  // --- 展開状態の保持 ---
  await page.selectOption('#glossarySort', 'STANDARD');
  await page.waitForTimeout(150);
  await page.click('.gl-item:first-child .gl-head');
  await page.waitForTimeout(150);
  check('項目を開くと詳細が出る', (await page.locator('.gl-detail').count()) === 1);
  await page.fill('#glossarySearch', 'SWOT');
  await page.waitForTimeout(150);
  check(
    '検索しても開いた状態が保たれる',
    (await page.locator('.gl-item.is-open').count()) === 1,
    '開閉が毎回リセットされると読みながら絞り込めない',
  );

  // --- 概念単位の復習 ---
  const practice = page.locator('.gl-practice').first();
  const practiceText = await practice.textContent();
  const expected = Number(practiceText.match(/（(\d+)問）/)[1]);
  await practice.click();
  await page.waitForTimeout(250);
  check('概念単位で出題が始まる', await page.locator('#quizView.active').isVisible());
  const progress = await page.locator('#progressText').textContent();
  check(
    '出題数が概念の問題数と一致する',
    progress.includes(`/ ${expected}`),
    `表示=${progress.trim()} 期待=${expected}問`,
  );

  check('JSエラーが出ていない', errors.length === 0, errors.join(' / '));
  await context.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 件成功`);
process.exit(failed ? 1 : 0);
