import axios from 'axios'
import type { FlowModel, ExcelCellsResponse, FieldDef, CallListResponse, CallDetailResponse, CallUpdateRequest } from './types'

const client = axios.create({
  baseURL: '/',
  timeout: 120_000, // 2 minutes — design can take 60-90s
})

// ---------------------------------------------------------------------------
// Flows CRUD
// ---------------------------------------------------------------------------

export async function listFlows(): Promise<string[]> {
  const res = await client.get<string[]>('/api/flows')
  return res.data
}

export async function getFlow(flowId: string): Promise<FlowModel> {
  const res = await client.get<FlowModel>(`/api/flows/${flowId}`)
  return res.data
}

export async function saveFlow(flow: FlowModel): Promise<FlowModel> {
  const res = await client.put<FlowModel>(`/api/flows/${flow.flow_id}`, flow)
  return res.data
}

export async function deleteFlow(flowId: string): Promise<void> {
  await client.delete(`/api/flows/${flowId}`)
}

// ---------------------------------------------------------------------------
// Design / Refine
// ---------------------------------------------------------------------------

export interface DesignRequest {
  fields: FieldDef[]
  prompt: string
  raw_text: string
}

export async function designFlow(req: DesignRequest): Promise<FlowModel> {
  const res = await client.post<FlowModel>('/api/design', req, {
    timeout: 120_000,
  })
  return res.data
}

export async function refineFlow(flowId: string, feedback: string): Promise<FlowModel> {
  const res = await client.post<FlowModel>(`/api/flows/${flowId}/refine`, { feedback }, {
    timeout: 120_000,
  })
  return res.data
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export async function parseExcelCells(file: File): Promise<ExcelCellsResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post<ExcelCellsResponse>('/api/excel/cells', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

// ---------------------------------------------------------------------------
// Phone Simulator
// ---------------------------------------------------------------------------

export interface SimulatorCallResponse {
  call_id: string
  db_id: string  // Database UUID for the call record
  room_name: string
  token: string
  url: string
}

export interface SimulatorCallOptions {
  flowId?: string
  agentName?: 'form-agent' | 'simple-agent'
}

export async function initiateSimulatorCall(options?: SimulatorCallOptions): Promise<SimulatorCallResponse> {
  const res = await client.post<SimulatorCallResponse>('/api/simulator/call', {
    flow_id: options?.flowId,
    agent_name: options?.agentName,
  })
  return res.data
}

export interface SimulatorV2CallResponse extends SimulatorCallResponse {
  scenario: string
}

/** V2 simulator — dispatches the `report_lost_card` flow by default. */
export async function initiateSimulatorCallV2(flowId?: string): Promise<SimulatorV2CallResponse> {
  const res = await client.post<SimulatorV2CallResponse>('/api/simulator/v2/call', {
    flow_id: flowId,
  })
  return res.data
}

export interface HumanTokenResponse {
  token: string
  url: string
  room: string
  identity: string
}

/** Generate a LiveKit token for a human operator to join an escalated call. */
export async function getHumanOperatorToken(callId: string): Promise<HumanTokenResponse> {
  const res = await client.get<HumanTokenResponse>(`/api/calls/${callId}/human-token`)
  return res.data
}

export async function initiateSimpleCall(): Promise<{
  call_id: string
  room_name: string
  token: string
  url: string
}> {
  const res = await client.post('/api/simulator/simple-call')
  if (res.status >= 400) {
    throw new Error(res.data?.detail || 'Failed to create simple call')
  }
  return res.data
}

// ---------------------------------------------------------------------------
// Calls CRUD
// ---------------------------------------------------------------------------

export interface CallsQueryParams {
  status?: 'ongoing' | 'completed' | 'escalated' | 'failed'
  limit?: number
  offset?: number
}

export async function listCalls(params?: CallsQueryParams): Promise<CallListResponse> {
  const queryParams = new URLSearchParams()
  if (params?.status) {
    // Map frontend 'ongoing' to backend 'in_progress'
    const backendStatus = params.status === 'ongoing' ? 'in_progress' : params.status
    queryParams.set('status', backendStatus)
  }
  if (params?.limit) queryParams.set('limit', String(params.limit))
  if (params?.offset) queryParams.set('offset', String(params.offset))

  const query = queryParams.toString()
  const url = query ? `/api/calls?${query}` : '/api/calls'
  const res = await client.get<CallListResponse>(url)
  return res.data
}

export async function getCall(callId: string): Promise<CallDetailResponse> {
  const res = await client.get<CallDetailResponse>(`/api/calls/${callId}`)
  return res.data
}

export async function updateCall(
  callId: string,
  data: CallUpdateRequest
): Promise<{ id: string; status: string; disposition?: string; ended_at?: string }> {
  const res = await client.patch(`/api/calls/${callId}`, data)
  return res.data
}

export interface EndCallRequest {
  disposition?: 'completed' | 'escalated' | 'dropped'
}

export interface EndCallResponse {
  id: string
  status: string
  disposition: string
  ended_at: string
  room_deleted: boolean
  message?: string
}

/**
 * End a call and shutdown the LiveKit room.
 * This will kick all participants and delete the room.
 */
export async function endCall(
  callId: string,
  data: EndCallRequest = {}
): Promise<EndCallResponse> {
  const res = await client.post<EndCallResponse>(`/api/calls/${callId}/end`, data)
  return res.data
}

// ---------------------------------------------------------------------------
// Outbound calls
// ---------------------------------------------------------------------------

export interface OutboundCallRequest {
  flow_id: string
  phone_number: string
}

export interface OutboundCallResponse {
  id: string
  call_id: string
  room_name: string
  phone_number: string
  flow_id: string
  flow_name: string
}

export async function createOutboundCall(
  req: OutboundCallRequest
): Promise<OutboundCallResponse> {
  const res = await client.post<OutboundCallResponse>('/api/calls/outbound', req)
  return res.data
}

export interface AnswerCallResponse {
  call_id: string
  room_name: string
  token: string
  url: string
}

export async function answerCall(callId: string): Promise<AnswerCallResponse> {
  const res = await client.post<AnswerCallResponse>(`/api/calls/${callId}/answer`)
  return res.data
}
