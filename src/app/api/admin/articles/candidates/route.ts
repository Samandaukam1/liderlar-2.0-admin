import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  if (!(await checkPermission("articles.view"))) {
    return Response.json({ error: "Ruxsat yo‘q." }, { status: 403 });
  }

  // Remove PostgREST filter syntax and user-supplied wildcards.
  const q = (new URL(request.url).searchParams.get("q") ?? "")
    .slice(0, 120)
    .replace(/[%_*\\(),".]/g, " ")
    .trim();
  if (!q) return Response.json({ candidates: [] });

  const pattern = `%${q.replace(/[ʻʼ‘’`´']/g, "_")}%`;
  const { data, error } = await createSupabaseAdminClient()
    .from("candidates")
    .select("id, full_name, slug")
    .is("deleted_at", null)
    .or(`full_name.ilike.${pattern},slug.ilike.${pattern}`)
    .order("full_name")
    .order("id")
    .limit(5);

  if (error) {
    return Response.json({ error: "Nomzodlarni qidirib bo‘lmadi." }, { status: 500 });
  }
  return Response.json({ candidates: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
