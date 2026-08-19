"""M3 コンテンツ生成スクリプト（questions-v3.json / legacy-id-map.json）。

概要: 2つの入力を1本の配信データへまとめる。
      1. M2の questions.json（81問）→ 永久IDと概念参照を持つ v3 形式へ変換
      2. content/exams/*.json（IPA過去問300問）→ 出典つきの PAST 問題として追加
入力: docs/data/questions.json（M2の確定データ。読み取りのみ）
      docs/data/concepts.json（用語辞書）
      content/exams/<試験>_<年度キー>.json（転記・検算済みの過去問）
出力: docs/data/questions-v3.json, docs/data/legacy-id-map.json（既存を上書き）
実行: python tools/build_content.py  （リポジトリのルートで実行する）

🔥 既存の81問を「再生成」せず「変換」する。
   M2の選択肢は random.sample で選ばれており、再生成すると別の問題になる。
   学習履歴は問題IDに紐づくため、中身が変わると履歴の意味が壊れる。

🔥 過去問には source_refs（出典）を必ず持たせる。IPAの利用条件であり、
   画面に出典が出ないと利用条件を満たさなくなる。改変した問は modification_label も持たせる。

失敗時: 用語と概念の対応が取れないと ValueError で止まる（黙って落とさない）。
        concepts.json の term と、questions.json の tags[0] の表記ゆれを疑う。
"""

import io
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'docs' / 'data'
EXAM_DIR = ROOT / 'content' / 'exams'
PAST_CONCEPTS = ROOT / 'content' / 'past-concepts.json'
PAST_REASONS = ROOT / 'content' / 'past-reasons.json'

# シナリオ問題（午前問題型）が主として問う概念。旧IDから対応付ける。
# 自動判定できないため明示する。問題を追加したらここへ1行足す。
SCENARIO_CONCEPT = {
    'str-sc-01': 'strategy.npv',
    'str-sc-02': 'strategy.ppm',
    'str-sc-03': 'strategy.kgi',
    'arc-sc-01': 'architecture.circuit_breaker',
    'arc-sc-02': 'architecture.saga',
    'arc-sc-03': 'architecture.rto',
    'sec-sc-01': 'security.ssrf',
    'sec-sc-02': 'security.zero_trust',
    'sec-sc-03': 'security.cvss',
}

TYPE_SLUG = {
    'TERM_TO_MEANING': 'term_to_meaning',
    'MEANING_TO_TERM': 'meaning_to_term',
    'SCENARIO': 'scenario',
}


def load(name):
    return json.load(io.open(DATA / name, encoding='utf-8'))


def dump(name, obj):
    # 改行は LF 固定。Windows 既定の CRLF で書くと差分が全行になる。
    io.open(DATA / name, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(obj, ensure_ascii=False, indent=2) + '\n'
    )


# 試験区分 → アプリ内の領域。過去問はこの対応で既存3領域＋PM・監査へ振り分ける。
EXAM_DOMAIN = {
    'ST': 'STRATEGY',
    'SA': 'ARCHITECTURE',
    'SC': 'SECURITY',
    'PM': 'PM',
    'AU': 'AUDIT',
}

EXAM_NAME = {
    'ST': 'ITストラテジスト試験',
    'SA': 'システムアーキテクト試験',
    'SC': '情報処理安全確保支援士試験',
    'PM': 'プロジェクトマネージャ試験',
    'AU': 'システム監査技術者試験',
}

CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ']

# 画面へ「改変あり」と出す種別。layout_only / transcription_fix は原本と文字列が同じなので出さない。
# ⚠️ この集合は tools/normalize_exams.py の MODIFIED_KINDS と同じ意味。片方だけ変えると
#    「分類はしたが画面に出ない」状態になり、利用条件を静かに割る。
MODIFIED_KINDS = {'figure_to_text', 'notation'}

KIND_LABEL = {
    'figure_to_text': '図・表・グラフを文へ変換',
    'notation': '上付き・下付き等を記法へ置換',
}

# 🔥 figure_text があるのに改変と分類されていない問が実測で25問あった。
#    転記者が modified フラグを立てなかったためで、分類表は「フラグが立った問」だけを見ていた。
#    原本の図を文の説明へ置き換えて見せている以上、それは改変である。
#    ここでは分類表ではなく「figure_text があるか」で判定し、取りこぼしを構造的に無くす。
DEFAULT_FIGURE_KIND = 'figure_to_text'


def source_of(doc, question_no):
    """出典を組み立てる。IPAの利用条件のうち「出典を明記する」を満たすための必須項目。

    source_label は解答例PDFの表題（例「令和7年度 春期 ITストラテジスト試験 午前II 解答例」）。
    末尾の「解答例」を落として問番号を足すと、問題冊子側の出典表記になる。
    ⚠️ 時間区分は当時の名称（午前II）のまま書く。2026年度からの「科目A-2」へ読み替えない。
       出典は原本の表記を指すため、読み替えると原本を特定できなくなる。
    """
    base = doc['source_label'].replace(' 解答例', '').strip()
    exam = doc['exam']
    return {
        'publisher': 'IPA（独立行政法人情報処理推進機構）',
        'exam_code': exam,
        'exam_name': EXAM_NAME[exam],
        'year_key': doc['year_key'],
        'section': '午前II',
        'question_no': question_no,
        'label': f'{base} 問{question_no}',
    }


def reasons_of(rmap, qid, missing):
    """設問IDから選択肢4つぶんの解説を取り出す。

    未執筆の問は空文字4つを返し、missing へ積む（部分的に書いた状態でもビルドを通すため）。
    形が違うものは、画面に出てから気づくと直しにくいのでここで落とす。
    """
    reasons = rmap.get(qid)
    if reasons is None:
        missing.append(qid)
        return [''] * 4
    if not isinstance(reasons, list) or len(reasons) != 4:
        raise ValueError(f'{qid}: 選択肢の解説が4個でない')
    for i, r in enumerate(reasons):
        if not isinstance(r, str) or not r.strip():
            raise ValueError(f'{qid}: 選択肢{CHOICE_LABELS[i]}の解説が空')
    return [r.strip() for r in reasons]


def build_past(concept_ids):
    """content/exams/*.json を配信用の PAST 問題へ変換する。

    concept_ids: 存在する概念IDの集合。対応表が指す概念が無いとここで落とす。
    """
    qmap = json.load(io.open(PAST_CONCEPTS, encoding='utf-8'))['map']
    rmap = json.load(io.open(PAST_REASONS, encoding='utf-8'))['map'] if PAST_REASONS.exists() else {}
    out = []
    missing_reasons = []
    files = sorted(EXAM_DIR.glob('*.json'))
    if not files:
        raise ValueError(f'過去問データが無い: {EXAM_DIR}')

    for path in files:
        doc = json.load(io.open(path, encoding='utf-8'))
        exam, year = doc['exam'], doc['year_key']
        if exam not in EXAM_DOMAIN:
            raise ValueError(f'{path.name}: 未知の試験区分 {exam}（EXAM_DOMAIN へ追加する）')
        for q in doc['questions']:
            no = q['question_no']
            mark = doc['answers'].get(str(no))
            if mark not in CHOICE_LABELS:
                raise ValueError(f'{exam}/{year} 問{no}: 正解記号が不正（{mark!r}）')
            if len(q['choices']) != 4:
                raise ValueError(f'{exam}/{year} 問{no}: 選択肢が4個でない')

            qid = f'past.{exam.lower()}.{year}.q{no:02}'
            # 🔥 主題の概念が無いと、解説にも用語辞書にも出てこない問になる。
            #    増やしたときに黙って抜けないよう、対応表に無ければ止める。
            concept_id = qmap.get(qid)
            if not concept_id:
                raise ValueError(f'{qid} が content/past-concepts.json に無い')
            if concept_id not in concept_ids:
                raise ValueError(f'{qid} が参照する概念 {concept_id} が concepts.json に無い')

            item = {
                'id': qid,
                'concept_id': concept_id,
                'revision': 1,
                'is_active': True,
                'source_type': 'IPA_PAST',
                'domain': EXAM_DOMAIN[exam],
                'question_type': 'PAST',
                'stem': q['stem'],
                'choices': q['choices'],
                'choice_concept_ids': [None] * 4,
                'correct_choice': CHOICE_LABELS.index(mark),
                'choice_reasons': reasons_of(rmap, qid, missing_reasons),
                'difficulty': 3,
                'tags': ['過去問', EXAM_NAME[exam]],
                'source_refs': source_of(doc, no),
            }
            figure = (q.get('figure_text') or '').strip()
            if figure:
                item['figure_text'] = figure

            # 改変にあたる問に、改変の旨を配信データへ載せる（利用条件2）。
            kind = q.get('modification_kind')
            if kind not in MODIFIED_KINDS and figure:
                kind = DEFAULT_FIGURE_KIND
            if kind in MODIFIED_KINDS:
                item['modification_kind'] = kind
                item['modification_label'] = q.get('modification_label') or KIND_LABEL[kind]
                item['modification_note'] = (q.get('modification_note') or '').strip()

            # 図を文へ置き換えたのに改変の旨が付かない状態を、ここで機械的に落とす。
            if figure and not item.get('modification_label'):
                raise ValueError(f'{exam}/{year} 問{no}: 図の文章化があるのに改変の旨が付いていない')
            out.append(item)

    # 🔥 選択肢の解説が抜けた問は、画面で正解の印だけが出て「なぜ違うのか」を学べない。
    #    抜けを黙って通さず、件数とIDを出す。0件であることは tools/test_past.mjs が検査する。
    if missing_reasons:
        print(f'⚠️ 選択肢の解説が無い過去問: {len(missing_reasons)} 問（例: {missing_reasons[0]}）')
    unknown = sorted(set(rmap) - {q['id'] for q in out})
    if unknown:
        raise ValueError(f'past-reasons.json に存在しない設問IDがある: {unknown[:3]}')
    return out


def main():
    questions = load('questions.json')
    concepts = load('concepts.json')['concepts']

    # 選択肢に英語表記や略称で出る概念があるため、aliases も引けるようにする。
    by_term = {c['term']: c for c in concepts}
    for c in concepts:
        for a in c.get('aliases', []):
            by_term.setdefault(a, c)
    # ⚠️ choice_definition は自作問の選択肢文と突き合わせるための欄で、
    #    過去問のために追加した語は持たない。get で引く（KeyError にしない）。
    by_definition = {c['choice_definition']: c for c in concepts if c.get('choice_definition')}
    by_id = {c['id']: c for c in concepts}

    out = []
    legacy_map = {}
    used_ids = set()

    for q in questions:
        qtype = q['question_type']

        # 主題の概念を決める
        if qtype == 'SCENARIO':
            concept_id = SCENARIO_CONCEPT.get(q['id'])
            if not concept_id:
                raise ValueError(f'シナリオ問題 {q["id"]} の概念が SCENARIO_CONCEPT に未登録')
        else:
            term = q['tags'][0]
            if term not in by_term:
                raise ValueError(f'{q["id"]} の用語「{term}」が concepts.json に存在しない')
            concept_id = by_term[term]['id']
        concept = by_id[concept_id]

        # 各選択肢が指す概念を解決する。辞書に無い選択肢（花形／MVC 等）は None。
        choice_concept_ids = []
        for text in q['choices']:
            hit = by_term.get(text) or by_definition.get(text)
            choice_concept_ids.append(hit['id'] if hit else None)

        # 設問固有の「なぜ適切／不適切か」。概念そのものの説明は concepts.json 側が持つ。
        reasons = []
        for i, text in enumerate(q['choices']):
            cid = choice_concept_ids[i]
            other = by_id.get(cid) if cid else None
            if i == q['correct_choice']:
                if qtype == 'TERM_TO_MEANING':
                    reasons.append(f'{concept["term"]}の定義そのもの。')
                elif qtype == 'MEANING_TO_TERM':
                    reasons.append('設問の説明に合致する。')
                else:
                    reasons.append(q['choice_notes'][i].replace('正解。', '').strip() or '設問の状況に最も適合する。')
            elif other is not None and qtype == 'TERM_TO_MEANING':
                reasons.append(f'これは{other["term"]}の説明であり、{concept["term"]}ではない。')
            elif other is not None and qtype == 'MEANING_TO_TERM':
                reasons.append(f'{other["term"]}は「{other["choice_definition"]}」であり、設問の説明とは別。')
            else:
                # 辞書に無い選択肢は、M2で書かれた設問固有の記述をそのまま使う。
                reasons.append(q['choice_notes'][i])

        new_id = f'{concept_id}.{TYPE_SLUG[qtype]}.001'
        if new_id in used_ids:
            raise ValueError(f'新IDが重複した: {new_id}（同じ概念・同じ形式の問題が複数ある）')
        used_ids.add(new_id)
        legacy_map[q['id']] = new_id

        out.append({
            'id': new_id,
            'concept_id': concept_id,
            'revision': 1,
            'is_active': True,
            'source_type': q['source_type'],
            'domain': q['domain'],
            'question_type': qtype,
            'stem': q['stem'],
            'choices': q['choices'],
            'choice_concept_ids': choice_concept_ids,
            'correct_choice': q['correct_choice'],
            'choice_reasons': reasons,
            'difficulty': q['difficulty'],
            'tags': q['tags'],
        })

    original = list(out)
    past = build_past(set(by_id))

    ids = [q['id'] for q in original + past]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise ValueError(f'問題IDが重複した: {sorted(dup)}')

    out = original + past
    dump('questions-v3.json', out)
    dump('legacy-id-map.json', legacy_map)

    resolved = sum(1 for q in original for c in q['choice_concept_ids'] if c)
    total = sum(len(q['choice_concept_ids']) for q in original)
    modified = sum(1 for q in past if q.get('modification_label'))
    no_source = [q['id'] for q in past if not q.get('source_refs', {}).get('label')]
    if no_source:
        raise ValueError(f'出典の無い過去問がある（利用条件違反）: {no_source}')

    print(f'自作 {len(original)} 問 / 過去問 {len(past)} 問 / 合計 {len(out)} 問')
    print(f'旧IDマップ {len(legacy_map)} 件')
    print(f'概念へ解決できた選択肢 {resolved}/{total}（自作問のみ）')
    print(f'画面に改変の旨を出す過去問: {modified} 問')
    linked = {q['concept_id'] for q in past}
    print(f'過去問が参照する概念: {len(linked)} 語 / 辞書全体 {len(by_id)} 語')
    orphan = sorted(set(by_id) - {q['concept_id'] for q in out if q['concept_id']})
    if orphan:
        print(f'⚠️ どの設問からも参照されていない概念: {len(orphan)} 語')


if __name__ == '__main__':
    main()
