import { useState, useCallback, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Connection,
  Node,
  Edge,
  NodeTypes,
  DefaultEdgeOptions,
} from '@xyflow/react'

import type { FlowModel, FlowNodeData, NodeType, DomainNode, FlowEdge } from './types'
import FlowNode from './nodes/FlowNode'
import NodePalette from './components/NodePalette'
import FlowList from './components/FlowList'
import NodeInspector from './components/NodeInspector'
import GenerateModal from './components/GenerateModal'
import { getFlow, saveFlow, refineFlow } from './api'
import {
  Waves,
  Plus,
  Save,
  Sparkles,
  RefreshCw,
  Loader2,
  ChevronRight,
  X,
  Check,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// ReactFlow node types registry
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  flowNode: FlowNode as unknown as NodeTypes[string],
}

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'smoothstep',
  style: { strokeWidth: 2 },
  labelStyle: {
    fontSize: 10,
    fontFamily: 'monospace',
    fill: '#94a3b8',
  },
  labelBgStyle: {
    fill: '#0f172a',
    fillOpacity: 0.85,
  },
  labelBgPadding: [4, 3] as [number, number],
  labelBgBorderRadius: 3,
}

// ---------------------------------------------------------------------------
// Edge color helper
// ---------------------------------------------------------------------------

function getEdgeColor(output: string): string {
  if (['next', 'collected', 'yes', 'confirmed', 'done'].includes(output)) return '#22c55e'
  if (output === 'retry') return '#f59e0b'
  if (['escalate', 'no', 'rejected', 'error'].includes(output)) return '#ef4444'
  return '#64748b'
}

// ---------------------------------------------------------------------------
// Domain <-> ReactFlow converters
// ---------------------------------------------------------------------------

function domainToRF(flow: FlowModel): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = flow.nodes.map((n: DomainNode) => ({
    id: n.id,
    type: 'flowNode',
    position: n.position,
    data: {
      type: n.type,
      name: n.name,
      prompt: n.prompt,
      outputs: n.outputs,
      config: n.config,
    },
  }))

  const edges: Edge[] = flow.edges.map((e: FlowEdge) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.output,
    label: e.output,
    animated: e.output === 'retry',
    style: { stroke: getEdgeColor(e.output), strokeWidth: 2 },
  }))

  return { nodes, edges }
}

function rfToDomain(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  existingFlow: FlowModel
): FlowModel {
  const domainNodes: DomainNode[] = nodes.map((n) => ({
    id: n.id,
    type: (n.data.type ?? 'prompt') as NodeType,
    name: (n.data.name ?? '') as string,
    position: n.position,
    prompt: (n.data.prompt ?? '') as string,
    outputs: (n.data.outputs ?? []) as string[],
    config: (n.data.config ?? {}) as Record<string, unknown>,
  }))

  const domainEdges: FlowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    output: (e.sourceHandle ?? '') as string,
  }))

  return {
    ...existingFlow,
    nodes: domainNodes,
    edges: domainEdges,
  }
}

// ---------------------------------------------------------------------------
// New node defaults
// ---------------------------------------------------------------------------

function getDefaultOutputs(type: NodeType): string[] {
  const map: Record<NodeType, string[]> = {
    start:      ['next'],
    greeting:   ['next'],
    collect:    ['collected', 'retry', 'escalate'],
    condition:  ['yes', 'no'],
    switch:     ['case1', 'default'],
    escalate:   ['next'],
    summary:    ['next'],
    confirm:    ['confirmed', 'rejected'],
    fill_excel: ['done', 'error'],
    prompt:     ['next'],
    set_field:  ['next'],
    goto:       [],
    end:        [],
  }
  return map[type] ?? ['next']
}

function getDefaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'start':      return { flow_name: '', language: 'en' }
    case 'collect':    return { field_id: 'field_id', field_type: 'text', cell: '', validation: {}, retry_limit: 3 }
    case 'condition':  return { field_id: '', operator: 'eq', value: null, prompt_eval: false }
    case 'switch':     return { field_id: '', cases: [], default_output: 'default' }
    case 'escalate':   return { reason_template: '', notify_log: true }
    case 'confirm':    return { summary_fields: [], confirm_port: 'confirmed', reject_port: 'rejected' }
    case 'fill_excel': return { template_path: '', output_path: '' }
    case 'set_field':  return { field_id: '', value_expr: '' }
    case 'goto':       return { target_node_id: '' }
    default:           return {}
  }
}

// ---------------------------------------------------------------------------
// Inner app (has access to useReactFlow)
// ---------------------------------------------------------------------------

let _nodeIdCounter = 1

function AppInner() {
  const { screenToFlowPosition } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [currentFlow, setCurrentFlow] = useState<FlowModel | null>(null)
  const [flowName, setFlowName] = useState('Untitled Flow')

  const [selectedNode, setSelectedNode] = useState<Node<FlowNodeData> | null>(null)
  const [showGenModal, setShowGenModal] = useState(false)
  const [showRefine, setShowRefine] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [refineLoading, setRefineLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [loadingFlow, setLoadingFlow] = useState(false)
  const [refreshFlowList, setRefreshFlowList] = useState(0)

  const dragTypeRef = useRef<NodeType | null>(null)

  // ---------------------------------------------------------------------------
  // Load flow from list
  // ---------------------------------------------------------------------------

  const loadFlow = useCallback(async (flowId: string) => {
    setLoadingFlow(true)
    try {
      const flow = await getFlow(flowId)
      setCurrentFlow(flow)
      setFlowName(flow.name)
      const { nodes: rfNodes, edges: rfEdges } = domainToRF(flow)
      setNodes(rfNodes)
      setEdges(rfEdges)
      setSelectedNode(null)
    } catch {
      alert(`Failed to load flow "${flowId}"`)
    } finally {
      setLoadingFlow(false)
    }
  }, [setNodes, setEdges])

  // ---------------------------------------------------------------------------
  // Flow generated from modal
  // ---------------------------------------------------------------------------

  const handleFlowGenerated = useCallback((flow: FlowModel) => {
    setCurrentFlow(flow)
    setFlowName(flow.name)
    const { nodes: rfNodes, edges: rfEdges } = domainToRF(flow)
    setNodes(rfNodes)
    setEdges(rfEdges)
    setSelectedNode(null)
    setRefreshFlowList((n) => n + 1)
  }, [setNodes, setEdges])

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (nodes.length === 0) {
      alert('Nothing to save. Add some nodes first.')
      return
    }
    setSaving(true)
    setSaveMsg('Saving & Compiling...')
    try {
      const base: FlowModel = currentFlow ?? {
        flow_id: flowName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'untitled_flow',
        name: flowName || 'Untitled Flow',
        nodes: [],
        edges: [],
        cell_mapping: {},
        settings: { language: 'en', max_retries: 3, tts_voice: '' },
        created_at: new Date().toISOString(),
        version: 1,
      }
      const updated = rfToDomain(nodes, edges, { ...base, name: flowName })
      const saved = await saveFlow(updated)
      setCurrentFlow(saved)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = saved as any
      if (resp._compiled) {
        setSaveMsg('Saved & Compiled!')
      } else if (resp._compile_error) {
        setSaveMsg('Saved (compile failed)')
      } else {
        setSaveMsg('Saved!')
      }
      setRefreshFlowList((n) => n + 1)
      setTimeout(() => setSaveMsg(''), 3000)
    } catch {
      setSaveMsg('Save failed!')
      setTimeout(() => setSaveMsg(''), 3000)
    } finally {
      setSaving(false)
    }
  }, [currentFlow, nodes, edges, flowName])

  // ---------------------------------------------------------------------------
  // New (clear canvas)
  // ---------------------------------------------------------------------------

  const handleNew = () => {
    if (nodes.length > 0 && !confirm('Discard current flow and start fresh?')) return
    setNodes([])
    setEdges([])
    setCurrentFlow(null)
    setFlowName('Untitled Flow')
    setSelectedNode(null)
  }

  // ---------------------------------------------------------------------------
  // Refine
  // ---------------------------------------------------------------------------

  const handleRefine = async () => {
    if (!currentFlow) { alert('No flow loaded.'); return }
    if (!refineText.trim()) { alert('Please enter feedback.'); return }
    setRefineLoading(true)
    try {
      const flow = await refineFlow(currentFlow.flow_id, refineText)
      handleFlowGenerated(flow)
      setRefineText('')
      setShowRefine(false)
    } catch {
      alert('Refine failed. Check backend logs.')
    } finally {
      setRefineLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Edge connect
  // ---------------------------------------------------------------------------

  const onConnect = useCallback(
    (connection: Connection) => {
      const output = connection.sourceHandle ?? 'next'
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.sourceHandle ?? 'next'}-${connection.target}`,
            label: output,
            animated: output === 'retry',
            style: { stroke: getEdgeColor(output), strokeWidth: 2 },
          } as Edge,
          eds
        )
      )
    },
    [setEdges]
  )

  // ---------------------------------------------------------------------------
  // Drag & drop from palette
  // ---------------------------------------------------------------------------

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const nodeType = (
        e.dataTransfer.getData('application/reactflow-type') || dragTypeRef.current
      ) as NodeType | null
      if (!nodeType) return

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = `node_${nodeType}_${_nodeIdCounter++}`
      const outputs = getDefaultOutputs(nodeType)
      const newNode: Node<FlowNodeData> = {
        id,
        type: 'flowNode',
        position,
        data: {
          type: nodeType,
          name: nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace('_', ' '),
          prompt: '',
          outputs,
          config: getDefaultConfig(nodeType),
        },
      }
      setNodes((prev) => [...prev, newNode])
    },
    [screenToFlowPosition, setNodes]
  )

  // ---------------------------------------------------------------------------
  // Node selection
  // ---------------------------------------------------------------------------

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setSelectedNode(node as Node<FlowNodeData>)
    },
    []
  )

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Inspector update
  // ---------------------------------------------------------------------------

  const handleNodeUpdate = useCallback(
    (nodeId: string, data: Partial<FlowNodeData>) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } as FlowNodeData } : n
        )
      )
      setSelectedNode((prev) =>
        prev && prev.id === nodeId
          ? { ...prev, data: { ...prev.data, ...data } as FlowNodeData }
          : prev
      )
    },
    [setNodes]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const inspectorWidth = selectedNode ? 280 : 0

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      {/* ===== TOOLBAR ===== */}
      <header className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border-b border-slate-700 z-20 flex-shrink-0">
        <Waves size={22} className="text-sky-400 flex-shrink-0" />

        <input
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5
                     text-slate-200 text-sm font-medium focus:outline-none focus:border-sky-500
                     w-48 transition-colors"
          placeholder="Flow name"
        />

        <div className="h-5 w-px bg-slate-700" />

        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                     bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300
                     transition-colors"
        >
          <Plus size={14} />
          New
        </button>

        <button
          onClick={() => void handleSave()}
          disabled={saving || nodes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                     bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saveMsg || 'Save'}
        </button>

        <button
          onClick={() => setShowGenModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold
                     bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
        >
          <Sparkles size={14} />
          Generate
        </button>

        <button
          onClick={() => setShowRefine(!showRefine)}
          disabled={!currentFlow}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                     bg-violet-800 hover:bg-violet-700 text-white transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={14} />
          Refine
        </button>

        {/* Inline refine input */}
        {showRefine && (
          <div className="flex items-center gap-2 ml-2 flex-1">
            <input
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRefine() }}
              placeholder="Describe changes to the flow..."
              className="flex-1 bg-slate-800 border border-slate-600 rounded-md px-3 py-1.5
                         text-sm text-slate-200 focus:outline-none focus:border-violet-500
                         transition-colors min-w-0"
              autoFocus
            />
            <button
              onClick={() => void handleRefine()}
              disabled={refineLoading || !refineText.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600
                         hover:bg-violet-500 text-white text-sm transition-colors
                         disabled:opacity-50"
            >
              {refineLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Apply
            </button>
            <button
              onClick={() => { setShowRefine(false); setRefineText('') }}
              className="text-slate-500 hover:text-slate-300 p-1 rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {loadingFlow && (
          <div className="flex items-center gap-2 text-sky-400 text-sm ml-auto">
            <Loader2 size={14} className="animate-spin" />
            Loading...
          </div>
        )}
      </header>

      {/* ===== MAIN LAYOUT ===== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ===== LEFT SIDEBAR ===== */}
        <aside
          className="flex flex-col bg-slate-900 border-r border-slate-700 flex-shrink-0"
          style={{ width: 180 }}
        >
          <NodePalette onDragStart={(type) => { dragTypeRef.current = type }} />
          <div className="border-t border-slate-700 flex-shrink-0" />
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <FlowList
              onSelect={(id) => void loadFlow(id)}
              currentFlowId={currentFlow?.flow_id}
              refreshTrigger={refreshFlowList}
            />
          </div>
        </aside>

        {/* ===== CANVAS ===== */}
        <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            style={{ background: '#020617' }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#1e293b"
            />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const colorMap: Record<string, string> = {
                  start: '#10b981', greeting: '#0ea5e9', collect: '#f97316',
                  condition: '#a855f7', switch: '#6366f1', escalate: '#ef4444',
                  summary: '#8b5cf6', confirm: '#14b8a6', fill_excel: '#22c55e',
                  prompt: '#3b82f6', set_field: '#64748b', goto: '#f59e0b', end: '#f43f5e',
                }
                return colorMap[(n.data as FlowNodeData).type as string] ?? '#64748b'
              }}
              style={{ background: '#0f172a' }}
              maskColor="rgba(2,6,23,0.7)"
            />
          </ReactFlow>

          {/* Empty state overlay */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-3">
                <Waves size={48} className="text-slate-700 mx-auto" />
                <p className="text-slate-600 text-lg font-medium">No flow loaded</p>
                <p className="text-slate-700 text-sm max-w-xs">
                  Click <span className="text-emerald-500 font-semibold">Generate</span> to create a flow from an Excel form,
                  or drag nodes from the palette to build manually.
                </p>
                <div className="flex items-center gap-1 text-slate-700 text-xs justify-center">
                  <ChevronRight size={12} />
                  You can also load a saved flow from the left panel
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== RIGHT INSPECTOR ===== */}
        {selectedNode && (
          <div
            className="flex-shrink-0 overflow-hidden"
            style={{ width: inspectorWidth }}
          >
            <NodeInspector
              node={selectedNode}
              onUpdate={handleNodeUpdate}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>

      {/* ===== GENERATE MODAL ===== */}
      {showGenModal && (
        <GenerateModal
          onClose={() => setShowGenModal(false)}
          onFlowGenerated={handleFlowGenerated}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root — wraps with ReactFlowProvider
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  )
}
