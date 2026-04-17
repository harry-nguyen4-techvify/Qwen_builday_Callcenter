import { useState, useRef, useCallback } from 'react'
import { parseExcelCells, designFlow } from '../api'
import type { FlowModel, CellInfo, ExcelCellsResponse, FieldDef } from '../types'
import {
  Upload,
  Plus,
  Trash2,
  X,
  Loader2,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
} from 'lucide-react'

interface Props {
  onClose: () => void
  onFlowGenerated: (flow: FlowModel) => void
}

type Step = 1 | 2 | 3

export default function GenerateModal({ onClose, onFlowGenerated }: Props) {
  // Step 1: Upload
  const [step, setStep] = useState<Step>(1)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [cellData, setCellData] = useState<ExcelCellsResponse>({})
  const [rawText, setRawText] = useState('')
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2: Pick fields
  const [pendingLabel, setPendingLabel] = useState<{ cell: CellInfo; sheet: string } | null>(null)
  const [fields, setFields] = useState<FieldDef[]>([])
  const [activeSheet, setActiveSheet] = useState<string>('')

  // Step 3: Generate
  const [prompt, setPrompt] = useState(
    'Collect form data via voice agent in Vietnamese. Be polite and professional.'
  )
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  // ---------------------------------------------------------------------------
  // Step 1: Upload
  // ---------------------------------------------------------------------------

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploading(true)
    try {
      const data = await parseExcelCells(file)
      setCellData(data)
      setFileName(file.name)
      const sheets = Object.keys(data)
      if (sheets.length > 0) setActiveSheet(sheets[0])
      setStep(2)
      // Build raw_text from all cells
      const lines: string[] = []
      for (const [sheet, cells] of Object.entries(data)) {
        for (const c of cells) {
          if (c.value) lines.push(`${sheet}!${c.coord}: ${c.value}`)
        }
      }
      setRawText(lines.join('\n'))
    } catch {
      setUploadError('Failed to parse Excel file. Make sure it is a valid .xlsx file.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Step 2: Cell picker
  // ---------------------------------------------------------------------------

  const handleCellClick = useCallback(
    (cell: CellInfo, sheet: string) => {
      if (!pendingLabel) {
        // First click: set as pending label (the field label)
        if (cell.value) {
          setPendingLabel({ cell, sheet })
        }
      } else {
        // Second click: create field pair
        const label = String(pendingLabel.cell.value ?? '').replace(/:$/, '').trim()
        const slugId = label
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || 'field'

        // Make ID unique
        const existingIds = fields.map((f) => f.id)
        let finalId = slugId
        let counter = 2
        while (existingIds.includes(finalId)) {
          finalId = `${slugId}_${counter++}`
        }

        const cellRef = cell.value
          ? `${sheet}!${cell.coord}`
          : `${sheet}!${cell.coord}` // even empty cells get a ref

        setFields((prev) => [
          ...prev,
          {
            id: finalId,
            label,
            cell_ref: cellRef,
            type: 'text',
          },
        ])
        setPendingLabel(null)
      }
    },
    [pendingLabel, fields]
  )

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateField = (idx: number, key: keyof FieldDef, value: string) => {
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, [key]: value } : f))
    )
  }

  // ---------------------------------------------------------------------------
  // Step 3: Generate
  // ---------------------------------------------------------------------------

  const handleGenerate = async () => {
    if (fields.length === 0) {
      setGenError('Please add at least one field.')
      return
    }
    setGenError('')
    setGenerating(true)
    try {
      const flow = await designFlow({ fields, prompt, raw_text: rawText })
      onFlowGenerated(flow)
      onClose()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string | { message?: string } } } }
      const detail = axiosErr?.response?.data?.detail
      if (typeof detail === 'string') {
        setGenError(detail)
      } else if (detail && typeof detail === 'object' && detail.message) {
        setGenError(detail.message)
      } else {
        setGenError('Generation failed. Please try again.')
      }
    } finally {
      setGenerating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Sheets available
  // ---------------------------------------------------------------------------

  const sheets = Object.keys(cellData)
  const activeCells = cellData[activeSheet] ?? []

  // Build grid dimensions from cell data
  const maxRow = activeCells.reduce((m, c) => Math.max(m, c.row), 0)
  const maxCol = activeCells.reduce((m, c) => Math.max(m, c.col), 0)
  const cellMap = new Map<string, CellInfo>()
  for (const c of activeCells) {
    cellMap.set(`${c.row}-${c.col}`, c)
  }
  const colLetters = Array.from({ length: maxCol }, (_, i) =>
    String.fromCharCode(65 + i)
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative w-full bg-slate-900 border border-slate-700 rounded-xl shadow-2xl
                   flex flex-col overflow-hidden"
        style={{ maxWidth: 860, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800/60">
          <div className="flex items-center gap-3">
            <FileSpreadsheet size={20} className="text-emerald-400" />
            <h2 className="text-slate-200 font-semibold text-lg">Generate Flow from Excel</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 p-1.5 rounded-md hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 pt-4 pb-0">
          {[
            { n: 1, label: 'Upload Excel' },
            { n: 2, label: 'Pick Fields' },
            { n: 3, label: 'Generate' },
          ].map(({ n, label }, idx, arr) => (
            <div key={n} className="flex items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                    ${step > n ? 'bg-emerald-500 text-white' :
                      step === n ? 'bg-sky-500 text-white' :
                      'bg-slate-700 text-slate-500'}`}
                >
                  {step > n ? <CheckCircle2 size={14} /> : n}
                </div>
                <span
                  className={`text-xs font-medium ${
                    step === n ? 'text-slate-200' : step > n ? 'text-emerald-400' : 'text-slate-600'
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < arr.length - 1 && (
                <ChevronRight size={14} className="text-slate-700 mx-3" />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">

          {/* === STEP 1: Upload === */}
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-12 gap-6">
              <div
                className="w-full max-w-md border-2 border-dashed border-slate-600 hover:border-sky-500
                           rounded-xl p-10 flex flex-col items-center gap-4 cursor-pointer
                           transition-colors bg-slate-800/30 hover:bg-slate-800/50"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 size={40} className="text-sky-400 animate-spin" />
                ) : (
                  <Upload size={40} className="text-slate-500" />
                )}
                <div className="text-center">
                  <p className="text-slate-200 font-medium">
                    {uploading ? 'Parsing Excel...' : 'Upload Excel Template'}
                  </p>
                  <p className="text-slate-500 text-sm mt-1">
                    Click to browse or drag & drop an .xlsx file
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => void handleFileChange(e)}
                />
              </div>
              {uploadError && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 w-full max-w-md">
                  <AlertCircle size={16} />
                  {uploadError}
                </div>
              )}
            </div>
          )}

          {/* === STEP 2: Pick fields === */}
          {step === 2 && (
            <div className="flex gap-4 h-full">
              {/* Left: cell table */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Sheet tabs */}
                {sheets.length > 1 && (
                  <div className="flex gap-1 mb-3 flex-wrap">
                    {sheets.map((s) => (
                      <button
                        key={s}
                        onClick={() => setActiveSheet(s)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors
                          ${activeSheet === s
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Instructions */}
                <div className="mb-2 text-xs text-slate-400 bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700">
                  {pendingLabel ? (
                    <span className="text-yellow-400">
                      Label selected: <strong>"{String(pendingLabel.cell.value)}"</strong> — now click the value cell (can be empty)
                    </span>
                  ) : (
                    'Click a non-empty cell to use as label, then click another cell for its value location.'
                  )}
                </div>

                {/* Spreadsheet grid */}
                <div className="flex-1 overflow-auto border border-slate-700 rounded-lg bg-slate-950">
                  <table className="text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-800 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-slate-500 font-semibold border-b border-r border-slate-700 w-10 text-center">

                        </th>
                        {colLetters.map((letter) => (
                          <th
                            key={letter}
                            className="px-2 py-1.5 text-slate-400 font-semibold border-b border-r border-slate-700 text-center min-w-[100px]"
                          >
                            {letter}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: maxRow }, (_, ri) => {
                        const rowNum = ri + 1
                        return (
                          <tr key={rowNum}>
                            <td className="px-2 py-1 text-center text-slate-500 font-mono border-r border-b border-slate-700/60 bg-slate-800/40 sticky left-0 z-[5]">
                              {rowNum}
                            </td>
                            {colLetters.map((letter, ci) => {
                              const cell = cellMap.get(`${rowNum}-${ci + 1}`)
                              if (!cell) {
                                return (
                                  <td
                                    key={letter}
                                    className="px-2 py-1 border-r border-b border-slate-800/40"
                                  />
                                )
                              }
                              const isPending =
                                pendingLabel?.cell.coord === cell.coord &&
                                pendingLabel?.sheet === activeSheet
                              const isInFields = fields.some(
                                (f) => f.cell_ref === `${activeSheet}!${cell.coord}`
                              )
                              return (
                                <td
                                  key={letter}
                                  onClick={() => handleCellClick(cell, activeSheet)}
                                  title={cell.coord}
                                  className={`
                                    px-2 py-1 border-r border-b cursor-pointer transition-colors truncate max-w-[200px]
                                    ${isPending
                                      ? 'bg-yellow-900/40 border-yellow-700/40 text-yellow-300 font-medium'
                                      : isInFields
                                      ? 'bg-emerald-900/30 border-emerald-700/30 text-emerald-400'
                                      : cell.value
                                      ? 'border-slate-800/40 text-slate-300 hover:bg-slate-800/60'
                                      : 'border-slate-800/40 text-slate-600 hover:bg-slate-800/40'}
                                  `}
                                >
                                  {cell.value ?? ''}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right: field pairs */}
              <div className="w-72 flex-shrink-0 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    Fields ({fields.length})
                  </span>
                  {fields.length > 0 && (
                    <button
                      onClick={() => setStep(3)}
                      className="flex items-center gap-1 text-xs bg-sky-600 hover:bg-sky-500
                                 text-white px-3 py-1 rounded-md transition-colors"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {fields.length === 0 && (
                    <p className="text-slate-600 text-xs italic p-2">
                      No fields yet. Click cells above to create pairs.
                    </p>
                  )}
                  {fields.map((f, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-800 border border-slate-700 rounded-lg p-2 space-y-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <Plus size={10} className="text-slate-500 flex-shrink-0" />
                        <input
                          value={f.id}
                          onChange={(e) => updateField(idx, 'id', e.target.value)}
                          className="flex-1 bg-slate-700 rounded px-1.5 py-0.5 text-xs font-mono
                                     text-slate-200 border border-slate-600 focus:outline-none focus:border-sky-500"
                          placeholder="field_id"
                        />
                        <button
                          onClick={() => removeField(idx)}
                          className="text-slate-600 hover:text-red-400 transition-colors p-0.5"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          value={f.label}
                          onChange={(e) => updateField(idx, 'label', e.target.value)}
                          className="bg-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-300
                                     border border-slate-600 focus:outline-none focus:border-sky-500"
                          placeholder="Label"
                        />
                        <input
                          value={f.cell_ref}
                          onChange={(e) => updateField(idx, 'cell_ref', e.target.value)}
                          className="bg-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-slate-400
                                     border border-slate-600 focus:outline-none focus:border-sky-500"
                          placeholder="Sheet1!B3"
                        />
                      </div>
                      <select
                        value={f.type}
                        onChange={(e) => updateField(idx, 'type', e.target.value)}
                        className="w-full bg-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-300
                                   border border-slate-600 focus:outline-none focus:border-sky-500"
                      >
                        {['text', 'phone', 'date', 'email', 'select', 'multiselect', 'boolean', 'pattern'].map(
                          (t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  ))}
                </div>

                {fields.length > 0 && (
                  <button
                    onClick={() => setStep(3)}
                    className="mt-3 w-full flex items-center justify-center gap-2
                               bg-sky-600 hover:bg-sky-500 text-white text-sm
                               font-medium px-4 py-2 rounded-md transition-colors"
                  >
                    Proceed to Generate <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* === STEP 3: Generate === */}
          {step === 3 && (
            <div className="max-w-2xl mx-auto space-y-5 py-2">
              {/* Summary of fields */}
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">
                  Fields to collect ({fields.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {fields.map((f) => (
                    <span
                      key={f.id}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-300"
                    >
                      {f.id} → {f.cell_ref}
                    </span>
                  ))}
                </div>
              </div>

              {/* File info */}
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700">
                <FileSpreadsheet size={14} className="text-emerald-400" />
                <span className="text-slate-300">{fileName}</span>
                <span>— {rawText.split('\n').filter(Boolean).length} cells parsed</span>
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1.5">
                  Persona / Requirements Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2
                             text-slate-200 text-sm focus:outline-none focus:border-sky-500
                             transition-colors resize-y leading-relaxed"
                  placeholder="Describe how the voice agent should behave..."
                />
              </div>

              {genError && (
                <div className="flex items-start gap-2 text-red-300 text-sm bg-red-900/20 border border-red-800 rounded-lg px-4 py-3">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Generation failed</p>
                    <p className="text-red-400 text-xs mt-0.5">{genError}</p>
                  </div>
                </div>
              )}

              {generating && (
                <div className="flex items-center gap-3 text-sky-400 bg-sky-900/20 border border-sky-800/40 rounded-lg px-4 py-3">
                  <Loader2 size={18} className="animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Generating flow...</p>
                    <p className="text-xs text-sky-600 mt-0.5">
                      This may take 60-90 seconds. The LLM is designing your conversation flow.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  disabled={generating}
                  className="px-4 py-2 rounded-md border border-slate-600 text-slate-400
                             hover:text-slate-200 hover:border-slate-500 text-sm transition-colors
                             disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={() => void handleGenerate()}
                  disabled={generating || fields.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-600
                             hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2
                             rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      Generate Flow
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
