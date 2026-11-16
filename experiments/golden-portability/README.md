# golden checker の改行・CLI入口の限定候補

親は PR #11 / `fix/h10-rest-limit-setting` の固定版 `5882e572b187d7922fb5b5c4a64413a998fd9d97`。main起点は `a5fb1588a4d336c7d4b4d827bd9a1528eb366822` です。未採用の別stacked候補であり、親の枝・本文・状態を変更しません。最新の固定head、作者試験、CI、独立監査と採用状態は対応PRを参照します。

基準は [decisions.md](../../docs/decisions.md) → [Hard v1.3](../../docs/hard-rules.md)。checker/testは保護対象で、候補制作と本人による正式採用を区別します。

- [テスト](../../scripts/check-golden.test.ts) の正本JSON抽出は、CRLFをLFに揃えて既存と同じ最初のJSON fenceを読む。汎用Markdown parserやBOM/UTF-16対応を定めない。LF/CRLFの架空文書をliteral期待値で検査し、既存H10の比較内容は維持する。
- エラー期待値は `path.join` でOSネイティブの相対パスに合わせる。[checker](../../scripts/check-golden.ts) の `path.relative` や表示パス自体を正規化しない。Windows APIによる対照はLinux上の計算であり、Windowsファイルシステムの検証ではない。
- CLIは [Nodeのentry判定](https://nodejs.org/api/esm.html#importmetamain) `import.meta.main` を優先する（Node24.2以降）。flagがある環境では通常entry・directory symlinkとも実行し、importはargvの見た目だけでCLIを起動しない。元のNode24範囲を変えず、flag未提供時は限定的なrealpath比較を残す。解決不能なargvはCLIの根拠にせずfalseを返し、importのstderr/exitCodeを変えない。実際にCLIとして開始した内容検査の失敗は従来どおり非ゼロにする。

Node `24.22.1` / npm `11.9.0` / Linuxと固定lockfileが作者の検証環境です。package/lock、Node pin、既存CI・root共有設定、新依存は変更しません。Node24.0/24.1等の実行は未検証です。fallback試験は一時コピーのflag参照を未定義へ置換する模擬であり、古いNodeを実行した証拠ではありません。

初版は親107件+12件で119件。初回監査修正では124件（親107+17件）です。架空文書2件、通常/別名CLIの受理と拒否4件、flagがある環境のimport無出力4件、fallback模擬4件、清掃境界3件です。CLIは終了コードだけでなく、検査1件・エラー件数のsummaryも照合し、harness起動失敗/timeoutを狙った拒否として数えません。入口用の補助ファイルはgolden探索範囲の外に置きます。

fallbackは全Node24 minorでのimport無副作用を保証しません。flag不在でargvがchecker自体を指すimportはCLIと区別できず、summary出力等が残ることを修正前後の隔離コピーで観察しています。これを正しいimportとして合格扱いせず、未解消の旧minor境界として残します。realpathとWindows loaderの結果がドライブ/UNC/subst等で異なる可能性は監査者の推測であり、未実測です。一致せず無検査exit0となる可能性を解消済みとは扱わず、独自のパス正規化も追加しません。

fixtureのリンクは一時workspace直下に限って記録し、清掃時はlstatでリンクであることを確認して明示unlinkした後だけworkspaceを再帰削除します。検査/unlinkが失敗したら清掃を例外終了し、workspaceを残して再帰削除へ進みません。外部の架空sentinelが不変な正常清掃、unlink失敗、リンクが通常ディレクトリへ変わった場合を確認します。実repository/導入依存のリンク先へ再帰削除を委ねません。Windowsのjunction清掃は未実測なので、Windows実行前にrepositoryや依存を指さない一時fixtureだけで同じunlink/残置境界を確認する必要があります。

未変異の親を使う負の対照は隔離コピーだけで行い、CRLF正本文書の抽出失敗、固定スラッシュ期待値のwin32不一致、別名CLIのsummary欠落/不正ケースの偽成功、argvをcheckerに見せたimportの出力を区別します。親+新試験の型検査も確認し、単なる依存/構文/起動失敗を回帰検出にしません。期待値をcheckerの出力から生成せず、golden実体・承認を変更しません。

実行はrootで `npm run typecheck`、`npm test`、`npm run golden:check`。tenantは既存の実験型検査、unit14/runtime8、補助30、実guard68を別に検証し、root件数へ加算しません。root試験自身に新しい件数guardを加える変更ではありません。

既存golden CIは親向けPRも対象ですが、tenant CIはmain向けPRだけなのでstack上では未実行です。CIを起動するためのworkflow変更はしません。本人が #11 を先に採用した後、本候補baseをmainへ変更し、同じhead/baseのCI結果を確認して保護変更として採用・マージします。今回retarget/Ready/approve/mergeや設定変更は行いません。追加コードは固定版での独立Claude Code監査待ちで、作者は監査を起動しません。

Windowsネイティブ、ドライブ/UNC/junctionの実挙動、端末表示、BOM/UTF-16は未確認です。Linuxの `junction` 型指定によるdirectory symlink成功をWindows成功と呼びません。拒否済み設定・実.npmrcを取得せず、親起動前オプション/敵対的ホスト全体の隔離も保証しません。Windows実測前の条件は完全解消ではありません。

親のH10 limit検査を維持し、REST_SHORTAGE unit・一般H10・完全性/期間/禁則/正式違反/製品Validatorを追加しません。PR #1の一般REST_SHORTAGE確認は例拡張前、保護・本人確認は正式golden運用前、CRLF/パス対応はWindows検証前という期限を保持します。既存2例はdraft・承認nullのままで、本人だけが承認・採用・マージ・本番反映を行います。
