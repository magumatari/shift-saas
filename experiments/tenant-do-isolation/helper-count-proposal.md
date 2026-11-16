# 補助30件の実行件数検査候補

起点 main は `a5fb1588a4d336c7d4b4d827bd9a1528eb366822`。採用済み `guard-ci.test.mjs` の30件を、専用 runner `scripts/check-guard-ci.mjs` から別 Node プロセスで実行する提案です。採用状態は対応 PR・固定 head の独立監査・本人の判断記録で確認します。workflow の変更は保護対象として扱い、採用・マージ・必須設定は本人だけが行います。

実験ディレクトリで:

```sh
node --test test/guard-ci-count.test.mjs
node scripts/check-guard-ci.mjs
```

新 runner は、採用済み `validateRun` と `test-summary-reporter.mjs` を変更せず利用します。実行ファイル・reporter・下限 **30** はソース内で固定し、CLI 引数を拒否します。runner 自身には環境変数による対象・下限の設定機能もありません。子環境のコピーから `NODE_TEST_CONTEXT` と `NODE_OPTIONS` を除き、runner の親環境は変更しません。Node は workflow 固定の `v24.22.1` を使います。親 Node が起動前に解釈したオプションを取り消すものではなく、任意の環境変数・悪意ある実行環境全体を隔離する保証でもありません。

子プロセスの正常終了、正規の単一最終累計、passed=tests、tests>=30、failed/cancelled/skipped/todo=0を要求します。空・欠損・不正・重複・途中 summary、0/29件、登録前や完了前の exit0、起動エラー・非ゼロ・signal・timeout は失敗です。基準以上の件数で終了した後の早期終了や、同数の別テストへの差替え、意味的な網羅まで保証するものではありません。30件を unit14/runtime8/実guard68に加算しません。

入口の両側を realpath で照合し、照合時のエラーも try 内で非ゼロにします。Linux の一時 fixture でファイル／ディレクトリ symlink の30件成功・29件拒否、存在しない argv パスの拒否を検査します。Windows/macOS や任意の実行環境を実証したものではなく、既存 runner の入口は変更しません。

新 runner の子プロセス上限は120秒、出力上限は4MiB、workflow は既存の10分上限です。孫プロセスを含むプロセスツリー全体の停止は保証せず、既知の清掃の限界は残します。OS起動不能・signal・timeout の検査には人工結果を使い、実際に120秒待つ timeout は未実測です。実 CLI の欠落 test/reporter は、子 Node 起動後の失敗として別に検査します。

新しい隔離試験は現在 **48件**です（PR #12 初版 `ec6f10011d0864d37180dc41184a0e1dda178631` は46件）。人工結果では passed=tests を維持して個々のskip/todo等を拒否させます。実 CLI のskip/todo検体は passed 不一致もある複合条件なので、個別条件だけの実証とは区別します。CLI拒否の終了値・理由と、正常対照を確認し、fixture側の10秒harness timeoutや起動エラーを狙った拒否とは数えません。変更するのは一時コピーの合成入力／reporterだけで、採用済みテストは変更しません。

追加2件では、Node v24.22.1 が無害な `NODE_OPTIONS=--require <一時 preload>` を実際に受理する正常対照と、起動後にだけその値を与える隔離 launcher からの子境界を検査します。preload は一時子プロセス内の合成印だけを設定し、秘密情報・実設定・外部通信を使いません。親はオプションなしで起動し、runner から戻った後も親のオプション値が保持され、親では preload が動いていないことを確認します。実装元プロセスやOSの環境設定は変更しません。旧 runner をコピーした負の対照では、子が preload の印を受け取るため新しい境界試験の assertion が失敗することを確認し、使用不能なフラグや親起動失敗を回帰検出に数えません。

同じ隔離試験には、裸の `node --test` が未宣言・29件・skip・todo・完了前exit0を終了0にする対照も含めます。この48件のステップ自体は裸の `node --test` の終了コードを使い、件数・skip/todoを機械強制する guard はありません。作者と Dots によるログ／内容確認が必要という限界を開示します。採用済み30件を検査する次のステップとは別です。

workflow の変更は、新隔離試験ステップの追加と、既存補助ステップの専用 runner 呼出しへの変更だけです。既存の必須 job 名、unit14/runtime8/実68、npm scripts、Node/Actions の pin、依存・lockfile、read-only 権限、資格情報永続化なし、cache/artifactなし、イベント分離 concurrency を維持します。main の進行中実行は取消しませんが、待機実行の置換余地は引き続きあり、全mainコミットの実行保証ではありません。

既存 README と guard-ci-proposal は PR #10 の文書候補と分離するため変更しません。そこにある「補助30件は非強制」は本候補採用前の版の記録として扱い、本候補の採用後の文書追従は別途判断します。PR #11 のchecker、実認証・製品経路・getter境界・本番、goldenの正式承認や一般H10照合は対象外です。正式golden運用前の保護・本人確認、例拡張前の一般REST_SHORTAGE照合、Windows検証前の対応という期限も変更しません。

作者のローカル結果と同じ head の Actions 実績は対応 PR に記録し、独立静的監査者による実行とは分けます。Dots が固定版の初回 Claude Code 監査を手配し、修正後再監査は最大2回、同じ指摘2回は本人判断とします。
