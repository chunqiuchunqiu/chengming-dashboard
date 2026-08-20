const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const ALLOWED_EXTENSIONS = new Set(["csv", "txt"]);

export class FinanceHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function requireUserId(request: Request) {
  const header = request.headers.get("oai-authenticated-user-id")?.trim();
  if (header) return header.slice(0, 200);
  const localEnabled = process.env.NODE_ENV === "development" && process.env.ALLOW_LOCAL_DEV_USER === "true";
  if (localEnabled) return "local-development-user";
  throw new FinanceHttpError(401, "请先登录后再访问资金数据");
}

export function requireSameOrigin(request: Request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const localEnabled = process.env.NODE_ENV === "development" && process.env.ALLOW_LOCAL_DEV_USER === "true";
  if ((!origin && !localEnabled) || (origin && origin !== expected)) {
    throw new FinanceHttpError(403, "请求来源校验失败");
  }
}

export function requireJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new FinanceHttpError(415, "仅接受 application/json");
  }
}

export function requireMultipart(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    throw new FinanceHttpError(415, "仅接受 multipart/form-data 账单上传");
  }
  const length = Number(request.headers.get("content-length") || "0");
  if (length && length > MAX_FILE_BYTES + 128 * 1024) throw new FinanceHttpError(413, "账单文件不能超过 10MB");
}

export function validateBillFile(file: File) {
  if (!file || file.size <= 0) throw new FinanceHttpError(400, "请选择账单文件");
  if (file.size > MAX_FILE_BYTES) throw new FinanceHttpError(413, "账单文件不能超过 10MB");
  const extension = file.name.toLowerCase().split(".").pop() || "";
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new FinanceHttpError(415, "仅支持解压后的 CSV 或 TXT；XLS/XLSX 请先另存为 CSV UTF-8");
  const type = file.type.toLowerCase();
  if (type && !type.includes("csv") && !type.startsWith("text/") && type !== "application/octet-stream") {
    throw new FinanceHttpError(415, "文件类型与 CSV/TXT 不匹配");
  }
}

export function safeFileName(name: string) {
  const leaf = name.split(/[\\/]/).pop() || "bill.csv";
  return leaf.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 100) || "bill.csv";
}

export function assertRowLimit(count: number) {
  if (count > MAX_ROWS) throw new FinanceHttpError(413, "单个账单最多包含 50000 条明细");
}

export function cleanText(value: unknown, max: number, fallback = "") {
  const result = typeof value === "string" ? value.trim() : fallback;
  if (result.length > max) throw new FinanceHttpError(400, `字段长度不能超过 ${max}`);
  return result;
}

export function financeErrorResponse(error: unknown) {
  if (error instanceof FinanceHttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error("finance_request_failed", { kind: error instanceof Error ? error.name : "unknown" });
  return Response.json({ error: "资金服务暂不可用，请稍后重试" }, { status: 500 });
}
