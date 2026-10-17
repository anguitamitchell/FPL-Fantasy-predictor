import { FplError } from "@/lib/fpl/client";
import { importTeam } from "@/lib/team/fetch";

export async function GET(_req: Request, ctx: RouteContext<"/api/team/[id]">) {
  const { id } = await ctx.params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) return Response.json({ error: "Team ID must be a positive number" }, { status: 400 });
  try {
    return Response.json(await importTeam(entryId));
  } catch (err) {
    if (err instanceof FplError && err.status === 404) return Response.json({ error: `No FPL team with ID ${entryId}` }, { status: 404 });
    return Response.json({ error: err instanceof Error ? err.message : "Could not load team" }, { status: 502 });
  }
}
