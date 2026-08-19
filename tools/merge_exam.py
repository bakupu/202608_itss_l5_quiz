"""過去問の転記結果を結合し、機械的に検算してから取り込み用データにする。

概要: 複数エージェントが分担して転記した extract-*.json を1本にまとめ、
      解答例（answer-key.json）と突合して、問番号の欠落・重複・正解の整合を検査する。
入力: 60_exams/<試験>/<年度>/extract-*.json, answer-key.json
出力: 60_exams/<試験>/<年度>/merged.json（検査に通った場合のみ）
実行: python tools/merge_exam.py ST 2025r07h
終了コード: 0=検査に通った, 1=検査で問題を検出（内容は標準出力）

🔥 転記は人手でも機械でも必ず誤る。ここを通さずに questions へ入れない。
   とくに「25問そろっているか」「正解の記号が解答例と一致するか」は
   目視では見落とすが、突合すれば確実に出る。

⚠️ このスクリプトが検算できるのは構造と正解記号だけで、
   問題文が原文どおりかは検算できない。本文の正しさは画像との読み合わせで担保する。
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ']


def main(argv):
    if len(argv) != 2:
        print('使い方: python tools/merge_exam.py <試験コード> <年度キー>   例) ST 2025r07h')
        return 2
    exam, year = argv[0].upper(), argv[1]
    base = ROOT / '60_exams' / exam / year
    if not base.is_dir():
        print(f'ディレクトリがない: {base}')
        return 2

    key_path = base / 'answer-key.json'
    if not key_path.exists():
        print(f'解答例が無い: {key_path}（先に解答例PDFを読んで作る）')
        return 2
    key = json.loads(key_path.read_text(encoding='utf-8'))
    answers = key['answers']

    items = []
    files = sorted(base.glob('extract-*.json'))
    if not files:
        print('転記結果 extract-*.json が無い')
        return 2
    for f in files:
        try:
            part = json.loads(f.read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            print(f'NG  {f.name} がJSONとして壊れている: {e}')
            return 1
        print(f'読込 {f.name}: {len(part)}問')
        items.extend(part)

    problems = []
    seen = {}
    for q in items:
        no = q.get('question_no')
        if no in seen:
            problems.append(f'問{no} が {seen[no]} と重複している')
        seen[no] = q.get('page')

    expected = set(range(1, len(answers) + 1))
    got = set(seen)
    missing = sorted(expected - got)
    extra = sorted(got - expected)
    if missing:
        problems.append(f'転記されていない問: {missing}')
    if extra:
        problems.append(f'存在しないはずの問: {extra}')

    for q in items:
        no = str(q.get('question_no'))
        choices = q.get('choices') or []
        if len(choices) != 4:
            problems.append(f'問{no} の選択肢が{len(choices)}個（4個であるべき）')
        if not (q.get('stem') or '').strip():
            problems.append(f'問{no} の問題文が空')
        for i, c in enumerate(choices):
            if not (c or '').strip():
                problems.append(f'問{no} の選択肢{CHOICE_LABELS[i]}が空')
        # 選択肢の先頭に記号が残っていないか（「ア　ABC分析」のような転記ミス）。
        # ⚠️ 先頭1文字だけで判定すると「インシデント…」の「イ」を記号と誤検知する。
        #    記号の直後に空白が来る場合だけを疑う。
        for i, c in enumerate(choices):
            head = (c or '').strip()[:2]
            if len(head) == 2 and head[0] in CHOICE_LABELS and head[1] in ' 　	':
                problems.append(f'問{no} の選択肢{CHOICE_LABELS[i]}に記号が残っている: {c[:12]}')
        if no not in answers:
            problems.append(f'問{no} の正解が解答例に無い')

    notes = [(q['question_no'], q['note']) for q in items if (q.get('note') or '').strip()]
    figures = sorted(q['question_no'] for q in items if q.get('has_figure'))
    modified = sorted(q['question_no'] for q in items if q.get('modified'))

    # 🔥 改変した問は、改変した旨を明記することが利用条件。記録が無い改変は検査で落とす。
    for q in items:
        if q.get('modified') and not (q.get('modification_note') or '').strip():
            problems.append(f'問{q["question_no"]} は改変ありだが modification_note が空')

    print()
    print(f'転記 {len(items)}問 / 解答例 {len(answers)}問')
    print(f'図表ありの問: {figures if figures else "なし"}')
    print(f'改変ありの問（画面に改変の旨を表示する）: {modified if modified else "なし"}')
    if notes:
        print('👤 転記者が不確かと申告した問（画像と読み合わせる）:')
        for no, n in sorted(notes):
            print(f'  問{no}: {n}')

    if problems:
        print('\nNG  検査で問題を検出:')
        for p in problems:
            print(f'  - {p}')
        return 1

    merged = {
        'exam': exam,
        'year_key': year,
        'source_label': key.get('source', ''),
        'questions': sorted(items, key=lambda q: q['question_no']),
        'answers': answers,
    }
    out = base / 'merged.json'
    out.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'\nOK  検査に通った → {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
