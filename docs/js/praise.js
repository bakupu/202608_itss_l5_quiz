/**
 * セッション終了時のねぎらい文（結果画面）。
 *
 * 役割: 正答率から5段階のレベルを決め、その段の文を1つ選ぶ。文は「見出し（短い）」と
 *       「本文（次の一手）」の対で持つ。画面では見出しを大きく、本文を小さく出す。
 * 方針:
 *   - 🔥 **0点でも嘘を書かない。** 「0点でも素晴らしい」のような空の称賛は、本人が一番分かっているので
 *     褒め全体の信用を落とす。0点の段は「答えた問題が明日また出る」「連続日数は途切れない」など、
 *     やったことが仕組み上どう効いたかを書く。
 *   - ⚠️ 各段6本持つ。3本だと同じ段を4回引けば必ず重複する。3問セッションを毎日回すと
 *     レベルは2〜3種に集中するため、重複は思ったより早く来る。
 *   - 直前に出した文は避ける（`itss-l5-praise-v1` に段ごとの直前の番号を持つ。
 *     ⚠️ 学習履歴のキーには触らない。消えても文が1回重複するだけ）。
 * レベルの境界: 0% / 1〜39% / 40〜69% / 70〜99% / 100%。
 *   ⚠️ 3問セッションでは 0・33・67・100% の4値しか出ないので、70〜99%の段は3問では出ない。
 *      20問以上のセッションで効く段として置いてある。
 */

const KEY = 'itss-l5-praise-v1';

// mark は結果画面の採点印に入れる語。輪の中に収まるのは2文字まで。
// tone は印の色（good=青緑 / ai=藍）。
const LEVELS = [
  {
    key: 'none',
    mark: '継続',
    tone: 'ai',
    messages: [
      ['今日も開いた', '3問ともLv1になり、明日の復習に並んだ'],
      ['継続はした', '全部外しても、答えた問題は間隔1日で戻ってくる。明日が本番'],
      ['初見の3問', '知らない問題を見つけた。見つけないと覚えようがない'],
      ['記録は積んだ', '今日の回答は連続日数に入る。0点でも途切れない'],
      ['明日に効く', '外した問題は最短間隔（1日後）で出る。ここが一番伸びる'],
      ['読んだぶんは残る', '解説を読んだ問題は、次に見たとき知っている問題になる'],
    ],
  },
  {
    key: 'low',
    mark: '一歩',
    tone: 'ai',
    messages: [
      ['取れた分はある', '当てた問題は次に出るまで間隔が開く。残りは明日また出る'],
      ['一歩進んだ', '知らない問題に当たった日。誤答は明日の復習に並んだ'],
      ['初見が多かった', '初見で外すのは想定どおり。2回目からが本番'],
      ['取っ掛かりはできた', '答えた問題はすべてLv1以上になった'],
      ['まだ入り口', 'この領域は伸びしろが大きい。明日また出る'],
      ['難しい方を引いた', '外した問題ほど、次に出るまでの間隔が短い'],
    ],
  },
  {
    key: 'mid',
    mark: '良し',
    tone: 'ai',
    messages: [
      ['半分は取れた', '落とした問題は明日また出る。そこで取れば定着する'],
      ['良し', '正解は間隔が開き、誤答は明日に詰まった。仕組みは動いている'],
      ['五分の出来', '当てた問題と外した問題の差が、いま一番学べるところ'],
      ['取れたぶんは残る', '誤答は消えない。復習リストからいつでも拾える'],
      ['半々', '解説を読んだ分は明日に効く。今日はここまででいい'],
      ['拾いに行けた', '間違えた問題は最短間隔で戻ってくる'],
    ],
  },
  {
    key: 'high',
    mark: '上々',
    tone: 'good',
    messages: [
      ['ほぼ取れた', '落とした問題だけが明日また出る。そこを取れば揃う'],
      ['上々', '大半は身についている。残りは覚え直すより、なぜ違うかを一度読む'],
      ['あと少し', '間違えた問題は間隔が1日に詰まった。明日拾える'],
      ['まず十分', '取れる問題は取れている。残りは選択肢の差を見る'],
      ['7割超え', '科目Aの合格ラインは6割。この調子なら余裕がある'],
      ['大きく崩れず', '落とした問題は復習リストに乗った'],
    ],
  },
  {
    key: 'full',
    mark: '満点',
    tone: 'good',
    messages: [
      ['全問正解', '取りこぼしなし。7日空けてもう一度当てればLv4＝習得に入る'],
      ['満点', '迷わず選べた問題は、次に出るまでの間隔が伸びる'],
      ['全部当てた', 'この形式は身体に入っている。問題数を増やしてもいい'],
      ['取りこぼしなし', '同じ調子で回せば、5領域の到達度が動く'],
      ['完答', '正解した問題は間隔が開く。明日は別の問題が出る'],
      ['危なげなし', '知っている問題を確認できた。未回答の問題を混ぜる余地がある'],
    ],
  },
];

function levelIndex(correct, total) {
  if (!total) return 0;
  const rate = (correct / total) * 100;
  if (rate <= 0) return 0;
  if (rate < 40) return 1;
  if (rate < 70) return 2;
  if (rate < 100) return 3;
  return 4;
}

function readLast() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * 正答数からねぎらい文を1つ選ぶ。
 * @param {number} correct 正解数
 * @param {number} total 出題数
 * @returns {{head:string, body:string, mark:string, tone:string, level:string}}
 */
export function pickPraise(correct, total) {
  const lv = LEVELS[levelIndex(correct, total)];
  const last = readLast();
  // 直前に出した番号を避ける。1本しか無い段では避けようがないので、そのまま出す。
  const choices = lv.messages.map((_, i) => i).filter((i) => i !== last[lv.key]);
  const pick = choices[Math.floor(Math.random() * choices.length)] ?? 0;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...last, [lv.key]: pick }));
  } catch {
    /* 保存できなくても、文が1回重複するだけ */
  }
  const [head, body] = lv.messages[pick];
  return { head, body, mark: lv.mark, tone: lv.tone, level: lv.key };
}

/**
 * その日いちばん強い「事実」を1行返す。
 *
 * 🔥 これがあるので、0点の日にも空の称賛をせずに済む。強い順に見て最初に当たったものを返す。
 * ⚠️ 0点のセッションでも「Lvが上がった」は成立する（未回答→Lv1）。ただし0点の日に効くのは
 *    「落とした問題が明日また出る」なので、Lvの上昇は1問でも正解した日に限って出す。
 * @param {{delta:number, milestone:number|null, streak:number, lvUp:number, correct:number, wrong:number, answered:number}} f
 */
export function praiseFact(f) {
  if (f.delta > 0) return `新しく${f.delta}問が習得（Lv4）に入った`;
  if (f.milestone) return `累積${f.milestone}問に到達`;
  if (f.streak >= 2) return `これで${f.streak}日連続`;
  if (f.lvUp > 0 && f.correct > 0) return `${f.lvUp}問の習得Lvが上がった`;
  if (f.wrong > 0) return `落とした${f.wrong}問は明日また出る`;
  return `答えた${f.answered}問が復習の予定に入った`;
}

/** 累積回答数の節目（このセッションで越えたものだけ返す）。 */
export function crossedMilestone(before, after) {
  const marks = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 2000];
  return marks.filter((m) => before < m && after >= m).pop() || null;
}
