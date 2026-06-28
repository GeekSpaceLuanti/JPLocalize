# JPLocalize

Luanti (旧 Minetest) のゲーム内コンテンツを日本語化するためのツール群と Claude Code 用スキル。

## できること

- `__builtin` (チャットコマンド、死亡画面、権限説明など Luanti 同梱の翻訳ドメイン) の日本語訳ファイル `__builtin.ja.tr` を生成
- 任意の MOD の `locale/*.tr` も同じ手順で日本語化
- 翻訳は Claude Code の Agent (Haiku モデル) に並列委譲。Anthropic API への直接課金は発生しない

## 構成

```
JPLocalize/
├── .claude/skills/luanti-translate/SKILL.md   # /luanti-translate スキル定義
├── .claude/agents/luanti-translator.md        # 翻訳用 Haiku サブエージェント定義
├── scripts/
│   ├── extract.ts          # 参照 .tr + 既存JP → 未訳キー JSON
│   ├── split-batches.ts    # 未訳キーをバッチに分割
│   ├── merge-batches.ts    # per-batch 翻訳結果を集約 (NBSP 正規化・欠損検出付き)
│   └── build-tr.ts         # 既存JP + 新訳 → 最終 .tr (検証付き)
├── translations/           # 翻訳成果物 .tr (commit 対象)
├── package.json            # bun
└── tsconfig.json
```

## セットアップ

```bash
curl -fsSL https://bun.sh/install | bash   # Bun が未導入なら
bun install
```

Claude Code の Bash ツールは `~/.bashrc` を読まないため、スキルは `~/.bun/bin/bun` のフルパスでスクリプトを呼びます。

## 使い方 (Claude Code 内)

### `__builtin` を日本語化

```
/luanti-translate
```

引数なしで実行すると、`/usr/share/luanti/builtin/locale/__builtin.fr.tr` を英語キー源、`/usr/share/luanti/builtin/locale/__builtin.ja.tr` を既存日本語訳として読み、未訳キーを Haiku サブエージェントが翻訳して `translations/__builtin.ja.tr` に出力します。

### MOD を日本語化

```
/luanti-translate <参照.tr> <既存JP.tr|-> <domain>
```

例:
```
/luanti-translate /home/bacon/.minetest/mods/mymod/locale/mymod.de.tr - mymod
```
- 第 1 引数: 英語キーが充実している他言語 (de, fr, it, ru など) の `.tr` を指定
- 第 2 引数: 既存日本語訳ファイル。無ければ `-`
- 第 3 引数: textdomain (出力ファイル名にも使われる: `translations/<domain>.ja.tr`)

### 内部フロー

1. `extract.ts` で未訳キーを抽出 → `tmp/<domain>.todo.json`
2. `split-batches.ts` で 50 件ずつのバッチに分割
3. Claude が **`luanti-translator` サブエージェントを並列起動** (`.claude/agents/luanti-translator.md` 定義、`model: haiku` 固定)
4. 各サブエージェントの JSON 出力を `tmp/<domain>.out/batch*.out.json` に保存
5. `merge-batches.ts` で集約:
   - NBSP (U+00A0) / 全角スペース等を ASCII スペースに正規化したキーを自動復元
   - 欠損キーを `*.missing.json` に書き出し
6. 欠損があれば追加のサブエージェントで 1 回リトライ
7. `build-tr.ts` で最終 `.tr` を生成 (プレースホルダ集合一致・空訳チェック付き、キー内の `=` は `@=` に自動エスケープ)
8. ユーザーに **AskUserQuestion で配置可否を確認** し、OK なら既存ファイルをバックアップ (`*.bak.<タイムスタンプ>`) してから上書き

### 翻訳ルール (SKILL.md に詳細)

- 文体: **です・ます調**
- プレースホルダ (`@1`, `@2`, …) は位置・個数厳守
- 山括弧プレースホルダ (`<cmd>`, `<player>` 等)、スラッシュコマンド (`/help`, `/grant` 等)、構文記号は維持
- ノーブレークスペース等の特殊空白は半角に正規化しない
- 用語統一: privilege→権限 / grant→付与 / revoke→剥奪 / teleport→テレポート / inventory→インベントリ など

## 配置 (反映)

スキル最後の AskUserQuestion で「配置する」を選べば自動で `sudo cp` が走ります。手動で行う場合:

```bash
sudo cp translations/__builtin.ja.tr /usr/share/luanti/builtin/locale/__builtin.ja.tr
# mod の場合
cp translations/<domain>.ja.tr ~/.minetest/mods/<modname>/locale/<domain>.ja.tr
```

### 注意

`__builtin` の配置先 `/usr/share/luanti/...` は **パッケージ管理下**のため、Luanti が `apt` 等で更新されると同梱の (ほぼ空の) `__builtin.ja.tr` で上書きされます。更新後は再度 `sudo cp` で配置し直してください (再翻訳は不要、リポジトリの `.tr` をそのまま使えます)。

## 方針

- Luanti のシステムファイル (`/usr/share/luanti/...`) や `~/.minetest/` の中身は一切リポジトリに含めない (`.gitignore` で除外)
- 翻訳には Claude Code の Agent 経由で Haiku モデルを使用 (Anthropic API 直叩きの従量課金なし)
- 中間ファイル (`tmp/`、`node_modules/`) も `.gitignore` 済み
- commit 対象は `scripts/`, `.claude/skills/`, `translations/`, 設定ファイルのみ
