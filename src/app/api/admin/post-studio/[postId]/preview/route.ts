import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { getPost } from "@/lib/post-studio/repository";
import { buildLayoutForPost } from "@/lib/post-studio/service";
import { renderPostImage } from "@/lib/post-studio/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/post-studio/[postId]/preview
 *
 * Renders the post through the exact pipeline the final export uses, so what an
 * admin approves is byte-for-byte what subscribers receive. The studio uses it
 * for the "true" preview; live slider dragging is drawn client-side from the
 * same layout object to avoid a round-trip per pixel.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ postId: string }> }) {
  const admin = await checkPermission("posts.view");
  if (!admin) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });

  const { postId } = await ctx.params;
  const post = await getPost(postId);
  if (!post) return NextResponse.json({ error: "Post topilmadi" }, { status: 404 });

  const layout = await buildLayoutForPost(post);
  const { png } = await renderPostImage(layout);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // The studio busts this itself with a version query on every change.
      "Cache-Control": "private, no-store",
    },
  });
}
