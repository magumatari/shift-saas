# H10 専用型検査・77件のCI接続候補

## 採用後の確認記録（2026-11-16）

本人が [PR #14](https://github.com/magumatari/shift-saas/pull/14) を merge `93d271a70c18cefa86d5cf89757c7478ec453e1e` で採用し、その後 [PR #17](https://github.com/magumatari/shift-saas/pull/17) を merge `3fad027e5d38c8620cc5f59600c727140984b765` で採用しました。以下は後者を main として担当CodexがGitHub API・実ジョブログを直接確認した固定時点の記録です。以後の採用状態は各PRとmainを確認します。

現行workflowのPR対象は `main` のみで、opened/synchronize/reopened/editedを維持し、pushもmainのみです。親ブランチ向けの一時triggerはPR #17で整理済みです。親へのpushや他base向けPRを対象に追加したわけではありません。

| main push CI | run / job | 実結果 |
| --- | --- | --- |
| H10 | [43937021355](https://github.com/magumatari/shift-saas/actions/runs/43937021355) / 133544183399 | 専用型検査・補助39件・UTC77件/Los Angeles77件 |
| golden | [43937021386](https://github.com/magumatari/shift-saas/actions/runs/43937021386) / 133544183024 | 型検査・root128件・golden2例/エラー0 |
| tenant | [43937021360](https://github.com/magumatari/shift-saas/actions/runs/43937021360) / 133544183581 | 型検査・unit14/runtime8/補助runner試験48/guard30/実guard68 |

全runは `event=push`、branchはmain、headと各jobの実checkoutは `3fad027e5d38c8620cc5f59600c727140984b765`、completed/successです。全fail/cancelled/skipped/todoは0でした。PR仮マージ・旧stack CI・作者ローカル試験の成功を、このmain pushの実績へ読み替えたものではありません。独立静的監査もCIの実行証拠とは別です。

専用CIへの接続・本人採用は、正式Validatorや一般REST_SHORTAGE照合の完成、goldenの正式承認を意味しません。必須check/rulesetの現在設定はこの確認で取得・変更しておらず、CI成功を必須化の証拠にはしません。補助39件自身の件数guardなし、待機run置換、実timeout/出力上限・孫プロセス・Windows/macOS等の限界と、PR #1の各期限は下記のままです。

## 以下はPR #14の制作・監査時点の履歴

以下に残す「未採用」「親ブランチの一時的なPR対象の整理は未実施」やroot98等は、初版と監査修正時点の記録です。現在の採用・trigger・件数は上の固定時点の記録と区別してください。過去の手順・検証範囲・未検証事項は削除しません。

PR #13 の監査済み固定head `e3ec555a27552685c49ecd37eb979c5fb950bd16` を親とする、別の未採用候補です。起点mainは `a5fb1588a4d336c7d4b4d827bd9a1528eb366822`。採用・監査・実行の固定headと最新状態は対応PRを参照します。PR #13 の静的監査を、この追加コードの監査に流用しません。

初版の追加は専用workflow、この説明、CLI runnerとその隔離試験の4ファイルです。PR #14の第1回監査修正では、この説明と親READMEの時点注記だけを更新します。H10本体/77試験/専用tsconfig、root package/lockfile、既存golden/tenant CI、共通parser/reporterと採用済みguard/pinは変更しません。親READMEの「既存CIに未接続」は親候補の時点の記録です。本候補のworkflowが実行できたこと、mainへの本人採用、製品/正式Validatorへの採用は別です。

## 実行範囲

`h10-rest-analysis` は標準 `ubuntu-24.04`、Node `24.22.1`、10分job上限、`contents: read`、checkout資格情報非永続化、cache/artifactなし。Actions SHAは既存tenant workflowの監査対象固定版と同じです。固定root lockfileから `npm ci --ignore-scripts --no-fund --no-audit` で導入し、次を別ステップで実行します。

1. `node node_modules/typescript/bin/tsc -p experiments/h10-rest-analysis/tsconfig.json`
2. `node --test experiments/h10-rest-analysis/check-rest-tests.test.mjs`
3. `node experiments/h10-rest-analysis/check-rest-tests.mjs`

CLI runnerは引数を受けず、同じ固定 `rest-analysis.test.ts` を実際の別NodeプロセスでUTC、America/Los_Angelesの順に実行します。各々最低77件、passed=tests、failed/cancelled/skipped/todo=0、整数カウンタ、正常終了、正規形式の最終summaryを要求します。共通の `validateRun` / `test-summary-reporter.mjs` を変更せず再利用し、余分/重複/欠落/不正/途中のsummary、signal、起動不能、非ゼロ、timeoutを成功にしません。各子120秒・出力4MiB上限で、両方を通過して初めて最終PASSを出します。既存root98・unit14/runtime8・補助30・実68へ77件を加算しません。

最低77件は固定headの平坦な77試験が基準で、追加の正常試験は許容します。下限や対象を変更・低下させる場合は本人確認と別AIの独立監査が必要です。件数は同名差替え、意味的網羅、reporter/テスト自体の不正改変、終了後の動作まで保証しません。

子環境だけから `NODE_OPTIONS` / `NODE_TEST_CONTEXT` を除き、TZはrunnerが固定します。親環境は変更せず、親Node起動前に解釈したオプションや任意環境全体を隔離したとは主張しません。CLI/runner固有の環境変数で対象や下限を設定する機能はありません。CLI専用入口は無条件に実行するため、symlink経由で入口比較が外れ無実行exit0になる経路を作りません。

## eventsとstack依存

PR対象は `main` と親ブランチ `experiment/h10-rest-pairs-20261116` です。親が未マージのstacked PRでも新jobを検証するため、後者を明示的に含めます。opened/synchronize/reopened/editedを対象とし、base変更時も検査対象にします。pushはmainだけです。パス条件、成功扱いskip、continue-on-error、モックへの置換、pull_request_target、秘密/write権限はありません。

他のbase向けPR、feature/親ブランチへのpushだけでは新workflowは実行されません。既存tenantはmain向けPR限定なので、親向けstackでは実行されません。既存goldenはPRのbase制限がないため実行対象です。これらの未実行を成功とは扱いません。本人が親 #13 を先に採用し、その後この候補のbaseをmainへ変更して同じhead/baseのCIを確認する必要があります。今回は親PRやbaseを変更しません。#10/#11/#12/#8への実装依存はありません。

親ブランチの一時的なPR対象の整理は未実施です。現在のstack検証を保つため、この文書修正ではworkflowを変更しません。整理は次の順で別途行います。

1. 本人が親 #13 を採用・マージし、本候補のbaseをmainへ変更した後、その時点の同じhead/baseに対する新H10・既存golden/tenant CIの実行と結果を確認する。親向けの成功やretarget前の成功で代用しない。
2. 本人による本候補の保護変更採用・マージ後、別の限定PRで `.github/workflows/h10-rest-analysis.yml` のPR対象から `experiment/h10-rest-pairs-20261116` だけを除き、main向けPR/push等を維持する案を用意する。別の依存PRが親向け検証を必要としていないことも確認する。
3. 整理候補も保護対象変更として固定headの独立Claude Code監査と同じhead/baseのCI確認を経て、本人が差分を確認して採用・マージする。採用後のmain push結果も確認する。親の採用やbase変更だけで自動削除・自動採用されたとは扱わない。

concurrency groupはworkflow名・event名・refで分離し、PRだけ進行中の同一対象を取り消します。別PRやmain pushを混同せず、後続pushで進行中mainを取り消しません。ただし同じgroupの待機run置換・実行順序の制約は残り、全mainコミットの実行保証ではありません。これはGitHubの[branch filter](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpull_requestpull_request_targetbranchesbranches-ignore)と[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)の仕様に基づく設定案で、実運用の取消/待機競合は今回再現していません。

## 作者検証と限界

追加の隔離試験は39件です。人工子結果で正常77/78、下限不足・0件、非ゼロ/起動失敗/signal/timeout/出力超過、summary欠落/重複キー/不正形式/途中/二重、各カウンタの単独異常を検査します。実CLIと架空のテストファイルでは76/0/未宣言/skip/todo/失敗/早期exit0/欠落/syntax/引数・LA側だけの失敗を検査します。正常対照、空白パス・symlink、起動後に設定した無害なNODE_OPTIONS preloadが子へ渡らない境界も確認します。各拒否は終了状態と理由を照合し、harness起動失敗/timeoutを狙った拒否として数えません。

この39件自身は `node --test` の終了コードだけで、件数減・skip/todoを別guardで機械強制しません。ログの39件/skip/todo0確認と、実H10の各77件に対する機械強制を区別します。人工ETIMEDOUT/ENOBUFSは実120秒待機/4MiB超過の実測ではありません。孫プロセス清掃、Windows/macOS、敵対的ホスト全体の隔離も保証しません。

実H10各77件・専用tscと、正常/故障コピーによる手動負の対照は固定headの作者記録へ分けて記載します。既存77試験や期待値を変えず、期待値をH10実装から生成しません。作者の実行・GitHub CI・Claude Code静的監査はそれぞれ別の証拠です。

新workflowも本人採用待ちの保護変更候補です。必須check/ruleset/権限は変更しません。CI接続だけで製品経路・正式Validator・一般REST_SHORTAGE整合が完成するわけではなく、親候補の会社分離/原work-break-cover前提・完全性/適用期間/禁則/正式違反/本番の限界とPR #1の期限は維持します。golden2例はdraft/承認nullのままです。独立監査はDotsが固定版で手配し、本人だけが採用・マージします。
