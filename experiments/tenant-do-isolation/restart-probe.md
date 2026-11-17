# SQLite DO のローカルランタイム再作成試験

起点main `7e8c36acd689e4d78ed6e657f2b66af8f26daa48` の企業別DO試作に、永続化を伴うローカル再作成の試験を1件追加する候補です。既存の業務APIや認証仕様を作らず、`ProbeCompanyObject` の同じテーブル・同じキーと架空のA/Bマーカーだけを使います。候補の独立監査・本人採用は対応PRで確認します。

`decisions.md:35-46` の企業ごとのSQLite DOと所属照合の原則に対する、保存・再読取境界の検証です。これまでの8試験は `durableObjectsPersist: false` で、一つのローカルランタイム内だけの確認でした。既存8件の本文・期待値は変更しません。

## 実行と確認範囲

固定した実験用lockfileの既存依存、Node `v24.22.1` を使い、実験ディレクトリで実行します。

```sh
npm run test:runtime
```

既存8件と新1件で9件を実行します。既存runnerの機械的下限は8のままです。9件への引上げやguard/reporter/pin、workflow、package/lockの変更は含めず、新1件の存在を下限9で強制したとは主張しません。既存CIが同じruntimeファイルを実行するため、新1件もそのファイル内で実行されます。unit18・runner隔離48・guard30/68には加算しません。

新1件は独立した4つのMiniflareインスタンスを逐次作成します。

1. 一時ディレクトリの下の保存先で、A/Bの異なるDOに同じキーで異なるマーカーを書き、停止をawaitする。
2. 同じ保存先で新ランタイム・namespace・stub・架空認証fixtureを作り直し、同じDO IDとA/B双方の保存値を確認。Aだけを更新し、Bが不変であることを確認して停止する。
3. もう一度作り直して更新済みAと元のBを読み戻す。その後モック所属でAを無効化するとread/writeが拒否され、ID/stub/fetchゼロとなる。Bは読め、Aに所属する別の架空ユーザーではAが不変と確認できる。
4. 同じ論理DO IDでも、新しい別の保存先ではA/Bとも空であることを対照にする。

DO IDの比較は試験管理側の観測です。リクエストのDOアクセスは従来のgate経由で、所属照合より前には進めません。JavaScriptのマーカーデータやstubはランタイム間で再利用しません。保存先は `mkdtemp` で作る試験専用領域の子だけで、CLI/環境変数から保存先を指定する機能はありません。

Miniflareの [公式Persistence説明](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/#persistence) に従い、`durableObjectsPersist` に専用パスを渡します。各ランタイムを `dispose()` してから再作成し、最後のdispose成功後に試験領域を削除します。後始末のdisposeが失敗した場合は削除へ進まず、試験も失敗します。外向きfetchは拒否、listenはloopbackの一時ポートだけです。

## 実測と限界の区別

これは同一Nodeプロセス内でのMiniflare/workerdインスタンス再作成です。OS再起動、強制終了中の書込み、クラッシュ耐性、Cloudflare本番の永続性、binding/migration/PITR/バックアップ復旧、並行アクセス、料金を検証するものではありません。保存形式や本番のディレクトリ構成を採用する提案でもありません。

SQLiteとDOは実ローカルランタイムですが、認証・所属は従来の架空fixtureです。各インスタンスでfixtureも作り直すため、所属情報や無効化の永続化、Better Auth/D1、実セッション真正性は検証していません。進行中リクエストの所属無効化競合も未決のままです。

故障対照は隔離コピーだけで新試験の永続化設定をfalseにし、「A survives first runtime recreation」のassertionが保存値欠落で失敗するか確認します。環境・起動・依存・timeoutをその故障の検出に数えません。作者の実行・PRの仮マージCI・main push・独立静的監査は別の証拠です。

一般H10/正式Validator、golden承認、公開条件、製品経路の完成とは扱いません。既存READMEの未検証一覧全体を解消したとも主張せず、他の保護対象やPR #8/#4は変更しません。本人だけがReady・採用・マージを行います。
