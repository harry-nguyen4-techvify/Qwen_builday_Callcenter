import { memo, CSSProperties } from 'react'
import { Handle, Position, NodeProps, Node } from '@xyflow/react'
import type { FlowNodeData, NodeType } from '../types'
import type { LucideIcon } from 'lucide-react'
import {
  Play,
  MessageSquare,
  ClipboardList,
  GitBranch,
  GitMerge,
  AlertTriangle,
  FileText,
  CheckSquare,
  FileSpreadsheet,
  MessageCircle,
  Settings,
  CornerDownRight,
  Square,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Color scheme per node type
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<NodeType, { border: string; bg: string; badge: string }> = {
  start:      { border: '#10b981', bg: 'rgba(16,185,129,0.08)',   badge: 'bg-emerald-500' },
  greeting:   { border: '#0ea5e9', bg: 'rgba(14,165,233,0.08)',   badge: 'bg-sky-500' },
  collect:    { border: '#f97316', bg: 'rgba(249,115,22,0.08)',   badge: 'bg-orange-500' },
  condition:  { border: '#a855f7', bg: 'rgba(168,85,247,0.08)',   badge: 'bg-purple-500' },
  switch:     { border: '#6366f1', bg: 'rgba(99,102,241,0.08)',   badge: 'bg-indigo-500' },
  escalate:   { border: '#ef4444', bg: 'rgba(239,68,68,0.08)',    badge: 'bg-red-500' },
  summary:    { border: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',   badge: 'bg-violet-500' },
  confirm:    { border: '#14b8a6', bg: 'rgba(20,184,166,0.08)',   badge: 'bg-teal-500' },
  fill_excel: { border: '#22c55e', bg: 'rgba(34,197,94,0.08)',    badge: 'bg-green-500' },
  prompt:     { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)',   badge: 'bg-blue-500' },
  set_field:  { border: '#64748b', bg: 'rgba(100,116,139,0.08)',  badge: 'bg-slate-500' },
  goto:       { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)',   badge: 'bg-amber-500' },
  end:        { border: '#f43f5e', bg: 'rgba(244,63,94,0.08)',    badge: 'bg-rose-500' },
}

// ---------------------------------------------------------------------------
// Output port colors
// ---------------------------------------------------------------------------

function getPortColor(port: string): string {
  if (['next', 'collected', 'yes', 'confirmed', 'done'].includes(port)) return '#22c55e'
  if (port === 'retry') return '#f59e0b'
  if (['escalate', 'no', 'rejected', 'error'].includes(port)) return '#ef4444'
  return '#64748b'
}

// ---------------------------------------------------------------------------
// Node icon per type
// ---------------------------------------------------------------------------

const NODE_ICONS: Record<NodeType, LucideIcon> = {
  start:      Play,
  greeting:   MessageSquare,
  collect:    ClipboardList,
  condition:  GitBranch,
  switch:     GitMerge,
  escalate:   AlertTriangle,
  summary:    FileText,
  confirm:    CheckSquare,
  fill_excel: FileSpreadsheet,
  prompt:     MessageCircle,
  set_field:  Settings,
  goto:       CornerDownRight,
  end:        Square,
}

// ---------------------------------------------------------------------------
// FlowNode component
// ---------------------------------------------------------------------------

function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const nodeType = data.type as NodeType
  const colors = NODE_COLORS[nodeType] ?? NODE_COLORS.prompt
  const Icon = NODE_ICONS[nodeType] ?? MessageCircle
  const outputs = data.outputs as string[]
  const hasTarget = nodeType !== 'start'

  const containerStyle: CSSProperties = {
    background: colors.bg,
    border: `1.5px solid ${selected ? '#00317a' : colors.border}`,
    borderRadius: '10px',
    minWidth: '180px',
    maxWidth: '220px',
    fontFamily: 'inherit',
    boxShadow: selected
      ? `0 0 0 2px ${colors.border}, 0 4px 20px rgba(0,0,0,0.1)`
      : '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
  }

  // Evenly space source handles
  const portCount = outputs.length
  const portSpacing = portCount > 1 ? 100 / (portCount + 1) : 50

  return (
    <div style={containerStyle}>
      {/* Target handle (top) — all nodes except start */}
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: '#737784',
            border: '2px solid #ffffff',
            width: 10,
            height: 10,
            top: -5,
          }}
        />
      )}

      {/* Node header */}
      <div
        style={{
          padding: '8px 10px 6px',
          borderBottom: `1px solid ${colors.border}30`,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon size={14} style={{ color: colors.border, flexShrink: 0 }} />
        <span
          style={{
            color: '#1c1b1b',
            fontSize: 13,
            fontWeight: 600,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={data.name as string}
        >
          {data.name as string}
        </span>
        <span
          className={`${colors.badge} text-white`}
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            flexShrink: 0,
          }}
        >
          {nodeType.replace('_', ' ')}
        </span>
      </div>

      {/* Prompt preview */}
      {data.prompt && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: 11,
            color: '#434652',
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
          title={data.prompt as string}
        >
          {data.prompt as string}
        </div>
      )}

      {/* field_id badge for collect nodes */}
      {nodeType === 'collect' && data.config && (data.config as { field_id?: string }).field_id && (
        <div style={{ padding: '0 10px 8px' }}>
          <span
            style={{
              background: 'rgba(249,115,22,0.2)',
              border: '1px solid rgba(249,115,22,0.4)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 10,
              color: '#fb923c',
              fontFamily: 'monospace',
            }}
          >
            {(data.config as { field_id: string }).field_id}
          </span>
        </div>
      )}

      {/* Spacer for source handles */}
      {portCount > 0 && <div style={{ height: 16 }} />}

      {/* Source handles (bottom) */}
      {outputs.map((port, idx) => {
        const leftPct = portCount === 1 ? 50 : portSpacing * (idx + 1)
        const portColor = getPortColor(port)
        return (
          <Handle
            key={port}
            type="source"
            position={Position.Bottom}
            id={port}
            style={{
              background: portColor,
              border: '2px solid #ffffff',
              width: 10,
              height: 10,
              bottom: -5,
              left: `${leftPct}%`,
              transform: 'translateX(-50%)',
            }}
          >
            {/* Port label */}
            <span
              style={{
                position: 'absolute',
                bottom: -18,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 9,
                color: portColor,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {port}
            </span>
          </Handle>
        )
      })}

      {/* Bottom padding for port labels */}
      {portCount > 0 && <div style={{ height: 12 }} />}
    </div>
  )
}

export default memo(FlowNode)
