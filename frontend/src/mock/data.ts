/**
 * Mock data for when backend is unavailable.
 * Provides realistic Vietnamese form-filling agent data.
 */

import type { FlowModel, ExcelCellsResponse } from '../types'

export const MOCK_FLOWS: FlowModel[] = [
  {
    flow_id: 'don_dang_ky_tin_dung',
    name: 'Đơn Đăng Ký Tín Dụng',
    nodes: [
      { id: 'start_1', type: 'start', name: 'Start', position: { x: 50, y: 200 }, prompt: '', outputs: ['next'], config: { flow_name: 'Đơn Đăng Ký Tín Dụng', language: 'vi' } },
      { id: 'greeting_1', type: 'greeting', name: 'Chào mừng', position: { x: 250, y: 200 }, prompt: 'Xin chào! Tôi là trợ lý AI giúp bạn điền đơn đăng ký tín dụng.', outputs: ['next'], config: {} },
      { id: 'collect_name', type: 'collect', name: 'Thu thập họ tên', position: { x: 500, y: 100 }, prompt: 'Xin cho biết họ tên đầy đủ của bạn?', outputs: ['collected', 'retry', 'escalate'], config: { field_id: 'ho_ten', field_type: 'text', cell: 'B3', validation: {}, retry_limit: 3 } },
      { id: 'collect_cmnd', type: 'collect', name: 'Thu thập CMND', position: { x: 750, y: 100 }, prompt: 'Xin cho biết số CMND/CCCD của bạn?', outputs: ['collected', 'retry', 'escalate'], config: { field_id: 'so_cmnd', field_type: 'text', cell: 'B4', validation: {}, retry_limit: 3 } },
      { id: 'collect_phone', type: 'collect', name: 'Thu thập SĐT', position: { x: 1000, y: 100 }, prompt: 'Số điện thoại liên hệ của bạn là gì?', outputs: ['collected', 'retry', 'escalate'], config: { field_id: 'sdt', field_type: 'phone', cell: 'B5', validation: {}, retry_limit: 3 } },
      { id: 'confirm_1', type: 'confirm', name: 'Xác nhận', position: { x: 1250, y: 200 }, prompt: 'Xin xác nhận lại thông tin...', outputs: ['confirmed', 'rejected'], config: { summary_fields: ['ho_ten', 'so_cmnd', 'sdt'], confirm_port: 'confirmed', reject_port: 'rejected' } },
      { id: 'fill_1', type: 'fill_excel', name: 'Điền Excel', position: { x: 1500, y: 200 }, prompt: '', outputs: ['done', 'error'], config: { template_path: 'templates/credit_app.xlsx', output_path: 'filled/' } },
      { id: 'end_1', type: 'end', name: 'Kết thúc', position: { x: 1750, y: 200 }, prompt: 'Cảm ơn bạn! Đơn đã được ghi nhận.', outputs: [], config: {} },
      { id: 'escalate_1', type: 'escalate', name: 'Chuyển NV', position: { x: 750, y: 400 }, prompt: '', outputs: ['next'], config: { reason_template: 'Khách hàng cần hỗ trợ', notify_log: true } },
    ],
    edges: [
      { id: 'e1', source: 'start_1', target: 'greeting_1', output: 'next' },
      { id: 'e2', source: 'greeting_1', target: 'collect_name', output: 'next' },
      { id: 'e3', source: 'collect_name', target: 'collect_cmnd', output: 'collected' },
      { id: 'e4', source: 'collect_cmnd', target: 'collect_phone', output: 'collected' },
      { id: 'e5', source: 'collect_phone', target: 'confirm_1', output: 'collected' },
      { id: 'e6', source: 'confirm_1', target: 'fill_1', output: 'confirmed' },
      { id: 'e7', source: 'fill_1', target: 'end_1', output: 'done' },
      { id: 'e8', source: 'confirm_1', target: 'collect_name', output: 'rejected' },
      { id: 'e9', source: 'collect_name', target: 'escalate_1', output: 'escalate' },
      { id: 'e10', source: 'collect_cmnd', target: 'escalate_1', output: 'escalate' },
    ],
    cell_mapping: { ho_ten: 'B3', so_cmnd: 'B4', sdt: 'B5' },
    settings: { language: 'vi', max_retries: 3, tts_voice: 'vi-VN-HoaiMyNeural' },
    created_at: '2026-04-14T08:00:00Z',
    version: 2,
  },
  {
    flow_id: 'phieu_kham_benh',
    name: 'Phiếu Khám Bệnh',
    nodes: [
      { id: 'start_1', type: 'start', name: 'Start', position: { x: 50, y: 200 }, prompt: '', outputs: ['next'], config: { flow_name: 'Phiếu Khám Bệnh', language: 'vi' } },
      { id: 'greeting_1', type: 'greeting', name: 'Chào hỏi', position: { x: 250, y: 200 }, prompt: 'Xin chào! Tôi giúp bạn điền phiếu khám bệnh.', outputs: ['next'], config: {} },
      { id: 'end_1', type: 'end', name: 'Kết thúc', position: { x: 500, y: 200 }, prompt: '', outputs: [], config: {} },
    ],
    edges: [
      { id: 'e1', source: 'start_1', target: 'greeting_1', output: 'next' },
      { id: 'e2', source: 'greeting_1', target: 'end_1', output: 'next' },
    ],
    cell_mapping: {},
    settings: { language: 'vi', max_retries: 3, tts_voice: '' },
    created_at: '2026-04-13T10:00:00Z',
    version: 1,
  },
  {
    flow_id: 'hop_dong_lao_dong',
    name: 'Hợp Đồng Lao Động',
    nodes: [
      { id: 'start_1', type: 'start', name: 'Start', position: { x: 50, y: 200 }, prompt: '', outputs: ['next'], config: {} },
      { id: 'end_1', type: 'end', name: 'End', position: { x: 250, y: 200 }, prompt: '', outputs: [], config: {} },
    ],
    edges: [{ id: 'e1', source: 'start_1', target: 'end_1', output: 'next' }],
    cell_mapping: {},
    settings: { language: 'vi', max_retries: 3, tts_voice: '' },
    created_at: '2026-04-12T14:00:00Z',
    version: 1,
  },
  {
    flow_id: 'don_xin_viec',
    name: 'Đơn Xin Việc',
    nodes: [],
    edges: [],
    cell_mapping: {},
    settings: { language: 'vi', max_retries: 3, tts_voice: '' },
    created_at: '2026-04-11T09:00:00Z',
    version: 1,
  },
  {
    flow_id: 'phieu_bao_hanh',
    name: 'Phiếu Bảo Hành',
    nodes: [],
    edges: [],
    cell_mapping: {},
    settings: { language: 'vi', max_retries: 3, tts_voice: '' },
    created_at: '2026-04-10T16:00:00Z',
    version: 1,
  },
]

export const MOCK_FLOW_STATS = {
  totalFlows: MOCK_FLOWS.length,
  compiled: 2,
  activeTests: 1,
  templates: 3,
}

export interface MockConversationMessage {
  role: 'agent' | 'user' | 'system'
  text: string
  timestamp: string
}

export const MOCK_CONVERSATION: MockConversationMessage[] = [
  { role: 'agent', text: 'Xin chào! Tôi là trợ lý AI giúp bạn điền đơn đăng ký tín dụng. Xin cho biết họ tên đầy đủ của bạn?', timestamp: '10:00:01' },
  { role: 'user', text: 'Nguyễn Văn An', timestamp: '10:00:05' },
  { role: 'system', text: '[fill_field] ho_ten → "Nguyễn Văn An" (cell B3)', timestamp: '10:00:06' },
  { role: 'agent', text: 'Cảm ơn anh An. Xin cho biết số CMND/CCCD của anh?', timestamp: '10:00:07' },
  { role: 'user', text: '079123456789', timestamp: '10:00:12' },
  { role: 'system', text: '[fill_field] so_cmnd → "079123456789" (cell B4)', timestamp: '10:00:13' },
  { role: 'agent', text: 'Số điện thoại liên hệ của anh là gì?', timestamp: '10:00:14' },
  { role: 'user', text: '0909 123 456', timestamp: '10:00:18' },
  { role: 'system', text: '[fill_field] sdt → "0909123456" (cell B5)', timestamp: '10:00:19' },
  { role: 'agent', text: 'Xin xác nhận lại thông tin:\n- Họ tên: Nguyễn Văn An\n- CMND: 079123456789\n- SĐT: 0909123456\nĐúng không ạ?', timestamp: '10:00:20' },
]

export const MOCK_FORM_STATE: Record<string, { value: string; filled: boolean; cell: string }> = {
  ho_ten: { value: 'Nguyễn Văn An', filled: true, cell: 'B3' },
  so_cmnd: { value: '079123456789', filled: true, cell: 'B4' },
  sdt: { value: '0909123456', filled: true, cell: 'B5' },
  dia_chi: { value: '', filled: false, cell: 'B6' },
  ngay_sinh: { value: '', filled: false, cell: 'B7' },
  email: { value: '', filled: false, cell: 'B8' },
}

export const MOCK_EXCEL_CELLS: ExcelCellsResponse = {
  Sheet1: [
    { coord: 'A3', row: 3, col: 1, value: 'Họ tên', is_label: true },
    { coord: 'B3', row: 3, col: 2, value: 'Nguyễn Văn An', is_label: false },
    { coord: 'A4', row: 4, col: 1, value: 'Số CMND/CCCD', is_label: true },
    { coord: 'B4', row: 4, col: 2, value: '079123456789', is_label: false },
    { coord: 'A5', row: 5, col: 1, value: 'Số điện thoại', is_label: true },
    { coord: 'B5', row: 5, col: 2, value: '0909123456', is_label: false },
    { coord: 'A6', row: 6, col: 1, value: 'Địa chỉ', is_label: true },
    { coord: 'B6', row: 6, col: 2, value: null, is_label: false },
    { coord: 'A7', row: 7, col: 1, value: 'Ngày sinh', is_label: true },
    { coord: 'B7', row: 7, col: 2, value: null, is_label: false },
    { coord: 'A8', row: 8, col: 1, value: 'Email', is_label: true },
    { coord: 'B8', row: 8, col: 2, value: null, is_label: false },
  ],
}

// ========== Call Data ==========

export type CallStatus = 'ongoing' | 'completed' | 'escalated'

export interface MockCall {
  id: string
  customerId: string
  customerName: string
  status: CallStatus
  flowId: string
  flowName: string
  startTime: string      // ISO timestamp
  endTime: string | null // null for ongoing
  duration: number       // seconds (live-calculated for ongoing)
  outcome?: 'completed' | 'escalated' | 'dropped'
}

export const MOCK_CALLS: MockCall[] = [
  // Ongoing calls (2)
  {
    id: 'call_001',
    customerId: 'cust_001',
    customerName: 'Nguyễn Văn Minh',
    status: 'ongoing',
    flowId: 'don_dang_ky_tin_dung',
    flowName: 'Đơn Đăng Ký Tín Dụng',
    startTime: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    endTime: null,
    duration: 0,
  },
  {
    id: 'call_002',
    customerId: 'cust_002',
    customerName: 'Trần Thị Hương',
    status: 'ongoing',
    flowId: 'phieu_kham_benh',
    flowName: 'Phiếu Khám Bệnh',
    startTime: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    endTime: null,
    duration: 0,
  },
  // History calls (6)
  {
    id: 'call_003',
    customerId: 'cust_003',
    customerName: 'Lê Hoàng Nam',
    status: 'completed',
    flowId: 'don_dang_ky_tin_dung',
    flowName: 'Đơn Đăng Ký Tín Dụng',
    startTime: '2026-04-16T09:15:00Z',
    endTime: '2026-04-16T09:22:30Z',
    duration: 450,
    outcome: 'completed',
  },
  {
    id: 'call_004',
    customerId: 'cust_004',
    customerName: 'Phạm Thanh Tùng',
    status: 'escalated',
    flowId: 'hop_dong_lao_dong',
    flowName: 'Hợp Đồng Lao Động',
    startTime: '2026-04-16T08:45:00Z',
    endTime: '2026-04-16T08:52:15Z',
    duration: 435,
    outcome: 'escalated',
  },
  {
    id: 'call_005',
    customerId: 'cust_005',
    customerName: 'Vũ Thị Mai Lan',
    status: 'completed',
    flowId: 'phieu_kham_benh',
    flowName: 'Phiếu Khám Bệnh',
    startTime: '2026-04-16T08:00:00Z',
    endTime: '2026-04-16T08:06:45Z',
    duration: 405,
    outcome: 'completed',
  },
  {
    id: 'call_006',
    customerId: 'cust_006',
    customerName: 'Đỗ Quang Huy',
    status: 'completed',
    flowId: 'don_xin_viec',
    flowName: 'Đơn Xin Việc',
    startTime: '2026-04-15T16:30:00Z',
    endTime: '2026-04-15T16:38:20Z',
    duration: 500,
    outcome: 'completed',
  },
  {
    id: 'call_007',
    customerId: 'cust_007',
    customerName: 'Hoàng Thị Bích Ngọc',
    status: 'escalated',
    flowId: 'phieu_bao_hanh',
    flowName: 'Phiếu Bảo Hành',
    startTime: '2026-04-15T14:20:00Z',
    endTime: '2026-04-15T14:28:50Z',
    duration: 530,
    outcome: 'escalated',
  },
  {
    id: 'call_008',
    customerId: 'cust_008',
    customerName: 'Bùi Văn Thành',
    status: 'completed',
    flowId: 'don_dang_ky_tin_dung',
    flowName: 'Đơn Đăng Ký Tín Dụng',
    startTime: '2026-04-15T11:10:00Z',
    endTime: '2026-04-15T11:17:30Z',
    duration: 450,
    outcome: 'completed',
  },
]
