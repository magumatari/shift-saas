# 企業別 Durable Objects 分離のローカル検証

`docs/decisions.md` の「リクエストごとに所属を照合してから、その企業の DO だけを開く」を小さく検証する、製品コードから独立した試験です。架空企業・架空ユーザーと、意味を持たない文字列の保存だけを扱います。業務 API、認証機能、所属のデータモデル、業務データのスキーマを実装・確定するものではありません。

## 現在の状態（PR #3 の修正版）

- 実験本体の [PR #2](https://github.com/magumatari/shift-saas/pull/2) は、head `69f7d3d5339b589d6ca1a8c86fb62a872dd8de7e` の Claude Code 静的再監査 `SHIFT-PR2-20261113-AUDIT02` を経て、本人が merge `f6fdbed2205bdc35c415cc7b3771ba39f5c96f96` で試作として受け入れました。P2 全 5 件は解消、getter 境界の low 指摘は別枠で残っています。監査者がテストを実行したという意味ではありません。
- 専用 CI は [PR #3](https://github.com/magumatari/shift-saas/pull/3) 上で接続・実行済みです。修正前の [run #2](https://github.com/magumatari/shift-saas/actions/runs/43524153036) は unit 14／runtime 8、skip／todo 0 で成功しました。これは作者が Actions のジョブログで確認した実行実績です。
- PR #3 は本人採用前で、main への workflow 採用と必須チェック設定は未了です。静的監査 `SHIFT-PR3-20261113-AUDIT01 rev1`（head `7a7a14c...`、P0=0/P1=1/P2=5）と `SHIFT-PR3-20261114-AUDIT02 rev2`（head `ef664b9...`、P0=0/P1=1/P2=4）はいずれも条件付き可。この README・件数ガード・main 取消防止を含む今回の修正版は、次の独立再監査待ちです。
- 次の PR #3 再監査は第 2 回かつ上限です。残件があれば追加ループせず本人判断へ戻します。P1 の必須チェック未設定を技術的に解消したとは扱いません。修正版の固定 head と最新 CI 実績は PR #3 の説明に記録します。

## 基準と分離

- 基準は [decisions.md](../../docs/decisions.md) が最優先、次が [hard-rules.md v1.3](../../docs/hard-rules.md)。設計監査の再開、Hard ルール・正解例の変更は行いません。
- 開始時の checkout は `work`、変更なし、`41acf9764041b4d5f41950810a4ac5e5a23bc9f9`。同じ SHA の main から別 worktree・`spike/tenant-do-isolation` を作成しました。
- 開始時の GitHub heads は `main` と `feat/golden-h10-schema` のみ。既存 PR は [PR #1](https://github.com/magumatari/shift-saas/pull/1) のみで、同じ分離検証への着手は見つかりませんでした。
- PR #1 の head は `dfd8032c373f18f6fc4af1c1c05c8b6fa6e49721`、base は上記 main SHA。PR #1 の変更 11 ファイルと、このディレクトリの変更パスは重複しません。
- PR #2 では root の設定・依存・lockfile・CI、`golden/`、Schema・読込比較処理、監査依頼文、`.claude/settings.json`、正本文書を変更しませんでした。PR #3 の今回の承認範囲は専用 workflow と本実験の README・package scripts・最小限の検証補助だけで、root package／lockfile、正本、既存 CI、CODEOWNERS、必須チェック等は変更しません。

## 実行

Node.js 24 と npm を使用します。リポジトリ root の npm 設定を使用しません。

```sh
cd experiments/tenant-do-isolation
npm ci --ignore-scripts --no-fund --no-audit
npm run typecheck
npm test
```

書込可能な npm cache の指定が必要な環境では、最初のコマンドに `--cache /tmp/shift-saas-npm-cache` を加えます。`npm run test:unit` と `npm run test:runtime` で個別実行もできます。

## テスト件数・skip／todo の検知

`npm test` は unit と runtime を順番に実行します。各 script は `scripts/check-test-run.mjs` を通じ、固定された既存のテストファイルを実際に別 Node プロセスで起動します。テスト本文と期待結果は変更していません。

専用 reporter `scripts/test-summary-reporter.mjs` は、[Node 24.22.1 の TestsStream](https://nodejs.org/download/release/v24.22.1/docs/api/test.html#event-testsummary) の最終累計 `test:summary`（`file` が undefined）だけを、バージョン付き JSON 1 レコードとして stdout に渡します。ファイル別 summary は合計せず、二重集計しません。テスト名・エラー・テスト自身の stdout／stderr は stderr に流し、人向けログを件数パーサーに混ぜません。

| 対象 | 件数の下限 | 起点と集計単位 |
| --- | --- | --- |
| unit | 14 | 監査済み PR #2 head `69f7d3d...` の gate.test.mjs。Node の `counts.tests`（suite を除くテスト数） |
| runtime | 8 | 同版 runtime.test.mjs。SQLite 5 件、DO 到達ゼロ 2 件、公開入口 404 の 1 件 |

同じ基準は独立確認で報告された現行ログとも一致します。入力値を回すループ内の各ケースは別件に数えません。runner は、子プロセス終了 0・signal／起動エラーなし・最終 summary が正常・passed=tests・件数が下限以上・failed/cancelled/skipped/todo がすべて 0、を要求します。不正／欠損／複数レコード、パース不能、型不正、テスト起動不能、テスト自身の非ゼロ終了も非ゼロにします。子プロセスには 120 秒の上限、workflow 全体には 10 分の上限があります。

**件数基準の変更運用**：下限は補助スクリプト内で固定し、CLI 引数や環境変数で下げる機能を設けません。テスト追加時は内容と件数を確認して下限の引上げを提案します。削除・統合などで下げる必要がある場合は、理由と失われる／移される検証範囲を別 PR で示し、本人の明示承認と別 AI の独立監査を経てから本人が採用します。失敗を消すために無断で基準を下げることは禁止です。同一アカウントがファイルを編集できる以上、本人承認を技術的に完全保証する仕組みではありません。

これは件数減・skip／todo の検知です。同名差替え、同じ件数の別テストへの置換、意味的な網羅、実認証・製品経路の正しさは保証しません。Node は宣言テストのないファイル自体を 1 テストと数える場合もあります。今回の早期終了の隔離例は実際の下限 14 に満たないため拒否しますが、件数だけでテスト内容を証明できるわけではありません。

### PR #3 修正版のローカル確認

Node `v24.22.1`／npm `11.9.0` で型検査と新しい `npm test` が成功し、guard が unit 14／runtime 8、skip／todo 0 を確認しました。補助スクリプトの検証は一時領域の人工レコードと人工テストで行い、実験の既存テストを弱めていません。正常・件数不足・skip・todo・不正出力・非ゼロ終了・起動不能などの隔離検査結果と CI 実績は PR #3 に記録します。一時領域は確認後に削除します。

## CI の接続と concurrency

専用 workflow は実験ディレクトリで lockfile から導入し、型検査・unit・runtime を別ステップで実行します。標準 GitHub-hosted Linux runner、固定 Node／Actions、contents: read、資格情報永続化なし・依存キャッシュ／artifact 保存なしで、Cloudflare 認証やデプロイはありません。

concurrency の group は workflow 名・イベント名・ref を含み、別 PR と main push を分離します。`cancel-in-progress` は PR イベントのときだけ true にし、main push の進行中実行は後続到着で取り消しません。ただし同一 group の待機中実行は置換される余地があり、実行順序にも制約があります。**全 main コミットの実行保証ではありません。** 主張する範囲は進行中 main の途中取消防止だけです。実行を重ねる取消・待機置換の実証と GitHub 上のマージ阻止確認は未実施で、静的確認と通常 PR CI の実績を区別します。

Wrangler・デプロイ用設定・Cloudflare アカウント ID・API トークンは使用しません。Miniflare のローカル workerd を loopback の一時ポートで起動し、SQLite DO は一時保存のみです。Worker の外向き fetch はテスト設定で拒否します。依存ダウンロードは npm registry、GitHub 操作は個人リポジトリだけです。実 Cloudflare へのデプロイ・接続や従量課金リソースの使用は行いません。

## 何を検証しているか

`src/gate.ts` の `accessCompany()` の 1 回の呼出しを 1 リクエストとして扱います。テストから認証済みの自社ユーザー ID と有効所属の照合結果を注入し、その照合成功後に初めて `idFromName(companyId)` → `get(id)` → DO への fetch を許します。所属の結果や stub をリクエスト間でキャッシュしません。

検証用境界では resolver の返却値を `unknown` として受け、自社ユーザー ID が直接のプロパティに存在する、空白だけではない文字列でなければ未認証として拒否します。企業 ID も欠損・非文字列・空文字・空白だけなら、所属照合前に拒否します。入力値を書き換える正規化は行いません。未知企業・未知ユーザーは架空の所属表に存在せず、所属照合が false になり拒否されます。これらは本検証の fail-closed ガードで、製品の ID 形式や認証・ユーザー存在確認の仕様を決めるものではありません。

企業 ID の入口は `companyId` 引数 1 つだけです。操作は read または文字列 write で、別の企業 ID を持つ経路はありません。そのため URL／header／body 間の ID 不一致は本検証には該当しません。保存文字列を他社の ID と同じ値にしてもルーティング先が変わらないことを検査します。製品の ID 形式、URL・header・body の選択と不一致時の処理は未決です。

`src/company-object.ts` は実 workerd 内の `state.storage.sql.exec()` で、企業 DO ごとに同一構造・同一キーの試験用テーブルを作ります。企業によるコード分岐や、共有テーブルの企業 ID フィルタで分離を代用していません。public Worker の入口は常に 404 で、試験用ログイン API は設けていません。

| 項目 | モックのみの検査 | ローカル実 DO ランタイムを含む検査 |
| --- | --- | --- |
| 自社アクセス | 認証→所属→照合完了→ID→stub→fetch の全順序 | 実 DO の SQLite で write/read と全イベント順序。同じ企業名の DO ID は同じ、別企業は異なる |
| 未所属企業 ID | read/write 拒否、ID・stub・fetch の呼出しゼロ | モック所属で拒否したリクエストは実 namespace に到達せず、B の保存値も不変 |
| 未ログイン | 所属照合も DO アクセスもゼロ | モック未ログインで実 namespace への到達ゼロ |
| 所属無効化 | 成功済みのユーザーでも次の read/write を拒否。毎回再照合 | 同じく A を拒否し、所属の残る B は利用可能 |
| 複数所属 | 選択した企業だけを開く | 同じキーを使う A/B の SQLite 保存値と更新が独立 |
| 照合前に開かない | 非同期照合を未完了のまま止め、ID・stub・fetch がゼロ。拒否完了後もゼロ | 未完了中は実 namespace 呼出しゼロ。成功完了後の A への PUT、A の read-back、B の保存値不変と全イベント順序を検査 |
| 未知企業・未知ユーザー・空の ID | read/write とも拒否し、ID・stub・fetch がゼロ。欠損・不正な resolver 値も所属照合前に拒否 | 実 namespace を注入した境界検査でも到達ゼロ。拒否だけの検査は SQLite 実行件数に含めない |
| 依存失敗 | セッション／所属照合の例外を伝播し DO を開かない。明示的な true 以外は拒否 | 認証・D1 の障害を実サービスで再現してはいない |
| DO の非 2xx 応答 | 400・403・404・500・503 の read/write でエラーを伝播。成功結果・再試行なし、呼出し順序も検査 | 非 2xx 応答の注入はモックのみ。実ランタイムでの障害再現は未検証 |

**実 DO を含むテストでも、セッションと所属はモックです。** gate は Node.js 内で実行し、Miniflare の `getDurableObjectNamespace()` 経由で実 workerd の DO に接続しています。認証から Worker 内で一貫して動く製品経路の検証ではありません。

## 過去の実行記録（PR #2）

2026-11-13、Linux x64、Node.js `v24.22.1`、npm `11.9.0`。

- 初版作成時の `npm --cache /tmp/shift-saas-npm-cache install --ignore-scripts --no-fund --no-audit`：成功、検証用ディレクトリ内に lockfile を生成。
- 初版作成時の `npm --cache /tmp/shift-saas-npm-cache ci --ignore-scripts --no-fund --no-audit`：成功、固定した lockfile から再インストール。PR #2 の第 1 回修正では依存・lockfile は変更せず、導入済み依存で以下を実行。
- `npm run typecheck`：成功（src の TypeScript を strict で検査）。
- `npm test`：22 件成功、失敗・skip とも 0。内訳はモック 14 件、ローカル workerd を起動する 8 件（実 SQLite の保存・照合を含む 5 件、DO 到達ゼロの境界検査 2 件、公開入口 404 の検査 1 件）。ループ内の各入力ケースを別テストとして水増しせず、Node test runner の件数を記載。
- 初版作成時の `npm ls --depth=1`：固定依存と workerd の導入を確認。
- `git diff --check`：成功。

Miniflare `4.20260730.0` と TypeScript `5.9.3` を固定しています。試験用 DO の TypeScript を workerd に渡すため Node の `stripTypeScriptTypes()` を使い、Node から ExperimentalWarning が出ます。テストの省略やモックへのフォールバックは行いません。

参考：[Miniflare の DO テスト API](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)、[SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)。これはローカル workerd の検証で、Cloudflare 上の実行結果ではありません。

## 過去の独立監査後の修正（PR #2 第 1 回）

Claude Code の静的監査 `SHIFT-PR2-20261113-AUDIT01` は初版 head `a439c63dc2408089a2693122072b0b09a091f7cd` と全変更 10 ファイル・正本 2 文書を対象とし、条件付き可（P0=0、P1=1、P2=5）でした。監査者は初版の 16 テストを再実行していません。この記録は返却された監査結果に基づき、作者の自己確認を独立監査には数えません。

PR #2 第 1 回修正は P2 の 5 項目に対応しました。未知・空の ID の拒否試験、欠損 resolver 値のガードと試験、非同期 PUT 後の読み戻し・他社データ不変、実際の SQLite 検証件数の訂正、非 2xx エラーと全イベント順序の検査を追加しました。初版は「SQLite 関連 6 件」と記載していましたが、未ログイン拒否の 1 件は SQLite に到達しないため実質 5 件でした。修正後も SQLite を実行するテストは 5 件です。

この PR #2 修正版の独立再監査と本人による試作受入れは完了しました。CI 接続と必須化は別の採用条件として残し、上部の PR #3 現在状態と区別します。PR #2 の受入れは製品経路の完成や P1 の技術的解消を意味しません。

## 未決・未検証と次の判断

- 現行 main に Better Auth・D1・業務 Worker の実装がないため、実セッションの検証、自社ユーザー ID との対応付け、実 D1 の所属テーブル・クエリ、所属無効化の反映遅延は未検証です。Better Auth を自作の認証方式で置き換えていません。
- 実際の API 入力形式・エラー応答、企業 ID の正規化、ロール／店舗単位の権限、運営代理アクセスは本検証で決めません。
- 所属の照合後から DO 操作までの間に無効化される進行中リクエストの扱い・競合制御は正本に具体手順がなく未決です。本検証が保証する無効化は、モックの所属変更後に照合を開始する次のリクエストの拒否だけです。
- Worker 内での全経路、並行実行、永続化を伴う再起動、実環境の DO binding・migration・障害復旧、クラウド上での挙動・料金は未検証です。
- 正本はテナント分離テストを CI 必須にするよう定めています。PR #3 上の接続・実行実績と、main への本人採用・必須チェック設定は別です。後者は未了で、P1 を解消済みとは扱いません。
- PR #2 の独立監査・本人による試作受入れは完了し、今回の PR #3 修正版は独立再監査待ちです。採用・リリース前に別 AI の監査が必要で、マージ・必須設定はご本人だけが行います。修正→独立再監査は PR ごとに最大 2 回、同じ指摘が 2 回続けば本人判断という運用を維持します。今回の次の PR #3 再監査が上限です。
