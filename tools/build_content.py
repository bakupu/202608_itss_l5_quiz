"""M3 コンテンツ生成スクリプト（questions-v3.json / legacy-id-map.json）。

概要: M2の questions.json（81問）を、永久IDと概念参照を持つ v3 形式へ変換する。
      解説の本文は持たせず、概念の説明は concepts.json 側を参照する。
入力: docs/data/questions.json（M2の確定データ。読み取りのみ）
      docs/data/concepts.json（用語辞書）
出力: docs/data/questions-v3.json, docs/data/legacy-id-map.json（既存を上書き）
実行: python tools/build_content.py  （リポジトリのルートで実行する）

🔥 既存の81問を「再生成」せず「変換」する。
   M2の選択肢は random.sample で選ばれており、再生成すると別の問題になる。
   学習履歴は問題IDに紐づくため、中身が変わると履歴の意味が壊れる。

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


def main():
    questions = load('questions.json')
    concepts = load('concepts.json')['concepts']

    # 選択肢に英語表記や略称で出る概念があるため、aliases も引けるようにする。
    by_term = {c['term']: c for c in concepts}
    for c in concepts:
        for a in c.get('aliases', []):
            by_term.setdefault(a, c)
    by_definition = {c['choice_definition']: c for c in concepts}
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

    dump('questions-v3.json', out)
    dump('legacy-id-map.json', legacy_map)

    resolved = sum(1 for q in out for c in q['choice_concept_ids'] if c)
    total = sum(len(q['choice_concept_ids']) for q in out)
    print(f'問題 {len(out)} 件 / 旧IDマップ {len(legacy_map)} 件')
    print(f'概念へ解決できた選択肢 {resolved}/{total}')


if __name__ == '__main__':
    main()
