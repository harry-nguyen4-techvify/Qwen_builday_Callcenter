import { useState, useCallback, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
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

import type { FlowModel, FlowNodeData, NodeType, DomainNode, FlowEdge } from '../types'
import FlowNode from '../nodes/FlowNode'
import NodePalette from '../components/NodePalette'
import FlowList from '../components/FlowList'
import NodeInspector from '../components/NodeInspector'
import GenerateModal from '../components/GenerateModal'
import { getFlow, saveFlow, refineFlow } from '../mock/api'
import {
  Plus,
  Save,
  Sparkles,
  RefreshCw,
  Loader2,
  ChevronRight,
  X,
  Check,
  Waves,
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
    fill: '#434652',
  },
  labelBgStyle: {
    fill: '#ffffff',
    fillOpacity: 0.9,
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

function FlowDesignerInner() {
  const { screenToFlowPosition } = useReactFlow()
  const [searchParams] = useSearchParams()

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

  // Auto-load from URL params
  useEffect(() => {
    const loadId = searchParams.get('load')
    if (loadId) {
      void loadFlow(loadId)
    }
    if (searchParams.get('generate') === 'true') {
      setShowGenModal(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load flow
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

  // Flow generated from modal
  const handleFlowGenerated = useCallback((flow: FlowModel) => {
    setCurrentFlow(flow)
    setFlowName(flow.name)
    const { nodes: rfNodes, edges: rfEdges } = domainToRF(flow)
    setNodes(rfNodes)
    setEdges(rfEdges)
    setSelectedNode(null)
    setRefreshFlowList((n) => n + 1)
  }, [setNodes, setEdges])

  // Save
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
      const resp = saved as unknown as Record<string, unknown>
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

  // New
  const handleNew = () => {
    if (nodes.length > 0 && !confirm('Discard current flow and start fresh?')) return
    setNodes([])
    setEdges([])
    setCurrentFlow(null)
    setFlowName('Untitled Flow')
    setSelectedNode(null)
  }

  // Refine
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

  // Edge connect
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

  // Drag & drop
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

  // Node selection
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setSelectedNode(node as Node<FlowNodeData>)
    },
    []
  )

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // Inspector update
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

  const inspectorWidth = selectedNode ? 280 : 0

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-surface-container-low">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-5 py-3 bg-white border-b border-outline-variant/15 z-20 flex-shrink-0 shadow-sm">
        {/* Flow name input */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Waves size={16} className="text-primary" />
          </div>
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="bg-transparent border-none text-on-surface text-base font-semibold
                       focus:outline-none w-56 placeholder:text-outline"
            placeholder="Untitled Flow"
          />
        </div>

        <div className="h-6 w-px bg-outline-variant/20" />

        {/* Primary actions group */}
        <div className="flex items-center gap-1.5 bg-surface-container-low rounded-xl p-1">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       hover:bg-white text-on-surface-variant hover:text-on-surface transition-all"
          >
            <Plus size={14} /> New
          </button>

          <button
            onClick={() => void handleSave()}
            disabled={saving || nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       hover:bg-white text-on-surface-variant hover:text-on-surface transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saveMsg || 'Save'}
          </button>
        </div>

        {/* AI actions group */}
        <div className="flex items-center gap-1.5 bg-success/5 rounded-xl p-1 border border-success/10">
          <button
            onClick={() => setShowGenModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-success/10 hover:bg-success/20 text-success transition-all"
          >
            <Sparkles size={14} /> Generate
          </button>

          <button
            onClick={() => setShowRefine(!showRefine)}
            disabled={!currentFlow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                       hover:bg-success/10 text-success/80 hover:text-success transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} /> Refine
          </button>
        </div>

        {/* Refine input */}
        {showRefine && (
          <div className="flex items-center gap-2 flex-1 ml-2">
            <input
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRefine() }}
              placeholder="Describe changes to the flow..."
              className="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-1.5
                         text-xs text-on-surface focus:outline-none focus:border-success focus:ring-1 focus:ring-success/20
                         transition-all min-w-0"
              autoFocus
            />
            <button
              onClick={() => void handleRefine()}
              disabled={refineLoading || !refineText.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success
                         hover:bg-success/90 text-white text-xs font-medium transition-all
                         disabled:opacity-50"
            >
              {refineLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Apply
            </button>
            <button
              onClick={() => { setShowRefine(false); setRefineText('') }}
              className="text-outline hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container transition-all"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {loadingFlow && (
          <div className="flex items-center gap-2 text-primary text-xs ml-auto bg-primary/5 px-3 py-1.5 rounded-lg">
            <Loader2 size={14} className="animate-spin" /> Loading...
          </div>
        )}
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node palette + flow list */}
        <aside
          className="flex flex-col bg-slate-50 border-r border-slate-200 flex-shrink-0 shadow-md"
          style={{ width: 220 }}
        >
          <NodePalette onDragStart={(type) => { dragTypeRef.current = type }} />
          <div className="h-px bg-slate-200 mx-2" />
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <FlowList
              onSelect={(id) => void loadFlow(id)}
              currentFlowId={currentFlow?.flow_id}
              refreshTrigger={refreshFlowList}
            />
          </div>
        </aside>

        {/* Canvas */}
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
            style={{ background: '#f8fafc' }}
          >
            {/* Primary grid - small squares */}
            <Background
              variant={BackgroundVariant.Lines}
              gap={20}
              color="#e2e8f0"
              lineWidth={1}
            />
            {/* Secondary grid - large squares */}
            <Background
              id="bg-large"
              variant={BackgroundVariant.Lines}
              gap={100}
              color="#cbd5e1"
              lineWidth={1}
            />
            <Controls className="!rounded-xl !border-outline-variant/20 !shadow-lg" />
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
              style={{ background: '#1e293b', borderRadius: 12 }}
              maskColor="rgba(30,41,59,0.6)"
              nodeStrokeWidth={3}
              className="!border-2 !border-slate-600 !shadow-xl"
            />
          </ReactFlow>

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-4 max-w-sm">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-success/10 flex items-center justify-center mx-auto">
                  <Waves size={36} className="text-primary/60" />
                </div>
                <div>
                  <p className="text-on-surface text-lg font-semibold mb-1">Design Your Flow</p>
                  <p className="text-on-surface-variant text-sm leading-relaxed">
                    Click <span className="text-success font-semibold bg-success/10 px-1.5 py-0.5 rounded">Generate</span> to create from Excel,
                    or drag nodes from the palette.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-outline text-xs justify-center bg-surface-container px-4 py-2 rounded-full mx-auto w-fit">
                  <ChevronRight size={12} />
                  <span>Or select a saved flow from the library</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        {selectedNode && (
          <div className="flex-shrink-0 overflow-hidden" style={{ width: inspectorWidth }}>
            <NodeInspector
              node={selectedNode}
              onUpdate={handleNodeUpdate}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>

      {/* Generate Modal */}
      {showGenModal && (
        <GenerateModal
          onClose={() => setShowGenModal(false)}
          onFlowGenerated={handleFlowGenerated}
        />
      )}
    </div>
  )
}

// Wrap with ReactFlowProvider
export default function FlowDesigner() {
  return (
    <ReactFlowProvider>
      <FlowDesignerInner />
    </ReactFlowProvider>
  )
}
