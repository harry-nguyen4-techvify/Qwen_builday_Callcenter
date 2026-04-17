import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { listFlows, getFlow } from '../mock/api'
import { MOCK_CONVERSATION, MOCK_FORM_STATE, MOCK_EXCEL_CELLS } from '../mock/data'
import type { MockConversationMessage } from '../mock/data'
import type { FlowModel } from '../types'

export default function VoiceTest() {
  const [searchParams] = useSearchParams()
  const preselectedFlow = searchParams.get('flow')

  const [flowIds, setFlowIds] = useState<string[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState(preselectedFlow || '')
  const [, setSelectedFlow] = useState<FlowModel | null>(null)
  const [messages, setMessages] = useState<MockConversationMessage[]>([])
  const [formState, setFormState] = useState(MOCK_FORM_STATE)
  const [isRunning, setIsRunning] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [inputText, setInputText] = useState('')
  const [currentStep, setCurrentStep] = useState('idle')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listFlows().then(setFlowIds)
  }, [])

  useEffect(() => {
    if (selectedFlowId) {
      getFlow(selectedFlowId).then(setSelectedFlow).catch(() => setSelectedFlow(null))
    }
  }, [selectedFlowId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleStart = () => {
    setIsRunning(true)
    setCurrentStep('greeting')
    setMessages([])
    setFormState(
      Object.fromEntries(
        Object.entries(MOCK_FORM_STATE).map(([k, v]) => [k, { ...v, value: '', filled: false }])
      )
    )
    let idx = 0
    const interval = setInterval(() => {
      if (idx < MOCK_CONVERSATION.length) {
        const msg = MOCK_CONVERSATION[idx]
        setMessages((prev) => [...prev, msg])
        if (msg.role === 'system' && msg.text.includes('fill_field')) {
          const match = msg.text.match(/\[fill_field\] (\w+) → "(.+?)" \(cell (\w+)\)/)
          if (match) {
            const [, fieldId, value, cell] = match
            setFormState((prev) => ({
              ...prev,
              [fieldId]: { value, filled: true, cell },
            }))
            setCurrentStep(`collect_${fieldId}`)
          }
        }
        if (msg.role === 'agent') setIsListening(false)
        if (msg.role === 'user') setIsListening(true)
        idx++
      } else {
        clearInterval(interval)
        setCurrentStep('confirm')
        setIsListening(false)
      }
    }, 1200)
    return () => clearInterval(interval)
  }

  const handleStop = () => {
    setIsRunning(false)
    setIsListening(false)
    setCurrentStep('idle')
  }

  const handleSendText = () => {
    if (!inputText.trim()) return
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: inputText, timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
    ])
    setInputText('')
  }

  const filledCount = Object.values(formState).filter((f) => f.filled).length
  const totalFields = Object.keys(formState).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-surface-container-lowest border-b border-outline-variant/10 flex-shrink-0">
        <Icon name="mic" className="text-tertiary" size={20} />
        <h1 className="text-sm font-bold text-navy">Voice Test</h1>

        <select
          value={selectedFlowId}
          onChange={(e) => setSelectedFlowId(e.target.value)}
          className="ml-4 bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary-container"
        >
          <option value="">Select a flow...</option>
          {flowIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>

        <div className="flex-1" />

        {isRunning && (
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-success animate-pulse' : 'bg-primary'}`} />
            <span className={`font-label font-bold ${isListening ? 'text-success' : 'text-primary'}`}>
              {isListening ? 'Listening...' : 'Agent speaking...'}
            </span>
          </div>
        )}

        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={!selectedFlowId}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-success/15 text-success text-sm font-bold hover:bg-success/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="mic" size={16} /> Start
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-error/15 text-error text-sm font-bold hover:bg-error/25 transition-colors"
          >
            <Icon name="mic_off" size={16} /> Stop
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Conversation */}
        <div className="flex-[6] flex flex-col border-r border-outline-variant/10">
          <div className="flex-1 overflow-y-auto p-4 space-y-3 transcript-scroll">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-on-surface-variant">
                <div className="text-center space-y-2">
                  <Icon name="mic" className="mx-auto text-outline" size={40} />
                  <p className="text-sm">Select a flow and click Start to begin testing</p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'}`}>
                {msg.role === 'system' ? (
                  <div className="px-3 py-1.5 rounded-lg bg-warning/10 text-warning text-xs font-label max-w-md">
                    {msg.text}
                  </div>
                ) : (
                  <div
                    className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-line ${
                      msg.role === 'agent'
                        ? 'bg-primary/10 text-on-surface rounded-bl-sm'
                        : 'bg-surface-container-high text-on-surface rounded-br-sm'
                    }`}
                  >
                    <div>{msg.text}</div>
                    <div className={`text-[10px] mt-1 font-label ${msg.role === 'agent' ? 'text-primary/60' : 'text-on-surface-variant'}`}>
                      {msg.timestamp}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="p-3 bg-surface-container-low border-t border-outline-variant/10 flex items-center gap-3">
            <button
              disabled={!isRunning}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                isListening
                  ? 'bg-success text-white shadow-lg shadow-success/30 animate-pulse'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              } disabled:opacity-40`}
            >
              <Icon name="mic" size={18} />
            </button>

            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
              placeholder="Type a message (text fallback)..."
              disabled={!isRunning}
              className="flex-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary-container disabled:opacity-40"
            />

            <button
              onClick={handleSendText}
              disabled={!isRunning || !inputText.trim()}
              className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center hover:bg-primary/25 transition-colors disabled:opacity-40"
            >
              <Icon name="send" size={16} />
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-[4] flex flex-col overflow-hidden bg-surface-container-lowest">
          {/* Form State */}
          <div className="flex-1 overflow-y-auto p-4 border-b border-outline-variant/10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider font-label">Form State</h3>
              <span className="text-xs text-on-surface-variant font-label">{filledCount}/{totalFields} fields</span>
            </div>

            {currentStep !== 'idle' && (
              <div className="mb-3 px-3 py-1.5 rounded-lg bg-tertiary/10 text-tertiary text-xs">
                Current step: <span className="font-label font-medium">{currentStep}</span>
              </div>
            )}

            <div className="space-y-1.5">
              {Object.entries(formState).map(([key, field]) => (
                <div
                  key={key}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    field.filled ? 'bg-surface-container-low' : 'bg-transparent'
                  } ${currentStep === `collect_${key}` ? 'ring-1 ring-primary/30' : ''}`}
                >
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center ${
                    field.filled ? 'bg-success/15' : 'bg-surface-container-high'
                  }`}>
                    <Icon
                      name={field.filled ? 'check' : 'remove'}
                      size={12}
                      className={field.filled ? 'text-success' : 'text-outline'}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-label text-on-surface-variant">{key}</span>
                      <span className="text-[10px] text-outline">{field.cell}</span>
                    </div>
                    <div className={`text-sm truncate ${field.filled ? 'text-on-surface' : 'text-outline italic'}`}>
                      {field.value || 'empty'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Excel Preview */}
          <div className="flex-shrink-0 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="description" className="text-success" size={16} />
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider font-label">Excel Preview</h3>
            </div>
            <div className="text-xs text-on-surface-variant mb-2 font-label">credit_application.xlsx</div>

            <div className="rounded-lg bg-surface-container-low overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-container">
                    <th className="px-2 py-1.5 text-left text-on-surface-variant font-medium w-8 font-label"></th>
                    <th className="px-2 py-1.5 text-left text-on-surface-variant font-medium font-label">A</th>
                    <th className="px-2 py-1.5 text-left text-on-surface-variant font-medium font-label">B</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_EXCEL_CELLS.Sheet1.filter((c) => c.row >= 3 && c.row <= 8 && c.col === 1).map((labelCell) => {
                    const valueCell = MOCK_EXCEL_CELLS.Sheet1.find(
                      (c) => c.row === labelCell.row && c.col === 2
                    )
                    const fieldEntry = Object.entries(formState).find(
                      ([, f]) => f.cell === `B${labelCell.row}`
                    )
                    const isFilled = fieldEntry?.[1]?.filled

                    return (
                      <tr key={labelCell.row} className="border-t border-outline-variant/10">
                        <td className="px-2 py-1.5 text-outline font-label">{labelCell.row}</td>
                        <td className="px-2 py-1.5 text-on-surface-variant">{labelCell.value}</td>
                        <td className={`px-2 py-1.5 font-label ${isFilled ? 'text-primary bg-primary/5 font-bold' : 'text-outline'}`}>
                          {fieldEntry?.[1]?.value || valueCell?.value || '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
