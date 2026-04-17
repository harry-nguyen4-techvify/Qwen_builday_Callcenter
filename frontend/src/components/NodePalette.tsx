import type { NodeType } from '../types'
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
  GripVertical,
} from 'lucide-react'

interface PaletteItem {
  type: NodeType
  label: string
  color: string
  Icon: LucideIcon
}

interface PaletteGroup {
  name: string
  items: PaletteItem[]
}

const PALETTE_GROUPS: PaletteGroup[] = [
  {
    name: 'Flow Control',
    items: [
      { type: 'start',     label: 'Start',     color: '#10b981', Icon: Play },
      { type: 'condition', label: 'Condition', color: '#a855f7', Icon: GitBranch },
      { type: 'switch',    label: 'Switch',    color: '#6366f1', Icon: GitMerge },
      { type: 'goto',      label: 'Goto',      color: '#f59e0b', Icon: CornerDownRight },
      { type: 'end',       label: 'End',       color: '#f43f5e', Icon: Square },
    ],
  },
  {
    name: 'Conversation',
    items: [
      { type: 'greeting', label: 'Greeting', color: '#0ea5e9', Icon: MessageSquare },
      { type: 'collect',  label: 'Collect',  color: '#f97316', Icon: ClipboardList },
      { type: 'prompt',   label: 'Prompt',   color: '#3b82f6', Icon: MessageCircle },
      { type: 'confirm',  label: 'Confirm',  color: '#14b8a6', Icon: CheckSquare },
    ],
  },
  {
    name: 'Actions',
    items: [
      { type: 'set_field',  label: 'Set Field',  color: '#64748b', Icon: Settings },
      { type: 'fill_excel', label: 'Fill Excel', color: '#22c55e', Icon: FileSpreadsheet },
      { type: 'summary',    label: 'Summary',    color: '#8b5cf6', Icon: FileText },
      { type: 'escalate',   label: 'Escalate',   color: '#ef4444', Icon: AlertTriangle },
    ],
  },
]

interface Props {
  onDragStart: (type: NodeType) => void
}

export default function NodePalette({ onDragStart }: Props) {
  const handleDragStart = (e: React.DragEvent, type: NodeType) => {
    e.dataTransfer.setData('application/reactflow-type', type)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(type)
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      <div className="px-3 pt-4 pb-1">
        <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold">
          Nodes
        </p>
      </div>

      <div className="flex flex-col gap-3 px-2 pb-3">
        {PALETTE_GROUPS.map((group) => (
          <div key={group.name}>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium px-1 mb-1.5">
              {group.name}
            </p>
            <div className="grid grid-cols-2 gap-1">
              {group.items.map(({ type, label, color, Icon }) => (
                <div
                  key={type}
                  draggable
                  onDragStart={(e) => handleDragStart(e, type)}
                  className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing
                             bg-white border border-slate-200 hover:border-primary/50
                             hover:shadow-md hover:bg-white transition-all duration-150 select-none"
                  title={`Drag to add ${label} node`}
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${color}15` }}
                  >
                    <Icon size={11} style={{ color }} />
                  </div>
                  <span className="text-slate-700 text-[10px] font-medium truncate">{label}</span>
                  <GripVertical
                    size={10}
                    className="ml-auto text-transparent group-hover:text-slate-400 transition-colors flex-shrink-0"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
