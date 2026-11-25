import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { requirePermission } from "@/lib/auth";
import { isUuid } from "@/lib/profile-editor/evidence-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MemberArticleEditForm } from "./member-article-edit-form";

/** Tahrirlash ruxsatini tekshiradi va forma uchun maqolaning joriy versiyasini yuklaydi. */
export default async function MemberArticleEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("articles.edit");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, error } = await createSupabaseAdminClient().from("member_articles")
    .select("id, candidate_id, title, subtitle, excerpt, content, hero_url, state, updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Maqola ma’lumotlarini o‘qib bo‘lmadi.");
  if (!data) notFound();

  return (
    <>
      <PageHeader title="Maqolani tahrirlash" breadcrumbs={[
        { label: "Liderlar Online maqolalari", href: "/online-maqolalar" },
        { label: data.title },
      ]} />
      <MemberArticleEditForm key={data.updated_at} article={data} />
    </>
  );
}
