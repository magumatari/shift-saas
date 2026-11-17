# 勤務パターンの分数再計算候補

起点main `7e8c36acd689e4d78ed6e657f2b66af8f26daa48`。労働・休憩・必要人数に数える区間を区別して元入力から分数を算出する、内部用TypeScript純粋関数のローカル候補です。PR #22の未採用試験には依存しません。新規API・認証・データ保存や、過去の採用記録を増やす作業ではありません。公開・独立監査・本人採用の状態は作業返却で確認します。

## 決定済みの根拠と切り出し

- `docs/decisions.md:49`、`docs/hard-rules.md:199-201`：TypeScript側はSolverの計算値やコードを使わず再計算する。
- Hard `:70-74`：整数分、半開区間、勤務・労働・休憩・被覆の区別。労働は労働区間の合計で、休憩を加えない。
- Hard `:75,121`：同じ人を被覆で二重計上しない。ここでは一つのパターンの被覆区間の和集合の長さだけを計算する。必要人数を満たすか、複数従業員の人数が何人かは計算しない。
- Hard `:290-291`：パターンの区間は始業からの相対分数。日跨ぎでも数値を逆転させない。
- 採用済み `scripts/check-golden.ts:128-149` の形式前提（正のduration、範囲内の区間、work/breakの完全分割、coverはwork内）に対象を絞る。同処理を変更・importしない。

入力は既存patternの `duration_minutes`、`work`、`break`、`cover` だけです。全キー・配列を明示し、数量はJavaScriptで正確に計算できるsafe integerに限定します。追加の業務必須項目やSchemaは導入しません。元のid/version/start等のメタデータは計算せず、呼出し側が選んだパターンの版の区間をそのまま受けます。版・店舗・従業員・会社の参照解決は呼出し側の責務です。

`calculatePatternMinutes(value)` は `{ durationMinutes, workMinutes, breakMinutes, coverMinutes }` を返します。欠損・不正な計算入力はTypeErrorにし、0や空配列で補いません。これは内部関数の前提検査であり、HTTPのエラー契約・Hardの違反コード・PASS/FAIL/INDETERMINATEを定義するものではありません。JSON由来の値を対象とし、任意のProxy/accessor等の敵対的JavaScript実行環境を隔離するものでもありません。

同一パターンの重複/重なるcoverは集合として長さを測ります。隣接する半開区間は二重計上せず、coverが休憩へ食い込めば拒否します。入力配列は変更せず、研修などの被覆に数えない労働もworkMinutesに残します。空coverは明示的な0、未入力coverとは区別します。

## 手計算と実行

架空の480分勤務で `work=[[0,240],[300,480]]`、`break=[[240,300]]`、`cover=work` なら、労働は240+180=420分、休憩60分、被覆420分です。これは勤務間休息の計算ではありません。coverを `[[60,240],[300,420]]` に絞れば180+120=300分で、労働420分は変わりません。`[[0,120],[60,240],[300,480]]` のcoverは和集合 `[0,240)∪[300,480)` なので420分であり、重なりを加算した480分にはしません。

固定root lockfileと既存導入済み依存、Node `v24.22.1` を使い、rootで実行します。

```sh
node node_modules/typescript/bin/tsc -p experiments/pattern-accounting/tsconfig.json
TZ=UTC node --import tsx --test experiments/pattern-accounting/pattern-minutes.test.ts
TZ=America/Los_Angeles node --import tsx --test experiments/pattern-accounting/pattern-minutes.test.ts
```

この例はPOSIX shell用で、Windows手順やWindows実測ではありません。新規依存、root package/lock/tsconfig、CI、既存checker/golden/Schema/正本は変更しません。新試験は既存CIに未接続で、件数/skip/todoの専用guardもありません。既存CIの成功を新試験の実行証拠にせず、作業返却の実測件数・終了状態を参照します。

## 非目標と次に残る境界

日・週・月の所属、年齢/就業条件、法的休憩の十分性、最低人数・役割・需要、日時生成、記録完全性、一般H10や正式Validatorの合否、Solverの生成/試験形式、UI/API、公開条件は扱いません。たとえばworkが空でbreakだけの形式入力を計算できても、実際の勤務として適法・配置可能と判定したことにはなりません。

期待値は架空区間の手計算から固定し、実装出力やSolverから生成しません。故障対照は一時コピーだけで労働をdurationと取り違える変更、coverを重複加算する変更を個別に入れ、正常対照と目的のassertion失敗を区別します。これらは作者の試験で、独立監査ではありません。CI接続・製品への採用・保護変更・正解例承認は別途本人判断と固定版監査が必要です。
