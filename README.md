# PUZZLIAR Tools

https://tools.puzzliar.jp/ で配信する PUZZLIAR の運営ツール置き場（GitHub Pages、`main` ブランチ直下）。

| パス | 内容 |
|---|---|
| [`amida/`](amida/) | 削減アミダクジ 集計ツール・発表ツール（https://tools.puzzliar.jp/amida/） |
| [`sugoroku/`](sugoroku/) | 制限すごろく 集計ツール・発表ツール・ルール説明（https://tools.puzzliar.jp/sugoroku/） |
| [`bingo/`](bingo/) | 強奪ビンゴ 集計ツール・発表画面（https://tools.puzzliar.jp/bingo/） |

ツールを追加するときは `<ツール名>/` フォルダを作り、`index.html` のカードに1件追加する。

## DNS

Cloudflare（puzzliar.jp）で `tools` → `puzzliar.github.io` の CNAME（プロキシなし＝DNS only）。
