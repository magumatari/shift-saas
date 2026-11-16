# 数量付きREST_SHORTAGEの単位整合候補

起点mainは `40cab6e5850a484654e8e82958b290a65be20dca`（本人によるPR #11/#15採用後）。採用状況・固定head・作者試験・CIと独立監査は対応PRの記録を参照します。本候補は未採用で、作者試験を独立監査と呼びません。

優先正本は [decisions.md](../../docs/decisions.md) → [Hard v1.3](../../docs/hard-rules.md)。根拠はHard H10（127行）の勤務間経過時間、整数分の規約（291行）、数量比較の5項目（302行）、会社min_rest_minutesと掲載REST_SHORTAGE（356/384行）です。時間量と同じ会社設定に照合するlimitの単位をminutesへ揃える限定の参照間整合で、日時再計算ではありません。

Schema検証を通り数量5項目があるREST_SHORTAGEだけ、unit=minutesを要求します。既存のmeasured検査ブロックを使い、quantity全省略、undecidedのexpected省略、draft承認nullを維持。Schemaの汎用enum minutes/days/people/assignmentsと全5項目あり/全省略の規則は変更しません。他コードを一律minutesへ狭めず、未定義コードのJSONを新たに受理するものでもありません。暗黙変換や既定値は加えません。

変更はchecker/testと本説明だけ。親124件に4件を追加し128件です。架空fixtureのunit以外を同一にしてminutes正常、days/people/assignmentsを単位エラー1件だけで拒否することを確認します。数量省略・undecided・候補/既存・他店舗・逆順、limit/employee等は既存回帰を維持。旧main checker＋新4試験の負の対照では、正常minutesが通り非minutes3件が狙ったassertionで落ちることを、型検査/環境/起動失敗と分けます。

Node24.2以降の24系でgolden:checkの合否を判断する本人の限定採用を守ります。作者環境はLinux/Node24.22.1/npm11.9.0、固定lockに一致する既存導入依存と空の専用npm設定を使用。依存/package/lock/CI/pinは変更せず、実設定を取得しません。コマンドはrootの `npm run typecheck`、`npm test`、`npm run golden:check` と既存tenant検証です。PR #15のCLI/fallback/清掃処理は不変で、旧minor・Windows canary/実測・診断上書き等を修正済みとはしません。

golden2例の実体・期待値・draft/承認null、Schema、Hard/正本は不変。一般H10の隣接性/端点/実測値/違反過不足/完全性/禁止並びや独立Validator完成、正式golden期待照合は非目標です。PR #1の例拡張前の一般REST_SHORTAGE確認、正式golden運用前の保護・本人確認、Windows検証前の条件は残ります。

保護対象checkerの未採用Draft候補として、固定版の独立Claude Code監査をDotsが手配します。修正後再監査は新PRで最大2回、同じ指摘2回は本人判断。本人だけが保護変更採用・正解例承認・Ready/マージ・本番反映を行い、作者はmain直push・既存PR更新・追加監査を行いません。
