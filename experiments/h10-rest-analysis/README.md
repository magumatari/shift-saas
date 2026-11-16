# H10 勤務間休息の対形成・分数根拠の隔離実験

起点 main `a5fb1588a4d336c7d4b4d827bd9a1528eb366822`。読み取り専用の純粋 TypeScript 関数 `analyzeRest` が、**渡された勤務だけ**の隣接対と時刻・経過分数を返します。ファイル・DB・ネットワークへのアクセス、Solverやcheckerのimport、期待値の生成・書換えはありません。採用状態と固定headの独立監査・実行記録は対応PRで確認します。

これは Validator の製品契約ではありません。H10/H01〜H19のPASS/FAIL/INDETERMINATE、正式REST_SHORTAGE JSON、承認・公開可否、記録完全性、検証期間全体の網羅を生成しません。禁止並びやH16の勤務内休憩判定も実装しません。既存の責務調査を繰り返すものではなく、その後の限定計算候補です。

## 正本との対応

基準は [decisions.md](../../docs/decisions.md)、[hard-rules.md v1.3](../../docs/hard-rules.md) の順です。設計v0.2本文は起点treeに見当たらず、下位資料の未確認事項を実装で補いません。

| 根拠（起点版） | この実験の対応・境界 |
| --- | --- |
| Hard 69〜71、290〜291、332 | 日本時間・整数分・半開の勤務区間。明示的な+09:00で解析し、暦日のround-tripを検査。24:00、日付の自動繰上げ、ホストTZからの日跨ぎ推定を認めない |
| Hard 80〜88、101、110、316〜318 | 設定未記入を0にしない。完全性・適用期間・勤務記録の不足はこの射影から推定しない |
| Hard 127 | 同じ従業員のcandidateとexistingを統合し、開始時刻順の隣接対すべてを計算。店舗・開始日連続・生成期間でフィルタしない |
| Hard 129、133 | 終了から次開始の経過時間は休憩を含む勤務区間の端点から算出。勤務内breakを休息へ加算せず、H12/H16の判定もしない |
| Hard 199〜201 | 元のstart_date/start/duration_minutesから再計算。Solverのコード・出力・計算済み被覆表を使わない |
| Hard 299〜302、339以降 | minutesの数値根拠だけを返す。違反の正式な区間・コード・期待結果は生成しない |

## 呼出し側の前提と実験用の射影

**単一会社に分離済みのレコード**であることが呼出し側の前提です。[現Schema](../../golden/schema/golden-case.schema.json) の会社・割当には会社IDがないため、この関数は会社所有権や所属を検証できません。会社混在を許す意味ではなく、会社分離を満たさない呼出しは対象外です。認証・DOアクセスや製品adapterは実装しません。

入力はJSON-like値の閉じた射影です。未知キーも前提不成立とし、完全なgoldenファイルをそのまま受ける入口にはしません。元Schemaやgoldenの形式変更ではありません。

| 関数入力 | 元データからの対応 |
| --- | --- |
| company.min_rest_minutes | input.company.min_rest_minutesを明示して渡す。非負のsafe integer。0は許容し、省略/null/不正値は補完しない |
| employees、stores | inputの各配列からidだけを射影。会社内のIDを完全一致で照合し、trimや大小文字変換はしない |
| patterns | input.patternsのid/version/start/duration_minutesだけを射影。id@versionで参照。勤務区間/work/break/coverの分割整合は呼出し側の前提で、この関数は検査しない |
| assignments | 元の候補割当と同じ5項目（id/employee/store/pattern/start_date） |
| existing_assignments | input.existing_assignmentsの同じ5項目。空配列も明示し、欠損を空へ補完しない |

expected、coverage、verify_period、生成期間、承認状態は受け取りません。与えられていない前後勤務の探索も行いません。必要な勤務をすべて渡す責務と、coverage対記録の完全性検査は呼出し側・将来の独立Validatorに残ります。

現Schemaに表示名キーはありません。テスト中のdisplayLabelは呼出し側の非入力メタデータで、製品用JSONキーではありません。表示ラベルや整合するwork/break内訳だけを変えても、同じid/version/start/duration_minutesの射影と参照は変わらないことを確認します。製品の名称変更・版更新処理を検証したという意味ではありません。

## 出力・未対応

- `evidence-only`: 各対のemployee、前後の割当ID/source/store/pattern、JST開始・終了、elapsedMinutes。設定値minimumMinutesは表示用にそのまま返すだけで、しきい値との比較・合否はしません。
- `no-pairs`: 検証した射影に対がない場合。空/1勤務をPASSや記録充足とせず、0/1勤務の従業員はunpairedEmployeesでも示します。有効な対がある場合も、対のない従業員を同配列へ明示します。
- `not-analyzed`: categoryは実験用の`precondition`または`unsupported`。理由を返し、途中で得た対を部分成功として返しません。業務違反コードではありません。

ID重複（候補/既存をまたぐ場合も含む）・参照欠落・不正日時/設定/射影はprecondition。同時開始、重複勤務による負の休息、同じ従業員の同じ開始日に複数勤務、4桁年の外へ出る演算は、この小さな対応範囲のunsupportedです。同日複数勤務をH09の業務判定へ変換しません。安全な整数と4桁年に範囲を絞り、巨大な値を丸めません。

分類の優先順位は実験用の `precondition` → `unsupported` → `evidence-only/no-pairs` です。全レコードの射影・ID/参照・開始日の前提検査を完了してから、終了日時の範囲や並びの未対応条件を評価します。同じレコード集合・参照・設定なら、配列順やcandidate/existingへの分配を変えても、前提不成立と未対応が混在する入力は `not-analyzed/precondition` を優先します。複数の同分類原因のうち最初に返す説明文の同一性や全原因の列挙は保証しません。業務規則の優先順位や正式な判定不能JSONを定めるものではありません。

端点一致は半開区間では重複しないため、別開始日の対について数値0を返せます。ただし0分の正式な違反区間は作りません。負の休息は重複として未対応にし、正式JSONの表現を定めません。配列を上書き・間引きしたり、同順位をID順で勝手に決めたりして成功にしません。

## 手計算の対照

以下は架空の作者テスト根拠であり、人が承認した新goldenではありません。既存goldenの期待値や承認状態は読み替えません。

| 入力・対 | 独立した手計算 |
| --- | --- |
| A1:12/7 22:00、duration480 → 12/8 06:00。A2:12/9 01:59 | 19h59m = 1199分。勤務内work420分/break60分でも終了は06:00 |
| A2だけ12/9 02:00へ | 20h = 1200分 |
| 中間A3:12/8 12:00〜13:00を既存勤務へ追加 | A1→A3=6h=360分、A3→A2=12h59m=779分。外側の1199分対は返さない |
| PAST:12/6 01:59〜05:59 → A1 | 12/6 05:59から12/7 22:00は40h1m=2401分 |
| A2終了12/9 05:59 → FUTURE開始12/10 01:59 | 20h=1200分 |
| E2の12/7夜勤 → 12/10 01:59 | 12/8 06:00から43h59m=2639分。E1と対を作らない |
| 月/年/閏日をまたぐ夜勤の翌朝06:00 → さらに翌日02:00 | 各20h=1200分。2028/2000は2/29を含み、2027は3/1へ進む |
| 12/31 23:30+30分 → 1/1 00:01（または00:00） | 1分（または0分）。前日・翌日を時刻大小から推測しない |

## 実行と検証の限界

rootで、採用済み固定lockfileの依存を使います。新依存・package/lockfile/npm scriptsは追加しません。検証時はNode `v24.22.1`と空の専用npm設定を使い、既存の実.npmrcは取得しません。

次はPOSIX sh向けのローカル実行例です。直接 `node --test` する2行は実験試験を実行しますが、CIが別途実行する補助39件や `check-rest-tests.mjs` の件数・skip/todo等のguardを通しません。CI同等の保証でも、Windows用手順でもありません。

```sh
npm ci --ignore-scripts --no-fund --no-audit
node node_modules/typescript/bin/tsc -p experiments/h10-rest-analysis/tsconfig.json
TZ=UTC node --import tsx --test experiments/h10-rest-analysis/rest-analysis.test.ts
TZ=America/Los_Angeles node --import tsx --test experiments/h10-rest-analysis/rest-analysis.test.ts
```

以下の1段落は親PR #13とPR #14候補時点の履歴です。

親PR #13の固定版 `e3ec555a27552685c49ecd37eb979c5fb950bd16` 時点では、既存root型検査はscriptsだけ、既存npm testはchecker試験だけを対象とし、この実験の型検査・テストはCI未接続でした。後続PR #14では、専用型検査とUTC/Los Angeles各77件をguardする専用CIを別候補として実行しています。実行範囲・stack依存・採用条件は [CI接続提案](ci-proposal.md) と対応PRの固定head記録を参照してください。候補CIの成功をmain採用や製品/正式Validatorへの採用と読み替えず、作者実行・CI・独立Claude Code静的監査を区別します。

2026-11-16確認時点では、本人がPR #14のCI接続とPR #17の一時親trigger整理を採用済みです。main `3fad027e5d38c8620cc5f59600c727140984b765` のmain pushで専用型検査・補助39件・UTC/Los Angeles各77件が成功し、golden/tenantも同じmainで成功しました。担当CodexによるAPI・実ジョブログの確認記録とrun/jobは [CI接続記録](ci-proposal.md) の冒頭にまとめています。現行PR対象はmainのみ、pushもmainのみです。必須設定の確認・変更や、製品/正式Validatorへの採用を意味しません。

採用経路は、親PR #13を本人が merge `c41c41c2758a22751f8b8f714831232f6e2e4cd8` で採用→PR #14をmainへ付替え後の同一head/baseのH10・golden・tenant CI確認→本人によるPR #14採用→PR #17採用です。各固定SHA・PR向け実checkout・runは上記CI接続記録で追跡でき、親向けstack CIだけを採用条件の証拠にしていません。

未対応のJSON/禁止並び、記録欠損と未計画の区別、完全性・適用期間別設定、正式違反の過不足/偽PASS、実認証/製品経路/本番は残ります。PR #1の例拡張前の一般REST_SHORTAGE整合、正式golden運用前の保護・本人確認、Windows検証前の対応期限は解消しません。既存のH10 2例はdraft/承認nullのままです。Dotsが固定版の初回独立監査を手配し、作者は起動しません。修正後再監査は最大2回、同じ指摘2回は本人判断、採用・golden承認・マージは本人だけが行います。

直前の「初回独立監査を手配」は、親PR #13制作時の引継ぎ文言として残しています。現在も役割は、実装担当Codexが候補作成・作者検証、Dotsが別AIの独立監査を依頼・回収、本人が採用・Ready・マージです。この文書追従自体の監査状態はPR #18の固定版記録を参照し、親実験やCI接続の監査を別の変更へ流用しません。
