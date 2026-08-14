# 澄明个人看板

响应式中文个人看板，聚合资产观察、每周股票研究与日程管理。默认时区为 `Asia/Shanghai`。资金和证券功能严格只读，未连接真实数据时不会生成或暗示真实数值。

## 目录

```text
app/
  api/events/route.ts   日程增删改查 API（按站点用户隔离）
  api/stock-reports/    股票周报读取 API
  api/admin/            GitHub Actions 专用的鉴权写入 API
  dashboard.tsx         资金、股票、日历、设置和交互
  globals.css           响应式视觉系统
  layout.tsx            中文元数据
db/
  index.ts              D1 数据库入口
  schema.ts             日程与股票周报数据结构
drizzle/
  0000_calendar_events.sql  D1 迁移
.openai/hosting.json    Sites 与 D1 声明
.env.example            只读连接变量示例（无真实密钥）
tests/                  关键安全与产品约束测试
scripts/                AKShare 周报生成脚本
.github/workflows/      每周六 20:00（北京时间）自动任务
```

## 启动

要求 Node.js 22.13+。

```bash
npm ci
npm run dev
```

打开开发服务器输出的本地地址。生产构建：`npm run build`；关键测试：`npm test`。

Windows PowerShell 若限制 `npm.ps1`，使用 `npm.cmd ci` 与 `npm.cmd run dev`。本项目的脚本使用 POSIX 环境变量语法；在 Windows 原生终端建议通过 Codex Sites 运行，或将环境变量设置交由 shell/CI。

## 数据与权限

- 资金：预留银行 Open Banking、券商、支付账单接口；必须仅申请余额、流水、资产、持仓和成交历史查询权限。禁止任何转账、支付、下单、撤单或账户修改 scope。
- 股票：第一阶段使用免费的 AKShare 聚合 A 股行情与财务数据；DeepSeek 只润色已计算的摘要，不负责提供行情，也不能改动价格、指标或关键价位。
- 日历：日程写入 Cloudflare D1，使用站点注入的稳定用户 ID 隔离。外部 Google/Outlook 日历默认只读且当前未连接。
- 密钥：只放服务端环境变量，不得写入代码、浏览器存储、日志或页面。

## 存储与隐私

`calendar_events` 保存标题、时间、全天标志、分类、优先级、地点、备注、提醒和完成状态，并以 `(user_id, starts_at)` 建索引。D1 由平台管理，静态数据由平台加密，传输使用 TLS。风险包括平台运营方在必要运维中可能接触服务端数据、错误的共享策略可能扩大访问范围，以及用户输入本身可能包含敏感内容；因此应保持站点私有、限制编辑者并避免在备注中存放密码或金融凭据。

## A 股第一阶段：免费数据 + DeepSeek

工作流为 `AKShare 只读抓取 → 本地规则计算 → DeepSeek 可选摘要 → 鉴权 API → D1 → 看板`。默认每周六 20:00（北京时间）运行，也可在 GitHub 的 Actions 页面手动运行。先筛流动性、规模、PE/PB 与财务质量，再只为 40 个候选读取历史行情，计算 MA20/MA60、ATR14、20/60 日涨跌、量比、最大回撤、支撑与压力，最终选出最多 10 只；同一行业优先不超过 2 只。

AKShare 不需要注册或申请 Token，但它聚合的是公开网页接口，可能因上游字段、限流或休市而暂时失败，不适合作为盘中交易行情。这里固定用于周频研究，不用于自动交易。

### GitHub 必填配置

打开仓库 `Settings → Secrets and variables → Actions`：

1. 在 `Secrets` 新建 `DEEPSEEK_API_KEY`，粘贴 DeepSeek API Key。
2. 在 `Secrets` 新建 `REPORT_INGEST_SECRET`。它必须和 Sites 服务端的同名变量完全一致，用来阻止他人写入周报。
3. 私有 Sites 还需在 `Secrets` 新建 `SITES_BYPASS_TOKEN`，否则 GitHub Actions 会被登录页拦截；公开站点可留空。
4. 在 `Variables` 新建 `DEEPSEEK_BASE_URL`，值为 `https://api.deepseek.com`。
5. 在 `Variables` 新建 `DEEPSEEK_MODEL`，使用 DeepSeek 当前 API 支持的模型名；脚本默认值为 `deepseek-chat`。
6. 在 `Variables` 新建 `DASHBOARD_INGEST_URL`，值为部署地址加 `/api/admin/stock-reports`。

配置后打开 `Actions → Weekly A-share research report → Run workflow → Run workflow`。运行日志出现 `stored YYYY-Wxx with 10 picks` 即写入成功。若 DeepSeek 临时不可用，任务会使用确定性规则摘要继续写入，页面会明确显示摘要来源。

### 本地检查

```bash
npm test
npm run build
```

本地真实抓取还需要安装 `requirements-a-share.txt`，并配置上述环境变量。请勿把任何真实 Key 写入 `.env.example` 或提交到 Git。

## 演示模式

页面顶部可切换演示模式。模拟资金、股票、异常与复盘数据都带有“模拟数据”标识；日程始终使用独立的真实 D1 本地记录，不会伪装成外部日历数据。
