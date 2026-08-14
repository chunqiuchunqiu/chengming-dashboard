"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "home" | "funds" | "stocks" | "calendar" | "settings";
type EventItem = {
  id: string; title: string; startsAt: string; allDay: boolean; category: string;
  priority: "高" | "中" | "低"; location: string; notes: string; reminderMinutes: number; completed: boolean;
};
type StockMetrics = {
  pe: number; pb: number; marketCapYi: number; turnoverRate: number; revenueGrowth: number;
  profitGrowth: number; roe: number; operatingCashFlowPerShare: number; grossMargin: number;
  ma20: number; ma60: number; return20d: number; return60d: number; volumeRatio20d: number;
  atr14Pct: number; maxDrawdown60d: number;
};
type StockPick = {
  rank: number; code: string; name: string; industry: string; price: number; score: number;
  scoreBreakdown: { fundamental: number; valuation: number; trend: number; risk: number };
  metrics: StockMetrics; support: number; resistance: number; buyZoneLow: number; buyZoneHigh: number;
  stopLoss: number; target: number; reason: string; fundamentals: string; sentiment: string;
  trend: string; risk: string; invalidates: string;
};
type StockReport = {
  isoYearWeek: string; market: string; status: "success" | "partial"; dataAsOf: string; generatedAt: string;
  dataProvider: string; summaryProvider: string; methodology: string; sentimentDefinition: string;
  disclaimer: string; stocks: StockPick[];
};

const APP_BOOT_TIME = Date.now();

const nav: { id: View; label: string; mark: string }[] = [
  { id: "home", label: "首页", mark: "⌂" }, { id: "funds", label: "资金", mark: "¥" },
  { id: "stocks", label: "股票", mark: "↗" }, { id: "calendar", label: "日历", mark: "□" },
  { id: "settings", label: "设置", mark: "⚙" },
];

const cashTrend = [36, 48, 42, 59, 54, 72, 67, 81, 74, 91, 84, 88];
const outTrend = [28, 32, 39, 35, 51, 46, 63, 58, 69, 61, 73, 66];
const accounts = [
  ["招商银行", "储蓄卡 · 4821", "¥128,430", "34%"], ["华泰证券", "证券账户 · 9037", "¥184,620", "49%"],
  ["支付宝", "支付账户", "¥24,580", "7%"], ["公积金", "住房公积金", "¥38,900", "10%"],
];
const spending = [["居住", 38, "¥6,240"], ["餐饮", 24, "¥3,940"], ["交通", 15, "¥2,460"], ["学习", 13, "¥2,130"], ["其他", 10, "¥1,640"]] as const;

const candidates = [
  { name: "InvestSkill", repo: "https://github.com/yennanliu/InvestSkill", stats: "147 ★ · 36 Fork · 7 Issues", score: 91, fit: "美股", pros: "纯 Markdown、MIT、26 套框架、288+ 测试；无运行时与 API Key", cons: "默认聚焦美股，A 股数据需另接；结论质量依赖检索数据", status: "首选研究框架" },
  { name: "finance-skills", repo: "https://github.com/himself65/finance-skills", stats: "2.5k ★ · 267 Fork · 0 Issues", score: 84, fit: "全球", pros: "维护活跃，估值/技术/情绪覆盖广，部分社交读取明确只读", cons: "包含交易策略主题且依赖 yfinance/外部服务，需逐项隔离安装", status: "保留候选" },
  { name: "stockaskill", repo: "https://github.com/axjing/stockaskill", stats: "活跃项目 · 指标待 API 复核", score: 82, fit: "A股优先", pros: "AKShare、SQLite 缓存、多因子与 A/H/美市场，中文文档完整", cons: "Python 代码与网络请求面较大；组合构建能力须禁用写入/交易扩展", status: "A股数据候选" },
  { name: "stock-analyzer-skill", repo: "https://github.com/AltenLi/stock-analyzer-skill", stats: "71 ★ · 14 Fork", score: 69, fit: "A/H/美", pros: "中文、三维分析、东方财富覆盖广", cons: "要求网站登录并模拟搜索；会话与限流风险较高，SKILL.md 过长", status: "暂不采用" },
];

const stocks = [
  ["贵州茅台", "600519", "食品饮料", "¥1,642.00", "品牌现金流稳健，观察需求恢复", "营收 +11%｜净利 +13%｜经营现金流稳健｜低负债｜PE 24x", "中性偏积极：渠道讨论回暖，需核对公告", "震荡上行｜量能 0.9x｜20日波动 18%", "1,590", "1,700", "1,595–1,625", "1,545", "1,735", "渠道库存上升或动销弱于预期"],
  ["宁德时代", "300750", "电力设备", "¥218.60", "全球份额与储能增长值得跟踪", "营收 +9%｜净利 +15%｜现金流改善｜负债中等｜PE 19x", "积极：新产品讨论升温，海外政策有分歧", "中期上行｜量能 1.2x｜波动 27%", "208", "228", "210–216", "201", "235", "价格竞争加剧、海外合规变化"],
  ["美的集团", "000333", "家用电器", "¥73.40", "现金回报与海外业务韧性", "营收 +8%｜净利 +12%｜自由现金流充足｜负债可控｜PE 14x", "中性：机构观点稳定，出口链讨论分化", "箱体偏强｜量能 1.0x｜波动 16%", "70", "76", "71–73", "68", "78", "原材料涨价、海外需求走弱"],
  ["中国移动", "600941", "通信服务", "¥111.20", "高现金流与算力资本开支逻辑", "营收 +6%｜净利 +7%｜现金流强｜负债低｜PE 17x", "中性偏积极：红利与云业务关注较高", "缓升｜量能 0.8x｜波动 13%", "107", "115", "108–110", "104", "118", "资本开支回报不及预期"],
  ["紫金矿业", "601899", "有色金属", "¥19.86", "铜金资源与产量增长弹性", "营收 +10%｜净利 +18%｜现金流改善｜负债中等｜PE 15x", "积极但拥挤：金铜价格是核心变量", "强势整理｜量能 1.3x｜波动 29%", "18.9", "20.8", "19.1–19.6", "18.3", "21.5", "金属价格回落、项目投产延迟"],
  ["海尔智家", "600690", "家用电器", "¥29.12", "海外高端化与利润率改善", "营收 +7%｜净利 +14%｜现金流良好｜负债可控｜PE 13x", "中性偏积极：利润率改善获关注", "震荡偏强｜量能 1.1x｜波动 19%", "27.9", "30.2", "28.2–28.8", "27.2", "31.0", "汇率波动、海外消费放缓"],
  ["中芯国际", "688981", "半导体", "¥88.50", "国产制造扩产与周期修复", "营收 +21%｜利润承压｜现金流投入期｜负债中等｜PB 3.1x", "分歧较大：自主可控热度高，估值受议", "高波动上行｜量能 1.4x｜波动 38%", "82", "94", "84–87", "79", "99", "扩产折旧、制程限制、估值回撤"],
  ["迈瑞医疗", "300760", "医药生物", "¥244.30", "器械龙头与海外渗透", "营收 +12%｜净利 +10%｜现金流稳定｜低负债｜PE 25x", "中性：集采担忧与海外增长并存", "筑底｜量能 0.9x｜波动 23%", "232", "255", "235–242", "225", "265", "集采降价、医院资本开支放缓"],
  ["长江电力", "600900", "公用事业", "¥30.18", "稳定现金流与防御属性", "营收 +5%｜净利 +8%｜现金流强｜负债中高｜PE 20x", "中性偏积极：红利偏好仍在", "缓升｜量能 0.8x｜波动 11%", "29.2", "31.0", "29.4–29.9", "28.7", "31.6", "来水偏弱、利率上行压制估值"],
  ["立讯精密", "002475", "电子", "¥42.76", "消费电子复苏与汽车业务扩张", "营收 +16%｜净利 +19%｜现金流改善｜负债中等｜PE 21x", "积极：新品周期讨论升温", "多头整理｜量能 1.2x｜波动 31%", "40.5", "45.0", "41.0–42.2", "39.2", "47.0", "客户集中、产品周期不及预期"],
] as const;

const blankEvent = (): EventItem => ({ id: "", title: "", startsAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16), allDay: false, category: "个人", priority: "中", location: "", notes: "", reminderMinutes: 30, completed: false });

function timeLabel(iso: string, completed: boolean) {
  if (completed) return "已完成";
  const diff = new Date(iso).getTime() - APP_BOOT_TIME;
  const abs = Math.abs(diff);
  const prefix = diff < 0 ? "已逾期 " : "还有 ";
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  return prefix + (days ? `${days}天${hours ? ` ${hours}小时` : ""}` : `${hours}小时${mins}分钟`);
}

function Source({ text = "内置模拟数据生成器", stale = false, updatedAt = "2026-08-13 09:30 CST" }: { text?: string; stale?: boolean; updatedAt?: string }) {
  return <div className={`source ${stale ? "stale" : ""}`}><span>{stale ? "!" : "i"}</span> 来源：{text} · 最后更新 {updatedAt}</div>;
}

function reportTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function SyncHead({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: () => void }) {
  return <div className="section-head"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>{action && <button className="button ghost" onClick={action}>↻ 手动刷新</button>}</div>;
}

function EmptyConnect({ kind }: { kind: string }) {
  return <div className="empty"><span className="empty-icon">＋</span><div><strong>{kind}尚未连接</strong><p>当前不展示任何真实数据。请在设置中添加官方接口，并仅授权查询权限。</p></div><button className="button ghost">查看接入要求</button></div>;
}

export function Dashboard() {
  const [view, setView] = useState<View>("home");
  const [demo, setDemo] = useState(true);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventDraft, setEventDraft] = useState<EventItem>(blankEvent());
  const [modal, setModal] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"today" | "month">("today");
  const [toast, setToast] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [stockReport, setStockReport] = useState<StockReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);

  const loadEvents = async () => {
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/events");
      if (!res.ok) throw new Error("日历服务暂不可用");
      const data = await res.json(); setEvents(data.events ?? []);
    } catch { setToast("接口错误：日历暂未同步，请稍后重试"); }
    finally { setLoadingEvents(false); }
  };
  useEffect(() => {
    let active = true;
    fetch("/api/events").then(res => {
      if (!res.ok) throw new Error("日历服务暂不可用");
      return res.json();
    }).then(data => { if (active) setEvents(data.events ?? []); })
      .catch(() => { if (active) setToast("接口错误：日历暂未同步，请稍后重试"); })
      .finally(() => { if (active) setLoadingEvents(false); });
    return () => { active = false; };
  }, []);
  const loadReport = async () => {
    setLoadingReport(true);
    try {
      const res = await fetch("/api/stock-reports/latest");
      if (!res.ok) throw new Error("周报服务暂不可用");
      const data = await res.json(); setStockReport(data.report ?? null);
    } catch { setStockReport(null); }
    finally { setLoadingReport(false); }
  };
  useEffect(() => {
    let active = true;
    fetch("/api/stock-reports/latest").then(res => {
      if (!res.ok) throw new Error("周报服务暂不可用");
      return res.json();
    }).then(data => { if (active) setStockReport(data.report ?? null); })
      .catch(() => { if (active) setStockReport(null); })
      .finally(() => { if (active) setLoadingReport(false); });
    return () => { active = false; };
  }, []);

  const upcoming = useMemo(() => events.filter(e => new Date(e.startsAt).getTime() < APP_BOOT_TIME + 8 * 86400000).sort((a,b) => +new Date(a.startsAt) - +new Date(b.startsAt)), [events]);
  const saveEvent = async (e: FormEvent) => {
    e.preventDefault();
    const item = { ...eventDraft, id: eventDraft.id || crypto.randomUUID() };
    const res = await fetch("/api/events", { method: eventDraft.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
    if (!res.ok) { setToast("保存失败：请检查权限或接口状态"); return; }
    await loadEvents(); setModal(false); setEventDraft(blankEvent()); setToast("日程已安全保存");
  };
  const updateEvent = async (item: EventItem) => { await fetch("/api/events", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(item) }); await loadEvents(); };
  const removeEvent = async (id: string) => { if (!confirm("确认删除这条日程？此操作不可撤销。")) return; await fetch(`/api/events?id=${encodeURIComponent(id)}`, { method: "DELETE" }); await loadEvents(); setToast("日程已删除"); };
  const openEdit = (item?: EventItem) => { setEventDraft(item ? { ...item } : blankEvent()); setModal(true); };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setView("home")}><span className="brand-mark">澄</span><span><b>澄明</b><small>PERSONAL BOARD</small></span></button>
      <div className="top-actions"><span className="timezone"><i /> Asia/Shanghai</span><label className="demo-switch"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} /><span />演示模式</label><button className="avatar" aria-label="个人设置">林</button></div>
    </header>
    <aside className="sidebar">
      <nav>{nav.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.mark}</span>{item.label}</button>)}</nav>
      <div className="readonly"><span>✓</span><div><b>只读安全模式</b><small>资金操作已永久禁用</small></div></div>
    </aside>
    <main>
      {!demo && <div className={`notice ${stockReport ? "safe" : "warning"}`}><b>真实数据模式 · {stockReport ? "A 股周报已接入" : "等待首份周报"}</b><span>{stockReport ? `数据截至 ${stockReport.dataAsOf}，资金账户仍未连接。` : "GitHub 周任务运行并写入首份报告后会自动显示；页面不会编造行情或新闻数据。"}</span></div>}
      {demo && <div className="notice demo"><b>模拟数据</b><span>用于界面演示，不代表任何真实账户、实时行情或投资结论。</span><button onClick={() => setDemo(false)}>退出演示</button></div>}
      {view === "home" && <Home demo={demo} events={upcoming} report={stockReport} loadingReport={loadingReport} openCalendar={() => setView("calendar")} openStocks={() => setView("stocks")} openFunds={() => setView("funds")} />}
      {view === "funds" && <Funds demo={demo} />}
      {view === "stocks" && <Stocks demo={demo} report={stockReport} loading={loadingReport} refresh={loadReport} />}
      {view === "calendar" && <CalendarPage events={events} upcoming={upcoming} loading={loadingEvents} mode={calendarMode} setMode={setCalendarMode} openEdit={openEdit} update={updateEvent} remove={removeEvent} refresh={loadEvents} />}
      {view === "settings" && <Settings demo={demo} setDemo={setDemo} stockConnected={Boolean(stockReport)} />}
    </main>
    <nav className="mobile-nav">{nav.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.mark}</span>{item.label}</button>)}</nav>
    {modal && <EventModal item={eventDraft} setItem={setEventDraft} close={() => setModal(false)} save={saveEvent} />}
    {toast && <button className="toast" onClick={() => setToast("")}>{toast}<span>×</span></button>}
  </div>;
}

function Home({ demo, events, report, loadingReport, openCalendar, openStocks, openFunds }: { demo: boolean; events: EventItem[]; report: StockReport | null; loadingReport: boolean; openCalendar: () => void; openStocks: () => void; openFunds: () => void }) {
  return <div className="page">
    <div className="welcome"><div><div className="eyebrow">2026年8月13日 · 星期四</div><h1>早上好，保持清醒的判断。</h1><p>你的资产、研究与日程，都在一处有据可查。</p></div><button className="button primary" onClick={() => location.reload()}>↻ 同步全部</button></div>
    <div className="home-grid">
      <section className="card asset-card"><SyncHead title="资产概览" eyebrow="FINANCIAL POSITION" action={openFunds} />{demo ? <><div className="asset-main"><div><small>净资产</small><strong>¥343,930</strong><em>↑ 2.4% 较上月</em></div><div className="ring"><b>72%</b><small>金融资产</small></div></div><div className="mini-stats"><div><span>总资产</span><b>¥376,530</b></div><div><span>总负债</span><b className="negative">¥32,600</b></div><div><span>本月净流入</span><b className="positive">+¥8,420</b></div></div><Source /></> : <EmptyConnect kind="资金账户" />}</section>
      <section className="card research-card"><SyncHead title="每周股票研究" eyebrow="WEEKLY RESEARCH" action={openStocks} />{demo ? <><div className="report-title"><span>第 33 周</span><div><b>A股重点关注清单</b><small>10 只 · 研究观察，不构成投资建议</small></div><strong>已生成</strong></div><div className="ticker-row">{stocks.slice(0,4).map((s,i) => <div key={s[1]}><span>{i+1}</span><b>{s[0]}</b><small>{s[1]} · {s[2]}</small><em className={i===2 ? "neutral" : "positive"}>{i===2 ? "观察" : "重点"}</em></div>)}</div><button className="text-link" onClick={openStocks}>查看全部 10 只及研究依据 →</button><Source /></> : loadingReport ? <div className="loading"><i/><b>正在加载 A 股周报…</b></div> : report ? <><div className="report-title"><span>{report.isoYearWeek}</span><div><b>A 股重点研究清单</b><small>{report.stocks.length} 只 · 数据截至 {report.dataAsOf}</small></div><strong>{report.status === "success" ? "已生成" : "部分数据"}</strong></div><div className="ticker-row">{report.stocks.slice(0,4).map(item => <div key={item.code}><span>{item.rank}</span><b>{item.name}</b><small>{item.code} · {item.industry}</small><em className="positive">{item.score} 分</em></div>)}</div><button className="text-link" onClick={openStocks}>查看全部及研究依据 →</button><Source text={report.dataProvider} updatedAt={reportTime(report.generatedAt)} /></> : <EmptyConnect kind="A 股周报数据源" />}</section>
      <section className="card today-card"><SyncHead title="今日日程" eyebrow="TODAY" action={openCalendar} />{events.length ? <div className="event-list">{events.slice(0,4).map(e => <EventRow key={e.id} event={e} />)}</div> : <div className="empty compact"><span className="empty-icon">✓</span><div><strong>近期没有日程</strong><p>添加一条日程，倒计时会在这里出现。</p></div></div>}<button className="text-link" onClick={openCalendar}>打开日历与未来 7 天 →</button><Source text="个人日程数据库" /></section>
    </div>
    <section className="card pulse"><div><span className="pulse-mark">!</span><div><b>今日风险雷达</b><p>{demo ? "检测到 1 笔模拟大额支出；2 只模拟关注股接近压力位；无逾期日程。" : "数据源尚未连接，无法执行风险扫描。"}</p></div></div><span>规则扫描 · 非投资建议</span></section>
  </div>;
}

function Funds({ demo }: { demo: boolean }) {
  return <div className="page"><SyncHead title="资金动向" eyebrow="READ-ONLY FINANCE" action={() => location.reload()} />
    <div className="notice safe"><b>查询专用</b><span>账户连接只允许余额、流水和持仓查询。转账、支付、交易、下单、撤单与账户修改均未实现。</span></div>
    {!demo ? <div className="card"><EmptyConnect kind="银行、证券、基金或支付账户" /><div className="connector-list"><b>建议接入</b><span>银行官方 Open Banking（余额/流水只读）</span><span>券商开放平台（资产/持仓/成交历史只读）</span><span>支付宝/微信官方账单导出（离线导入）</span></div></div> : <>
      <div className="metric-grid"><Metric label="总资产" value="¥376,530" delta="+2.1% 较上月"/><Metric label="总负债" value="¥32,600" delta="−4.8% 较上月" negative/><Metric label="净资产" value="¥343,930" delta="+2.4% 较上月"/><Metric label="本月净现金流" value="+¥8,420" delta="+12.6% 环比"/></div>
      <div className="two-col"><section className="card"><SyncHead title="资金流入 / 流出趋势" eyebrow="近 12 周"/><div className="legend"><span><i className="in"/>流入</span><span><i className="out"/>流出</span></div><div className="line-chart"><div className="grid-lines"/><svg viewBox="0 0 600 180" role="img" aria-label="模拟资金流入流出趋势折线图"><polyline className="line-in" points={cashTrend.map((v,i)=>`${i*54},${165-v*1.45}`).join(" ")}/><polyline className="line-out" points={outTrend.map((v,i)=>`${i*54},${165-v*1.45}`).join(" ")}/></svg><div className="x-labels"><span>5月</span><span>6月</span><span>7月</span><span>8月</span></div></div><Source/></section>
      <section className="card"><SyncHead title="支出分类" eyebrow="本月 ¥16,410"/><div className="spending">{spending.map(s=><div key={s[0]}><span>{s[0]}</span><div><i style={{width:`${s[1]}%`}}/></div><b>{s[2]}</b><em>{s[1]}%</em></div>)}</div><Source/></section></div>
      <div className="two-col"><section className="card"><SyncHead title="账户与资产分布" eyebrow="4 个模拟账户"/><div className="account-list">{accounts.map(a=><div key={a[0]}><span className="account-icon">{a[0].slice(0,1)}</span><div><b>{a[0]}</b><small>{a[1]}</small></div><strong>{a[2]}</strong><em>{a[3]}</em></div>)}</div><Source/></section><section className="card"><SyncHead title="异常与大额变动" eyebrow="规则阈值 ¥10,000"/><div className="alert-row"><span>!</span><div><b>模拟大额支出 · ¥12,800</b><small>8月11日 · 家居 · 招商银行 · 4821</small><p>金额为近 90 日同分类均值的 3.2 倍，请人工确认。</p></div></div><div className="compare"><div><span>本周支出 vs 上周</span><b className="negative">↑ 18.2%</b></div><div><span>本月收入 vs 上月</span><b className="positive">↑ 6.7%</b></div></div><Source/></section></div>
    </>}
  </div>;
}

function Metric({label,value,delta,negative=false}:{label:string;value:string;delta:string;negative?:boolean}) { return <div className="card metric"><span>{label}</span><strong className={negative ? "negative" : ""}>{value}</strong><small className={negative ? "negative" : "positive"}>{delta}</small><Source/></div> }

function Stocks({ demo, report, loading, refresh }: { demo: boolean; report: StockReport | null; loading: boolean; refresh: () => void }) {
  const [tab,setTab]=useState<"report"|"skills"|"history">("report");
  const [expanded,setExpanded]=useState<string>("600519");
  if (!demo) return <RealStocks report={report} loading={loading} refresh={refresh} expanded={expanded} setExpanded={setExpanded}/>;
  return <div className="page"><SyncHead title="每周股票研究" eyebrow="RESEARCH ONLY · 默认 A 股" action={() => location.reload()} />
    <div className="notice warning"><b>研究关注清单</b><span>“推荐”仅表示值得继续研究，不保证收益，不构成个性化投资建议；系统没有任何自动交易或证券账户权限。</span></div>
    <div className="tabs"><button className={tab==="report"?"active":""} onClick={()=>setTab("report")}>本周清单</button><button className={tab==="skills"?"active":""} onClick={()=>setTab("skills")}>Skill 评审</button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>历史与复盘</button></div>
    {tab==="report" && (!demo ? <div className="card"><EmptyConnect kind="A 股行情、财务与新闻数据源"/><div className="source-plan"><b>生成一份可验证周报需要：</b><span>行情：交易所授权供应商或券商只读行情</span><span>财务：巨潮资讯 / 上交所 / 深交所公告</span><span>新闻：公司公告与可验证媒体原文</span></div></div> : <div className="stock-list"><div className="report-meta"><div><b>2026 · 第 33 周</b><span>默认市场：A 股 · 10 只模拟研究样本</span></div><div><span>数据状态</span><b className="simulation">模拟 / 非实时</b></div></div>{stocks.map((s,i)=><article className={`stock-card ${expanded===s[1]?"expanded":""}`} key={s[1]}><button className="stock-summary" onClick={()=>setExpanded(expanded===s[1]?"":s[1])}><span className="rank">{String(i+1).padStart(2,"0")}</span><div><b>{s[0]} <small>{s[1]}</small></b><span>{s[2]}</span></div><strong>{s[3]}<small>模拟价 · 延迟状态不适用</small></strong><em>{expanded===s[1]?"收起":"展开研究"}⌄</em></button>{expanded===s[1]&&<div className="stock-detail"><div className="thesis"><span>入选原因</span><b>{s[4]}</b><p>{s[5]}</p></div><div className="research-grid"><div><span>情绪面</span><p>{s[6]}</p></div><div><span>趋势 / 量价 / 波动</span><p>{s[7]}</p></div><div><span>关键价位</span><p>支撑 {s[8]} · 压力 {s[9]}</p></div><div><span>观察计划</span><p>入场区间 {s[10]} · 止损参考 {s[11]} · 止盈参考 {s[12]}</p></div></div><div className="logic"><b>逻辑与失效条件</b><p>仅在基本面趋势未恶化、量价确认且风险回报合理时继续观察。{s[13]}时，当前研究假设可能失效；后续跟踪季报、经营现金流、行业景气与成交量。</p></div><Source text="内置模拟数据生成器；名称与代码仅作界面样例"/></div>}</article>)}</div>)}
    {tab==="skills" && <div><div className="audit-head"><div><b>GitHub 社区 Skill 综合评审</b><span>抓取 2026-08-13 · 公开仓库静态初筛 · 未安装、未执行任何第三方代码</span></div><div className="score-legend">综合：维护 20% · 安全 25% · 能力 25% · 数据 15% · 社区 15%</div></div><div className="candidate-grid">{candidates.map(c=><article className="card candidate" key={c.name}><div className="candidate-top"><div><a href={c.repo} target="_blank" rel="noreferrer">{c.name} ↗</a><span>{c.fit}</span></div><strong>{c.score}<small>/100</small></strong></div><div className="repo-stats">{c.stats}</div><p><b>优点</b>{c.pros}</p><p><b>限制</b>{c.cons}</p><footer><span>{c.status}</span><small>来源：GitHub 公开仓库 · 2026-08-13</small></footer></article>)}</div><section className="card decision"><span className="decision-mark">✓</span><div><b>最终选择：InvestSkill 作为方法论框架，stockaskill 仅作为待审计的 A 股数据候选</b><p>InvestSkill 没有运行时、网络请求或 API Key，权限面最小，且文档、验证门与三类分析最完整；但它不自带 A 股数据，因此正式接入前仍须把交易所公告与只读行情作为唯一事实来源。finance-skills 功能强，但包含交易策略主题，不能整体安装。</p></div></section></div>}
    {tab==="history" && <div className="history"><article className="card"><div className="history-head"><span>第 32 周</span><div><b>上期复盘 · 模拟</b><small>2026-08-03—08-07</small></div><em>已归档</em></div><div className="review-stats"><div><b>6 / 10</b><span>方向符合观察</span></div><div><b>+1.8%</b><span>等权模拟表现</span></div><div><b>−3.4%</b><span>最大模拟回撤</span></div></div><p><b>偏差：</b>对周期品成交量持续性的判断偏乐观；对防御板块相对强度判断较准确。下期把“连续两日量能确认”加入入选门槛。</p><Source/></article><article className="card"><div className="history-head"><span>第 31 周</span><div><b>历史周报 · 模拟</b><small>2026-07-27—07-31</small></div><em>已归档</em></div><p>查看当期 10 股清单、逐条假设、失效条件与期末复盘。</p><button className="button ghost">查看归档</button><Source/></article></div>}
  </div>;
}

function RealStocks({ report, loading, refresh, expanded, setExpanded }: { report: StockReport | null; loading: boolean; refresh: () => void; expanded: string; setExpanded: (value: string) => void }) {
  return <div className="page"><SyncHead title="每周股票研究" eyebrow="AKSHARE · DEEPSEEK 可选摘要" action={refresh}/>
    <div className="notice warning"><b>研究关注清单</b><span>仅供继续研究，不保证收益，不构成个性化投资建议；系统没有任何自动交易或证券账户权限。</span></div>
    {loading ? <div className="card loading"><i/><b>正在从 D1 加载最新周报…</b></div> : !report ? <div className="card"><EmptyConnect kind="首份 A 股周报"/><div className="source-plan"><b>下一步</b><span>在 GitHub 的 Actions 页面手动运行 Weekly A-share research report</span><span>成功后刷新本页，报告会从 D1 自动读取</span></div></div> : <div className="stock-list">
      <div className="report-meta"><div><b>{report.isoYearWeek}</b><span>{report.market} · {report.stocks.length} 只研究样本 · 数据截至 {report.dataAsOf}</span></div><div><span>报告状态</span><b className={report.status === "success" ? "positive" : "simulation"}>{report.status === "success" ? "完整" : "部分数据"}</b></div></div>
      <div className="notice safe"><b>方法透明</b><span>{report.methodology} {report.sentimentDefinition}</span></div>
      {report.stocks.map(item => <article className={`stock-card ${expanded===item.code?"expanded":""}`} key={item.code}>
        <button className="stock-summary" onClick={()=>setExpanded(expanded===item.code?"":item.code)}><span className="rank">{String(item.rank).padStart(2,"0")}</span><div><b>{item.name} <small>{item.code}</small></b><span>{item.industry} · 综合 {item.score} 分</span></div><strong>¥{item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}<small>数据日 {report.dataAsOf}</small></strong><em>{expanded===item.code?"收起":"展开研究"}⌄</em></button>
        {expanded===item.code&&<div className="stock-detail"><div className="thesis"><span>入选原因</span><b>{item.reason}</b><p>{item.fundamentals}</p></div><div className="research-grid"><div><span>量价情绪代理</span><p>{item.sentiment}</p></div><div><span>趋势 / 量价 / 波动</span><p>{item.trend}</p></div><div><span>关键价位</span><p>支撑 {item.support} · 压力 {item.resistance}</p></div><div><span>观察计划</span><p>观察区间 {item.buyZoneLow}–{item.buyZoneHigh} · 风险参考 {item.stopLoss} · 目标参考 {item.target}</p></div></div><div className="logic"><b>风险与失效条件</b><p>{item.risk} 当{item.invalidates}时，当前研究假设可能失效。</p></div><div className="score-legend">评分：基本面 {item.scoreBreakdown.fundamental}/30 · 估值 {item.scoreBreakdown.valuation}/15 · 趋势 {item.scoreBreakdown.trend}/35 · 风险 {item.scoreBreakdown.risk}/20</div><Source text={`${report.dataProvider}；${report.summaryProvider}`} updatedAt={reportTime(report.generatedAt)}/></div>}
      </article>)}
      <div className="notice warning"><b>风险提示</b><span>{report.disclaimer}</span></div>
    </div>}
  </div>;
}

function EventRow({event,actions}:{event:EventItem;actions?:React.ReactNode}) { const overdue=!event.completed&&new Date(event.startsAt).getTime()<APP_BOOT_TIME; return <div className={`event-row ${overdue?"overdue":""} ${event.completed?"done":""}`}><span className={`priority p-${event.priority}`}/><div><b>{event.title}</b><small>{new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"numeric",day:"numeric",hour:event.allDay?undefined:"2-digit",minute:event.allDay?undefined:"2-digit"}).format(new Date(event.startsAt))} · {event.category}{event.location?` · ${event.location}`:""}</small></div><em>{timeLabel(event.startsAt,event.completed)}</em>{actions}</div> }

function CalendarPage({events,upcoming,loading,mode,setMode,openEdit,update,remove,refresh}:{events:EventItem[];upcoming:EventItem[];loading:boolean;mode:"today"|"month";setMode:(v:"today"|"month")=>void;openEdit:(e?:EventItem)=>void;update:(e:EventItem)=>void;remove:(id:string)=>void;refresh:()=>void}) {
  const days=Array.from({length:35},(_,i)=>{const d=new Date(2026,7,i-4);return d});
  return <div className="page"><SyncHead title="日历看板" eyebrow="ASIA/SHANGHAI" action={refresh}/><div className="calendar-toolbar"><div className="tabs"><button className={mode==="today"?"active":""} onClick={()=>setMode("today")}>今日与未来 7 天</button><button className={mode==="month"?"active":""} onClick={()=>setMode("month")}>本月</button></div><button className="button primary" onClick={()=>openEdit()}>＋ 新建日程</button></div>
    {loading?<div className="card loading"><i/><b>正在安全加载日程…</b></div>:mode==="today"?<div className="calendar-layout"><section className="card"><SyncHead title="今日" eyebrow="8月13日 · 星期四"/>{upcoming.filter(e=>new Date(e.startsAt).toDateString()===new Date().toDateString()).length?upcoming.filter(e=>new Date(e.startsAt).toDateString()===new Date().toDateString()).map(e=><ManageEvent key={e.id} e={e} openEdit={openEdit} update={update} remove={remove}/>):<div className="empty compact"><span className="empty-icon">✓</span><div><strong>今天没有安排</strong><p>留一点空间，也是一种计划。</p></div></div>}</section><section className="card"><SyncHead title="未来 7 天" eyebrow={`${upcoming.length} 个事项`}/><div className="event-list">{upcoming.length?upcoming.map(e=><ManageEvent key={e.id} e={e} openEdit={openEdit} update={update} remove={remove}/>):<div className="empty compact"><div><strong>暂无未来事项</strong><p>点击“新建日程”开始安排。</p></div></div>}</div></section></div>:<section className="card month-card"><div className="month-head"><button>‹</button><b>2026 年 8 月</b><button>›</button></div><div className="weekdays">{"一二三四五六日".split("").map(x=><span key={x}>{x}</span>)}</div><div className="month-grid">{days.map((d,i)=>{const count=events.filter(e=>{const x=new Date(e.startsAt);return x.getFullYear()===d.getFullYear()&&x.getMonth()===d.getMonth()&&x.getDate()===d.getDate()}).length; const active=d.getDate()===13&&d.getMonth()===7; return <button key={i} className={`${d.getMonth()!==7?"muted":""} ${active?"today":""}`}><span>{d.getDate()}</span>{count>0&&<b>{count} 项</b>}</button>})}</div><Source text="个人日程数据库"/></section>}
    <div className="notice safe"><b>持久化说明</b><span>日程保存在本项目的 Cloudflare D1 数据库，按站点用户 ID 隔离；平台静态加密、TLS 传输。外部日历未连接，系统不会修改其内容。</span></div>
  </div>;
}

function ManageEvent({e,openEdit,update,remove}:{e:EventItem;openEdit:(e:EventItem)=>void;update:(e:EventItem)=>void;remove:(id:string)=>void}) { return <EventRow event={e} actions={<div className="event-actions"><button onClick={()=>update({...e,completed:!e.completed})}>{e.completed?"恢复":"完成"}</button><button onClick={()=>openEdit(e)}>编辑</button><button className="danger" onClick={()=>remove(e.id)}>删除</button></div>}/> }

function EventModal({item,setItem,close,save}:{item:EventItem;setItem:(e:EventItem)=>void;close:()=>void;save:(e:FormEvent)=>void}) { return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><form className="modal" onSubmit={save}><div className="modal-head"><div><div className="eyebrow">CALENDAR ITEM</div><h2>{item.id?"编辑日程":"新建日程"}</h2></div><button type="button" onClick={close}>×</button></div><label>标题<input required value={item.title} onChange={e=>setItem({...item,title:e.target.value})} placeholder="例如：季度复盘"/></label><div className="form-grid"><label>日期与时间<input required type="datetime-local" value={item.startsAt} onChange={e=>setItem({...item,startsAt:e.target.value})}/></label><label>分类<select value={item.category} onChange={e=>setItem({...item,category:e.target.value})}><option>个人</option><option>工作</option><option>财务</option><option>健康</option><option>学习</option></select></label><label>优先级<select value={item.priority} onChange={e=>setItem({...item,priority:e.target.value as EventItem["priority"]})}><option>高</option><option>中</option><option>低</option></select></label><label>提醒<select value={item.reminderMinutes} onChange={e=>setItem({...item,reminderMinutes:+e.target.value})}><option value="0">不提醒</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="1440">提前 1 天</option></select></label></div><label>地点<input value={item.location} onChange={e=>setItem({...item,location:e.target.value})} placeholder="可选"/></label><label>备注<textarea value={item.notes} onChange={e=>setItem({...item,notes:e.target.value})} placeholder="补充背景或准备事项"/></label><div className="check-row"><label><input type="checkbox" checked={item.allDay} onChange={e=>setItem({...item,allDay:e.target.checked})}/> 全天事项</label><label><input type="checkbox" checked={item.completed} onChange={e=>setItem({...item,completed:e.target.checked})}/> 已完成</label></div><div className="modal-actions"><button type="button" className="button ghost" onClick={close}>取消</button><button className="button primary">保存日程</button></div></form></div> }

function Settings({demo,setDemo,stockConnected}:{demo:boolean;setDemo:(v:boolean)=>void;stockConnected:boolean}) { return <div className="page"><SyncHead title="设置与数据治理" eyebrow="PRIVACY & CONNECTIONS"/><div className="settings-grid"><section className="card"><SyncHead title="数据模式"/><label className="setting-row"><div><b>模拟数据模式</b><span>所有资金与股票数值均为显著标注的界面样例</span></div><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/></label><label className="setting-row"><div><b>默认股票市场</b><span>当前自动周报固定为 A 股</span></div><select><option>A 股</option></select></label><div className="setting-row"><div><b>默认时区</b><span>日程、抓取时间与同步时间统一</span></div><strong>Asia/Shanghai</strong></div></section><section className="card"><SyncHead title="数据连接"/><Connection name="资金账户" detail="银行 / 券商 / 支付 · 仅余额与流水查询"/><Connection name="A 股数据" detail="AKShare 免费行情与财务 · 仅读取" connected={stockConnected}/><Connection name="外部日历" detail="Google / Outlook · 默认仅查看"/></section><section className="card full"><SyncHead title="安全与隐私"/><div className="security-grid"><div><b>最小权限</b><p>资金与证券连接仅允许读取。应用没有转账、支付、下单、撤单或修改账户的代码路径。</p></div><div><b>凭据隔离</b><p>密钥只放在服务端环境变量；不进入前端包、日志、数据库、页面或版本控制。</p></div><div><b>脱敏规则</b><p>账号仅显示机构、类型和末四位；日志移除 Token、完整账号及个人身份字段。</p></div><div><b>存储风险</b><p>日程和周报存在 D1，平台静态加密并通过 TLS 传输；服务运营方在必要运维中仍可能接触服务端数据。</p></div></div></section></div></div> }
function Connection({name,detail,connected=false}:{name:string;detail:string;connected?:boolean}) { return <div className="connection"><span>{connected?"✓":"×"}</span><div><b>{name}</b><small>{detail}</small></div><em>{connected?"已接入":"未连接"}</em><button className="button ghost">{connected?"查看":"配置"}</button></div> }
