import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { calendarEvents } from "../../../db/schema";

export const dynamic = "force-dynamic";

type EventPayload = {
  id?: string; title?: string; startsAt?: string; allDay?: boolean; category?: string;
  priority?: string; location?: string; notes?: string; reminderMinutes?: number; completed?: boolean;
};

function userId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

function clean(payload: EventPayload) {
  const title = payload.title?.trim().slice(0, 120) ?? "";
  const startsAt = payload.startsAt ?? "";
  if (!title) throw new Error("标题不能为空");
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) throw new Error("日期时间无效");
  if (!(["高", "中", "低"] as const).includes(payload.priority as "高" | "中" | "低")) throw new Error("优先级无效");
  return {
    title,
    startsAt,
    allDay: Boolean(payload.allDay),
    category: (payload.category?.trim() || "个人").slice(0, 30),
    priority: payload.priority || "中",
    location: (payload.location?.trim() || "").slice(0, 160),
    notes: (payload.notes?.trim() || "").slice(0, 2000),
    reminderMinutes: Math.max(0, Math.min(43200, Number(payload.reminderMinutes) || 0)),
    completed: Boolean(payload.completed),
  };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "日历服务暂不可用";
  return Response.json({ error: message }, { status: message.includes("不能为空") || message.includes("无效") ? 400 : 500 });
}

export async function GET(request: Request) {
  try {
    const rows = await getDb().select().from(calendarEvents).where(eq(calendarEvents.userId, userId(request))).orderBy(asc(calendarEvents.startsAt));
    return Response.json({ events: rows, source: "Cloudflare D1", updatedAt: new Date().toISOString() });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as EventPayload;
    const now = new Date().toISOString();
    const row = { id: payload.id || crypto.randomUUID(), userId: userId(request), ...clean(payload), createdAt: now, updatedAt: now };
    await getDb().insert(calendarEvents).values(row);
    return Response.json({ event: row }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json() as EventPayload;
    if (!payload.id) return Response.json({ error: "id 不能为空" }, { status: 400 });
    const row = { ...clean(payload), updatedAt: new Date().toISOString() };
    await getDb().update(calendarEvents).set(row).where(and(eq(calendarEvents.id, payload.id), eq(calendarEvents.userId, userId(request))));
    return Response.json({ event: { id: payload.id, ...row } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id 不能为空" }, { status: 400 });
    await getDb().delete(calendarEvents).where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId(request))));
    return Response.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
