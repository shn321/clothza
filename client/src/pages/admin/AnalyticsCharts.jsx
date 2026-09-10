/* CLOTHZA admin analytics charts (Step 20) — dependency-free SVG +
   CSS-bar visuals in the existing admin language (ivory/charcoal/linen/
   bronze). All charts are responsive (viewBox / fluid widths), carry
   role="img" with text summaries for assistive tech, and render explicit
   empty states instead of fake data. */

function niceMax(value) {
  const v = Math.max(1, Number(value) || 0)
  const mag = 10 ** Math.floor(Math.log10(v))
  const norm = v / mag
  const ceil = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return ceil * mag
}

/* Vertical bar chart for a daily series: [{ date, value }]. */
export function DailyBars({ days, valueKey, label, formatValue, color = '#1c1a17' }) {
  const data = Array.isArray(days) ? days : []
  const total = data.reduce((n, d) => n + (Number(d[valueKey]) || 0), 0)
  if (data.length === 0 || total <= 0) {
    return <p className="type-body-muted mt-4">No {label.toLowerCase()} data for this range.</p>
  }
  const W = 600
  const H = 220
  const PAD_L = 44
  const PAD_B = 26
  const PAD_T = 8
  const innerW = W - PAD_L - 8
  const innerH = H - PAD_T - PAD_B
  const max = niceMax(Math.max(...data.map((d) => Number(d[valueKey]) || 0)))
  const slot = innerW / data.length
  const barW = Math.max(2, Math.min(26, slot * 0.62))
  const gridlines = [0, 0.5, 1].map((f) => f * max)
  const labelIdx = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 w-full"
        role="img"
        aria-label={`${label} over time. Total ${formatValue(total)} across ${data.length} days.`}
      >
        <title>{`${label} over time`}</title>
        {gridlines.map((g) => {
          const y = PAD_T + innerH - (g / max) * innerH
          return (
            <g key={g}>
              <line x1={PAD_L} y1={y} x2={W - 8} y2={y} stroke="#e5ddcf" strokeWidth="1" />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#8a8378">
                {g >= 1000 ? `${Math.round(g / 100) / 10}k` : Math.round(g)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0
          const h = (v / max) * innerH
          const x = PAD_L + i * slot + (slot - barW) / 2
          const y = PAD_T + innerH - h
          return (
            <g key={d.date}>
              <title>{`${d.date}: ${formatValue(v)}`}</title>
              <rect x={x} y={y} width={barW} height={Math.max(h, v > 0 ? 2 : 0)} rx="2" fill={color} opacity={v > 0 ? 1 : 0.25} />
              {labelIdx.has(i) && (
                <text x={PAD_L + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#8a8378">
                  {String(d.date).slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="type-small mt-2">
        Total {label.toLowerCase()}: <span className="font-medium text-charcoal">{formatValue(total)}</span>
      </p>
    </div>
  )
}

/* Horizontal meter rows: [{ label, sub, value, display }]. Pure HTML so
   values stay selectable and readable on small screens. */
export function MeterRows({ rows, emptyText }) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) {
    return <p className="type-body-muted mt-4">{emptyText || 'Nothing to show for this range.'}</p>
  }
  const max = Math.max(1, ...list.map((r) => Number(r.value) || 0))
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {list.map((r, i) => (
        <li key={`${r.label}-${i}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium">{r.label}</p>
            <p className="type-small shrink-0 tabular-nums">{r.display}</p>
          </div>
          {r.sub && <p className="type-small truncate">{r.sub}</p>}
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-linen"
            role="img"
            aria-label={`${r.label}: ${r.display}`}
          >
            <div
              className="h-full rounded-full bg-charcoal"
              style={{ width: `${Math.max(2, ((Number(r.value) || 0) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
