import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { listFlows, getFlow } from '../mock/api'

interface FlowSummary {
  flow_id: string
  name: string
  nodeCount: number
  status: 'compiled' | 'draft' | 'error'
  lastModified: string
}

const STATUS_STYLES: Record<string, string> = {
  compiled: 'bg-success/15 text-success',
  draft: 'bg-outline/15 text-outline',
  error: 'bg-error/15 text-error',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, compiled: 0, active: 1, templates: 3 })

  useEffect(() => {
    async function load() {
      try {
        const ids = await listFlows()
        const loaded: FlowSummary[] = []
        let compiledCount = 0

        for (const id of ids) {
          try {
            const flow = await getFlow(id)
            const hasNodes = flow.nodes.length > 2
            const status: FlowSummary['status'] = hasNodes ? 'compiled' : 'draft'
            if (status === 'compiled') compiledCount++
            loaded.push({
              flow_id: flow.flow_id,
              name: flow.name,
              nodeCount: flow.nodes.length,
              status,
              lastModified: flow.created_at,
            })
          } catch {
            loaded.push({ flow_id: id, name: id, nodeCount: 0, status: 'error', lastModified: '' })
          }
        }

        setFlows(loaded)
        setStats({ total: ids.length, compiled: compiledCount, active: 1, templates: 3 })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const STAT_CARDS = [
    { label: 'Active Calls', value: stats.active, icon: 'phone_in_talk', color: 'primary' },
    { label: 'Total Flows', value: stats.total, icon: 'account_tree', color: 'tertiary' },
    { label: 'Compiled', value: stats.compiled, icon: 'check_circle', color: 'success' },
    { label: 'Templates', value: stats.templates, icon: 'description', color: 'warning' },
  ]

  const COLOR_MAP: Record<string, { bg: string; icon: string; text: string }> = {
    primary: { bg: 'bg-primary/10', icon: 'text-primary', text: 'text-primary' },
    tertiary: { bg: 'bg-tertiary/10', icon: 'text-tertiary', text: 'text-tertiary' },
    success: { bg: 'bg-success/10', icon: 'text-success', text: 'text-success' },
    warning: { bg: 'bg-warning/10', icon: 'text-warning', text: 'text-warning' },
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-navy tracking-tight font-headline">Dashboard</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          AI Call Center — Overview &amp; Quick Access
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-6">
        {STAT_CARDS.map((card) => {
          const c = COLOR_MAP[card.color]
          return (
            <div
              key={card.label}
              className="rounded-xl bg-surface-container-lowest p-6 flex items-center gap-4 shadow-ambient"
            >
              <div className={`w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center`}>
                <Icon name={card.icon} className={c.icon} />
              </div>
              <div>
                <div className={`text-3xl font-bold font-headline ${c.text}`}>
                  {loading ? (
                    <Icon name="progress_activity" className="animate-spin text-outline" size={20} />
                  ) : (
                    card.value
                  )}
                </div>
                <div className="text-xs text-on-surface-variant font-medium">{card.label}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Recent Flows table */}
      <div className="rounded-xl bg-surface-container-lowest overflow-hidden shadow-ambient">
        <div className="px-6 py-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy font-headline">Recent Flows</h2>
          <button
            onClick={() => navigate('/flows')}
            className="text-xs text-primary font-bold hover:underline flex items-center gap-1 transition-colors"
          >
            View all <Icon name="arrow_forward" size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Icon name="progress_activity" className="animate-spin text-outline" size={24} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="text-left font-bold text-xs text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                    Flow Name
                  </th>
                  <th className="text-left font-bold text-xs text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                    Status
                  </th>
                  <th className="text-left font-bold text-xs text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                    Nodes
                  </th>
                  <th className="text-left font-bold text-xs text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                    Last Modified
                  </th>
                  <th className="text-right font-bold text-xs text-on-surface-variant uppercase tracking-wider px-6 py-3 font-label">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {flows.map((flow, i) => (
                  <tr
                    key={flow.flow_id}
                    className={`${
                      i % 2 === 0 ? 'bg-surface-container-low/50' : 'bg-surface-container-lowest'
                    } hover:bg-primary/5 transition-colors`}
                  >
                    <td className="px-6 py-4 text-on-surface font-medium">{flow.name}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex px-3 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[flow.status]}`}
                      >
                        {flow.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-on-surface-variant font-label">{flow.nodeCount}</td>
                    <td className="px-6 py-4 text-on-surface-variant text-xs font-label">
                      {flow.lastModified
                        ? new Date(flow.lastModified).toLocaleDateString('vi-VN')
                        : '—'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/flows?load=${flow.flow_id}`)}
                        className="text-xs text-primary font-bold mr-4 hover:underline transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => navigate(`/voice-test?flow=${flow.flow_id}`)}
                        className="text-xs text-success font-bold hover:underline transition-colors"
                      >
                        Run
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
          <h2 className="text-lg font-bold text-navy mb-4 font-headline">Quick Actions</h2>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/calls')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-semibold transition-colors"
            >
              <Icon name="phone_in_talk" size={18} /> Open Live Call Console
            </button>
            <button
              onClick={() => navigate('/flows?generate=true')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-success/10 hover:bg-success/20 text-success text-sm font-semibold transition-colors"
            >
              <Icon name="auto_awesome" size={18} /> Generate New Flow
            </button>
            <button
              onClick={() => navigate('/voice-test')}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-tertiary/10 hover:bg-tertiary/20 text-tertiary text-sm font-semibold transition-colors"
            >
              <Icon name="play_arrow" size={18} /> Run Voice Test
            </button>
          </div>
        </div>

        {/* System Status */}
        <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
          <h2 className="text-lg font-bold text-navy mb-4 font-headline">System Status</h2>
          <div className="space-y-4">
            {[
              { label: 'FastAPI Backend', status: 'connected', ok: true },
              { label: 'Flow Compiler', status: 'ready', ok: true },
              { label: 'Voice Engine', status: 'warming up', ok: false },
              { label: 'Excel Filler', status: 'ready', ok: true },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-on-surface">{item.label}</span>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      item.ok ? 'bg-success' : 'bg-warning'
                    }`}
                  />
                  <span
                    className={`text-xs font-bold font-label ${
                      item.ok ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
