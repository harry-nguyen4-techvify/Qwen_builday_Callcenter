import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import Icon from '../components/Icon'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KPIs {
  total_calls: number
  completed: number
  escalated: number
  failed: number
  in_progress: number
  form_filled: number
  completion_rate: number
  escalation_rate: number
  avg_talk_seconds: number
  avg_wait_seconds: number
  avg_csat: number | null
  total_customers: number
  total_agents: number
  active_agents: number
}

interface SeriesPoint {
  date: string
  total: number
  completed: number
  escalated: number
}

interface LabelValue {
  label: string
  value: number
}

interface AgentRow {
  label: string
  calls: number
  avg_talk: number
}

interface AnalyticsResponse {
  generated_at: string
  window_days: number
  kpis: KPIs
  series: SeriesPoint[]
  status_breakdown: LabelValue[]
  disposition_breakdown: LabelValue[]
  direction_breakdown: LabelValue[]
  top_queues: LabelValue[]
  top_agents: AgentRow[]
  hourly: number[]
  escalation_reasons: LabelValue[]
  flow_breakdown: LabelValue[]
  agent_status: LabelValue[]
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, string> = {
  completed: '#10B981',
  escalated: '#F59E0B',
  failed: '#EF4444',
  abandoned: '#94A3B8',
  in_progress: '#0046a8',
  queued: '#A78BFA',
  transferred: '#0EA5E9',
}

const DONUT_PALETTE = [
  '#00317a',
  '#0046a8',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#A78BFA',
  '#0EA5E9',
  '#64748B',
]

function formatDuration(sec: number): string {
  if (!sec) return '0s'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

// ---------------------------------------------------------------------------
// Chart primitives (pure SVG, zero deps)
// ---------------------------------------------------------------------------

function AreaLineChart({ data }: { data: SeriesPoint[] }) {
  const width = 760
  const height = 240
  const padL = 40
  const padR = 12
  const padT = 16
  const padB = 32

  const max = Math.max(1, ...data.map((d) => d.total))
  const niceMax = Math.ceil(max / 5) * 5 || 5
  const xStep = (width - padL - padR) / Math.max(1, data.length - 1)

  const yFor = (v: number) => padT + (height - padT - padB) * (1 - v / niceMax)
  const xFor = (i: number) => padL + i * xStep

  const pathTotal = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d.total).toFixed(1)}`)
    .join(' ')
  const pathCompleted = data
    .map(
      (d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d.completed).toFixed(1)}`,
    )
    .join(' ')
  const pathEscalated = data
    .map(
      (d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d.escalated).toFixed(1)}`,
    )
    .join(' ')

  const areaPath =
    pathTotal +
    ` L ${xFor(data.length - 1).toFixed(1)} ${(height - padB).toFixed(1)}` +
    ` L ${xFor(0).toFixed(1)} ${(height - padB).toFixed(1)} Z`

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(niceMax * t))
  const everyNth = Math.max(1, Math.ceil(data.length / 10))

  const [hover, setHover] = useState<number | null>(null)

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0046a8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0046a8" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="#e5e2e1"
              strokeDasharray="2 3"
            />
            <text
              x={padL - 8}
              y={yFor(t) + 4}
              textAnchor="end"
              className="fill-outline"
              style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            >
              {t}
            </text>
          </g>
        ))}

        {/* Area for total */}
        <path d={areaPath} fill="url(#areaFill)" />

        {/* Lines */}
        <path d={pathTotal} fill="none" stroke="#0046a8" strokeWidth={2} />
        <path d={pathCompleted} fill="none" stroke="#10B981" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={pathEscalated} fill="none" stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="4 3" />

        {/* Hover capture */}
        {data.map((_, i) => (
          <rect
            key={i}
            x={xFor(i) - xStep / 2}
            y={padT}
            width={xStep}
            height={height - padT - padB}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {/* Hover marker */}
        {hover !== null && (
          <g>
            <line
              x1={xFor(hover)}
              x2={xFor(hover)}
              y1={padT}
              y2={height - padB}
              stroke="#00317a"
              strokeDasharray="2 2"
              opacity={0.4}
            />
            <circle cx={xFor(hover)} cy={yFor(data[hover].total)} r={4} fill="#0046a8" />
            <circle cx={xFor(hover)} cy={yFor(data[hover].completed)} r={3} fill="#10B981" />
            <circle cx={xFor(hover)} cy={yFor(data[hover].escalated)} r={3} fill="#F59E0B" />
          </g>
        )}

        {/* X labels */}
        {data.map((d, i) =>
          i % everyNth === 0 || i === data.length - 1 ? (
            <text
              key={d.date}
              x={xFor(i)}
              y={height - padB + 16}
              textAnchor="middle"
              className="fill-outline"
              style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            >
              {formatDate(d.date)}
            </text>
          ) : null,
        )}
      </svg>

      {/* Tooltip */}
      {hover !== null && (
        <div
          className="absolute pointer-events-none bg-navy text-white text-xs rounded-lg px-3 py-2 shadow-ambient"
          style={{
            left: `${((xFor(hover) + 12) / width) * 100}%`,
            top: 8,
          }}
        >
          <div className="font-bold font-label">{formatDate(data[hover].date)}</div>
          <div className="mt-1 space-y-0.5">
            <div>
              <span className="inline-block w-2 h-2 rounded-full bg-[#0046a8] mr-1.5" />
              Total: <span className="font-bold">{data[hover].total}</span>
            </div>
            <div>
              <span className="inline-block w-2 h-2 rounded-full bg-[#10B981] mr-1.5" />
              Completed: <span className="font-bold">{data[hover].completed}</span>
            </div>
            <div>
              <span className="inline-block w-2 h-2 rounded-full bg-[#F59E0B] mr-1.5" />
              Escalated: <span className="font-bold">{data[hover].escalated}</span>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs text-on-surface-variant font-label">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#0046a8]" /> Total
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#10B981]" /> Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#F59E0B]" /> Escalated
        </span>
      </div>
    </div>
  )
}

function Donut({ data, total, size = 176 }: { data: LabelValue[]; total: number; size?: number }) {
  const radius = size / 2 - 12
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f0edec" strokeWidth={18} />
        {data.map((d, i) => {
          const frac = total > 0 ? d.value / total : 0
          const len = frac * circumference
          const color = STATUS_COLOR[d.label] || DONUT_PALETTE[i % DONUT_PALETTE.length]
          const seg = (
            <circle
              key={d.label}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={18}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
          )
          offset += len
          return seg
        })}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-navy font-bold"
          style={{ fontSize: 22, fontFamily: 'Pretendard, Inter, sans-serif' }}
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="fill-outline"
          style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
        >
          TOTAL
        </text>
      </svg>

      <div className="flex-1 space-y-1.5">
        {data.slice(0, 6).map((d, i) => {
          const color = STATUS_COLOR[d.label] || DONUT_PALETTE[i % DONUT_PALETTE.length]
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
          return (
            <div key={d.label} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-on-surface capitalize flex-1 truncate">
                {d.label.replace(/_/g, ' ')}
              </span>
              <span className="text-on-surface-variant font-label tabular-nums">
                {d.value}
              </span>
              <span className="text-outline font-label tabular-nums w-8 text-right">
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HBarList({
  rows,
  colorFn,
  unit = '',
}: {
  rows: LabelValue[]
  colorFn?: (i: number) => string
  unit?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100
        const color = colorFn ? colorFn(i) : DONUT_PALETTE[i % DONUT_PALETTE.length]
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-on-surface capitalize truncate pr-3">
                {r.label.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-on-surface-variant font-label tabular-nums flex-shrink-0">
                {r.value}
                {unit}
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        )
      })}
      {rows.length === 0 && (
        <div className="text-sm text-outline py-6 text-center font-label">
          No data
        </div>
      )}
    </div>
  )
}

function HourlyHeatmap({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly)
  return (
    <div>
      <div className="grid grid-cols-12 gap-1.5">
        {hourly.map((v, h) => {
          const intensity = v / max
          const opacity = 0.12 + intensity * 0.88
          return (
            <div
              key={h}
              className="relative group"
              title={`${h.toString().padStart(2, '0')}:00 — ${v} calls`}
            >
              <div
                className="aspect-square rounded-md cursor-pointer transition-transform hover:ring-2 hover:ring-primary/30"
                style={{ backgroundColor: `rgba(0, 70, 168, ${opacity})` }}
              />
              <div className="text-[9px] text-center mt-1 text-outline font-label">
                {h.toString().padStart(2, '0')}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-outline font-label">
        <span>less</span>
        <div className="flex gap-0.5">
          {[0.12, 0.3, 0.5, 0.7, 1].map((o) => (
            <div
              key={o}
              className="w-4 h-2.5 rounded"
              style={{ backgroundColor: `rgba(0, 70, 168, ${o})` }}
            />
          ))}
        </div>
        <span>more</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  icon,
  color,
  hint,
}: {
  label: string
  value: string | number
  icon: string
  color: 'primary' | 'success' | 'warning' | 'error' | 'tertiary'
  hint?: string
}) {
  const map: Record<string, { bg: string; text: string; iconBg: string }> = {
    primary: { bg: 'bg-primary/10', text: 'text-primary', iconBg: 'bg-primary/10' },
    success: { bg: 'bg-success/10', text: 'text-success', iconBg: 'bg-success/10' },
    warning: { bg: 'bg-warning/10', text: 'text-warning', iconBg: 'bg-warning/10' },
    error: { bg: 'bg-error/10', text: 'text-error', iconBg: 'bg-error/10' },
    tertiary: { bg: 'bg-tertiary/10', text: 'text-tertiary', iconBg: 'bg-tertiary/10' },
  }
  const c = map[color]
  return (
    <div className="rounded-xl bg-surface-container-lowest p-5 shadow-ambient flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg ${c.iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} className={c.text} size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-on-surface-variant font-label font-bold">
          {label}
        </div>
        <div className={`text-2xl font-bold font-headline ${c.text} tabular-nums mt-0.5`}>
          {value}
        </div>
        {hint && (
          <div className="text-[11px] text-outline mt-0.5 font-label truncate">{hint}</div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Analytics() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<7 | 14 | 30>(30)
  const pollRef = useRef<number | null>(null)

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await axios.get<AnalyticsResponse>(`/api/analytics?days=${days}`, {
          timeout: 15_000,
        })
        setData(res.data)
      } catch (e: any) {
        setError(e?.message || 'Failed to load analytics')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [days],
  )

  useEffect(() => {
    fetchData(false)
  }, [fetchData])

  // Auto-refresh every 30s (optional, keeps data fresh)
  useEffect(() => {
    pollRef.current = window.setInterval(() => fetchData(true), 30_000)
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [fetchData])

  const kpis = data?.kpis
  const series = data?.series || []

  const generatedAt = useMemo(() => {
    if (!data?.generated_at) return ''
    return new Date(data.generated_at).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }, [data?.generated_at])

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-on-surface-variant">
          <Icon name="progress_activity" className="animate-spin text-primary" size={32} />
          <span className="text-sm font-label">Loading analytics…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <Icon name="insights" className="text-primary" size={32} />
            <h1 className="text-3xl font-bold text-navy tracking-tight font-headline">
              Analytics
            </h1>
          </div>
          <p className="text-sm text-on-surface-variant mt-1">
            Real-time call center metrics · synced from the database
            {generatedAt && (
              <span className="text-outline font-label ml-2">· last sync {generatedAt}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Time range selector */}
          <div className="inline-flex rounded-lg bg-surface-container-lowest p-1 shadow-ambient">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold font-label transition-colors cursor-pointer ${
                  days === d
                    ? 'bg-primary text-white'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Reload button */}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold shadow-ambient hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <Icon
              name="refresh"
              size={18}
              className={refreshing ? 'animate-spin' : ''}
            />
            {refreshing ? 'Syncing…' : 'Reload'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-error/10 border border-error/20 text-error px-4 py-3 flex items-center gap-2 text-sm">
          <Icon name="error" size={18} />
          <span>{error}</span>
          <button
            onClick={() => fetchData(true)}
            className="ml-auto font-bold underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {kpis && (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <KpiCard
              label="Total Calls"
              value={kpis.total_calls}
              icon="call"
              color="primary"
              hint={`${data?.window_days} day window`}
            />
            <KpiCard
              label="Completed"
              value={kpis.completed}
              icon="check_circle"
              color="success"
              hint={`${kpis.completion_rate}% rate`}
            />
            <KpiCard
              label="Escalated"
              value={kpis.escalated}
              icon="priority_high"
              color="warning"
              hint={`${kpis.escalation_rate}% rate`}
            />
            <KpiCard
              label="Failed"
              value={kpis.failed}
              icon="error"
              color="error"
              hint="No-answer / abandoned"
            />
            <KpiCard
              label="Avg Talk"
              value={formatDuration(kpis.avg_talk_seconds)}
              icon="schedule"
              color="tertiary"
              hint={`Avg wait ${formatDuration(kpis.avg_wait_seconds)}`}
            />
            <KpiCard
              label="CSAT"
              value={kpis.avg_csat != null ? kpis.avg_csat.toFixed(2) : '—'}
              icon="sentiment_satisfied"
              color="success"
              hint={`${kpis.total_customers} customers · ${kpis.active_agents}/${kpis.total_agents} agents`}
            />
          </div>

          {/* Row: Trend + Donut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-navy font-headline">Call Volume Trend</h2>
                  <p className="text-xs text-on-surface-variant">
                    Daily totals with completed / escalated overlays
                  </p>
                </div>
                <span className="text-[10px] font-label uppercase tracking-wider text-outline bg-surface-container px-2 py-1 rounded">
                  {series.length} days
                </span>
              </div>
              <AreaLineChart data={series} />
            </div>

            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-navy font-headline">Status Mix</h2>
                <p className="text-xs text-on-surface-variant">
                  Breakdown across all call statuses
                </p>
              </div>
              <Donut data={data!.status_breakdown} total={kpis.total_calls} size={168} />
            </div>
          </div>

          {/* Row: Hourly + Queues + Flows */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-navy font-headline">Hourly Activity</h2>
                <p className="text-xs text-on-surface-variant">
                  Call volume by hour of day (UTC)
                </p>
              </div>
              <HourlyHeatmap hourly={data!.hourly} />
            </div>

            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-navy font-headline">Top Queues</h2>
                <p className="text-xs text-on-surface-variant">
                  Routed call volume per queue
                </p>
              </div>
              <HBarList
                rows={data!.top_queues}
                colorFn={(i) => ['#00317a', '#0046a8', '#0EA5E9', '#10B981', '#F59E0B', '#A78BFA'][i] || '#64748B'}
              />
            </div>

            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-navy font-headline">Flow Usage</h2>
                <p className="text-xs text-on-surface-variant">
                  Which compiled flows handle traffic
                </p>
              </div>
              <HBarList
                rows={data!.flow_breakdown}
                colorFn={(i) => ['#10B981', '#0046a8', '#A78BFA', '#F59E0B', '#0EA5E9', '#64748B'][i] || '#64748B'}
              />
            </div>
          </div>

          {/* Row: Agents table + Escalation reasons + Agent status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl bg-surface-container-lowest overflow-hidden shadow-ambient">
              <div className="px-6 py-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-navy font-headline">Top Agents</h2>
                  <p className="text-xs text-on-surface-variant">
                    Ranked by handled call volume
                  </p>
                </div>
                <span className="text-[10px] font-label uppercase tracking-wider text-outline bg-surface-container px-2 py-1 rounded">
                  {data!.top_agents.length} agents
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-container-low">
                      <th className="text-left font-bold text-[10px] text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                        #
                      </th>
                      <th className="text-left font-bold text-[10px] text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                        Agent
                      </th>
                      <th className="text-right font-bold text-[10px] text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                        Calls
                      </th>
                      <th className="text-right font-bold text-[10px] text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                        Avg Talk
                      </th>
                      <th className="text-left font-bold text-[10px] text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label pl-6">
                        Volume
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.top_agents.map((a, i) => {
                      const topCount = data!.top_agents[0]?.calls || 1
                      const pct = (a.calls / topCount) * 100
                      return (
                        <tr
                          key={a.label}
                          className={`${
                            i % 2 === 0
                              ? 'bg-surface-container-lowest'
                              : 'bg-surface-container-low/50'
                          } hover:bg-primary/5 transition-colors`}
                        >
                          <td className="px-6 py-3 text-outline font-label tabular-nums">
                            {i + 1}
                          </td>
                          <td className="px-6 py-3 text-on-surface font-medium">{a.label}</td>
                          <td className="px-6 py-3 text-right text-on-surface font-bold tabular-nums">
                            {a.calls}
                          </td>
                          <td className="px-6 py-3 text-right text-on-surface-variant font-label tabular-nums">
                            {formatDuration(a.avg_talk)}
                          </td>
                          <td className="px-6 py-3 pl-6 min-w-[140px]">
                            <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {data!.top_agents.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-outline font-label">
                          No agent activity yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-navy font-headline">Escalation Reasons</h2>
                  <p className="text-xs text-on-surface-variant">
                    Why calls were handed to humans
                  </p>
                </div>
                <HBarList
                  rows={data!.escalation_reasons}
                  colorFn={() => '#F59E0B'}
                />
              </div>

              <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-navy font-headline">Agent Status</h2>
                  <p className="text-xs text-on-surface-variant">
                    Live roster snapshot
                  </p>
                </div>
                <div className="space-y-2">
                  {data!.agent_status.map((s) => {
                    const palette: Record<string, string> = {
                      online: 'bg-success',
                      busy: 'bg-primary',
                      offline: 'bg-outline',
                      break: 'bg-warning',
                      after_call_work: 'bg-tertiary',
                    }
                    return (
                      <div
                        key={s.label}
                        className="flex items-center justify-between py-1.5 border-b border-surface-container last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${palette[s.label] || 'bg-outline'}`}
                          />
                          <span className="text-sm text-on-surface capitalize">
                            {s.label.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <span className="text-sm font-bold font-label tabular-nums text-on-surface">
                          {s.value}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Row: Disposition + Direction */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-navy font-headline">
                  Disposition Breakdown
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Final outcome of each call
                </p>
              </div>
              <HBarList rows={data!.disposition_breakdown} />
            </div>

            <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-navy font-headline">Direction</h2>
                <p className="text-xs text-on-surface-variant">
                  Inbound vs outbound mix
                </p>
              </div>
              <Donut
                data={data!.direction_breakdown}
                total={data!.direction_breakdown.reduce((s, x) => s + x.value, 0)}
                size={168}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
