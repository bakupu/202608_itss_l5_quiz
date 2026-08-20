/**
 * 見た目の設定（配色・問題文の書体・文字サイズ・解説の開きかた）。
 *
 * 役割: `<html>` の data 属性を切り替えるだけで全画面の見た目が変わる。CSSの
 *       `[data-theme='night']` などがトークンを差し替えるので、ここでは値を持つだけで色を知らない。
 * 保存: localStorage の `itss-l5-ui-v1`。
 *       🔥 学習履歴（itss-l5-study-state-v1/v2/v3）とは別キー。見た目の保存で履歴を壊さないため。
 * 初期適用: index.html の <head> のインラインスクリプトが行う（最初の描画より前に当てるため）。
 *           このモジュールは「押されたら変える」と「押されている状態を出す」を担う。
 * 失敗時: localStorage が使えない環境では既定値で動き、選択が保存されないだけになる。
 */

const KEY = 'itss-l5-ui-v1';

// 設定名 → { 既定値, 有効値, data属性名 }。
// ⚠️ 有効値は index.html の data-value と揃える。片方だけ増やすと押しても何も起きない。
const DEFS = {
  theme: { def: 'paper', values: ['paper', 'linen', 'night', 'auto'], attr: 'theme' },
  examFont: { def: 'mincho', values: ['mincho', 'gothic'], attr: 'examFont' },
  textSize: { def: 'm', values: ['s', 'm', 'l'], attr: 'textSize' },
  explain: { def: 'all', values: ['all', 'focus'], attr: 'explain' },
};

// 端末のテーマ色（ブラウザのアドレスバー等）。配色を変えたら合わせる。
const THEME_COLOR = { paper: '#edf0ec', linen: '#f6f1e7', night: '#0f1520' };

let current = load();

function load() {
  const out = {};
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    saved = {};
  }
  for (const [name, d] of Object.entries(DEFS)) {
    out[name] = d.values.includes(saved[name]) ? saved[name] : d.def;
  }
  return out;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 保存できなくても、このセッションの見た目は変わる */
  }
}

export function getSetting(name) {
  return current[name];
}

function applyAll() {
  const r = document.documentElement;
  for (const [name, d] of Object.entries(DEFS)) r.dataset[d.attr] = current[name];
  const theme =
    current.theme === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'night'
        : 'paper'
      : current.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.paper);
}

/**
 * 設定UIを動かす。
 * @param {(name:string)=>void} onChange 変更後に呼ばれる（描画のやり直しに使う）
 */
export function initSettings(onChange) {
  applyAll();
  const groups = [...document.querySelectorAll('.seg[data-setting]')];
  const paint = () => {
    for (const g of groups) {
      const name = g.dataset.setting;
      for (const b of g.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b.dataset.value === current[name]));
      }
    }
  };
  for (const g of groups) {
    const name = g.dataset.setting;
    for (const b of g.querySelectorAll('button')) {
      b.onclick = () => {
        if (!DEFS[name]?.values.includes(b.dataset.value)) return;
        current[name] = b.dataset.value;
        save();
        applyAll();
        paint();
        onChange?.(name);
      };
    }
  }
  paint();
  // 「端末に合わせる」を選んでいるときは、端末側の切り替えにも追従する。
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => current.theme === 'auto' && applyAll());
}
