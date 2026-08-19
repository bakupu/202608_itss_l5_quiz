/**
 * 設問テキストの表示用整形。
 *
 * 役割: 問題文・選択肢に含まれる記法を HTML へ変換する。
 *   ^{...}  → 上付き（E＝5.2L^{0.98} のような指数）
 *   _{...}  → 下付き
 *   改行     → <br>（過去問の〔条件〕ブロックなどで使う）
 *
 * 🔥 変換の前に必ずエスケープする。設問データは外部PDFの転記であり、
 *    `<` や `&` がそのまま入りうる（実測: HTMLの特殊文字を問う設問がある）。
 *    エスケープを後回しにすると、その設問がタグとして解釈されて表示が壊れる。
 *
 * ⚠️ この関数の戻り値は innerHTML へ入れる前提。textContent へ入れるとタグが見えてしまう。
 */

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>'"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
}

export function formatText(s) {
  return escapeHtml(s)
    .replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>')
    .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
    .replace(/\n/g, '<br>');
}
