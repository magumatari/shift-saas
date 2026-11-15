# 保護対象変更の読取・記録候補

起点 main `0901ae623bb71feffbbeadf86a28822f4c85aee2`。正本は `docs/decisions.md`（blob `0d392a26225407b09537973ff374f7944021f6bc`）→ `docs/hard-rules.md` v1.3（`b34455d5bae697977e56cfbb4806b875712f8f3d`）。本候補は内容検査とは別に差分の記録を出すものです。JSON の `approval: "not-evaluated"` のとおり、本人承認・採用を機械判定しません。workflow の緑は読取・記録成功だけです。正式 golden 保護の完成ではなく、workflow を含め本人採用待ちの提案です。採用状態は対応 PR と本人のマージ記録で確認します。

## 検出対象表

パスは Git の大小文字を区別した相対名です。既存正本のカテゴリに対応し、検知自身と実行基盤の最小範囲も候補に含めます。後者の範囲採用も本人判断です。

| パス／パターン | 現在の対応・本人確認の理由 |
| --- | --- |
| `golden/**` | H10 の2例、README、`golden/schema/golden-case.schema.json`。例・承認状態・形式定義の意味を変更できる。新拡張子や追加ディレクトリも対象 |
| `scripts/check-golden` の後が `.`／`-` または末尾のファイル、`scripts/golden/**` | 現在の `.ts` と `.test.ts`、将来この配下へ追加する loader／comparer と試験。照合を緩める変更を本人が確認する |
| `.github/workflows/golden-*.yml`／`.yaml` | 現在の `golden-check.yml` と同じ名前系列の追加。内容検査の実行／省略を変更できる |
| `.github/workflows/tenant-isolation.yml`／`.yaml` | 必須の分離試験の実行設定。今回の別候補である68件接続も本人確認対象として提案 |
| `.claude/commands/**` | 正本が予定する `audit-pr.md` と関連テンプレートを取りこぼさないためディレクトリを対象化。現在は未作成。無関係なコマンドを将来置く場合の範囲見直しも本人判断 |
| `.claude/settings.json` | 現存する監査権限設定 |
| `scripts/protected-changes/**`、`.github/workflows/protected-*.yml`／`.yaml` | この検知のコード・対象表・試験・実行設定。自分を消す変更も確認するための補助範囲 |
| root `package.json`／`package-lock.json` | 現行 golden CI が実行する npm コマンドと固定依存。保護対象の実行を差し替え得るため含める補助範囲 |

他の全ソースや全 workflow を一律には含めません。任意の名前・任意の場所に新設された Schema／loader／comparer／監査文／再利用 workflow を意味解析で発見するものではありません。追加・移動する PR では、本人が正本のカテゴリと照合し、必要な対象表更新も同時に確認します。既知対象から対象外への移動は削除側を記録しますが、その移動を採用した後の対象外パスの更新までは追跡しません。この配置方針と補助範囲を承認せずに、将来の全該当ファイルを保証したとは扱えません。

## 比較と安全性

`pull_request` はイベントの base SHA と head SHA の一意な merge base → head（PR の差分）、`push` の main は before → after（その push 全体）の2点比較です。GitHub の PR `GITHUB_SHA` は仮マージなので比較 head の代用にしません。起点・比較起点・head をログと job summary に残します。初回 push の全ゼロ SHA、欠落／不正 SHA、object 不在・非 commit、merge base 不在／複数は失敗です。取得できないものを空差分にしません。

`git diff --no-ext-diff --no-textconv --no-renames --name-status -z BASE HEAD --` を shell なしの引数配列で実行します。rename はヒューリスティックに依存せず D＋A で記録し、両パスを照合します。add／modify／delete／型変更を扱い、未知 status、途中切れ、重複、UTF-8 として解釈不能なパスなどは失敗します。空白・タブ・改行等は JSON エスケープで保ち、summary は HTML をエスケープします。PR の名前・パス・内容を shell 文へ挿入したり、変更ファイルの内容を実行したりしません。

新 workflow は標準 ubuntu-24.04／Node 24.22.1、確認済み公式 Actions の固定 SHA、contents: read、checkout 資格情報永続化なし、cache／artifact・追加依存・secret・コメント・write API・`pull_request_target` なしです。全履歴 checkout と各 Git 呼出30秒／4MiB、job 5分上限を設け、失敗を成功に変換しません。summary 書込失敗も非ゼロです。内容検査 `golden-check` は変更しません。concurrency はイベント・ref 別、進行中 main は取消しませんが待機 run の置換は残ります。

この workflow は通常の PR checkout にある検知コードを実行します。PR が検知自体・対象表・workflow を書き換える／削除することで、記録を消したり嘘の成功にできる限界があります。この候補自身の初回採用も、機械記録だけで判断できません。本人名義のトークンと本人を区別できず、自己申告文字列・ラベル・bot コメントで承認済みにはしません。より強い基準側固定実行・必須設定・権限分離は別の本人判断で、今回設定しません。

## 実行と本人の手順

```sh
node --test scripts/protected-changes/report.test.mjs
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=/path/to/event.json node scripts/protected-changes/report.mjs
```

合成 Git fixture で add／modify／delete／型変更、対象内外の移動、空差分、PR 分岐、取得失敗、比較入力欠落／異常、空白等のパスを検査します。架空ファイルだけを OS 一時領域へ作り、自分の fixture だけを削除します。

作者のローカル確認（Linux／Git 2.52.0／Node v24.22.1）では52件が成功し、skip／todo は0でした。CLI の構文検査と diff check も成功。独立監査ではありません。提案 head の Actions と実差分の検出結果は対応 PR に記録します。main push・fork PR・巨大履歴・実 timeout の故障注入や GitHub の必須化による遮断を、この合成試験だけで実証したとは扱いません。

本人は (1) PR の固定 head と base、GitHub Files changed の全差分を確認、(2) 検知対象表と検知機構自身の変更も確認、(3) 同じ head の内容検査と検知ログ／summary、別 AI の独立監査を確認、(4) 保護対象変更を認識した採用判断を PR に本人自身の操作で記録し、本人だけがマージします。この記録をプログラムで本人認定する機能はありません。必要な記録形式と、`protected-changes`／`golden-check` の必須化要否・設定は本人が別途決めます。設定する場合は GitHub の protect-main の required status checks で実在する check 名を選び、bypass／権限とともに確認します。この提案は設定を変更しません。

内容成功は golden 正式承認ではありません。H10 は draft／承認 null のままです。正式 golden 運用前の検知＋本人確認、例拡張前の REST_SHORTAGE 一般照合、Windows 検証前の CRLF／パス対応の期限を維持します。Linux の Git パス検査は golden loader の Windows 対応を証明しません。実認証・製品経路・本番や既知 getter／孫プロセス low も対象外です。各 PR の独立監査は Dots が手配し、修正→再監査は最大2回、同じ指摘2回は本人判断です。

一次資料: [Git diff の NUL 出力・rename](https://git-scm.com/docs/git-diff)、[Git merge-base](https://git-scm.com/docs/git-merge-base)、[GitHub PR／push イベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[Node spawnSync](https://nodejs.org/download/release/v24.22.1/docs/api/child_process.html#child_processspawnsynccommand-args-options)。
