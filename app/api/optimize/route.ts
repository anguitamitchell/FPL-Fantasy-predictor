import { z } from "zod";
import { getAppData } from "@/lib/data/app";
import { planScenarios } from "@/lib/optimizer/scenarios";

export const maxDuration = 60;

const Body = z.object({
  squad: z.array(z.object({ id: z.number().int(), sell: z.number().int().positive() })).max(15),
  bank: z.number().int().min(0),
  freeTransfers: z.number().int().min(0).max(15),
  locked: z.array(z.number().int()).optional(),
  banned: z.array(z.number().int()).optional(),
  chips: z.array(z.string()).optional(),
  maxHits: z.number().int().min(0).max(4).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  try {
    const d = await getAppData();
    return Response.json({ gws: d.gws, ...(await planScenarios(d.players, parsed.data)) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Optimisation failed" }, { status: 422 });
  }
}
