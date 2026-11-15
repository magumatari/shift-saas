# guard 回帰68件の CI 接続候補

起点 main `0901ae623bb71feffbbeadf86a28822f4c85aee2`。この文書は提案ブランチの説明です。main の採用状態は対応 PR と本人のマージ記録で確認します。workflow は本人採用待ちの保護対象として扱い、独立監査は Dots が固定 SHA で依頼します。

既存の必須 job `tenant-isolation` に、補助の隔離試験と68件の実行を別ステップで追加します。unit 14／runtime 8、既存 npm scripts、Node `24.22.1`、公式 Actions の固定 SHA、10分上限、read-only 権限、資格情報永続化なし、cache／artifact なし、イベント別 concurrency は維持します。guard・reporter・採用済み68件・それらの pin・依存／lockfile は変更しません。

実験ディレクトリで:

```sh
node --test test/guard-ci.test.mjs
node scripts/check-guard-regression.mjs
```

追加 runner は実テストを別 Node プロセスで起動し、既存 reporter の最終累計と既存 `validateRun` を下限 **68** で使用します。起動不能・非ゼロ終了・signal・timeout・空／不正／途中切れ／重複出力・下限不足・failed/cancelled/skipped/todo は失敗です。CLI／環境変数で下限やファイルを差し替える機能はありません。68件側にも Node `v24.22.1` 完全一致と guard／reporter の固定ハッシュ検査があります。失敗時のモック代替・成功扱い省略はありません。

隔離試験では人工結果の timeout と不正出力を検査し、変更していない CLI／parser／reporter のコピーで実際の68件完了、欠落、67件、skip、todo、非ゼロ、未宣言、早期終了などを検査します。採用済みテスト自体は書き換えません。人工 timeout の拒否は120秒実測の証拠ではありません。新しい補助の120秒上限と既存の外側 timeout は孫プロセスの停止を保証しません。この既知 low の大規模修正は含めません。

68件と補助の隔離試験は unit 14／runtime 8 に加算しません。件数は意味的な網羅、同数の別テストへの差替え、下限以上が完了した後の早期終了を保証しません。将来の基準引下げ・対象／pin の変更は、理由と失われる範囲を提示して本人の明示判断と別 AI の独立監査が必要です。実認証・製品経路・getter 境界・本番も未検証／未修正のままです。

採用前に本人が固定 head・workflow 差分・独立監査・同じ head の CI ログ（`guard-regression: PASS minimum=68` と各失敗件数0）を確認してマージします。既存 check 名を維持する案で、ruleset 等の設定変更は行いません。PR #1 の正式 golden 運用前／例拡張前／Windows 検証前の期限と H10 draft／承認 null は変えません。

作者のローカル確認（Linux／Node v24.22.1／npm 11.9.0）では、補助の隔離試験26件、採用済み68件、unit 14／runtime 8、型検査が成功しました。root の型検査・87件・golden 2例も成功。guard／reporter／68件／既存 unit・runtime のバイト不変を起点 main と照合しました。独立監査ではありません。提案 head の Actions 結果は対応 PR に記録します。

参考: [Node 24.22.1 child_process](https://nodejs.org/download/release/v24.22.1/docs/api/child_process.html#child_processspawnsynccommand-args-options)、[Node test summary](https://nodejs.org/download/release/v24.22.1/docs/api/test.html#event-testsummary)。
