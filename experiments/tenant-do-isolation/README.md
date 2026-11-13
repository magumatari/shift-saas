# 企業別 Durable Objects 分離のローカル検証

`docs/decisions.md` の「リクエストごとに所属を照合してから、その企業の DO だけを開く」を小さく検証する、製品コードから独立した試験です。架空企業・架空ユーザーと、意味を持たない文字列の保存だけを扱います。業務 API、認証機能、所属のデータモデル、業務データのスキーマを実装・確定するものではありません。

## 基準と分離

- 基準は [decisions.md](../../docs/decisions.md) が最優先、次が [hard-rules.md v1.3](../../docs/hard-rules.md)。設計監査の再開、Hard ルール・正解例の変更は行いません。
- 開始時の checkout は `work`、変更なし、`41acf9764041b4d5f41950810a4ac5e5a23bc9f9`。同じ SHA の main から別 worktree・`spike/tenant-do-isolation` を作成しました。
- 開始時の GitHub heads は `main` と `feat/golden-h10-schema` のみ。既存 PR は [PR #1](https://github.com/magumatari/shift-saas/pull/1) のみで、同じ分離検証への着手は見つかりませんでした。
- PR #1 の head は `dfd8032c373f18f6fc4af1c1c05c8b6fa6e49721`、base は上記 main SHA。PR #1 の変更 11 ファイルと、このディレクトリの変更パスは重複しません。
- root の設定・依存・lockfile・CI、`golden/`、Schema・読込比較処理、監査依頼文、`.claude/settings.json`、正本文書は変更しません。

## 実行

Node.js 24 と npm を使用します。リポジトリ root の npm 設定を使用しません。

```sh
cd experiments/tenant-do-isolation
npm ci --ignore-scripts --no-fund --no-audit
npm run typecheck
npm test
```

書込可能な npm cache の指定が必要な環境では、最初のコマンドに `--cache /tmp/shift-saas-npm-cache` を加えます。`npm run test:unit` と `npm run test:runtime` で個別実行もできます。

Wrangler・デプロイ用設定・Cloudflare アカウント ID・API トークンは使用しません。Miniflare のローカル workerd を loopback の一時ポートで起動し、SQLite DO は一時保存のみです。Worker の外向き fetch はテスト設定で拒否します。依存ダウンロードは npm registry、GitHub 操作は個人リポジトリだけです。実 Cloudflare へのデプロイ・接続や従量課金リソースの使用は行いません。

## 何を検証しているか

`src/gate.ts` の `accessCompany()` の 1 回の呼出しを 1 リクエストとして扱います。テストから認証済みの自社ユーザー ID と有効所属の照合結果を注入し、その照合成功後に初めて `idFromName(companyId)` → `get(id)` → DO への fetch を許します。所属の結果や stub をリクエスト間でキャッシュしません。

企業 ID の入口は `companyId` 引数 1 つだけです。操作は read または文字列 write で、別の企業 ID を持つ経路はありません。そのため URL／header／body 間の ID 不一致は本検証には該当しません。保存文字列を他社の ID と同じ値にしてもルーティング先が変わらないことを検査します。製品の ID 形式、URL・header・body の選択と不一致時の処理は未決です。

`src/company-object.ts` は実 workerd 内の `state.storage.sql.exec()` で、企業 DO ごとに同一構造・同一キーの試験用テーブルを作ります。企業によるコード分岐や、共有テーブルの企業 ID フィルタで分離を代用していません。public Worker の入口は常に 404 で、試験用ログイン API は設けていません。

| 項目 | モックのみの検査 | ローカル実 DO ランタイムを含む検査 |
| --- | --- | --- |
| 自社アクセス | 認証→所属→ID→stub→fetch の順序 | 実 DO の SQLite で write/read。同じ企業名の DO ID は同じ、別企業は異なる |
| 未所属企業 ID | read/write 拒否、ID・stub・fetch の呼出しゼロ | モック所属で拒否したリクエストは実 namespace に到達せず、B の保存値も不変 |
| 未ログイン | 所属照合も DO アクセスもゼロ | モック未ログインで実 namespace への到達ゼロ |
| 所属無効化 | 成功済みのユーザーでも次の read/write を拒否。毎回再照合 | 同じく A を拒否し、所属の残る B は利用可能 |
| 複数所属 | 選択した企業だけを開く | 同じキーを使う A/B の SQLite 保存値と更新が独立 |
| 照合前に開かない | 非同期照合を未完了のまま止め、ID・stub・fetch がゼロ。拒否完了後もゼロ | 未完了中は実 namespace 呼出しゼロ、成功完了後に選択 DO にだけ保存 |
| 依存失敗 | セッション／所属照合の例外を伝播し DO を開かない。明示的な true 以外は拒否 | 認証・D1 の障害を実サービスで再現してはいない |

**実 DO を含むテストでも、セッションと所属はモックです。** gate は Node.js 内で実行し、Miniflare の `getDurableObjectNamespace()` 経由で実 workerd の DO に接続しています。認証から Worker 内で一貫して動く製品経路の検証ではありません。

## 実行記録

2026-11-13、Linux x64、Node.js `v24.22.1`、npm `11.9.0`。

- `npm --cache /tmp/shift-saas-npm-cache install --ignore-scripts --no-fund --no-audit`：成功、検証用ディレクトリ内に lockfile を生成。
- `npm --cache /tmp/shift-saas-npm-cache ci --ignore-scripts --no-fund --no-audit`：成功、固定した lockfile から再インストール。
- `npm run typecheck`：成功（src の TypeScript を strict で検査）。
- `npm test`：16 件成功、失敗・skip とも 0。内訳はモック 9 件、ローカル workerd を使う 7 件（うち SQLite 関連 6 件、公開入口 404 の検査 1 件）。
- `npm ls --depth=1`：固定依存と workerd の導入を確認。
- `git diff --check`：成功。

Miniflare `4.20260730.0` と TypeScript `5.9.3` を固定しています。試験用 DO の TypeScript を workerd に渡すため Node の `stripTypeScriptTypes()` を使い、Node から ExperimentalWarning が出ます。テストの省略やモックへのフォールバックは行いません。

参考：[Miniflare の DO テスト API](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/)、[SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)。これはローカル workerd の検証で、Cloudflare 上の実行結果ではありません。

## 未決・未検証と次の判断

- 現行 main に Better Auth・D1・業務 Worker の実装がないため、実セッションの検証、自社ユーザー ID との対応付け、実 D1 の所属テーブル・クエリ、所属無効化の反映遅延は未検証です。Better Auth を自作の認証方式で置き換えていません。
- 実際の API 入力形式・エラー応答、企業 ID の正規化、ロール／店舗単位の権限、運営代理アクセスは本検証で決めません。
- 所属の照合後から DO 操作までの間に無効化される進行中リクエストの扱い・競合制御は正本に具体手順がなく未決です。本検証が保証する無効化は、モックの所属変更後に照合を開始する次のリクエストの拒否だけです。
- Worker 内での全経路、並行実行、永続化を伴う再起動、実環境の DO binding・migration・障害復旧、クラウド上での挙動・料金は未検証です。
- 正本はテナント分離テストを CI 必須にするよう定めていますが、このタスクの「既存 CI・root 共有設定を変更しない」制約により未接続です。採用時に別途 CI 統合が必要です。現状を CI 条件の達成とは扱いません。
- Claude Code の独立した実装監査は未実施です。自己確認は独立監査ではありません。draft PR の採用・リリースは監査後、マージはご本人だけが行います。修正→独立再監査は PR ごとに最大 2 回、同じ指摘が 2 回続けば本人判断という運用を維持します。
