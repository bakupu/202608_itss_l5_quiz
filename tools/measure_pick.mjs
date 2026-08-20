/**
 * 出題の偏りを測る。
 *
 * 概要: docs/ を静的配信し、実アプリを操作して「同じ日に何セットも回したとき、
 *       同じ設問がどれだけ出直すか」を数える。
 * 目的: 「同じ問題ばかり出る」は体感でしか気づけず、体感は次の変更で必ず忘れられる。
 *       判断（adr-0004）の受け入れ基準を、数えられる形で置いておく。
 * 実行: node tools/measure_pick.mjs
 *       CORRECT=1 … 毎問正解する（既定は毎問ア＝1を押すので誤答が混ざる）
 *       N=20       … 1セッションの問題数（既定20）
 *       SESSIONS=4 … 回すセッション数（既定4）
 * 出力: 標準出力に重複率と、出た設問の実数。ファイルは書かない。
 * 注意:
 *   - 🔥 乱数は差し替えない（tools/shoot.mjs とは逆）。本物の Math.random で測る。
 *   - localStorage は空から始まる。実機の履歴とは別の条件なので、値は比較用の指標として読む。
 * 失敗時: ポート衝突なら PORT を変える。Chromium 未導入なら `npx playwright install chromium`。
 *
 * adr-0004 時点の実測（改修前 → 改修後）:
 *   誤答運用・20問×4本 … 4本目の既出重複 100% → 0%、80問で出た実数 28問 → 80問
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8979);
const N = Number(process.env.N || 20);
const SESSIONS = Number(process.env.SESSIONS || 4);
const ALWAYS_CORRECT = process.env.CORRECT === '1';

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

// 設問データから正解の位置を引く（誤答だけを続けると原因が混ざるため、正答運用も測れるようにする）
const qdoc = JSON.parse(await readFile(join(DOCS, 'data/questions-v3.json'), 'utf-8'));
const norm = (t) =>
  String(t)
    .replace(/[\^_]\{|\}/g, '')
    .replace(/\s+/g, '')
    .slice(0, 60);
const answerKey = new Map((qdoc.questions || qdoc).map((q) => [norm(q.stem), q.correct_choice]));
// ⚠️ 設問の見分けは問題文の先頭で行う。短く切ると「次の説明に該当する用語はどれか。」のような
//    共通の書き出しで別の設問と衝突し、重複数が実際より多く見える。

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

async function runSession() {
  await page.fill('#countInput', String(N));
  await page.click('#customStartBtn');
  await page.waitForSelector('#quizView.active');
  const seen = [];
  for (let i = 0; i < N; i++) {
    const stem = await page.locator('#questionStem').innerText();
    seen.push(norm(stem));
    const idx = ALWAYS_CORRECT ? (answerKey.get(norm(stem)) ?? 0) : 0;
    await page.keyboard.press(String(idx + 1));
    await page.locator('#nextBtn').click();
    await page.waitForTimeout(30);
  }
  await page.click('#resultHomeBtn');
  return seen;
}

const sessions = [];
for (let s = 0; s < SESSIONS; s++) sessions.push(await runSession());

console.log(
  `1セッション ${N}問 × ${SESSIONS}本（同じ日に連続）／${ALWAYS_CORRECT ? '毎問正答' : '毎問ア（誤答が混ざる）'}`,
);
for (let i = 1; i < sessions.length; i++) {
  const prev = new Set(sessions.slice(0, i).flat());
  const dup = sessions[i].filter((k) => prev.has(k)).length;
  console.log(`  ${i + 1}本目: 既出との重複 ${dup}/${N} 問 (${Math.round((dup / N) * 100)}%)`);
}
const all = sessions.flat();
console.log(
  `  出た設問の実数: ${new Set(all).size} / のべ ${all.length} 問（全 ${(qdoc.questions || qdoc).length} 問中）`,
);
if (errors.length) console.error('⚠️ JSエラー:\n  ' + errors.join('\n  '));

await ctx.close();
await browser.close();
server.close();
