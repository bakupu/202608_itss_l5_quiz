"""IPA 過去問（科目A-2 / 旧・午前II）の取得とページ画像化。

概要: IPA が公開している過去問題PDF（問題冊子・解答例）を取得し、各ページをPNGへ書き出す。
      PDFは全ページが画像でテキスト層を持たないため、読み取りは画像に対して行う。
入力: なし（IPAのサイトから取得する）
出力: 60_exams/<試験コード>/<年度キー>/ 配下に PDF と page-NN.png
実行: python tools/fetch_exams.py ST 2025r07h
      python tools/fetch_exams.py --list          利用できる試験コードを表示

利用条件（2026-08-19 時点でIPAサイトを確認）:
  公表されている過去問題は、法令に特別の定めがある場合を除き許諾も使用料も不要。
  ただし利用時は次を守る。
    1. 出典を明記する（年度・期・試験区分・時間区分・問番号）
    2. 問題を改変した場合はその旨も明記する
    3. 著作権はIPAが放棄していない
  🔥 このリポジトリでは問題データの source_refs に出典を持たせ、画面にも表示する。
     出典表示を外すと利用条件を満たさなくなる。

安全上の注意:
  - 取得先はIPAの公開URLのみ。既存の同名ファイルは上書きする
  - 出力先 60_exams/ は .gitignore 対象。PDFは1本2MB程度あり、リポジトリへは入れない
失敗時:
  - 404 が返る場合は年度キーの期記号（h/a）が違う可能性がある。IPAの年度ページで実URLを確認する
  - PDFのURLに含まれるハッシュ部分は年度ページごとに異なるため、YEARS へ実URLの断片を登録する
"""

import sys
import urllib.request
from pathlib import Path

import fitz

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = ROOT / '60_exams'
BASE = 'https://www.ipa.go.jp/shiken/mondai-kaiotu'

# 試験区分コード → 表示名。科目A-2（旧・午前II）を対象にする。
EXAMS = {
    'ST': 'ITストラテジスト試験',
    'SA': 'システムアーキテクト試験',
    'PM': 'プロジェクトマネージャ試験',
    'AU': 'システム監査技術者試験',
    'SC': '情報処理安全確保支援士試験',
}

# 年度キー → その年度ページのPDF格納パス（IPAのページごとに異なるハッシュ）。
# 新しい年度を足すときは https://www.ipa.go.jp/shiken/mondai-kaiotu/<年度>.html を開いて
# 問題冊子PDFのURLからハッシュ部分を写す。
YEARS = {
    '2024r06h': 'm42obm000000afqx-att',  # 令和6年度 春期
    '2024r06a': 'm42obm000000afqx-att',  # 令和6年度 秋期
    '2025r07h': 'nl10bi0000009lh8-att',  # 令和7年度 春期
    '2025r07a': 'nl10bi0000009lh8-att',  # 令和7年度 秋期
}

# 実施された組合せ。ST/SA は春、PM/AU は秋、SC は春秋の年2回。
# ⚠️ 実施されていない組合せを指定すると 404 になる。IPAの年度ページで確認して足す。
TARGETS = [
    ('ST', '2024r06h'), ('SA', '2024r06h'), ('SC', '2024r06h'),
    ('PM', '2024r06a'), ('AU', '2024r06a'), ('SC', '2024r06a'),
    ('ST', '2025r07h'), ('SA', '2025r07h'), ('SC', '2025r07h'),
    ('PM', '2025r07a'), ('AU', '2025r07a'), ('SC', '2025r07a'),
]

DPI = 150  # 実測: 150dpi で本文・選択肢とも判読できる


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'itss-l5-study/1.0'})
    with urllib.request.urlopen(req) as res:
        body = res.read()
    dest.write_bytes(body)
    print(f'取得 {dest.name} ({len(body):,} bytes)')


def render(pdf: Path) -> int:
    doc = fitz.open(pdf)
    for i, page in enumerate(doc, start=1):
        out = pdf.parent / f'{pdf.stem}-p{i:02}.png'
        page.get_pixmap(dpi=DPI).save(out)
    print(f'画像化 {pdf.name} → {len(doc)} ページ')
    return len(doc)


def one(exam: str, year: str) -> None:
    out_dir = OUT_ROOT / exam / year
    for kind in ('qs', 'ans'):
        name = f'{year}_{exam.lower()}_am2_{kind}.pdf'
        url = f'{BASE}/{YEARS[year]}/{name}'
        dest = out_dir / name
        if dest.exists():
            print(f'既存 {dest.name}（再取得しない）')
        else:
            fetch(url, dest)
        if not list(dest.parent.glob(f'{dest.stem}-p*.png')):
            render(dest)


def main(argv):
    if not argv or argv[0] == '--list':
        print('試験コード:', ', '.join(f'{k}({v})' for k, v in EXAMS.items()))
        print('年度キー  :', ', '.join(YEARS))
        print('対象一覧  :', ', '.join(f'{e}/{y}' for e, y in TARGETS))
        return 0

    if argv[0] == '--all':
        for exam, year in TARGETS:
            print(f'--- {exam} {year}')
            one(exam, year)
        print(f'{len(TARGETS)} 回分を処理した。出力先: {OUT_ROOT}')
        return 0

    if len(argv) != 2:
        print('使い方: python tools/fetch_exams.py <試験コード> <年度キー>')
        print('        python tools/fetch_exams.py --all      TARGETS を一括処理')
        return 2

    exam, year = argv[0].upper(), argv[1]
    if exam not in EXAMS:
        print(f'不明な試験コード: {exam}（--list で一覧）')
        return 2
    if year not in YEARS:
        print(f'不明な年度キー: {year}（--list で一覧。新年度は YEARS へ追加する）')
        return 2
    one(exam, year)
    print(f'出力先: {OUT_ROOT / exam / year}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
