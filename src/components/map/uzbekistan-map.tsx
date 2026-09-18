"use client";

import * as React from "react";
import { UZ_MAP_REGIONS, UZ_MAP_VIEWBOX } from "./uzbekistan-map-data";

/**
 * O'ZBEKISTON INTERAKTIV XARITASI.
 *
 * Har hudud — ALOHIDA SVG PATH. Rasm ustidagi ko'rinmas
 * to'rtburchaklar emas: ular ekran o'lchami o'zgarganda siljiydi,
 * klaviatura bilan tanlab bo'lmaydi va skrin-riderga hech narsa
 * aytmaydi.
 *
 * RANG YAGONA BELGI EMAS (50-band): har hududning holati matn
 * bilan ham beriladi — `aria-label` da va yon paneldagi kartada.
 * Rang ko'rmaydigan odam ham, bosib chiqaradigan odam ham holatni
 * biladi.
 */

export const MAP_STATES = [
  "neutral",
  "no_data",
  "below_target",
  "near_target",
  "target_met",
  "top_performer",
] as const;
export type MapState = (typeof MAP_STATES)[number];

/**
 * Holat ranglari — mavjud dizayn tokenlaridan.
 *
 * `no_data` va `below_target` ATAYLAB farq qiladi: birinchisi
 * "hali ma'lumot yo'q", ikkinchisi "ma'lumot bor va u past".
 * Ikkalasini bir xil ko'rsatish yangi hududni yomon ishlayotgandek
 * ko'rsatardi.
 */
const STATE_FILL: Record<MapState, string> = {
  neutral: "var(--color-line)",
  no_data: "#e8eef5",
  below_target: "var(--color-peach)",
  near_target: "var(--color-amber)",
  target_met: "var(--color-green)",
  top_performer: "var(--color-mint)",
};

export interface MapRegionState {
  state: MapState;
  /** Skrin-rider va tooltip uchun — rangdan mustaqil. */
  statusLabel: string;
  /** Ixtiyoriy qisqa qiymat, masalan "10 / 10". */
  valueLabel?: string;
}

export interface UzbekistanMapProps {
  /** Slug -> holat. Berilmagan hudud `neutral` bo'ladi. */
  states?: Readonly<Record<string, MapRegionState>>;
  selectedSlug?: string | null;
  onSelect?: (slug: string) => void;
  onHover?: (slug: string | null) => void;
  /** Interfeys elementi sifatida nomi. */
  ariaLabel?: string;
  className?: string;
}

export function UzbekistanMap({
  states = {},
  selectedSlug = null,
  onSelect,
  onHover,
  ariaLabel = "O‘zbekiston hududlari xaritasi",
  className,
}: UzbekistanMapProps) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  const handleHover = React.useCallback(
    (slug: string | null) => {
      setHovered(slug);
      onHover?.(slug);
    },
    [onHover],
  );

  return (
    <svg
      viewBox={UZ_MAP_VIEWBOX}
      className={className}
      role="group"
      aria-label={ariaLabel}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {UZ_MAP_REGIONS.map((region) => {
        const info = states[region.slug];
        const state: MapState = info?.state ?? "neutral";
        const isSelected = selectedSlug === region.slug;
        const isHovered = hovered === region.slug;

        // Holat MATN bilan ham beriladi — rang yagona belgi emas.
        const label = [
          region.name,
          info?.statusLabel,
          info?.valueLabel,
        ].filter(Boolean).join(", ");

        return (
          <path
            key={region.slug}
            d={region.d}
            /*
             * Tanlangan hudud DOIM brend ko'k: u holatdan qat'i
             * nazar "hozir shu tanlangan" degan ma'noni bildiradi
             * va uni holat rangi bilan aralashtirish mumkin emas.
             */
            fill={isSelected ? "var(--color-brand)" : STATE_FILL[state]}
            stroke="#ffffff"
            strokeWidth={isSelected || isHovered ? 2.5 : 1.2}
            strokeLinejoin="round"
            opacity={isHovered && !isSelected ? 0.85 : 1}
            tabIndex={0}
            role="button"
            aria-label={label}
            aria-pressed={isSelected}
            onMouseEnter={() => handleHover(region.slug)}
            onMouseLeave={() => handleHover(null)}
            onFocus={() => handleHover(region.slug)}
            onBlur={() => handleHover(null)}
            onClick={() => onSelect?.(region.slug)}
            onKeyDown={(event) => {
              // Enter va Probel — tugmaning standart xatti-harakati.
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(region.slug);
              }
            }}
            style={{ cursor: onSelect ? "pointer" : "default", outline: "none", transition: "fill .15s" }}
          />
        );
      })}
    </svg>
  );
}

/** Rang legendasi — matn bilan, chunki rang yagona belgi bo‘la olmaydi. */
export const MAP_STATE_LABELS: Record<MapState, string> = {
  neutral: "Belgilanmagan",
  no_data: "Ma’lumot yo‘q",
  below_target: "Talabdan past",
  near_target: "Talabga yaqin",
  target_met: "Talab darajasida",
  top_performer: "Talabdan yuqori",
};

export { STATE_FILL as MAP_STATE_FILL };
