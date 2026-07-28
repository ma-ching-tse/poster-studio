# Poster Studio

BitMart 运营海报生成工具。源码丢失后从 Vercel 部署（poster-studio-bay.vercel.app）恢复。

## 运行

```bash
npm install
npm run dev
```

## 恢复说明

- `public/` 下所有文件（studio 控制台、模板、素材、字体）为部署上的**原始文件**，逐字节拷回
- `app/`（Next.js 壳、StudioShell 导出组件、API 路由）为**重建**：StudioShell 从客户端 chunk 反推，行为与原版一致
- `/api/templates` 返回 `data/templates.json`（抓取自线上接口的完整 registry）
- `/api/brief/fetch`（Lark Sheets 链接拉取）依赖服务端 lark-cli，无法从部署恢复，现为 501 占位；粘贴 JSON 导入不受影响
- `public/assets/savings/coins/` 只找回 6 个图标（btc/eth/sol/usdc/usdt/xrp，靠常见符号试探；目录无法枚举）。其他币种用控制台的「上传」即可，模板对缺失图标会自动隐藏

## 结构

- `public/studio/` — 控制台 UI（index.html + app.js + zip.js）
- `public/src/templates/` — listing / savings 海报模板与布局数据
- `public/src/shared/` — brief 校验、时间格式化等共享逻辑
- `public/assets/` — Figma 导出素材、Alexandria 自托管字体
- `data/templates.json` — 模板 registry（字段、语言、标题文案、fixture）
