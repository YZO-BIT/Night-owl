import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { fetchLeaderboard } from "@/lib/leaderboard";

function leagueFromRank(rank: number | null) {
  if (rank === null) return "Bronze";
  if (rank <= 3) return "Diamond";
  if (rank <= 10) return "Obsidian";
  if (rank <= 25) return "Gold";
  if (rank <= 50) return "Silver";
  return "Bronze";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const subject = (searchParams.get("subject") || "").trim();

    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await fetchLeaderboard(user.id, { subject: subject || null });
    return NextResponse.json({
      ...payload,
      league: leagueFromRank(payload.me?.rank ?? null),
      updatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
