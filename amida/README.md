# 削減アミダクジ — 運営ツール

リアル交渉ゲーム「削減アミダクジ」の運営ツール一式。

- **集計ツール** (`tool.html`): ディーラー用。セッション管理／場所決め投票／本戦集計／最終結果
- **発表ツール** (`present.html`): プレイヤー卓のスクリーン用。ルール説明／タイマー／結果発表
- **ランディング** (`index.html`): 上記2ツールへのリンク

データストアは Supabase（`wiqnmebudaadwqdaxwko`）を共有しているため、両ツールは同じセッションを参照します。

---

## 🌐 公開URL

リポジトリ `puzzliar/tools`（GitHub Pages、カスタムドメイン `tools.puzzliar.jp`）の `amida/` フォルダとして配信しています。

- ランディング: https://tools.puzzliar.jp/amida/
- 集計ツール: https://tools.puzzliar.jp/amida/tool.html
- 発表ツール: https://tools.puzzliar.jp/amida/present.html

旧URL `amida.puzzliar.jp`（リポジトリ `puzzliar/amida-tools`）は新URLへの転送専用です。

---

## 🔧 更新（バージョンアップ時）

新版を入手したら、`amida/tool.html` / `amida/present.html` を差し替えてコミット → プッシュ。  
数分以内に GitHub Pages が再ビルドされ自動反映されます。

```bash
# 例
cp ~/Downloads/amida_tool_v6.4.html amida/tool.html
cp ~/Downloads/amida_present_v6.4.html amida/present.html
git add amida/tool.html amida/present.html
git commit -m "update to v6.4"
git push
```

---

## ⚠️ 重要事項

### Supabase Anon Key の公開について

両 HTML には Supabase の Anon Key が埋め込まれています。Anon Key は public とすることを前提とした鍵で、データベース側の Row Level Security (RLS) で守られています。リポジトリを public にしても Anon Key の漏洩はセキュリティ上の問題になりません。

ただし、`amida_sessions` テーブルが現状 RLS 未設定で全アクセス可能の場合、Supabase Dashboard で適切な RLS ポリシーを設定することを推奨します。

### Supabase プロジェクトの状態

無料プランは1週間以上 inactive で自動 pause されます。長期間使わない予定がある場合は Supabase Dashboard で定期的にアクセス／プロジェクトを restore してください。

---

## 📂 ファイル構成

```
tools/（リポジトリ直下）
├─ CNAME            # tools.puzzliar.jp
├─ index.html       # ツール一覧
└─ amida/
   ├─ index.html    # ランディングページ
   ├─ tool.html     # 集計ツール
   ├─ present.html  # 発表ツール
   ├─ medals/       # メダル画像
   ├─ AUTH_SETUP.md / setup_auth.sql
   └─ README.md     # このファイル
```

---

最終更新: 2026-11-23（tools.puzzliar.jp/amida/ へ移転）
