/**
 * 画面スクリーンショット撮影スクリプト（目視検証用）。
 *
 * 概要: docs/ を静的配信し、Chromium で主要画面をスマホ幅・PC幅の2解像度で撮影する。
 * 目的: 変更の前後で画面が変わっていないか（整形・リファクタ時）、
 *       または意図どおり変わったか（UI改修時）を、実機を出す前に自分で確かめる。
 * 実行: node tools/shoot.mjs <ラベル>
 *       例) node tools/shoot.mjs before  →  60_shots/before/ へ出力
 * 出力: 60_shots/<ラベル>/<画面>-<幅>.png（このディレクトリは .gitignore 対象）
 * オプション（環境変数）:
 *   PORT      … 静的配信のポート（既定 8931）
 *   DOCS_DIR  … 配信するディレクトリ（既定 docs/）。変更前後を比較するとき、
 *               `git archive HEAD docs` で取り出した旧版を指定して撮る
 * 注意:
 *   - 既存の同名ファイルは上書きする。ネットワークは使わない（Supabaseは未設定のため無効）。
 *   - 出題は本来 Math.random() でランダムに選ばれる。撮影中だけ固定シードの疑似乱数へ
 *     差し替えており、そのままでは撮影ごとに違う問題が写って比較できない。
 * 失敗時: ポート衝突なら PORT を変える。Chromium 未導入なら `npx playwright install chromium`。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = process.env.DOCS_DIR || join(ROOT, 'docs');
const PORT = Number(process.env.PORT || 8931);
const label = process.argv[2];

if (!label) {
  console.error('使い方: node tools/shoot.mjs <ラベル>   例) node tools/shoot.mjs before');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(DOCS, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// 各画面の撮影手順。name が出力ファイル名になる。
const SCREENS = [
  { name: '1-home', act: async () => {} },
  { name: '2-question', act: async (page) => page.click('#dailyStartBtn') },
  { name: '3-feedback', act: async (page) => page.click('#choices button:first-child') },
  { name: '4-dashboard', act: async (page) => page.click('.nav-btn[data-view="dashboardView"]') },
  { name: '5-review', act: async (page) => page.click('.nav-btn[data-view="reviewView"]') },
];

const VIEWPORTS = [
  { tag: 'mobile', width: 390, height: 844 },
  { tag: 'desktop', width: 1280, height: 900 },
];

await new Promise((r) => server.listen(PORT, r));
const outDir = join(ROOT, '60_shots', label);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    // 端末ごとに新しいコンテキストを作り、localStorage を空の状態から始める。
    // 履歴が残っていると「今日の3問」の出題が変わり、撮影結果が再現しなくなる。
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    // 出題選択は Math.random() を使う。撮影のたびに違う問題が写ると変更前後を比較できないため、
    // ページ読み込み前に固定シードの線形合同法へ差し替える（撮影時だけの措置）。
    await page.addInitScript(() => {
      let seed = 20260819;
      Math.random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
    });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    for (const screen of SCREENS) {
      await screen.act(page);
      await page.waitForTimeout(250);
      // fullPage 撮影では position:fixed の要素がページ中央へ描画され、本文に重なって写る
      // （実機の見え方ではなく撮影側の挙動）。撮影の間だけ static へ落として本文を隠さないようにする。
      await page.addStyleTag({ content: '.bottom-nav{position:static !important}' });
      const out = join(outDir, `${screen.name}-${vp.tag}.png`);
      await page.screenshot({ path: out, fullPage: true });
      console.log(out);
    }
    if (errors.length) console.error(`⚠️ ${vp.tag} でJSエラー:\n  ` + errors.join('\n  '));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
