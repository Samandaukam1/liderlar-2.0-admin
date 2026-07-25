import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

const SECRET_KEYS = /token|secret|password|key|hash/i;

/** Strips secret-looking fields so raw tokens/keys never reach audit_logs. */
export function sanitizeForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : sanitizeForAudit(v);
    }
    return out;
  }
  return value;
}

/** Fire-and-forget audit write; failures are logged but never break the action. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      old_value: entry.oldValue != null ? sanitizeForAudit(entry.oldValue) : null,
      new_value: entry.newValue != null ? sanitizeForAudit(entry.newValue) : null,
      reason: entry.reason ?? null,
      severity: entry.severity ?? "info",
      metadata: entry.metadata ? sanitizeForAudit(entry.metadata) : {},
    });
  } catch (err) {
    console.error("audit log write failed", err);
  }
}
