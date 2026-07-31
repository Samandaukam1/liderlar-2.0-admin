import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { CandidateEditor } from "../candidate-editor";
import { emptyCandidateData } from "@/lib/candidates/schema";
import { getCandidatePrompt } from "@/lib/candidates/repository";

export const metadata = { title: "Yangi nomzod" };
export const dynamic = "force-dynamic";

export default async function NewCandidatePage() {
  await requirePermission("candidates.create");
  const prompt = await getCandidatePrompt();

  return (
    <>
      <PageHeader
        title="Yangi nomzod"
        breadcrumbs={[{ label: "Nomzodlar", href: "/candidates" }, { label: "Yangi" }]}
      />
      <CandidateEditor candidateId={null} initialData={emptyCandidateData()} initialPrompt={prompt} />
    </>
  );
}
