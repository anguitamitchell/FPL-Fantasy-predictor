import { z } from "zod";
import { loadTeam, PinSchema, savedTeamInfo, saveTeam, SavedTeamDataSchema } from "@/lib/team/saved";

function parseId(id: string) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 && n < 1e9 ? n : null;
}

/** Whether a cloud save exists (no PIN needed, returns no team data). */
export async function GET(_req: Request, ctx: RouteContext<"/api/saved-team/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "Invalid team ID" }, { status: 400 });
  return Response.json(await savedTeamInfo(id), { headers: { "Cache-Control": "no-store" } });
}

/** Save (or overwrite) the team. Body: { pin, data }. */
export async function PUT(req: Request, ctx: RouteContext<"/api/saved-team/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "Invalid team ID" }, { status: 400 });
  const body = z.object({ pin: PinSchema, data: SavedTeamDataSchema }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const r = await saveTeam(id, body.data.pin, body.data.data);
  return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
}

/** Load the saved team. Body: { pin } (POST so the PIN never appears in a URL). */
export async function POST(req: Request, ctx: RouteContext<"/api/saved-team/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return Response.json({ error: "Invalid team ID" }, { status: 400 });
  const body = z.object({ pin: PinSchema }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const r = await loadTeam(id, body.data.pin);
  return r.ok ? Response.json(r, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: r.error }, { status: r.status });
}
