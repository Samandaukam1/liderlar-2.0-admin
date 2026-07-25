"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Chart-grade brand series colors, in FIXED assignment order.
 * Validated (dataviz six checks, light surface): lightness band, chroma,
 * CVD ΔE 13.8 worst pair, normal-vision ΔE 19.2, contrast ≥ 3:1 — all pass.
 */
export const CHART_SERIES = [
  "#1677FF", // electric blue
  "#1d8a6b", // mint · dark step
  "#6a52c7", // lavender · dark step
  "#0097be", // cyan · dark step
  "#c43d3d", // coral · dark step
] as const;

const GRID = "rgba(8, 126, 164, 0.10)";
const AXIS_INK = "#526579";

interface TooltipPayloadItem {
  value?: number | string;
  name?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-pop">
      <p className="font-bold text-ink">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-ink-soft">
          {typeof p.value === "number"
            ? new Intl.NumberFormat("uz-UZ").format(p.value)
            : p.value}
          {suffix ? ` ${suffix}` : ""}
        </p>
      ))}
    </div>
  );
}

/** Single-series area chart (e.g. 30 kunlik profil ko‘rishlari). */
export function ViewsAreaChart({
  data,
  color = CHART_SERIES[0],
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
}) {
  return (
    <div className="h-60 w-full" role="img" aria-label="Vaqt bo‘yicha ko‘rsatkich grafigi">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: AXIS_INK, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: AXIS_INK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: color, strokeOpacity: 0.35 }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill="url(#area-fill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-hue horizontal bars for magnitude comparison across categories. */
export function CategoryBarChart({
  data,
  color = CHART_SERIES[3],
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
}) {
  return (
    <div
      className="w-full"
      style={{ height: Math.max(160, data.length * 42) }}
      role="img"
      aria-label="Kategoriyalar bo‘yicha taqsimot grafigi"
    >
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: AXIS_INK, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={130}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(8,126,164,0.05)" }} />
          <Bar
            dataKey="value"
            fill={color}
            radius={[0, 4, 4, 0]}
            barSize={16}
            label={{ position: "right", fill: AXIS_INK, fontSize: 11 }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Multi-series trend lines (e.g. reyting kategoriyalari) — fixed color order. */
export function TrendLinesChart({
  data,
  series,
}: {
  data: Array<Record<string, number | string>>;
  series: Array<{ key: string; label: string }>;
}) {
  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap gap-3">
        {series.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: CHART_SERIES[i % CHART_SERIES.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="h-64" role="img" aria-label="Trend grafigi">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: AXIS_INK, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={28}
            />
            <YAxis tick={{ fill: AXIS_INK, fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<ChartTooltip />} />
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={CHART_SERIES[i % CHART_SERIES.length]}
                strokeWidth={2}
                fill="transparent"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
