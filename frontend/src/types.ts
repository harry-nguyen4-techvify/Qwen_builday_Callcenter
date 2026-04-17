// ---------------------------------------------------------------------------
// Domain types matching the Python FlowModel / nodes
// ---------------------------------------------------------------------------

export type NodeType =
  | 'start'
  | 'greeting'
  | 'collect'
  | 'condition'
  | 'switch'
  | 'escalate'
  | 'summary'
  | 'confirm'
  | 'fill_excel'
  | 'prompt'
  | 'set_field'
  | 'goto'
  | 'end'

export interface FlowSettings {
  language: string
  max_retries: number
  tts_voice: string
}

export interface NodePosition {
  x: number
  y: number
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  output: string
}

// Config shapes per node type
export interface StartConfig {
  flow_name: string
  language: string
}

export interface CollectConfig {
  field_id: string
  field_type: string
  cell: string
  validation: Record<string, unknown>
  retry_limit: number
  options?: string[]
  required?: boolean
}

export interface ConditionConfig {
  field_id: string
  operator: string
  value: string | null
  prompt_eval: boolean
  prompt_eval_question?: string
}

export interface SwitchCase {
  match: string
  output_port: string
}

export interface SwitchConfig {
  field_id: string
  cases: SwitchCase[]
  default_output: string
}

export interface EscalateConfig {
  reason_template: string
  notify_log: boolean
}

export interface ConfirmConfig {
  summary_fields: string[]
  confirm_port: string
  reject_port: string
}

export interface FillExcelConfig {
  template_path: string
  output_path: string
}

export interface SetFieldConfig {
  field_id: string
  value_expr: string
}

export interface GotoConfig {
  target_node_id: string
}

// Generic node data stored in ReactFlow node.data
export interface FlowNodeData {
  type: NodeType
  name: string
  prompt: string
  outputs: string[]
  config: Record<string, unknown>
  [key: string]: unknown
}

// Full Python domain node
export interface DomainNode {
  id: string
  type: NodeType
  name: string
  position: NodePosition
  prompt: string
  outputs: string[]
  config: Record<string, unknown>
}

// Full FlowModel
export interface FlowModel {
  flow_id: string
  name: string
  nodes: DomainNode[]
  edges: FlowEdge[]
  cell_mapping: Record<string, string>
  settings: FlowSettings
  created_at: string
  version: number
}

// ---------------------------------------------------------------------------
// Excel parsing types
// ---------------------------------------------------------------------------

export interface CellInfo {
  coord: string
  row: number
  col: number
  value: string | null
  is_label: boolean
}

export type ExcelCellsResponse = Record<string, CellInfo[]>

// ---------------------------------------------------------------------------
// Field definition for /api/design
// ---------------------------------------------------------------------------

export interface FieldDef {
  id: string
  label: string
  cell_ref: string
  type: string
}

// ---------------------------------------------------------------------------
// Transcript / Real-time call types
// ---------------------------------------------------------------------------

export interface TranscriptEvent {
  id: string
  role: 'agent' | 'customer' | 'system'
  text: string
  timestamp: string
  is_final: boolean
  turn_index: number
  translation?: string
  is_translated?: boolean
}

export interface TranscriptMessage {
  id: string
  role: 'agent' | 'customer' | 'system'
  text: string
  timestamp: string
  isFinal: boolean
  turnIndex: number
  translation?: string
  isTranslated?: boolean
  isLive?: boolean
}

// ---------------------------------------------------------------------------
// Call types for real-time tracking
// ---------------------------------------------------------------------------

export type CallStatus = 'ringing' | 'in_progress' | 'completed' | 'escalated' | 'failed'

export interface Call {
  id: string
  caller_number: string
  customer_name: string | null
  status: CallStatus
  disposition: string | null
  direction?: 'inbound' | 'outbound' | null
  flow_id: string | null
  flow_name: string | null
  queued_at: string
  answered_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  livekit_room?: string
  escalation_requested?: boolean
  card_locked?: boolean
}

export interface CallListResponse {
  calls: Call[]
  total: number
  limit: number
  offset: number
}

export interface CallDetailResponse {
  call: Call & {
    direction: string
    callee_number: string
    metadata: Record<string, unknown>
  }
  events: Array<{
    id: string
    event_type: string
    timestamp: string
    data: Record<string, unknown>
  }>
}

export interface CallUpdateRequest {
  status?: CallStatus
  disposition?: string
  ended_at?: string
}

export interface CallEvent {
  type:
    | 'call-started'
    | 'call-updated'
    | 'call-ended'
    | 'call-escalation-requested'
    | 'call-escalation-cleared'
    | 'call-card-locked'
    | 'incoming-call'
    | 'call-answered'
  call_id: string
  call?: Call
  ended_at?: string
  reason?: string | null
  timestamp: string
}

// ---------------------------------------------------------------------------
// Form field types for real-time form display
// ---------------------------------------------------------------------------

// Form field from CompiledFlowSpec
export interface FormFieldInfo {
  id: string
  label: string
  field_type: string
}

// Form field with runtime state
export interface FormFieldState extends FormFieldInfo {
  value: string | null
  validated: boolean
  attempts: number
}

// Form overall state
export interface FormState {
  fields: FormFieldState[]
  confirmed: boolean
  completed: boolean
}
