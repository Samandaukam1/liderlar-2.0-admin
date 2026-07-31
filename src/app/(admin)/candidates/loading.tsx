export default function CandidatesLoading() {
  return (
    <div className="space-y-5" aria-label="Nomzodlar yuklanmoqda" aria-busy="true">
      <div className="h-20 animate-pulse rounded-card bg-brand/5" />
      <div className="h-14 animate-pulse rounded-card bg-brand/5" />
      <div className="overflow-hidden rounded-card border border-line bg-card">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-line/60 p-4 last:border-0">
            <div className="h-10 w-10 animate-pulse rounded-full bg-brand/8" />
            <div className="h-4 flex-1 animate-pulse rounded bg-brand/8" />
            <div className="h-6 w-24 animate-pulse rounded-full bg-brand/8" />
          </div>
        ))}
      </div>
    </div>
  );
}
