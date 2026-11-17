# 勤務分数試作の CI 接続候補

PR #23 固定親 `77aa09a44b5028babb37748ddfd8394893558948`（起点 main `7e8c36acd689e4d78ed6e657f2b66af8f26daa48`）からの追加候補。ローカル制作のみで、公開・CI 実行・本人採用は未実施です。採用状態は固定版の返却記録と将来の PR を参照します。親の README にある「CI 未接続」は親固定版の記録です。この候補は新 workflow による接続を提案するもので、親の実装・56 試験・専用 tsconfig を変更しません。

## 追加範囲と根拠

- 専用 `.github/workflows/pattern-accounting.yml`、CLI runner、隔離試験、本説明の 4 ファイルだけを追加します。既存 workflow、root package/lock/tsconfig、既存の集計器・reporter は変更しません。
- 元の数値計算の根拠は `docs/decisions.md:49`、`docs/hard-rules.md:70-75,199-201,290-291`。CI は新しい勤務規則・合否を追加せず、親の専用型検査・手計算期待値の試験を実行します。一般 Validator、H04 人数不足、実認証・製品経路・本番の完成ではありません。別の H04 候補には依存しません。
- root の固定 lockfile を `npm ci --ignore-scripts --no-fund --no-audit` で導入し、`node node_modules/typescript/bin/tsc -p experiments/pattern-accounting/tsconfig.json` を実行します。
- 既存 H10/tenant workflow と同じ ubuntu-24.04、Node 24.22.1、checkout/setup-node の commit SHA をそのまま使用します。contents: read、persist-credentials: false、cache 無効、10 分上限。secrets・追加サービス・artifact・追加依存・write 権限は不要です。必須 check の設定は変更しません。

## 固定 runner と検査

`node experiments/pattern-accounting/check-pattern-tests.mjs` は CLI 専用です。symlink 入口でも無条件に実行し、ライブラリ用 export はありません。引数を拒否し、Node の完全一致を確認します。対象は `pattern-minutes.test.ts`、最低件数は 56、時区は UTC と America/Los_Angeles に固定します。各時区を別の Node プロセスで `--import tsx --test` により実行し、既存 tenant reporter / validateRun を再利用します。cwd と対象・reporter は import.meta.url から決めるため、呼出し側 cwd で切り替わりません。

各子に 120 秒・stdout 4 MiB 上限を設け、正常終了・正規の単一最終 summary・tests >= 56・passed == tests・failed/cancelled/skipped/todo == 0 を要求します。親の 56 件は flat なため suites == 0、topLevel == tests も要求します。空・不完全・重複・非正規 summary、未知/欠けた counter、非整数、起動失敗・signal・非ゼロ終了・timeout を成功にしません。両時区が成功した場合だけ最後の `pattern-minutes: PASS timezones=2` を出します。56 件は root133、H10、tenant の件数に加算しません。

件数の最低値・固定対象・flat 前提を変える場合は、追加/削除の理由と実測を示し、独立レビューと本人採用を経ます。最低値を下げて緑にする運用は認めません。件数は同名差替えや意味的網羅、終了後の不正変更を保証しません。

子環境から NODE_OPTIONS と NODE_TEST_CONTEXT を除去し、TZ を固定します。runner 自身に対象/下限を変える環境変数機能はありません。親 Node が起動前に解釈したオプション、任意環境変数や悪意ある実行環境全体を隔離するものではありません。

## 隔離試験とローカル実測

`node --test experiments/pattern-accounting/check-pattern-tests.test.mjs` の新 53 件は、人工結果と実際の架空子プロセスを区別します。56/57 の正常、55/0 件、独立した fail/cancelled/skipped/todo、終了非ゼロ、summary 欠損/重複/不正、flat 不一致、引数拒否、LA だけの失敗、無害な preload による子境界、空白パス・symlink を検査します。素の node --test が未宣言/55 件/skip/todo/早期 exit0 を成功にし得る対照も実行します。

新 53 件自身は node --test の終了コードを使い、件数・skip/todo の独立 guard はありません。53 件という実績は作者ログの集計で、CI がそれを機械強制するとの主張ではありません。人工 timeout/出力上限エラーは拒否しますが、実 120 秒 timeout・実 4 MiB 超過・孫プロセス清掃は実測/保証していません。Windows/macOS は未検証です。一時 fixture の外部依存リンクは明示 unlink 後に削除し、リンクが置換されていれば停止して残します。

作者 Linux / Node v24.22.1 のローカル結果は専用型検査・新 53 件・実 UTC56/LA56、root 型検査・root133/golden2 が成功、fail/cancelled/skipped/todo は 0。既存固定 lock と一致する導入済み依存を再利用し、新 install はありません。隔離コピーの下限引下げ・NODE_OPTIONS 継承・flat 検査除去の故障対照は各 2 件中正常 1 pass/狙った assertion 1 fail として確認しました。詳細な確定コマンド・exit・ログは固定版の返却資料に置き、独立監査の実行と混同しません。

## 起動条件・採用順と残条件

main 向け PR（opened/synchronize/reopened/edited）と main push が対象です。パス条件・continue-on-error・成功扱い skip はありません。PR 本文編集も edited として起動します。workflow名/event/ref の group により別 PR と main を分離し、PR だけ古い進行中実行を取り消します。main の進行中実行は後続で取り消しませんが、同じ group の待機実行の置換・順序制約が残り、全 main commit の実行保証ではありません。

親 #23 は未採用です。将来公開が承認された場合の推奨は #23 を親にした stacked Draft。親ブランチ向け PR とこの枝への通常 push は本 workflow の対象外であり、この段階で GitHub CI を実行済みとは扱いません。一時的な親 trigger を追加せず、#23 を本人が先に採用・merge → 本候補の公開承認 → 本人管理で base main → 同一 head/最新 base の実 checkout と専用/既存 CI を確認 → 独立レビュー・本人の保護変更採用/merge とします。公開時は main/親固定版・対応 PR・担当競合・累積差分と追加差分を再確認し、無断で retarget/Ready/merge しません。

本候補は CI ファイルを含む未採用の保護変更です。現在はローカルだけで、独立監査・GitHub 実 CI は未実施。必須化・正解例承認・本番反映は本人判断であり、公開/監査 PASS がこれらの承認を代替しません。
