---
name: luanti-translate
description: Luanti (Minetest) の .tr ファイルを日本語化する。引数なしで __builtin、引数ありで任意 MOD の locale を処理。Haiku サブエージェントで翻訳。
---

# /luanti-translate

Luanti のローカライズファイル (`.tr`) を日本語化するスキル。
重い処理はすべて `scripts/` 配下の TypeScript (Bun) に寄せ、Claude (あなた) の役割は **Haiku サブエージェントへの委譲と、各バッチ出力ファイルの書き出し** のみ。集約・整形・検証はスクリプトが行う。

## 引数

- **引数なし**: `__builtin` を以下のパスで処理
  - 参照 (英語キー源): `/usr/share/luanti/builtin/locale/__builtin.fr.tr`
  - 既存JP: `/usr/share/luanti/builtin/locale/__builtin.ja.tr`
  - 出力: `translations/__builtin.ja.tr`
  - domain: `__builtin`
- **`<refTr> <existingJpTr|-> <domain>`**: 任意の MOD/コンテンツに対応
  - 例: `/luanti-translate /path/to/mod/locale/mymod.de.tr /path/to/mod/locale/mymod.ja.tr mymod`
  - 既存JPが無い場合は 2 番目の引数を `-` にする

## Bun の起動について

Claude Code の Bash ツールは `~/.bashrc` を読み込まないため、`bun` コマンドは必ず以下のいずれかで呼ぶ:
- `~/.bun/bin/bun ...` (フルパス、推奨)
- `PATH="$HOME/.bun/bin:$PATH" bun ...`

## 実行手順

リポジトリのルート (`/home/bacon/JPLocalize`) で作業すること。`<domain>` は引数から決定 (引数なしなら `__builtin`)。

### 1. 未訳キーを抽出

```bash
~/.bun/bin/bun scripts/extract.ts <refTr> <existingJpTr|-> tmp/<domain>.todo.json
```

### 2. バッチに分割

```bash
~/.bun/bin/bun scripts/split-batches.ts tmp/<domain>.todo.json tmp/<domain>.batches 50
```

`tmp/<domain>.batches/batch{1..N}.in.json` が生成される。各ファイルは英文キーの JSON 配列。

### 3. Haiku サブエージェントに並列で翻訳依頼

各 `batch*.in.json` を Read し、その配列を **下記テンプレートの `<KEYS_JSON>` に埋め込んで** Agent ツールを起動。**1 メッセージ内に全バッチの Agent 呼び出しを並列**で含めること。

- `subagent_type`: `"general-purpose"`
- `model`: `"haiku"`
- `description`: `"Translate Luanti .tr batch N/M"`

#### サブエージェント用プロンプトテンプレート

````
あなたは Luanti (旧 Minetest) のローカライズ翻訳者です。
以下の英語ソース文字列を **日本語** に翻訳してください。

# 翻訳ルール (厳守)

- 文体は **です・ます調** (例: 「コマンドが見つかりません」「権限が不足しています」)
- プレースホルダ `@1` `@2` `@3` ... は **位置と個数を一字一句変えない**。順序の入れ替えも禁止
- 山括弧プレースホルダ (`<cmd>`, `<player>`, `<action>`, `<name>` 等) はそのまま残す
- スラッシュコマンド (`/help`, `/grant`, `/me` 等) は翻訳しない
- 構文記号 (`[-t]`, `(x1,y1,z1)`, `|`, `<...>`) はそのまま
- **空白文字を一切変更しないこと**:
  - 原文先頭/末尾の空白は訳文でも維持 (例: ` (@1 s)` の先頭スペース)
  - 原文中の **ノーブレークスペース (U+00A0)** や全角スペースもそのまま保持。半角スペースに置換するのは禁止
  - キーをエコーする際 (JSON のプロパティ名) も同様に保持
- 訳文の中に改行を入れない
- Luanti のゲーム文脈に合わせる:
  - "privilege" → 「権限」 / "grant" → 「付与」 / "revoke" → 「剥奪」
  - "command" → 「コマンド」 / "player" → 「プレイヤー」 / "server" → 「サーバー」
  - "chat" → 「チャット」 / "spawn/respawn" → 「スポーン/リスポーン」
  - "node" → 「ノード」 / "param" → 「パラメータ」 / "teleport" → 「テレポート」
  - "inventory" → 「インベントリ」 / "rollback" → 「ロールバック」
  - "ban/unban" → 「BAN/BAN解除」 / "kick" → 「キック」
- 既存訳との一貫性:
  - "You died" → 「死んでしまった」 / "Respawn" → 「リスポーン」

# 出力形式

**JSON オブジェクトのみ** を出力すること。説明文、コードフェンス (```)、前置き、追加キー一切不要。
キーは入力英文を一字一句そのまま (空白の正規化禁止)、値は日本語訳。

例:
入力: `["Close", "Command: @1 @2"]`
出力: `{"Close":"閉じる","Command: @1 @2":"コマンド: @1 @2"}`

# 翻訳対象 (JSON 配列)

<KEYS_JSON>
````

### 4. 各エージェント出力を per-batch JSON ファイルに書き出す

各サブエージェントの最終応答から JSON オブジェクトを抽出 (前後のコードフェンスや説明文を取り除く) し、**Write ツール** でそのまま per-batch ファイルに保存:

```
tmp/<domain>.out/batch1.out.json
tmp/<domain>.out/batch2.out.json
...
```

JSON が壊れて Write できない場合のみ、その 1 件は次の集約ステップで欠損として検出されるため、手で再投げするより 6. のリトライに任せる。

### 5. 集約 (NBSP 自動修正・欠損検出)

```bash
~/.bun/bin/bun scripts/merge-batches.ts tmp/<domain>.todo.json 'tmp/<domain>.out/*.out.json' tmp/<domain>.done.json
```

このスクリプトは:
- **`[fixed]`**: ノーブレークスペース (U+00A0) や narrow NBSP、全角スペース等を ASCII スペースに正規化したキーが todo に存在する場合、自動的に正規キーへ復元
- **`[skip]`**: todo に該当キーが無く正規化でも一致しない場合は警告
- **`[conf]`**: 同一キーで異なる訳が複数バッチに存在する場合は警告
- **missing > 0**: 不足キーを `tmp/<domain>.done.missing.json` に書き出し、終了コード `2`
- **warnings あり (skip/conf) で missing なし**: 終了コード `3`
- **問題なし**: 終了コード `0`

### 6. リトライ (missing/conflict があった場合)

`tmp/<domain>.done.missing.json` を Read し、その JSON 配列をテンプレートの `<KEYS_JSON>` に詰めて **追加の Haiku サブエージェントを 1 回起動**。
結果を `tmp/<domain>.out/retry.out.json` に Write し、`merge-batches.ts` を再実行。
**リトライは 1 回まで**。なお欠損するキーがあればユーザーに報告して停止。

### 7. ビルド

```bash
~/.bun/bin/bun scripts/build-tr.ts tmp/<domain>.todo.json tmp/<domain>.done.json translations/<domain>.ja.tr
```

`build-tr.ts` も検証付き (プレースホルダ集合一致・空訳・未登録キー)。
万一ここでエラーが出た場合 (merge を通過しているので想定外) はユーザーに報告。

### 8. 報告と配置確認

まず以下を報告:
- 出力ファイルパス: `translations/<domain>.ja.tr`
- 出力行数 (`wc -l translations/<domain>.ja.tr`)
- 新規翻訳件数 / 既存温存件数

配置先 (`<deployTarget>`) を決定:
- `<domain>` が `__builtin` の場合: `/usr/share/luanti/builtin/locale/__builtin.ja.tr`
- 引数で `<refTr>` が指定された mod の場合: `<refTr の dirname>/<domain>.ja.tr`
  - 例: refTr=`/foo/mod/locale/mymod.de.tr` → deployTarget=`/foo/mod/locale/mymod.ja.tr`

`sudo -n true` で **パスワード不要 sudo が使えるかを事前確認** (即フェイルさせる):

```bash
sudo -n true 2>/dev/null && echo OK || echo NEEDS_PASSWORD
```

次に **AskUserQuestion ツール** で配置可否を問う。`<deployTarget>` の書き込みに sudo が要るかどうかで質問内容を変える:

- 書き込み先がユーザー所有 (mod 等で `[ -w "<dirname>" ]` が真) → 「`cp` で配置しますか？」
- sudo が必要かつ `sudo -n` 通る → 「`sudo cp` で配置しますか？ (パスワード入力不要)」
- sudo が必要かつ `sudo -n` 通らない → 配置オプションを出さず、手動コマンドのみ提示

質問は **AskUserQuestion** で single-select、選択肢:
1. **配置する** (Recommended) — 「上記の `<deployTarget>` に書き込みます」
2. **手動で配置する** — 「コピーコマンドを表示するだけにします」

「配置する」が選ばれた場合:
- 既存ファイルが配置先にあれば `<deployTarget>.bak.<タイムスタンプ>` として **バックアップ** を取ってから上書き (sudo 要否に合わせて `cp` または `sudo cp` で)
- バックアップとコピーは 1 つの Bash 呼び出しでまとめる:
  ```bash
  TS=$(date +%Y%m%d%H%M%S)
  sudo cp -a "<deployTarget>" "<deployTarget>.bak.$TS" 2>/dev/null  # 既存があれば
  sudo cp translations/<domain>.ja.tr "<deployTarget>"
  ```
- 完了したら配置パス、バックアップパス (取った場合)、確認コマンド (`ls -l <deployTarget>`) を報告

「手動で配置する」が選ばれた場合:
- 以下のコマンドをそのまま提示してスキル終了:
  ```bash
  sudo cp translations/<domain>.ja.tr <deployTarget>
  ```

### 注意: 配置後の脆弱性

`__builtin` の配置先 `/usr/share/luanti/...` は **パッケージ管理下**のため、Luanti が `apt` 等で更新されると同梱の (ほぼ空の) `__builtin.ja.tr` で上書きされる。更新を検知したら再度 `/luanti-translate` を実行してリポジトリの最新 `.tr` を `sudo cp` で配置し直すこと。リポジトリの成果物は更新の影響を受けない。

## 既知のハマりどころ

- **ノーブレークスペース (U+00A0)**: Luanti の `.tr` には `@1\xa0s` のように単位や記号と数値の間に NBSP が使われている。LLM はこれを ASCII スペースに正規化しがち。
  - 対策: プロンプトに明記、かつ `merge-batches.ts` で **自動修正**。原文を改変せず正規キーへ復元する
- **単数/複数の近似キー**: 例えば `(missing privilege: @1).` と `(missing privileges: @1).` のように、ほぼ同一だが別エントリのキーが存在する。LLM が片方しか返さないと欠損になる。
  - 対策: `merge-batches.ts` が **todo にあって done に無い** ものを検出し missing として吐く → リトライ
- **半角=を含むキー**: `@1 = @2` や `range=@1` 等。`.tr` ではキー側の `=` を `@=` でエスケープする必要があるが、これは `build-tr.ts` が出力時に自動エスケープする。LLM 側は素の `=` のままで OK

## 注意

- `/usr/share/luanti/...` のファイルを **コピー / commit しない**。読み取りのみ
- `tmp/` は `.gitignore` 済み。中間ファイルが残ってもよい
- Haiku サブエージェントは小さなプロンプト + JSON 出力に最適化されているので、バッチ 50 件は安全圏。極端に長い英文 (200 文字超) が多いバッチがあれば 20 件程度に縮小
