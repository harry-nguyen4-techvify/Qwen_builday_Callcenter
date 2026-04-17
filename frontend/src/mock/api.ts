/**
 * Mock API layer - falls back to mock data when backend is unavailable.
 * Wraps the real API calls and catches network errors.
 */

import * as realApi from '../api'
import type { FlowModel, ExcelCellsResponse } from '../types'
import { MOCK_FLOWS } from './data'

let useMock = false
const localFlows = new Map<string, FlowModel>(
  MOCK_FLOWS.map((f) => [f.flow_id, f])
)

async function tryReal<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  if (useMock) return fallback()
  try {
    return await fn()
  } catch {
    console.warn('[mock-api] Backend unavailable, switching to mock mode')
    useMock = true
    return fallback()
  }
}

export function isMockMode(): boolean {
  return useMock
}

export async function listFlows(): Promise<string[]> {
  return tryReal(
    () => realApi.listFlows(),
    () => Array.from(localFlows.keys())
  )
}

export async function getFlow(flowId: string): Promise<FlowModel> {
  return tryReal(
    () => realApi.getFlow(flowId),
    () => {
      const flow = localFlows.get(flowId)
      if (!flow) throw new Error(`Flow '${flowId}' not found`)
      return flow
    }
  )
}

export async function saveFlow(flow: FlowModel): Promise<FlowModel> {
  return tryReal(
    () => realApi.saveFlow(flow),
    () => {
      localFlows.set(flow.flow_id, { ...flow, version: flow.version + 1 })
      return { ...flow, version: flow.version + 1, _compiled: true } as FlowModel & { _compiled: boolean }
    }
  )
}

export async function deleteFlow(flowId: string): Promise<void> {
  return tryReal(
    () => realApi.deleteFlow(flowId),
    () => { localFlows.delete(flowId) }
  )
}

export async function designFlow(req: realApi.DesignRequest): Promise<FlowModel> {
  return tryReal(
    () => realApi.designFlow(req),
    () => {
      // Return a mock generated flow
      const flowId = 'generated_' + Date.now()
      const flow: FlowModel = {
        flow_id: flowId,
        name: 'Generated Flow',
        nodes: [
          { id: 'start_1', type: 'start', name: 'Start', position: { x: 50, y: 200 }, prompt: '', outputs: ['next'], config: {} },
          ...req.fields.map((f, i) => ({
            id: `collect_${f.id}`,
            type: 'collect' as const,
            name: `Thu thập ${f.label}`,
            position: { x: 300 + i * 250, y: 200 },
            prompt: `Xin cho biết ${f.label.toLowerCase()} của bạn?`,
            outputs: ['collected', 'retry', 'escalate'],
            config: { field_id: f.id, field_type: f.type, cell: f.cell_ref, validation: {}, retry_limit: 3 },
          })),
          { id: 'end_1', type: 'end', name: 'End', position: { x: 300 + req.fields.length * 250, y: 200 }, prompt: '', outputs: [], config: {} },
        ],
        edges: [],
        cell_mapping: Object.fromEntries(req.fields.map((f) => [f.id, f.cell_ref])),
        settings: { language: 'vi', max_retries: 3, tts_voice: '' },
        created_at: new Date().toISOString(),
        version: 1,
      }
      localFlows.set(flowId, flow)
      return flow
    }
  )
}

export async function refineFlow(flowId: string, feedback: string): Promise<FlowModel> {
  return tryReal(
    () => realApi.refineFlow(flowId, feedback),
    () => {
      const flow = localFlows.get(flowId)
      if (!flow) throw new Error(`Flow '${flowId}' not found`)
      return { ...flow, version: flow.version + 1 }
    }
  )
}

export async function parseExcelCells(file: File): Promise<ExcelCellsResponse> {
  return tryReal(
    () => realApi.parseExcelCells(file),
    () => {
      // Return mock excel data
      return {
        Sheet1: [
          { coord: 'A1', row: 1, col: 1, value: 'Form Header', is_label: true },
          { coord: 'A3', row: 3, col: 1, value: 'Họ tên', is_label: true },
          { coord: 'B3', row: 3, col: 2, value: null, is_label: false },
          { coord: 'A4', row: 4, col: 1, value: 'Số CMND', is_label: true },
          { coord: 'B4', row: 4, col: 2, value: null, is_label: false },
          { coord: 'A5', row: 5, col: 1, value: 'Ngày sinh', is_label: true },
          { coord: 'B5', row: 5, col: 2, value: null, is_label: false },
        ],
      }
    }
  )
}
