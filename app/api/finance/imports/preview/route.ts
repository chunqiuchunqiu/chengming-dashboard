import { buildPreview, parseFinanceUpload } from "../../_shared";
import { financeErrorResponse, requireSameOrigin, requireUserId } from "../../../../../lib/finance/security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = requireUserId(request);
    requireSameOrigin(request);
    const { parsed } = await parseFinanceUpload(request);
    return Response.json({ preview: await buildPreview(userId, parsed), source: "请求内存解析（原始文件未保存）", updatedAt: new Date().toISOString() });
  } catch (error) { return financeErrorResponse(error); }
}
