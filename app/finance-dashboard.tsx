"use client";

import { FormEvent, type ReactNode, useEffect, useState } from "react";

type Daily = { date: string; netCashflowFen: number };
type Transaction = {
  id: string; source: "wechat" | "alipay" | "manual"; occurredAt: string; direction: string; amountFen: number;
  counterparty: string; description: string; normalizedCategory: string; excluded: boolean; notes: string;
};
type ImportBatch = {
  id: string; source: "wechat" | "alipay"; safeFileName: string; periodStart: string; periodEnd: string;
  insertedRows: number; duplicateRows: number; skippedRows: number; errorRows: number; status: string; createdAt: string;
};
type Summary = {
  month: string;
  summary: {
    manualIncomeFen: number; wechatExpenseFen: number; alipayExpenseFen: number; refundsFen: number;
    netExpenseFen: number; netCashflowFen: number; categories: Array<{ category: string; amountFen: number }>; daily: Daily[];
  };
  comparisons: Record<"income" | "expense" | "cashflow", { changeFen: number; changePct: number | null }>;
  recent: Transaction[];
  coverage: { start: string; end: string } | null;
  latestImport: ImportBatch | null;
  source: string; updatedAt: string; timezone: string;
};
type Preview = {
  source: string; encoding: string; periodStart: string; periodEnd: string; totalRows: number; validRows: number;
  expenseRows: number; refundRows: number; excludedRows: number; duplicateRows: number; skippedRows: number; errorRows: number;
  projectedNetExpenseFen: number; errors: Array<{ row: number; reason: string }>;
  preview: Array<{ occurredAt: string; direction: string; amountFen: number; counterparty: string; description: string; normalizedCategory: string; excluded: boolean }>;
};

const CATEGORIES = ["餐饮", "交通", "居住", "日用购物", "数码家电", "医疗健康", "教育学习", "娱乐", "转账红包", "其他", "待分类"];
const INCOME_TYPES = ["工资", "奖金", "副业", "报销", "投资收益", "转账收入", "其他"];

function shanghaiMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
}
function money(fen: number, signed = false) {
  const sign = signed && fen > 0 ? "+" : fen < 0 ? "−" : "";
  return `${sign}¥${(Math.abs(fen) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function localTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function monthShift(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "请求失败，请稍后重试"; }

async function readFinance(month: string) {
  const [summaryResponse, importResponse] = await Promise.all([
    fetch(`/api/finance/summary?month=${month}`), fetch("/api/finance/imports"),
  ]);
  const summaryBody = await summaryResponse.json() as Summary & { error?: string };
  const importBody = await importResponse.json() as { imports?: ImportBatch[]; error?: string };
  if (!summaryResponse.ok) throw new Error(summaryBody.error || "统计加载失败");
  if (!importResponse.ok) throw new Error(importBody.error || "导入记录加载失败");
  return { summary: summaryBody, imports: importBody.imports || [] };
}

export function FinanceHomeSummary({ openFunds }: { openFunds: () => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/finance/summary?month=${shanghaiMonth()}`).then(async response => {
      const body = await response.json() as Summary & { error?: string };
      if (!response.ok) throw new Error(body.error || "资金数据加载失败");
      setData(body);
    }).catch(value => setError(errorMessage(value)));
  }, []);
  if (error) return <div className="finance-state"><b>资金数据暂不可用</b><p>{error}</p><button className="button ghost" onClick={openFunds}>打开资金页</button></div>;
  if (!data) return <div className="loading"><i /><b>正在读取只读账单统计…</b></div>;
  return <>
    <div className="asset-main"><div><small>本月净现金流</small><strong className={data.summary.netCashflowFen >= 0 ? "positive" : "negative"}>{money(data.summary.netCashflowFen, true)}</strong><em>仅账单导入与手动收入</em></div><div className="ring"><b>{data.summary.daily.length}</b><small>有记录天数</small></div></div>
    <div className="mini-stats"><div><span>手动收入</span><b>{money(data.summary.manualIncomeFen)}</b></div><div><span>净支出</span><b className="negative">{money(data.summary.netExpenseFen)}</b></div><div><span>数据截至</span><b>{data.coverage ? data.coverage.end.slice(0, 10) : "待导入"}</b></div></div>
    <div className="source"><span>i</span> 来源：{data.source} · 最后更新 {localTime(data.updatedAt)}</div>
  </>;
}

export function FinanceDashboard() {
  const [month, setMonth] = useState(shanghaiMonth());
  const [data, setData] = useState<Summary | null>(null);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"calendar" | "bars">("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayRows, setDayRows] = useState<Transaction[]>([]);
  const [importModal, setImportModal] = useState(false);
  const [incomeModal, setIncomeModal] = useState(false);
  const [recordModal, setRecordModal] = useState(false);
  const [toast, setToast] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const result = await readFinance(month);
      setData(result.summary); setImports(result.imports);
    } catch (value) { setError(errorMessage(value)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void readFinance(month).then(result => {
      if (active) { setData(result.summary); setImports(result.imports); setError(""); }
    }).catch(value => { if (active) setError(errorMessage(value)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);

  const selectDay = async (date: string) => {
    setSelectedDate(date);
    try {
      const response = await fetch(`/api/finance/transactions?date=${date}`);
      const body = await response.json() as { transactions?: Transaction[]; error?: string };
      if (!response.ok) throw new Error(body.error || "明细加载失败");
      setDayRows(body.transactions || []);
    } catch (value) { setToast(errorMessage(value)); }
  };
  const removeBatch = async (id: string) => {
    if (!window.confirm("确认删除这批导入及其标准化流水？手动收入和其他批次不会被删除。")) return;
    const response = await fetch(`/api/finance/imports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await response.json() as { error?: string };
    if (!response.ok) { setToast(body.error || "删除失败"); return; }
    setToast("该批导入数据已删除"); await load();
  };

  return <div className="page finance-page">
    <div className="section-head"><div><div className="eyebrow">READ-ONLY BILL IMPORT</div><h2>资金动向</h2></div><div className="finance-actions"><button className="button ghost" onClick={() => setRecordModal(true)}>导入记录</button><button className="button ghost" onClick={() => setIncomeModal(true)}>＋ 添加收入</button><button className="button primary" onClick={() => setImportModal(true)}>导入账单</button></div></div>
    <div className="notice safe"><b>账单只读导入 · 离线同步</b><span>只接收微信/支付宝官方导出的 CSV/TXT。原始文件仅在本次请求内存中解析，不保存；不登录支付账户，也没有转账、支付、退款或交易能力。</span></div>
    <div className="finance-month"><button aria-label="上一月" onClick={() => setMonth(monthShift(month, -1))}>‹</button><b>{month.replace("-", " 年 ")} 月</b><button aria-label="下一月" onClick={() => setMonth(monthShift(month, 1))}>›</button>{month !== shanghaiMonth() && <button className="text-link" onClick={() => setMonth(shanghaiMonth())}>返回本月</button>}<button className="button ghost" onClick={load}>↻ 手动刷新</button></div>
    {loading && <div className="card finance-state"><div className="loading"><i /><b>正在读取 D1 标准化流水…</b></div></div>}
    {!loading && error && <div className="card finance-state error-state"><b>接口错误或权限不足</b><p>{error}</p><button className="button ghost" onClick={load}>重试</button></div>}
    {!loading && !error && data && <>
      <div className="metric-grid finance-metrics">
        <FinanceMetric label="本月手动收入" value={money(data.summary.manualIncomeFen)} comparison={data.comparisons.income} />
        <FinanceMetric label="微信支出" value={money(data.summary.wechatExpenseFen)} source="官方账单导入" negative />
        <FinanceMetric label="支付宝支出" value={money(data.summary.alipayExpenseFen)} source="官方账单导入" negative />
        <FinanceMetric label="合计净支出" value={money(data.summary.netExpenseFen)} comparison={data.comparisons.expense} negative />
        <FinanceMetric label="本月净现金流" value={money(data.summary.netCashflowFen, true)} comparison={data.comparisons.cashflow} negative={data.summary.netCashflowFen < 0} />
      </div>
      <div className="finance-status card"><div><span>导入覆盖</span><b>{data.coverage ? `${data.coverage.start.slice(0, 10)} — ${data.coverage.end.slice(0, 10)}` : "待接入：请导入官方账单"}</b></div><div><span>最新导入状态</span><b>{data.latestImport ? `${data.latestImport.source === "wechat" ? "微信" : "支付宝"} · ${data.latestImport.status} · 新增 ${data.latestImport.insertedRows}` : "暂无导入记录"}</b></div><div><span>最后成功同步</span><b>{localTime(data.updatedAt)} · {data.timezone}</b></div></div>
      <section className="card finance-visual"><div className="section-head"><div><div className="eyebrow">DAILY NET CASH FLOW</div><h2>月度资金日历</h2></div><div className="tabs"><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>日历图</button><button className={view === "bars" ? "active" : ""} onClick={() => setView("bars")}>柱状图</button></div></div>
        {view === "calendar" ? <FinanceCalendar month={month} daily={data.summary.daily} select={selectDay} selected={selectedDate} /> : <CashflowBars daily={data.summary.daily} select={selectDay} />}
        <p className="finance-legend"><span className="cash-positive">＋ 正现金流（红）</span><span className="cash-negative">− 负现金流（蓝）</span><span>0 无净流动（中性）</span></p>
      </section>
      <div className="two-col finance-lower">
        <section className="card"><div className="section-head"><div><div className="eyebrow">EXPENSE CATEGORIES</div><h2>支出分类</h2></div><span>退款 {money(data.summary.refundsFen)}</span></div>{data.summary.categories.length ? <div className="spending">{data.summary.categories.map(item => { const max = Math.abs(data.summary.categories[0].amountFen) || 1; return <div key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.max(4, Math.abs(item.amountFen) / max * 100)}%` }} /></div><b className={item.amountFen < 0 ? "positive" : ""}>{money(item.amountFen, item.amountFen < 0)}</b></div>; })}</div> : <EmptyFinance text="本月暂无消费支出" />}</section>
        <section className="card"><div className="section-head"><div><div className="eyebrow">RECENT TRANSACTIONS</div><h2>最近流水</h2></div></div>{data.recent.length ? <TransactionList rows={data.recent} changed={load} notify={setToast} /> : <EmptyFinance text="暂无流水；请先导入账单或添加收入" />}</section>
      </div>
      <div className="source"><span>i</span> 来源：{data.source} · 抓取/统计时间 {localTime(data.updatedAt)} · 数据时间 {month} · 非实时，延迟取决于账单导出时间</div>
    </>}
    {selectedDate && <DayDrawer date={selectedDate} rows={dayRows} close={() => setSelectedDate(null)} />}
    {importModal && <ImportDialog close={() => setImportModal(false)} done={async message => { setImportModal(false); setToast(message); await load(); }} />}
    {incomeModal && <IncomeDialog close={() => setIncomeModal(false)} done={async () => { setIncomeModal(false); setToast("手动收入已保存"); await load(); }} />}
    {recordModal && <Modal title="导入记录" close={() => setRecordModal(false)}><div className="import-records">{imports.length ? imports.map(item => <div key={item.id}><span className={`source-pill ${item.source}`}>{item.source === "wechat" ? "微信" : "支付宝"}</span><div><b>{item.periodStart.slice(0, 10)} — {item.periodEnd.slice(0, 10)}</b><small>{item.safeFileName} · 新增 {item.insertedRows} / 重复 {item.duplicateRows} / 跳过 {item.skippedRows} / 错误 {item.errorRows}</small><small>导入时间 {localTime(item.createdAt)} · {item.status}</small></div><button className="button danger" onClick={() => removeBatch(item.id)}>删除此批</button></div>) : <EmptyFinance text="暂无导入记录" />}</div></Modal>}
    {toast && <button className="toast" onClick={() => setToast("")}>{toast}<span>×</span></button>}
  </div>;
}

function FinanceMetric({ label, value, comparison, negative, source }: { label: string; value: string; comparison?: { changeFen: number; changePct: number | null }; negative?: boolean; source?: string }) {
  const change = comparison ? `${comparison.changeFen >= 0 ? "+" : "−"}${money(Math.abs(comparison.changeFen))}${comparison.changePct == null ? "（上月为 0）" : ` · ${comparison.changePct >= 0 ? "+" : ""}${comparison.changePct}%`}` : source;
  return <div className="card metric"><span>{label}</span><strong className={negative ? "negative" : "positive"}>{value}</strong><small>较上月 {change || "待接入"}</small></div>;
}

function FinanceCalendar({ month, daily, select, selected }: { month: string; daily: Daily[]; select: (date: string) => void; selected: string | null }) {
  const [year, value] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, value, 0)).getUTCDate();
  const offset = new Date(Date.UTC(year, value - 1, 1)).getUTCDay();
  const map = new Map(daily.map(item => [item.date, item.netCashflowFen]));
  const max = Math.max(1, ...daily.map(item => Math.abs(item.netCashflowFen)));
  return <div className="finance-calendar"><div className="weekday"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div><div className="cash-grid">{Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => {
    const day = index + 1; const date = `${month}-${String(day).padStart(2, "0")}`; const amount = map.get(date) || 0;
    const level = amount === 0 ? 0 : Math.max(1, Math.ceil(Math.abs(amount) / max * 4));
    return <button key={date} className={`${amount > 0 ? "cash-positive" : amount < 0 ? "cash-negative" : "cash-zero"} level-${level} ${selected === date ? "selected" : ""}`} onClick={() => select(date)} aria-label={`${date}，当日净现金流${money(amount, true)}`}><b>{day}</b><span>{money(amount, true)}</span></button>;
  })}</div></div>;
}

function CashflowBars({ daily, select }: { daily: Daily[]; select: (date: string) => void }) {
  const max = Math.max(1, ...daily.map(item => Math.abs(item.netCashflowFen)));
  if (!daily.length) return <EmptyFinance text="本月暂无可绘制数据" />;
  return <div className="cash-bars" role="img" aria-label="本月每日净现金流柱状图">{daily.map(item => <button key={item.date} onClick={() => select(item.date)} aria-label={`${item.date} ${money(item.netCashflowFen, true)}`}><span className={item.netCashflowFen >= 0 ? "cash-positive" : "cash-negative"} style={{ height: `${Math.max(8, Math.abs(item.netCashflowFen) / max * 120)}px` }} /><b>{item.date.slice(8)}</b><small>{money(item.netCashflowFen, true)}</small></button>)}</div>;
}

function TransactionList({ rows, changed, notify }: { rows: Transaction[]; changed: () => Promise<void>; notify: (value: string) => void }) {
  const updateImported = async (item: Transaction, patch: { normalizedCategory?: string; excluded?: boolean; notes?: string }) => {
    const response = await fetch("/api/finance/transactions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, normalizedCategory: patch.normalizedCategory || item.normalizedCategory, excluded: patch.excluded ?? item.excluded, notes: patch.notes ?? item.notes }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) { notify(body.error || "更新失败"); return; }
    notify("流水统计设置已更新"); await changed();
  };
  const removeManual = async (id: string) => {
    if (!window.confirm("确认删除这条手动收入？此操作不可撤销。")) return;
    const response = await fetch(`/api/finance/transactions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await response.json() as { error?: string };
    if (!response.ok) { notify(body.error || "删除失败"); return; }
    notify("手动收入已删除"); await changed();
  };
  const editManual = async (item: Transaction) => {
    if (!window.confirm("即将修改这条手动收入。导入账单的原始金额和时间不会被修改。是否继续？")) return;
    const amount = window.prompt("金额（元）", (item.amountFen / 100).toFixed(2));
    if (amount == null) return;
    const match = amount.trim().match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
    if (!match) { notify("金额格式无效"); return; }
    const amountFen = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    const incomeType = window.prompt(`收入类型：${INCOME_TYPES.join("、")}`, item.description) || item.description;
    const counterparty = window.prompt("收入来源（可选）", item.counterparty) ?? item.counterparty;
    const notes = window.prompt("备注（可选）", item.notes) ?? item.notes;
    const response = await fetch("/api/finance/transactions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, amountFen, occurredAt: item.occurredAt, incomeType, counterparty, notes }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) { notify(body.error || "修改失败"); return; }
    notify("手动收入已修改"); await changed();
  };
  return <div className="transaction-list">{rows.map(item => <div key={item.id} className={item.excluded ? "excluded" : ""}><span className={`direction ${item.direction}`}>{item.direction === "refund" ? "退款" : item.direction === "income" ? "收入" : item.direction === "excluded" ? "排除" : "支出"}</span><div><b>{item.counterparty || item.description || "未提供交易对方"}</b><small>{item.source === "wechat" ? "微信" : item.source === "alipay" ? "支付宝" : "手动"} · {localTime(item.occurredAt)} · {item.normalizedCategory}</small>{item.source !== "manual" && <span className="transaction-controls"><select aria-label="修改标准分类" value={item.normalizedCategory} onChange={event => updateImported(item, { normalizedCategory: event.target.value })}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><label><input type="checkbox" checked={item.excluded} onChange={event => updateImported(item, { excluded: event.target.checked })} /> 不计入统计</label><button className="icon-button" onClick={() => { const notes = window.prompt("流水备注", item.notes); if (notes != null) void updateImported(item, { notes }); }}>备注</button></span>}</div><strong className={item.direction === "income" || item.direction === "refund" ? "positive" : "negative"}>{money((item.direction === "income" || item.direction === "refund") ? item.amountFen : -item.amountFen, true)}</strong>{item.source === "manual" && <span className="row-actions"><button className="icon-button" aria-label="编辑手动收入" onClick={() => editManual(item)}>编辑</button><button className="icon-button" aria-label="删除手动收入" onClick={() => removeManual(item.id)}>删除</button></span>}</div>)}</div>;
}

function ImportDialog({ close, done }: { close: () => void; done: (message: string) => Promise<void> }) {
  const [source, setSource] = useState<"wechat" | "alipay">("wechat");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const submit = async (confirmImport: boolean) => {
    if (!file) { setError("请选择解压后的 CSV/TXT 文件"); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("source", source); form.set("file", file);
      const response = await fetch(confirmImport ? "/api/finance/imports" : "/api/finance/imports/preview", { method: "POST", body: form });
      const body = await response.json() as { preview?: Preview; result?: { insertedRows: number; duplicateRows: number }; error?: string };
      if (!response.ok) throw new Error(body.error || "账单解析失败");
      if (confirmImport && body.result) await done(`导入完成：新增 ${body.result.insertedRows} 条，重复 ${body.result.duplicateRows} 条`);
      else setPreview(body.preview || null);
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  };
  return <Modal title="账单只读导入" close={close}><div className="import-flow"><div className="flow-steps"><b className={!preview ? "active" : "done"}>1 上传并预览</b><b className={preview ? "active" : ""}>2 核对后确认</b></div><div className="notice safe"><b>原始文件不保存</b><span>仅在请求内存中解析；不会写入 D1、R2、日志、GitHub、浏览器缓存或分析平台。请勿上传 ZIP 或输入解压码。</span></div><button className="text-link" onClick={() => setHelp(!help)}>{help ? "收起" : "如何获取账单与使用看板"} →</button>{help && <BillTutorial />}
    {!preview ? <div className="form-grid"><label><span>账单平台</span><select value={source} onChange={event => setSource(event.target.value as "wechat" | "alipay")}><option value="wechat">微信支付账单</option><option value="alipay">支付宝余额明细</option></select></label><label className="full"><span>CSV/TXT（最大 10MB、50000 条）</span><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={event => setFile(event.target.files?.[0] || null)} /></label><p className="full file-note">{file ? `已选择：${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "ZIP 请先在自己的电脑解压；XLS/XLSX 请另存为 CSV UTF-8。"}</p></div> : <PreviewPanel value={preview} />}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button ghost" onClick={preview ? () => setPreview(null) : close}>{preview ? "返回重选" : "取消"}</button><button className="button primary" disabled={busy || !file} onClick={() => submit(Boolean(preview))}>{busy ? "正在安全解析…" : preview ? "确认导入标准化流水" : "生成预览（不写数据库）"}</button></div></div></Modal>;
}

function PreviewPanel({ value }: { value: Preview }) {
  return <div className="preview-panel"><div className="preview-metrics"><div><span>时间范围</span><b>{value.periodStart.slice(0, 10)} — {value.periodEnd.slice(0, 10)}</b></div><div><span>原始 / 有效</span><b>{value.totalRows} / {value.validRows}</b></div><div><span>支出 / 退款</span><b>{value.expenseRows} / {value.refundRows}</b></div><div><span>排除 / 重复 / 错误</span><b>{value.excludedRows} / {value.duplicateRows} / {value.errorRows}</b></div><div><span>预计新增净支出</span><b>{money(value.projectedNetExpenseFen)}</b></div><div><span>编码</span><b>{value.encoding}</b></div></div><div className="preview-table"><div className="preview-row head"><span>时间</span><span>对方（脱敏）</span><span>分类</span><span>金额</span></div>{value.preview.map((item, index) => <div className="preview-row" key={`${item.occurredAt}-${index}`}><span>{item.occurredAt.slice(0, 16).replace("T", " ")}</span><span>{item.counterparty} · {item.description}</span><span>{item.excluded ? "已排除" : item.normalizedCategory}</span><b>{money(item.direction === "refund" ? -item.amountFen : item.amountFen)}</b></div>)}</div>{value.errors.length > 0 && <details><summary>查看前 {value.errors.length} 条解析错误</summary>{value.errors.map(item => <p key={`${item.row}-${item.reason}`}>第 {item.row} 行：{item.reason}</p>)}</details>}</div>;
}

function BillTutorial() {
  return <div className="bill-tutorial"><details open><summary>微信：导出用于个人对账的账单</summary><ol><li>打开微信，依次点击“我”→“服务”（旧版本可能显示“支付”）→“钱包”→“账单”。</li><li>点击右上角“常见问题”或“…”，选择“下载账单”→“用于个人对账”。</li><li>交易类型选“全部”，选择时间范围，填写自己的邮箱并提交。</li><li>从邮箱下载压缩包。解压码通常通过微信支付通知发送；只在自己的电脑解压，不要把解压码输入本看板。</li><li>上传解压后的 CSV。版本升级后入口名称可能变化，可在微信支付帮助中心搜索“下载账单”。</li></ol></details><details><summary>支付宝：下载余额收支明细</summary><ol><li>在电脑浏览器打开 <a href="https://www.alipay.com" target="_blank" rel="noreferrer">alipay.com</a>，确认域名后用本人账户登录，优先扫码。</li><li>进入“交易记录”或账户余额旁“查看”→“余额收支明细”，选择时间范围并下载查询结果。</li><li>优先选 CSV；若得到 XLS/XLSX，用 Excel/WPS“另存为”→“CSV UTF-8（逗号分隔）”。</li><li>在看板选择“支付宝”并上传，预览中核对日期、笔数和金额。</li></ol><p>不同账户和版本入口可能不同。余额收支明细不代表覆盖全部银行卡、花呗或其他支付方式；请与支付宝 App 月账单人工核对。</p></details><details><summary>看板：每月离线同步</summary><ol><li>打开“资金”→“导入账单”，选择平台并上传 CSV。</li><li>核对预览后确认导入；重复流水不会重复计入。</li><li>点击“添加收入”填写当月收入。</li><li>在日历图、分类图和流水列表检查结果，下个月重复导入新的时间范围。</li></ol></details></div>;
}

function IncomeDialog({ close, done }: { close: () => void; done: () => Promise<void> }) {
  const [amount, setAmount] = useState(""); const [occurredAt, setOccurredAt] = useState(""); const [incomeType, setIncomeType] = useState("工资"); const [counterparty, setCounterparty] = useState(""); const [notes, setNotes] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const match = amount.trim().match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
    if (!match || Number(match[1]) === 0 && !Number(match[2])) { setError("请输入大于 0 的有效金额"); return; }
    const amountFen = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/finance/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountFen, occurredAt: `${occurredAt}:00+08:00`, incomeType, counterparty, notes }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "保存失败");
      await done();
    } catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  };
  return <Modal title="添加手动收入" close={close}><form onSubmit={submit}><div className="notice warning"><b>手动记录</b><span>收入不会连接银行或支付账户；保存前请核对金额和日期。</span></div><div className="form-grid"><label><span>金额（元）*</span><input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required /></label><label><span>日期和时间*</span><input type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} required /></label><label><span>收入类型*</span><select value={incomeType} onChange={event => setIncomeType(event.target.value)}>{INCOME_TYPES.map(value => <option key={value}>{value}</option>)}</select></label><label><span>收入来源</span><input value={counterparty} maxLength={100} onChange={event => setCounterparty(event.target.value)} placeholder="可选" /></label><label className="full"><span>备注</span><textarea value={notes} maxLength={1000} onChange={event => setNotes(event.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={close}>取消</button><button className="button primary" disabled={busy}>{busy ? "保存中…" : "确认添加"}</button></div></form></Modal>;
}

function DayDrawer({ date, rows, close }: { date: string; rows: Transaction[]; close: () => void }) {
  return <div className="drawer-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><aside className="day-drawer" aria-label={`${date} 流水明细`}><div className="section-head"><div><div className="eyebrow">DAILY DETAILS</div><h2>{date} 明细</h2></div><button className="icon-button" onClick={close} aria-label="关闭日明细">×</button></div>{rows.length ? <TransactionList rows={rows} changed={async () => {}} notify={() => {}} /> : <EmptyFinance text="当天没有流水" />}</aside></div>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && close()}><section className="modal finance-modal" role="dialog" aria-modal="true" aria-label={title}><header><div><span>FINANCE · READ ONLY</span><b>{title}</b></div><button onClick={close} aria-label={`关闭${title}`}>×</button></header>{children}</section></div>;
}
function EmptyFinance({ text }: { text: string }) { return <div className="finance-state"><b>无数据</b><p>{text}</p></div>; }
