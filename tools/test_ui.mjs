/**
 * 見た目の設定とキーボード操作のテスト。
 *
 * 実行: node tools/test_ui.mjs
 * 終了コード: 0=全件成功、1=失敗あり
 *
 * なぜ機械で見るか: 配色・書体・記号・キー操作は「開けば分かる」ため検証が省かれやすく、
 *   CSSやHTMLを触ったときに静かに壊れる。とくに次の2つは壊れても画面が普通に見える。
 *     1. 設定が localStorage へ保存されず、リロードで既定へ戻る
 *     2. 見た目の設定が学習履歴のキーを書き換える（履歴は失うと復元できない）
 * ⚠️ 色そのもの（読みやすさ・印象）はここでは判定できない。撮影して目で見る
 *    （node tools/shoot.mjs <ラベル>）。ここが見るのは「設定が効いて保たれるか」。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8951);

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

const results = [];
function check(name, ok, detail = '') {
  results.push({ ok });
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? ` — ${detail}` : ''}`);
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

  // --- 空の状態 ---
  check(
    'まだ記録が無いとき、7日の棒グラフではなく案内文を出す',
    await page.locator('#weekEmpty').isVisible(),
  );
  check(
    '到達度0%のとき、五角の到達印に面を描かない（中心に潰れた図形を出さない）',
    (await page.locator('#sealSvg .seal-area').count()) === 0,
  );
  check('到達度が0%と表示される', (await page.locator('#sealPct').textContent()) === '0%');

  // --- 選択肢の記号と、キーボードでの回答 ---
  await page.click('#dailyStartBtn');
  await page.waitForSelector('#quizView.active');
  const marks = await page.locator('#choices .mark').allTextContents();
  check(
    '🔥 選択肢の記号が本番と同じ ア〜エ',
    marks.map((m) => m.trim()[0]).join('') === 'アイウエ',
    marks.join(' / '),
  );
  await page.keyboard.press('1');
  check(
    '数字キーで回答できる',
    !(await page.locator('#feedback').evaluate((e) => e.classList.contains('hidden'))),
  );
  check('採点マークが描かれる', (await page.locator('#verdictMark svg').count()) === 1);
  // 演出そのもの（発光・振れ・数え上げ）は静止画では確かめられない。
  // ここでは「引き金のクラスが付くか」だけを見る。CSSを削れば演出は消えるので、
  // 見た目は撮影で確認する（node tools/shoot.mjs <ラベル>）。
  const verdictClass = await page.locator('.quiz-card').getAttribute('class');
  check(
    '正誤に応じた演出の引き金が付く（good / bad）',
    ['good', 'bad'].some((c) => verdictClass.split(' ').includes(c)),
    verdictClass,
  );
  check('習得Lvの階段が出る', (await page.locator('#lvLadder i').count()) === 4);
  check('解説は既定で4つとも開く', (await page.locator('.ex-card:not(.is-subject)').count()) === 4);
  check(
    '畳まれた解説が無い（既定）',
    (await page.locator('details.ex-card').count()) === 0,
    '誤答選択肢が何の説明かを読めるようにするため',
  );
  const before = await page.locator('#progressText').textContent();
  await page.keyboard.press('Enter');
  check(
    'Enterで次の問題へ進む',
    (await page.locator('#progressText').textContent()) !== before,
    `${before.trim()} → ${(await page.locator('#progressText').textContent()).trim()}`,
  );

  // --- 正答時の採点印 ---
  // ⚠️ 「1」を押すだけでは正解か誤答かが問題によって変わる。
  //    設問データから正解の位置を引いて、必ず正解を押す。
  const qdoc = JSON.parse(await readFile(join(DOCS, 'data/questions-v3.json'), 'utf-8'));
  const qs = qdoc.questions || qdoc;
  const norm = (t) =>
    String(t)
      .replace(/[\^_]\{|\}/g, '')
      .replace(/\s+/g, '')
      .slice(0, 60); // 短く切ると共通の書き出しで別の設問と衝突する
  const answerKey = new Map(qs.map((q) => [norm(q.stem), q.correct_choice]));
  const stem = await page.locator('#questionStem').innerText();
  const correctIndex = answerKey.get(norm(stem));
  check('画面の設問を設問データへ突き合わせられる', correctIndex !== undefined, norm(stem));
  await page.keyboard.press(String((correctIndex ?? 0) + 1));
  check(
    '🔥 正答すると画面中央に採点印が出る',
    (await page.locator('#stamp.show svg').count()) === 1,
  );
  check('採点印は「正解」と読める', (await page.locator('#stamp').innerText()).includes('正解'));
  check(
    '採点印は操作を邪魔しない（pointer-events: none）',
    (await page.locator('#stamp').evaluate((e) => getComputedStyle(e).pointerEvents)) === 'none',
  );
  await page.waitForTimeout(1000);
  check(
    '採点印は演出が終わると消える（画面に残らない）',
    (await page.locator('#stamp.show').count()) === 0,
  );

  // --- 回答したので到達印に面が出る ---
  await page.click('#quitBtn');
  check(
    'セッションから戻ると到達印が広がる（前回の広さから）',
    (await page.locator('#sealSvg g.seal-grow').count()) === 1,
  );
  check(
    '回答すると五角の到達印に面が出る',
    (await page.locator('#sealSvg .seal-area').count()) === 1,
  );

  // --- 見た目の設定 ---
  await page.click('.settings-card > summary');
  const stemFont = () =>
    page.locator('#questionStem').evaluate((e) => getComputedStyle(e).fontFamily);
  await page.click('.seg[data-setting="theme"] button[data-value="night"]');
  await page.click('.seg[data-setting="examFont"] button[data-value="gothic"]');
  await page.click('.seg[data-setting="textSize"] button[data-value="l"]');
  await page.click('.seg[data-setting="explain"] button[data-value="focus"]');
  const ds = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  check(
    '配色・書体・文字サイズ・解説の設定が画面へ反映される',
    ds.theme === 'night' &&
      ds.examFont === 'gothic' &&
      ds.textSize === 'l' &&
      ds.explain === 'focus',
    JSON.stringify(ds),
  );
  check(
    '選んだ配色が押された状態で出る',
    (await page
      .locator('.seg[data-setting="theme"] button[data-value="night"]')
      .getAttribute('aria-pressed')) === 'true',
  );

  // --- 保存と、履歴を壊していないこと ---
  const stored = await page.evaluate(() => ({
    ui: localStorage.getItem('itss-l5-ui-v1'),
    v3: localStorage.getItem('itss-l5-study-state-v3'),
  }));
  check('設定が localStorage へ保存される', JSON.parse(stored.ui || '{}').theme === 'night');
  check(
    '🔥 見た目の設定は学習履歴のキーを壊さない',
    Boolean(stored.v3) && JSON.parse(stored.v3).attempts.length >= 1,
    `attempts=${JSON.parse(stored.v3 || '{"attempts":[]}').attempts.length}`,
  );

  await page.reload({ waitUntil: 'networkidle' });
  const after = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  check(
    '🔥 リロード後も設定が保たれる（最初の描画から当たる）',
    after.theme === 'night' && after.examFont === 'gothic',
    JSON.stringify(after),
  );

  // --- ゴシック指定が実際の書体に効いているか（属性だけ変わって見た目が変わらない事故を防ぐ） ---
  await page.click('#dailyStartBtn');
  await page.waitForSelector('#quizView.active');
  const gothic = await stemFont();
  await page.click('#quitBtn');
  await page.click('.settings-card > summary');
  await page.click('.seg[data-setting="examFont"] button[data-value="mincho"]');
  await page.click('#dailyStartBtn');
  await page.waitForSelector('#quizView.active');
  const mincho = await stemFont();
  check('問題文の書体が実際に切り替わる', gothic !== mincho, `${gothic} ≠ ${mincho}`);
  check('明朝を選ぶと明朝系が先頭に来る', /Mincho|Serif|明朝/i.test(mincho), mincho);

  // --- 「自分の回答と正解だけ開く」 ---
  await page.keyboard.press('1');
  const collapsed = await page.locator('details.ex-card').count();
  const open = await page.locator('section.ex-card:not(.is-subject)').count();
  check(
    '「自分の回答と正解だけ開く」で残りが畳まれる',
    collapsed >= 1 && open >= 1 && collapsed + open === 4,
    `畳${collapsed} / 開${open}`,
  );

  // --- ダッシュボード: 「習得」だけでは初週に何も動かない ---
  // 🔥 実測でここが指摘された（6問全問正解でも領域別が0%のまま）。
  //    Lv4は7日空けた正解が要るので正しい挙動だが、画面上は故障と区別できなかった。
  await page.click('#nextBtn').catch(() => {});
  await page.click('.nav-btn[data-view="dashboardView"]');
  const widths = await page
    .locator('#domainProgress .stack i')
    .evaluateAll((els) => els.map((e) => parseFloat(e.style.width)));
  check(
    '🔥 回答した当日から領域別の内訳が動く（Lv4だけの棒にしない）',
    widths.some((w) => w > 0),
    `幅>0 の段: ${widths.filter((w) => w > 0).length} / ${widths.length}`,
  );
  check('Lv1〜4の凡例が出る', (await page.locator('#domainProgress .legend i').count()) === 4);
  check(
    '習得（Lv4）の条件が画面に書いてある',
    (await page.locator('#kpiNote').textContent()).includes('7日'),
  );

  // --- 同じ日に続けて回しても同じ設問が出直さないか（adr-0004） ---
  // 🔥 改修前は、同じ日に20問×4本回すと4本目は既出100%だった。
  //    ここは軽い回帰確認（5問×2本）。本格的な測定は node tools/measure_pick.mjs。
  await page.click('.nav-btn[data-view="homeView"]');
  const runFive = async () => {
    await page.fill('#countInput', '5');
    await page.click('#customStartBtn');
    await page.waitForSelector('#quizView.active');
    const seen = [];
    for (let i = 0; i < 5; i++) {
      seen.push(norm(await page.locator('#questionStem').innerText()));
      await page.keyboard.press('1');
      await page.locator('#nextBtn').click();
      await page.waitForTimeout(20);
    }
    await page.click('#resultHomeBtn');
    return seen;
  };
  const first = await runFive();
  const second = await runFive();
  const dup = second.filter((k) => first.includes(k)).length;
  check('🔥 同じ日に続けて回しても同じ設問が出直さない', dup === 0, `重複 ${dup}/5 問`);
  check('2本で10問ぶんの別々の設問が出る', new Set([...first, ...second]).size === 10);

  // --- 結果画面のねぎらい（adr-0003 の追記） ---
  // 🔥 0点でも文が出ることを見る。「淡々としすぎ」への対処が、0点の日だけ空になるのを防ぐ。
  const runThree = async (correctly) => {
    await page.click('.nav-btn[data-view="homeView"]');
    await page.fill('#countInput', '3');
    await page.click('#customStartBtn');
    await page.waitForSelector('#quizView.active');
    for (let i = 0; i < 3; i++) {
      const stem = await page.locator('#questionStem').innerText();
      const key = answerKey.get(norm(stem)) ?? 0;
      // 誤答させたいときは正解以外を押す（1〜4のうち正解でない最初の番号）
      const press = correctly ? key + 1 : key === 0 ? 2 : 1;
      await page.keyboard.press(String(press));
      await page.locator('#nextBtn').click();
      await page.waitForTimeout(20);
    }
    await page.waitForSelector('#resultView.active');
    // ⚠️ 正答数と正答率は0から数え上げる（420ms）。すぐ読むと途中の値が取れる。
    //    採点印は0.85秒で消えるので、その前に読み終える必要がある。
    await page.waitForTimeout(500);
    return {
      head: (await page.locator('#resultTitle').textContent()).trim(),
      body: (await page.locator('#praiseBody').textContent()).trim(),
      fact: (await page.locator('#praiseFact').textContent()).trim(),
      rate: (await page.locator('#resultRate').textContent()).trim(),
      stamp: await page.locator('#stamp.show svg').count(),
      word: (await page.locator('#stamp').innerText()).trim(),
    };
  };

  const full = await runThree(true);
  check('満点のとき正答率が100%になる', full.rate === '100%', full.rate);
  check(
    '満点のときねぎらいの見出しと本文が出る',
    full.head.length > 0 && full.body.length > 0,
    `${full.head} / ${full.body}`,
  );
  check('満点のとき採点印が押される', full.stamp === 1 && full.word.length > 0, full.word);
  check('事実の1行が出る', full.fact.length > 0, full.fact);

  const zero = await runThree(false);
  check('0点のとき正答率が0%になる', zero.rate === '0%', zero.rate);
  check(
    '🔥 0点でもねぎらいの見出しと本文が出る',
    zero.head.length > 0 && zero.body.length > 0,
    `${zero.head} / ${zero.body}`,
  );
  check('🔥 0点でも事実の1行が出る（空の称賛にしない）', zero.fact.length > 0, zero.fact);
  check('0点でも採点印は押される', zero.stamp === 1, zero.word);

  const zero2 = await runThree(false);
  check('同じ段の文が2回続けて出ない', zero2.head !== zero.head, `${zero.head} → ${zero2.head}`);

  check('JSエラーが出ていない', errors.length === 0, errors.join(' / '));
  await context.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 件成功`);
process.exit(failed ? 1 : 0);
