import { useEffect, useState, useCallback } from 'react'
import { listFlows, deleteFlow } from '../api'
import { RefreshCw, Trash2, FileJson, FolderOpen } from 'lucide-react'

interface Props {
  onSelect: (flowId: string) => void
  currentFlowId?: string
  refreshTrigger: number
}

export default function FlowList({ onSelect, currentFlowId, refreshTrigger }: Props) {
  const [flows, setFlows] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const ids = await listFlows()
      setFlows(ids)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshTrigger])

  const handleDelete = async (e: React.MouseEvent, flowId: string) => {
    e.stopPropagation()
    if (!confirm(`Delete flow "${flowId}"?`)) return
    try {
      await deleteFlow(flowId)
      setFlows((prev) => prev.filter((id) => id !== flowId))
    } catch {
      alert('Failed to delete flow.')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-3 pt-4 pb-1">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold">
          Library
        </p>
        <button
          onClick={() => void load()}
          className="text-slate-400 hover:text-primary transition-colors p-1 rounded-md hover:bg-primary/10"
          title="Refresh flow list"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {flows.length === 0 && !loading && (
        <div className="px-3 py-6 text-center">
          <FolderOpen size={24} className="text-slate-400 mx-auto mb-2" />
          <p className="text-slate-500 text-[10px]">No flows yet</p>
        </div>
      )}

      <div className="flex flex-col gap-1 px-2 pb-3">
        {flows.map((flowId) => {
          const isActive = currentFlowId === flowId
          return (
            <div
              key={flowId}
              onClick={() => onSelect(flowId)}
              className={`
                group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer
                transition-all duration-150 border
                ${
                  isActive
                    ? 'bg-primary/15 border-primary/40 shadow-md'
                    : 'bg-white border-slate-200 hover:border-primary/40 hover:shadow-md'
                }
              `}
            >
              <div
                className={`
                  w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0
                  ${isActive ? 'bg-primary/20' : 'bg-slate-100'}
                `}
              >
                <FileJson size={12} className={isActive ? 'text-primary' : 'text-outline'} />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-[11px] font-medium truncate ${
                    isActive ? 'text-primary' : 'text-on-surface'
                  }`}
                  title={flowId}
                >
                  {flowId.replace(/_/g, ' ')}
                </p>
                <p className="text-[9px] text-slate-400 font-mono truncate">{flowId}</p>
              </div>
              <button
                onClick={(e) => void handleDelete(e, flowId)}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500
                           transition-all duration-150 p-1 rounded-md hover:bg-red-50"
                title="Delete flow"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
