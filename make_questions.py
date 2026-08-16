import json, random
random.seed(42)
DOMAINS={
'STRATEGY':[
('SWOT分析','内部環境の強み・弱みと、外部環境の機会・脅威を整理して戦略立案に用いる分析手法',['3C分析','PEST分析']),
('PEST分析','政治・経済・社会・技術の観点から、企業を取り巻くマクロ環境を分析する手法',['SWOT分析','ファイブフォース分析']),
('ファイブフォース分析','業界の競争要因を、新規参入・代替品・買い手・売り手・既存競争の五つの力で捉える手法',['PPM','バリューチェーン']),
('バリューチェーン','企業活動を主活動と支援活動に分け、どこで価値や競争優位が生まれるかを分析する考え方',['BSC','VRIO']),
('PPM','事業を市場成長率と相対的市場占有率で分類し、経営資源配分を検討するポートフォリオ分析',['BCP','TCO']),
('BSC','財務・顧客・内部プロセス・学習と成長の複数視点で戦略を指標に落とし込む管理手法',['KPI','SLA']),
('KGI','組織や施策が最終的に達成すべきゴールを定量的に表す成果指標',['KPI','CSF']),
('KPI','KGI達成に至るプロセスの進捗や重要活動を定量的に測る中間指標',['KGI','ROI']),
('ROI','投下した資本や費用に対して、どれだけ利益を得たかを示す投資効率の指標',['TCO','NPV']),
('NPV','将来キャッシュフローを割引率で現在価値に換算し、投資額との差で投資価値を評価する指標',['IRR','ROI']),
('TCO','導入費だけでなく運用・保守・教育・廃棄などを含め、保有期間全体の総コストで評価する考え方',['ROI','ABC']),
('TOGAF','エンタープライズアーキテクチャを策定・運用するための代表的なフレームワーク',['COBIT','ITIL'])],
'ARCHITECTURE':[
('非機能要件','性能・可用性・拡張性・セキュリティ・運用性など、機能そのもの以外にシステムへ求める品質特性',['機能要件','受入基準']),
('可用性','必要なときにシステムやサービスを利用できる度合い。稼働率や停止時間などで評価する',['信頼性','保守性']),
('スケーラビリティ','負荷増大に対して資源追加や構成変更により処理能力を拡張できる性質',['移植性','相互運用性']),
('疎結合','コンポーネント間の依存を小さくし、変更の影響範囲を限定する設計上の性質',['高凝集','密結合']),
('CQRS','更新系コマンドと参照系クエリの責務やモデルを分離するアーキテクチャパターン',['MVC','Saga']),
('イベントソーシング','現在状態だけでなく、状態変化を表すイベント列を永続化し、イベントから状態を再構築する方式',['CQRS','ETL']),
('Sagaパターン','分散システムの長いトランザクションを複数のローカルトランザクションと補償処理で扱うパターン',['2相コミット','Circuit Breaker']),
('Circuit Breaker','障害中の外部サービスへの呼出しを一時的に遮断し、連鎖障害や無駄な待ちを防ぐパターン',['Retry','Bulkhead']),
('キャッシュアサイド','アプリケーションがまずキャッシュを参照し、ミス時にデータストアから取得してキャッシュへ格納する方式',['Write Through','Read Replica']),
('冪等性','同じ操作を複数回実行しても、一回実行した場合と同じ最終状態になる性質',['原子性','一貫性']),
('RTO','災害や障害発生後、業務やサービスを復旧させるまでの目標時間',['RPO','MTTR']),
('RPO','障害発生時に、どの時点までのデータ損失を許容するかを表す目標復旧時点',['RTO','MTBF'])],
'SECURITY':[
('ゼロトラスト','ネットワーク内外を理由に暗黙に信頼せず、アクセスごとに主体・端末・状況を継続的に検証する考え方',['境界防御','多層防御']),
('最小権限','利用者やプロセスへ、業務遂行に必要な最小限の権限だけを付与する原則',['職務分離','Need to Know']),
('職務分離','重要処理を一人で完結できないよう、承認・実行・監査などの役割を分ける統制',['最小権限','デュアルコントロール']),
('多要素認証','知識・所持・生体など異なる認証要素のカテゴリから複数を組み合わせて本人確認する方式',['多段階認証','SSO']),
('PKI','公開鍵証明書と認証局などを用いて、公開鍵の正当性を信頼連鎖で保証する仕組み',['Kerberos','OAuth']),
('OCSP','証明書の失効状態をオンラインで問い合わせて確認するプロトコル',['CRL','SCEP']),
('OAuth 2.0','利用者のパスワードを第三者アプリへ渡さず、限定されたアクセス権を委譲する認可フレームワーク',['OpenID Connect','SAML']),
('OpenID Connect','OAuth 2.0を基盤に、利用者の認証とID情報の受け渡しを標準化したプロトコル',['OAuth 2.0','SCIM']),
('CSRF','認証済み利用者のブラウザを悪用し、意図しないリクエストを対象サイトへ送信させる攻撃',['XSS','SSRF']),
('SSRF','サーバ側の機能を悪用して、攻撃者が直接到達できない内部サービスなどへリクエストさせる攻撃',['CSRF','SQLインジェクション']),
('SIEM','複数機器やサービスのログを集中収集・相関分析し、脅威検知やインシデント調査に利用する仕組み',['SOAR','EDR']),
('CVSS','脆弱性の深刻度を基本・現状・環境などの指標から定量評価する共通スコアリング方式',['CVE','CWE'])]
}

questions=[]
for domain, items in DOMAINS.items():
    for idx,(term,definition,related) in enumerate(items):
        # choose 3 distractors
        others=[x for x in items if x[0]!=term]
        ds=random.sample(others,3)
        option_defs=[definition]+[x[1] for x in ds]
        tagged=[(option_defs[0],term)]+[(x[1],x[0]) for x in ds]
        random.shuffle(tagged)
        choices=[x[0] for x in tagged]; correct=[x[1] for x in tagged].index(term)
        notes=[f"{name}の説明です。" if name!=term else f"{term}の定義として適切です。" for _,name in tagged]
        questions.append(dict(id=f'{domain[:3].lower()}-tm-{idx+1:02}',source_type='ORIGINAL',domain=domain,subdomain='頻出用語',question_type='TERM_TO_MEANING',stem=f'「{term}」の説明として、最も適切なものはどれか。',choices=choices,correct_choice=correct,explanation=definition+'。',choice_notes=notes,related_terms=related,difficulty=2,tags=[term,'頻出用語']))
        tagged2=[(term,term)]+[(x[0],x[0]) for x in ds]
        random.shuffle(tagged2); choices2=[x[0] for x in tagged2]; correct2=[x[1] for x in tagged2].index(term)
        notes2=[f"正解。{term}は、{definition}。" if name==term else f"{name}は別概念であり、この説明には該当しません。" for _,name in tagged2]
        questions.append(dict(id=f'{domain[:3].lower()}-mt-{idx+1:02}',source_type='ORIGINAL',domain=domain,subdomain='頻出用語',question_type='MEANING_TO_TERM',stem=f'次の説明に該当する用語はどれか。\n\n{definition}。',choices=choices2,correct_choice=correct2,explanation=f'正解は「{term}」。{definition}。',choice_notes=notes2,related_terms=related,difficulty=2,tags=[term,'頻出用語']))

scenarios=[
('STRATEGY','str-sc-01','ある企業が新規事業への投資可否を比較している。各案について将来得られるキャッシュフローを資本コストで現在価値に割り引き、初期投資額との差額で評価したい。最も適切な指標はどれか。',['ROI','NPV','TCO','KPI'],1,'NPVは将来キャッシュフローを現在価値に割り引き、初期投資との差で投資価値を評価する。',['ROIは利益と投資額の比率。','NPVが適切。','TCOは総保有コスト。','KPIは重要業績評価指標。'],['IRR','DCF']),
('STRATEGY','str-sc-02','市場成長率が高く、自社の相対的市場占有率も高い事業について、PPMでは一般にどの区分として扱うか。',['花形','金のなる木','問題児','負け犬'],0,'高成長・高シェアは「花形」に分類され、成長投資を要しつつ将来の収益源になることが期待される。',['正解。','低成長・高シェア。','高成長・低シェア。','低成長・低シェア。'],['PPM','経営資源配分']),
('STRATEGY','str-sc-03','経営目標を「売上高100億円達成」と定めた。これを実現するため、営業部門で「商談化率」「平均提案件数」を月次追跡する。この関係として最も適切なものはどれか。',['売上高がKPI、商談化率がKGI','売上高がKGI、商談化率がKPI','両方ともKGI','両方ともCSF'],1,'最終成果を表す売上高目標はKGI、そこへ至る活動・進捗を測る商談化率等はKPIである。',['関係が逆。','正解。','役割が異なる。','CSFは重要成功要因であり指標そのものとは限らない。'],['KGI','KPI','CSF']),
('ARCHITECTURE','arc-sc-01','注文サービスから決済サービスへの同期呼出しで障害が続き、タイムアウト待ちが大量発生して注文サービスまで枯渇し始めた。一定回数の失敗後、決済サービスへの呼出しを一時停止して早期失敗させたい。適切なパターンはどれか。',['Saga','Circuit Breaker','CQRS','Event Sourcing'],1,'Circuit Breakerは障害先への呼出しを遮断し、連鎖障害やリソース枯渇を防ぐ。',['分散トランザクションの整合性用。','正解。','参照と更新の分離。','イベント列の永続化。'],['Retry','Bulkhead']),
('ARCHITECTURE','arc-sc-02','分散した複数サービスをまたぐ注文処理で、単一DBトランザクションを利用できない。各サービスの処理をローカルトランザクションとして実行し、途中失敗時は既実行処理を打ち消す処理を行いたい。適切なパターンはどれか。',['Saga','MVC','Repository','Cache Aside'],0,'Sagaは複数のローカルトランザクションと補償処理で分散処理の整合性を扱う。',['正解。','UI構造の分離。','データアクセス抽象化。','キャッシュ利用方式。'],['補償トランザクション','分散システム']),
('ARCHITECTURE','arc-sc-03','災害対策の要件で「障害発生後2時間以内にサービスを再開」「データ損失は最大15分まで許容」と定めた。前者と後者の組合せとして正しいものはどれか。',['前者RPO、後者RTO','前者RTO、後者RPO','前者MTBF、後者MTTR','前者SLA、後者SLO'],1,'復旧までの目標時間がRTO、許容するデータ損失時点がRPO。',['逆。','正解。','MTBF/MTTRの定義と異なる。','SLA/SLOの関係とは異なる。'],['BCP','DR']),
('SECURITY','sec-sc-01','WebアプリがURLを受け取り、そのURLからサーバ側で画像を取得する機能を持つ。攻撃者が 127.0.0.1 やクラウドのメタデータサービスを指定し、内部情報へアクセスさせようとしている。該当する攻撃はどれか。',['CSRF','SSRF','XSS','クリックジャッキング'],1,'サーバを踏み台にして内部・外部へ不正リクエストを送らせる攻撃はSSRF。',['利用者ブラウザから意図しない操作を送らせる攻撃。','正解。','スクリプトを実行させる攻撃。','UIを重ねて誤操作させる攻撃。'],['URL allowlist','クラウドメタデータ']),
('SECURITY','sec-sc-02','社内ネットワークからのアクセスであっても無条件には信頼せず、利用者ID、端末状態、アクセス先、リスク情報を用いてアクセスごとに評価する方針を採用した。この考え方はどれか。',['境界防御','ゼロトラスト','Defense in Depth','Security by Obscurity'],1,'ゼロトラストは場所を信頼根拠とせず、アクセスごとに検証する。',['境界内を信頼しやすい従来型。','正解。','多層防御の一般原則。','秘匿性に依存する不適切な考え方。'],['最小権限','継続的認証']),
('SECURITY','sec-sc-03','脆弱性情報に「CVE-XXXX-YYYY」と識別子が付与され、別途0.0〜10.0の深刻度スコアが示されている。後者の評価方式はどれか。',['CWE','CVSS','CAPEC','STIX'],1,'CVSSは脆弱性の深刻度を共通尺度でスコアリングする方式。',['弱点の種類を分類する体系。','正解。','攻撃パターンの分類。','脅威情報交換の表現仕様。'],['CVE','脆弱性管理'])]
for d,id_,stem,choices,correct,explanation,notes,related in scenarios:
    questions.append(dict(id=id_,source_type='ORIGINAL',domain=d,subdomain='午前問題型',question_type='SCENARIO',stem=stem,choices=choices,correct_choice=correct,explanation=explanation,choice_notes=notes,related_terms=related,difficulty=3,tags=['午前問題型']))

with open('questions.json','w',encoding='utf-8') as f: json.dump(questions,f,ensure_ascii=False,indent=2)
print(len(questions))
