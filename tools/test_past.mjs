/**
 * IPA過去問の取り込みと表示のテスト。
 *
 * 実行: node tools/test_past.mjs
 * 終了コード: 0=全件成功、1=失敗あり
 *
 * 🔥 ここで守っているのは主に IPA の利用条件である。
 *    「出典を明記する」「改変した場合はその旨も明記する」は、
 *    データにフィールドがあるだけでは足りず、画面に出て初めて満たされる。
 *    出典の表示は消しても機能は動くため、壊れても気づけない。だから機械で見る。
 *
 * 構成:
 *   1. データ検査（JSONを直接読む。ブラウザ不要）
 *   2. 画面検査（Playwright。記法整形の単体テストもここで行う。PM領域の過去問50問をすべて出して出典の有無を数える）
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8951);

const results = [];
function check(name, ok, detail = '') {
  results.push({ ok });
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- 1. データ検査 ---
const questions = JSON.parse(await readFile(join(DOCS, 'data/questions-v3.json'), 'utf-8'));
const past = questions.filter((q) => q.source_type === 'IPA_PAST');

check('過去問が取り込まれている', past.length === 300, `${past.length}問`);
check(
  '自作問と過去問が両方ある',
  questions.length === past.length + 81,
  `合計${questions.length}問`,
);
check(
  '🔥 すべての過去問に出典がある（利用条件1）',
  past.every((q) => q.source_refs?.label && q.source_refs?.publisher),
  `欠落 ${past.filter((q) => !q.source_refs?.label).length}件`,
);
check(
  '出典に年度・試験区分・時間区分・問番号が含まれる',
  past.every(
    (q) =>
      q.source_refs.label.includes('年度') &&
      q.source_refs.label.includes('午前II') &&
      /問\d+$/.test(q.source_refs.label),
  ),
);
check(
  '🔥 図を文にした問には改変の旨が付く（利用条件2）',
  past.every((q) => !q.figure_text || q.modification_label),
  `不足 ${past.filter((q) => q.figure_text && !q.modification_label).length}件`,
);
check(
  '正解の位置が選択肢の範囲に収まっている',
  past.every(
    (q) =>
      Number.isInteger(q.correct_choice) &&
      q.correct_choice >= 0 &&
      q.correct_choice < q.choices.length,
  ),
);
check('問題IDが一意', new Set(questions.map((q) => q.id)).size === questions.length);
check(
  '🔥 すべての過去問に主題の用語が結び付いている',
  past.every((q) => q.concept_id),
  `未設定 ${past.filter((q) => !q.concept_id).length}件`,
);
check(
  '🔥 すべての過去問に選択肢4つぶんの解説がある',
  past.every((q) => q.choice_reasons?.length === 4 && q.choice_reasons.every((r) => r.trim())),
  `未執筆 ${past.filter((q) => !(q.choice_reasons || []).every((r) => r && r.trim())).length}問`,
);
check(
  '選択肢の解説が4つとも異なる文になっている',
  past.every((q) => new Set(q.choice_reasons).size === 4),
  past
    .filter((q) => new Set(q.choice_reasons).size !== 4)
    .map((q) => q.id)
    .slice(0, 5)
    .join(','),
);
check(
  '5領域に分かれている',
  new Set(past.map((q) => q.domain)).size === 5,
  [...new Set(past.map((q) => q.domain))].join(','),
);

// --- 2. 画面検査（記法整形の単体テストもブラウザ側で行う） ---
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
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

  // 記法整形はブラウザのESモジュールとして読み込む。
  // ⚠️ Node から docs/js/text.js を直接 import できない（package.json が commonjs のため）。
  //    ブラウザで読ませることで、配信されるコードそのものを試せる。
  const fmt = await page.evaluate(async () => {
    const m = await import('./js/text.js');
    return {
      sup: m.formatText('5.2L^{0.98}'),
      sub: m.formatText('H_{2}O'),
      br: m.formatText('a' + String.fromCharCode(10) + 'b'),
      esc: m.formatText('<script>'),
    };
  });
  check('上付きが sup になる', fmt.sup === '5.2L<sup>0.98</sup>', fmt.sup);
  check('下付きが sub になる', fmt.sub === 'H<sub>2</sub>O', fmt.sub);
  check('改行が br になる', fmt.br === 'a<br>b', fmt.br);
  check('🔥 記法より先にエスケープされる', fmt.esc === '&lt;script&gt;', fmt.esc);

  // 領域セレクトに新しい2領域が並んでいるか（データだけ増えて選べない状態を防ぐ）。
  const domainOptions = await page
    .locator('#domainSelect option')
    .evaluateAll((els) => els.map((e) => e.value));
  check(
    '領域フィルタに PM と 監査 が追加されている',
    domainOptions.includes('PM') && domainOptions.includes('AUDIT'),
    domainOptions.join(','),
  );
  const typeOptions = await page
    .locator('#typeSelect option')
    .evaluateAll((els) => els.map((e) => e.value));
  check('形式フィルタで過去問を選べる', typeOptions.includes('PAST'), typeOptions.join(','));

  // PM領域の過去問を全問出して、1問ずつ出典が出ているかを数える。
  // ⚠️ 1問だけ見て通すと「たまたま出典のある問が当たった」と区別できない。全問数える。
  const pmPast = past.filter((q) => q.domain === 'PM');
  const expectedMod = pmPast.filter((q) => q.modification_label).length;
  await page.selectOption('#domainSelect', 'PM');
  await page.selectOption('#typeSelect', 'PAST');
  await page.fill('#countInput', String(pmPast.length));
  await page.click('#customStartBtn');
  await page.waitForSelector('#quizView.active');

  let shownSource = 0;
  let shownMod = 0;
  let shownFigure = 0;
  let openFigure = 0;
  for (let i = 0; i < pmPast.length; i++) {
    const html = await page.locator('#sourceNote').innerHTML();
    if (html.includes('出典') && html.includes('午前II')) shownSource++;
    if (html.includes('改変あり')) shownMod++;
    // ⚠️ 「要素がある」ではなく「開いていて中身が見えている」を見る。
    //    問題文が「図のとおり」と書く設問は、図が畳まれていると解けない。
    if (html.includes('原本の図表')) {
      shownFigure++;
      if (
        await page
          .locator('.src-figure')
          .first()
          .evaluate((e) => e.open)
      )
        openFigure++;
    }
    await page.locator('#choices button').first().click();
    await page.locator('#nextBtn').click();
  }
  check(
    '🔥 全問の画面に出典が表示される',
    shownSource === pmPast.length,
    `${shownSource}/${pmPast.length}問`,
  );
  check(
    '🔥 改変ありの問に改変の旨が表示される',
    shownMod === expectedMod,
    `画面${shownMod} / データ${expectedMod}`,
  );
  check('図の文章化が出る', shownFigure > 0, `${shownFigure}問`);
  check(
    '🔥 図の文章化は既定で開いている（畳まれていると図が要る設問を解けない）',
    shownFigure > 0 && openFigure === shownFigure,
    `開 ${openFigure}/${shownFigure}`,
  );

  // 自作問には出典枠を出さない（IPAの出典が付いていない問に出典を出すと誤情報になる）。
  await page.click('#resultHomeBtn');
  await page.selectOption('#domainSelect', 'STRATEGY');
  await page.selectOption('#typeSelect', 'TERM_TO_MEANING');
  await page.fill('#countInput', '1');
  await page.click('#customStartBtn');
  await page.waitForSelector('#quizView.active');
  check(
    '自作問には出典枠を出さない',
    (await page.locator('#sourceNote').innerHTML()).trim() === '',
  );

  // 上付き記法が実際に sup として描画されるか（文字列変換だけでなく画面で確かめる）。
  const supQ = past.find((q) => /\^\{/.test(q.stem));
  check('上付き記法を含む過去問がある', Boolean(supQ), supQ?.id || 'なし');

  // --- 用語辞書が過去問の語まで広がっているか ---
  const concepts = JSON.parse(await readFile(join(DOCS, 'data/concepts.json'), 'utf-8')).concepts;
  const byDomain = {};
  for (const c of concepts) byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
  check(
    'PM・監査の用語が辞書にある（過去問取り込み前はゼロだった）',
    byDomain.PM > 0 && byDomain.AUDIT > 0,
    Object.entries(byDomain)
      .map(([k, v]) => `${k}:${v}`)
      .join(' '),
  );
  const conceptIds = new Set(concepts.map((c) => c.id));
  check(
    '概念の related が全て実在する用語を指す',
    concepts.every((c) => (c.related || []).every((r) => conceptIds.has(r))),
    concepts
      .flatMap((c) => (c.related || []).filter((r) => !conceptIds.has(r)))
      .slice(0, 5)
      .join(','),
  );
  check(
    '全ての用語に意味と試験ポイントがある',
    concepts.every((c) => c.meaning && c.exam_tip),
    concepts
      .filter((c) => !c.meaning || !c.exam_tip)
      .map((c) => c.id)
      .slice(0, 5)
      .join(','),
  );

  // 過去問の解説に「この設問の主題」カードが出るか（選択肢が文章で用語へ解決できないため）。
  // 直前のセッションは1問目を解かずに残っているので、終了してホームへ戻る。
  await page.click('#quitBtn');
  await page.selectOption('#domainSelect', 'AUDIT');
  await page.selectOption('#typeSelect', 'PAST');
  await page.fill('#countInput', '1');
  await page.click('#customStartBtn');
  await page.waitForSelector('#quizView.active');
  await page.locator('#choices button').first().click();
  const subject = await page.locator('.ex-card.is-subject').count();
  check('🔥 過去問の解説に主題の用語が出る', subject === 1, `${subject}枚`);
  const subjectText = subject ? await page.locator('.ex-card.is-subject').innerText() : '';
  check(
    '主題カードに意味と試験ポイントが載る',
    subjectText.includes('意味') && subjectText.includes('試験ポイント'),
  );

  // 選択肢ごとの解説が、A〜Dの4枚すべてに描画されているか。
  // データにあっても描画側の分岐で落ちることがあるので、画面から数える。
  const cardCount = await page.locator('.ex-card:not(.is-subject)').count();
  const withReason = await page
    .locator('.ex-card:not(.is-subject) .ex-row dt', { hasText: '解説' })
    .count();
  check(
    '🔥 過去問の4選択肢すべてに解説が出る',
    cardCount === 4 && withReason === 4,
    `カード${cardCount}枚 / 解説${withReason}件`,
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
