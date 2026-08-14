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
scripts/
  generate_a_share_report.py  AKShare 只读抓取、评分、摘要和发布
  short_trend.py              确认型 Pivot / BOS 纯函数
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

工作流为 `AKShare 只读抓取 → Python 确定性计算 → DeepSeek 可选摘要 → 鉴权 API → D1 → 看板`。默认每周六 20:00（北京时间）运行，也可在 GitHub 的 Actions 页面手动运行。先筛流动性、规模、PE/PB 与财务质量，再只为 40 个候选读取前复权（`qfq`）历史行情。中期趋势保留 MA20/MA60 与 20/60 日表现；短期趋势改用确认型 Swing Pivot、结构突破（BOS）、回踩、量能与市场风向，最终选出最多 10 只，同一行业优先不超过 2 只。

日 K 先按日期升序排序并确定性去重，只保留 `dataAsOf` 及以前的有效已完成 K 线。工作日 15:15（北京时间）之前生成报告时，截止日自动回退一天，避免读取尚未结算的当日线；周末或休市日由数据源自然返回最近交易日。少于 61 个有效交易日时，`shortTrend.direction` 明确为 `insufficient_data`，不会伪造启动点。

### 确认型短期趋势参数

所有阈值集中在 `scripts/short_trend.py` 的 `TREND_CONFIG`，不散落魔法数字：

| 参数 | 默认值 | 含义 |
| --- | ---: | --- |
| `left_bars` / `right_bars` | 3 / 3 | Pivot 左右窗口；右侧 3 根完成后才确认 |
| `atr_period` | 14 | ATR 平均周期 |
| `min_swing_pct` | 1.2% | 过滤微小摆动的最低价格幅度 |
| `min_swing_atr` | 0.75 ATR | 过滤微小摆动的最低波动幅度 |
| `breakout_buffer_pct` | 0.3% | 收盘形成有效 BOS 的缓冲 |
| `startup_max_age_bars` | 5 | “启动”阶段最长交易日数 |
| `startup_max_distance_atr` | 1 ATR | 启动阶段距突破位上限 |
| `pullback_distance_atr` | 1 ATR | 回踩到突破位/结构支撑的容差 |
| `extension_distance_atr` | 2.5 ATR | 距 EMA20 或结构位的过度延伸阈值 |
| `volume_strong_ratio` / `volume_normal_ratio` | 1.5 / 1.2 | 强确认、一般确认量比阈值 |
| `observation_band_atr` | 0.35 ATR | 结构观察区半宽 |
| `stop_buffer_atr` | 0.5 ATR | 结构失效位外的风险缓冲 |
| `atr_target_multiple` | 2 ATR | 单独展示的 ATR 目标参考 |
| `min_reward_risk` | 2.0 | 输出观察区间的最低结构风险收益比 |

上涨由“已确认 Swing Low 之后，收盘突破前一已确认 Swing High”启动；下跌使用镜像规则。连续同类型 Pivot 仅保留更极端者。每个 Pivot 保存 `confirmationLagBars`，BOS 扫描只能从相关 Pivot 已确认之后开始，因此不会用未来 K 线回填历史判断。支撑、压力、失效位来自本轮结构；创新高且上方没有已确认结构高点时，`structureResistance` 和兼容字段 `resistance` 为 `null`。`target` 是独立的 ATR 目标参考，不冒充历史压力位。趋势待确认、过度延伸或风险收益不足时，观察计划输出“等待确认”。

趋势总分仍为 35 分：`trendDetail.mediumTerm` 最多 15 分，`trendDetail.shortTerm` 最多 20 分；`scoreBreakdown.trend` 保留两者之和，以兼容旧页面。DeepSeek 仅接收已经计算的 `shortTrend` 与 `marketWind` 来润色说明，不能重新判断方向、寻找启动点、计算价位或修改数字；失败时继续使用确定性摘要。

### A 股短期市场风向

锁定依赖为 `akshare==1.18.64`、`pandas==3.0.5`、`numpy==2.5.1`、`requests==2.34.2`。指数接口按该版本核验为：

```python
ak.stock_zh_index_daily_tx(symbol="sh000001", start_date="YYYYMMDD", end_date="YYYYMMDD")
```

报告读取上证指数 `sh000001`、沪深300 `sh000300`、创业板指 `sz399006`，分别计算 5/10/20 日涨跌、EMA5/10/20、价格相对 EMA20、EMA5 相对 EMA10 和 5 日/20 日均量比，再合成为 `risk_on`、`neutral`、`risk_off` 或 `unknown`。任一指数失败会在该指数标记 `unknown`；有效指数少于两个时报告级风向降级为 `unknown`，但不阻断个股周报。

`schemaVersion=2` 把 `shortTrend` 放在每只股票下并新增报告级 `marketWind`。旧的 `support`、`resistance`、`buyZoneLow`、`buyZoneHigh`、`stopLoss`、`target` 仍保留，但由新结构算法派生。D1 继续将完整报告存入 `stock_reports.report_json`，所以本次不需要数据库迁移；读取端仍可展示缺少 `shortTrend` 的 `schemaVersion=1` 历史报告。

AKShare 不需要注册或申请 Token，但它聚合的是公开网页接口，可能因上游字段、限流或休市而暂时失败，不适合作为盘中交易行情。这里固定用于周频研究，不用于自动交易。

算法方法仅参考 `sepa-strategy` 的趋势结构思路和 InvestSkill 的多周期/数据验证原则。第三方仓库没有被安装或执行，也没有获得网络、Secrets、账户、下单或仓位权限；本项目只保留自行实现、可重复测试的只读纯函数。

### GitHub 必填配置

打开仓库 `Settings → Secrets and variables → Actions`：

1. 在 `Secrets` 新建 `DEEPSEEK_API_KEY`，粘贴 DeepSeek API Key。
2. 在 `Secrets` 新建 `REPORT_INGEST_SECRET`。它必须和 Sites 服务端的同名变量完全一致，用来阻止他人写入周报。
3. 私有 Sites 还需在 `Secrets` 新建 `SITES_BYPASS_TOKEN`，否则 GitHub Actions 会被登录页拦截；公开站点可留空。
4. 在 `Variables` 新建 `DEEPSEEK_BASE_URL`，值为 `https://api.deepseek.com`。
5. 在 `Variables` 新建 `DEEPSEEK_MODEL`，值为 `deepseek-v4-flash`（脚本默认值相同）。
6. 看板写入地址已固定在工作流中，不需要再创建 `DASHBOARD_INGEST_URL`；仅在站点域名变更时修改工作流里的公开地址。

配置后打开 `Actions → Weekly A-share research report → Run workflow → Run workflow`。运行日志出现 `stored YYYY-Wxx with 10 picks` 即写入成功。若 DeepSeek 临时不可用，任务会使用确定性规则摘要继续写入，页面会明确显示摘要来源。

### 本地检查

```bash
npm test
npm run lint
npm run build
```

本地真实抓取还需要安装 `requirements-a-share.txt`，并配置上述环境变量。请勿把任何真实 Key 写入 `.env.example` 或提交到 Git。

## 演示模式

页面顶部可切换演示模式。模拟资金、股票、异常与复盘数据都带有“模拟数据”标识；日程始终使用独立的真实 D1 本地记录，不会伪装成外部日历数据。
