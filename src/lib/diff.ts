export type DiffOp = { type: "same" | "added" | "removed"; text: string };

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/**
 * Word-level diff (LCS) used by AIDiffViewer to show exactly what Jaxongir AI
 * changed. Adjacent ops of the same type are merged for compact rendering.
 */
export function diffWords(original: string, revised: string): DiffOp[] {
  const a = tokenize(original);
  const b = tokenize(revised);
  const n = a.length;
  const m = b.length;

  // LCS table (n and m stay small for editorial texts; guard very long inputs)
  if (n * m > 4_000_000) {
    if (original === revised) return [{ type: "same", text: original }];
    return [
      { type: "removed", text: original },
      { type: "added", text: revised },
    ];
  }

  const dp: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[idx(i, j)] =
        a[i] === b[j]
          ? dp[idx(i + 1, j + 1)] + 1
          : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (type: DiffOp["type"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      push("removed", a[i]);
      i++;
    } else {
      push("added", b[j]);
      j++;
    }
  }
  while (i < n) push("removed", a[i++]);
  while (j < m) push("added", b[j++]);
  return ops;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    const words = op.text.trim() ? op.text.trim().split(/\s+/).length : 0;
    if (op.type === "added") added += words;
    if (op.type === "removed") removed += words;
  }
  return { added, removed };
}
