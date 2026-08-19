"""転記結果の「改変」判定を一本の基準へ揃える。

概要: 12回分の転記は担当を分けたため、同じ性質のものが片方は改変、片方は注記と
      ばらついていた。ここで基準を1か所に集約し、全問へ当て直す。
入力/出力: 60_exams/<試験>/<年度>/merged.json（その場で更新）
実行: python tools/normalize_exams.py
終了コード: 0=全問分類できた, 1=未分類が残っている

分類（modification_kind）:
  figure_to_text … 図・グラフ・表を文へ変換した。原本の見た目とは異なる → 改変
  notation       … 上付き・下付き・丸数字などの字面を記法へ置き換えた → 改変
  layout_only    … 2段組・ルビ・下線など紙面の体裁のみ。文字列は原本どおり → 改変ではない
  transcription_fix … 転記時の読み取りを文脈から訂正した → 改変ではない（原本へ近づける修正）

🔥 IPA の利用条件は「改変した場合はその旨も明記する」。
   figure_to_text と notation は画面へ改変の旨を出す。layout_only は出さない。

⚠️ 注記や改変フラグが付いた問で、この表に載っていないものがあると失敗する。
   新しい回を足したら必ずここへ追記する。「表に無い＝分類し忘れ」を検出するための仕組み。
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
EXAM_DIR = ROOT / '60_exams'

# (試験, 年度キー, 問番号) → 分類
CLASSIFY = {
    # --- 図・グラフ・表を文へ変換した ---
    ('ST', '2025r07h', 5): 'figure_to_text',
    ('ST', '2025r07h', 24): 'figure_to_text',
    ('SA', '2025r07h', 24): 'figure_to_text',
    ('SC', '2025r07h', 18): 'figure_to_text',
    ('SC', '2025r07h', 20): 'figure_to_text',
    ('SC', '2025r07h', 21): 'figure_to_text',  # 縦並びの値を「，」で結合。注記止まりだった
    ('SC', '2024r06h', 16): 'figure_to_text',
    ('SC', '2024r06h', 24): 'figure_to_text',
    ('SC', '2024r06a', 7): 'figure_to_text',
    ('AU', '2025r07a', 8): 'figure_to_text',
    ('AU', '2025r07a', 10): 'figure_to_text',
    ('PM', '2024r06a', 10): 'figure_to_text',
    ('PM', '2025r07a', 18): 'figure_to_text',  # グラフを文で記述。注記止まりだった
    # --- 上付き・下付きなどの記法 ---
    ('PM', '2024r06a', 9): 'notation',
    ('PM', '2025r07a', 9): 'notation',  # グラフ変換も含むが、式の記法が主
    ('SA', '2025r07h', 17): 'notation',
    ('SA', '2025r07h', 7): 'notation',  # 丸数字
    # --- 転記の訂正 ---
    ('SC', '2024r06a', 12): 'transcription_fix',
    # --- 紙面の体裁のみ（内容は原本どおり） ---
    ('AU', '2024r06a', 20): 'layout_only',
    ('AU', '2025r07a', 3): 'layout_only',
    ('AU', '2025r07a', 23): 'layout_only',
    ('PM', '2024r06a', 12): 'layout_only',
    ('PM', '2024r06a', 24): 'layout_only',
    ('PM', '2025r07a', 7): 'layout_only',
    ('SA', '2025r07h', 8): 'layout_only',
    ('SC', '2024r06h', 3): 'layout_only',
    ('SC', '2024r06h', 9): 'layout_only',
    ('SC', '2024r06h', 11): 'layout_only',
    ('SC', '2024r06h', 17): 'layout_only',
    ('SC', '2024r06h', 18): 'layout_only',
    ('SC', '2025r07a', 16): 'layout_only',
    ('ST', '2024r06h', 5): 'layout_only',
}

MODIFIED_KINDS = {'figure_to_text', 'notation'}

KIND_LABEL = {
    'figure_to_text': '図・表・グラフを文へ変換',
    'notation': '上付き・下付き等を記法へ置換',
    'layout_only': '紙面の体裁のみ（文字列は原本どおり）',
    'transcription_fix': '転記の読み取りを文脈から訂正',
}


def main():
    unclassified = []
    counts = {k: 0 for k in KIND_LABEL}
    total = 0

    for path in sorted(EXAM_DIR.glob('*/*/merged.json')):
        doc = json.loads(path.read_text(encoding='utf-8'))
        exam, year = doc['exam'], doc['year_key']
        changed = False
        for q in doc['questions']:
            total += 1
            no = q['question_no']
            has_flag = bool((q.get('note') or '').strip()) or q.get('modified')
            kind = CLASSIFY.get((exam, year, no))

            if kind is None:
                if has_flag:
                    unclassified.append(f'{exam}/{year} 問{no}')
                q['modification_kind'] = None
                q['modified'] = False
                changed = True
                continue

            q['modification_kind'] = kind
            q['modified'] = kind in MODIFIED_KINDS
            q['modification_label'] = KIND_LABEL[kind]
            counts[kind] += 1
            changed = True

        if changed:
            path.write_text(
                json.dumps(doc, ensure_ascii=False, indent=2) + '\n',
                encoding='utf-8',
                newline='\n',
            )

    print(f'対象 {total} 問')
    for k, v in counts.items():
        mark = '改変あり' if k in MODIFIED_KINDS else '改変なし'
        print(f'  {k:18} {v:3}問  ({mark}) {KIND_LABEL[k]}')
    modified = sum(counts[k] for k in MODIFIED_KINDS)
    print(f'画面に改変の旨を表示する問: {modified}')

    if unclassified:
        print('\nNG  注記や改変フラグがあるのに分類表へ載っていない問:')
        for u in unclassified:
            print(f'  - {u}')
        return 1
    print('\nOK  分類漏れなし')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
