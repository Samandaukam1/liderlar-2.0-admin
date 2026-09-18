"use client";

import * as React from "react";
import {
  UzbekistanMap,
  MAP_STATE_LABELS,
  MAP_STATE_FILL,
  type MapState,
} from "@/components/map/uzbekistan-map";

export interface RegionPanelData {
  regionId: string;
  slug: string;
  name: string;
  leadsToday: number;
  claimedToday: number;
  confirmedToday: number;
  target: number | null;
  progress: number | null;
  state: string;
  coordinators: Array<{ id: string; fullName: string; photoUrl: string | null; status: string }>;
  alerts: string[];
}

/**
 * Xarita + tanlangan hudud paneli.
 *
 * MA'LUMOT FAQAT HOVER'DA EMAS (7-band): bosilganda yon panel ochiq
 * qoladi. Sensorli ekranda hover yo'q, va hover bilan ko'rsatilgan
 * son bosib chiqarib bo'lmaydi hamda skrin-riderga yetmaydi.
 */
export function RegionMapPanel({ regions }: { regions: RegionPanelData[] }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);

  const bySlug = React.useMemo(
    () => Object.fromEntries(regions.map((r) => [r.slug, r])),
    [regions],
  );

  const states = React.useMemo(
    () =>
      Object.fromEntries(
        regions.map((r) => [
          r.slug,
          {
            state: r.state as MapState,
            statusLabel: MAP_STATE_LABELS[r.state as MapState] ?? r.state,
            valueLabel: r.target != null ? `${r.confirmedToday} / ${r.target}` : undefined,
          },
        ]),
      ),
    [regions],
  );

  // Ko'rsatiladigan hudud: tanlangani ustun, bo'lmasa hover.
  const active = bySlug[selected ?? hovered ?? ""] ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="rounded-card border border-line bg-card p-4 shadow-card">
        <UzbekistanMap
          states={states}
          selectedSlug={selected}
          onSelect={(slug) => setSelected((prev) => (prev === slug ? null : slug))}
          onHover={setHovered}
          ariaLabel="Hududlar bo‘yicha bugungi natija"
        />
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {(["target_met", "near_target", "below_target", "no_data"] as MapState[]).map((s) => (
            <li key={s} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                // Legenda ranglari xaritaning O'ZIDAN olinadi — ikki
                // ro'yxat bo'lsa, ular vaqt o'tib mos kelmay qolardi.
                style={{ background: MAP_STATE_FILL[s] }}
                aria-hidden
              />
              {MAP_STATE_LABELS[s]}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-card border border-line bg-card p-5 shadow-card">
        {!active ? (
          <p className="text-sm text-ink-soft">
            Hududni tanlang — bugungi natija va koordinator shu yerda ko‘rinadi.
          </p>
        ) : (
          <div>
            <h3 className="font-display text-lg font-bold uppercase text-ink">{active.name}</h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              {MAP_STATE_LABELS[active.state as MapState] ?? active.state}
            </p>

            <dl className="mt-4 space-y-2">
              <Row label="Bugungi lidlar" value={active.leadsToday} />
              <Row label="Band qilingan" value={active.claimedToday} />
              <Row label="Tasdiqlangan sotuv" value={active.confirmedToday} />
              <Row
                label="Konversiya"
                /* Maxraj nol bo'lsa foiz KO'RSATILMAYDI: "0%" bilan
                   "hali lid yo'q" bir xil narsa emas. */
                value={
                  active.claimedToday > 0
                    ? `${active.confirmedToday} / ${active.claimedToday}`
                    : "—"
                }
              />
              <Row
                label="Talab"
                value={active.target == null ? "belgilanmagan" : `${active.confirmedToday} / ${active.target}`}
              />
              {active.progress != null ? <Row label="Bajarilishi" value={`${active.progress}%`} /> : null}
            </dl>

            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                Koordinator
              </p>
              {active.coordinators.length === 0 ? (
                <p className="mt-1 text-sm text-ink-soft">
                  Bu hudud uchun koordinator hali biriktirilmagan.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {active.coordinators.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      {c.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="h-8 w-8 rounded-full bg-surface" aria-hidden />
                      )}
                      <span className="text-sm text-ink">{c.fullName}</span>
                      {c.status !== "active" ? (
                        <span className="text-[11px] text-coral">({c.status})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {active.alerts.length > 0 ? (
              <ul className="mt-4 space-y-1 border-t border-line pt-3">
                {active.alerts.map((alert) => (
                  <li key={alert} className="text-xs text-coral">
                    • {alert}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="text-sm font-bold text-ink">{value}</dd>
    </div>
  );
}
