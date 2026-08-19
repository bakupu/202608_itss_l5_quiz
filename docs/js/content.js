/**
 * 学習コンテンツの読み込みと、学習履歴のバージョン移行。
 *
 * 役割:
 *   - questions-v3.json / concepts.json / legacy-id-map.json を読む
 *   - localStorage の学習履歴を v2（旧連番ID）から v3（永久ID）へ移行する
 *
 * 🔥 移行では v2 / v1 を消さない。★・誤答履歴・習得Lvは localStorage にしか無く、
 *    失うと復元できない。v3 の書き込みに失敗しても元へ戻せる状態を保つ。
 */

export const STORAGE_KEY_V3 = 'itss-l5-study-state-v3';
export const STORAGE_KEY_V2 = 'itss-l5-study-state-v2';
export const STORAGE_KEY_V1 = 'itss-l5-study-state-v1';

export function blankState() {
  return { progress: {}, attempts: [], daily: {} };
}

export async function loadContent() {
  const [questions, conceptDoc, legacyMap] = await Promise.all([
    fetch('data/questions-v3.json').then((r) => r.json()),
    fetch('data/concepts.json').then((r) => r.json()),
    fetch('data/legacy-id-map.json').then((r) => r.json()),
  ]);
  const concepts = new Map(conceptDoc.concepts.map((c) => [c.id, c]));
  return {
    questions: questions.filter((q) => q.is_active !== false),
    concepts,
    legacyMap,
  };
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // 壊れた値を黙って捨てると、履歴が消えた理由が後から分からなくなる。
    console.error(`localStorage の ${key} を読めませんでした。移行をスキップします。`, e);
    return null;
  }
}

/**
 * 旧IDで記録された履歴を永久IDへ張り替える。
 * 対応表に無いIDは、変換せずそのまま残す（消さない）。
 */
export function convertState(old, legacyMap) {
  const converted = blankState();
  converted.daily = old.daily || {};

  for (const [oldId, p] of Object.entries(old.progress || {})) {
    converted.progress[legacyMap[oldId] || oldId] = p;
  }
  converted.attempts = (old.attempts || []).map((a) => ({
    ...a,
    question_id: legacyMap[a.question_id] || a.question_id,
  }));

  const unknown = Object.keys(old.progress || {}).filter((id) => !legacyMap[id]);
  return { state: converted, unknownIds: unknown };
}

/**
 * v3 の履歴を返す。無ければ v2（無ければ v1）から移行して作る。
 * 戻り値の migrated は「今回移行を実行したか」。呼び出し側の表示判断に使う。
 */
export function loadStateV3(legacyMap) {
  const v3 = readJson(STORAGE_KEY_V3);
  if (v3) return { state: v3, migrated: false, unknownIds: [] };

  const source = readJson(STORAGE_KEY_V2) || readJson(STORAGE_KEY_V1);
  if (!source) return { state: blankState(), migrated: false, unknownIds: [] };

  const { state, unknownIds } = convertState(source, legacyMap);
  localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(state));
  if (unknownIds.length) {
    console.warn(
      `対応表に無い問題IDが ${unknownIds.length} 件ありました。変換せず保持します。`,
      unknownIds,
    );
  }
  console.info(
    `学習履歴を v3 へ移行しました（進捗 ${Object.keys(state.progress).length} 件 / 回答 ${state.attempts.length} 件）。旧データは残しています。`,
  );
  return { state, migrated: true, unknownIds };
}
