# Design Concept Generator

設計構想書を自動生成するための Next.js アプリケーション。AWS Amplify を使用した認証機能と、チャットボット機能を備えています。

## 📋 概要

このアプリケーションは、以下の機能を提供します：

- **ドキュメントアップロード**: 設計構想書、商品企画書、製品企画書などの入力資料をアップロード
- **コンポーネント選択**: テールゲート、フロントバンパー、フードなどの対象コンポーネントを選択
- **設計構想書生成**: アップロードされた資料から設計構想書を自動生成
- **認証機能**: AWS Amplify による安全なユーザー認証
- **チャットボット**: インタラクティブなチャットボットサポート

## 🚀 技術スタック

- **フレームワーク**: Next.js 14.2.16 (App Router)
- **言語**: TypeScript
- **UI**: React 18.3.1
- **スタイリング**: Tailwind CSS 4.0
- **認証**: AWS Amplify 6.6.1
- **開発環境**: Node.js 20+

## 📁 プロジェクト構造

```
design-concept/
├── app/                    # Next.js App Router
│   ├── page.tsx           # メインダッシュボード
│   ├── login/             # ログインページ
│   ├── layout.tsx         # ルートレイアウト
│   └── globals.css        # グローバルスタイル
├── components/            # Reactコンポーネント
│   ├── AuthProvider.tsx   # 認証プロバイダー
│   └── Chatbot.tsx        # チャットボット
├── lib/                   # ユーティリティ
├── public/                # 静的ファイル
└── package.json          # 依存関係
```

## 🔧 セットアップ

### 前提条件

- Node.js 20 以上
- npm または yarn、pnpm、bun

### インストール

```bash
# リポジトリをクローン（またはディレクトリに移動）
cd C:\cairo\design-concept

# 依存関係をインストール
npm install
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションを確認できます。

## 📝 使い方

1. **ログイン**: AWS Amplify 認証でログイン
2. **ドキュメントアップロード**: 以下の資料をアップロード
   - 設計構想書
   - 商品企画書
   - 製品企画書
   - ハードウエア設計者の対応するリスト
   - 専門家の研究資料
   - 法規リスト
3. **コンポーネント選択**: 対象コンポーネントを選択
4. **生成**: 設計構想書を生成

## 🛠️ 開発コマンド

```bash
# 開発サーバーを起動
npm run dev

# 本番ビルド
npm run build

# 本番サーバーを起動
npm run start

# リント
npm run lint
```

## ☁️ AWS Amplify Setup

### 1. 前提条件
- AWS アカウント
- AWS CLI が設定済みであること

### 2. ローカル開発環境 (Sandbox)
ローカルでバックエンドを開発・テストするために、Sandboxを起動します。

```bash
npx ampx sandbox
```
これにより、隔離されたAWS環境がプロビジョニングされ、`amplify_outputs.json` が生成されます。

### 3. デプロイ
GitHubリポジトリにプッシュし、Amplify ConsoleまたはVercelでリポジトリを接続してデプロイします。

## 🔐 認証

このアプリケーションは AWS Amplify を使用してユーザー認証を管理しています。`AuthProvider` コンポーネントが認証状態を管理し、未認証ユーザーをログインページにリダイレクトします。

## 📦 主な依存関係

- `next`: Next.js フレームワーク
- `react` / `react-dom`: React ライブラリ
- `aws-amplify`: AWS Amplify SDK
- `@aws-amplify/ui-react`: Amplify UI コンポーネント
- `tailwindcss`: CSS フレームワーク
- `typescript`: TypeScript

## 🌐 デプロイ

### Vercel

Next.js アプリケーションを Vercel にデプロイするのが最も簡単です：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme)

詳細は [Next.js デプロイメントドキュメント](https://nextjs.org/docs/app/building-your-application/deploying) を参照してください。

## 📚 リソース

- [Next.js Documentation](https://nextjs.org/docs) - Next.js の機能と API を学ぶ
- [Learn Next.js](https://nextjs.org/learn) - インタラクティブな Next.js チュートリアル
- [AWS Amplify Documentation](https://docs.amplify.aws/) - AWS Amplify のドキュメント
- [Tailwind CSS Documentation](https://tailwindcss.com/docs) - Tailwind CSS のドキュメント

## 📄 ライセンス

Private

## 👥 作成者

Cairo Plus
