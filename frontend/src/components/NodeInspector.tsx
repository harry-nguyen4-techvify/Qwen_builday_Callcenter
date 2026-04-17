import { useState, useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type { FlowNodeData } from '../types'
import { Save, X } from 'lucide-react'

interface Props {
  node: Node<FlowNodeData> | null
  onUpdate: (nodeId: string, data: Partial<FlowNodeData>) => void
  onClose: () => void
}

export default function NodeInspector({ node, onUpdate, onClose }: Props) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [configText, setConfigText] = useState('')
  const [configError, setConfigError] = useState('')

  useEffect(() => {
    if (!node) return
    setName((node.data.name as string) ?? '')
    setPrompt((node.data.prompt as string) ?? '')
    setConfigText(JSON.stringify(node.data.config ?? {}, null, 2))
    setConfigError('')
  }, [node])

  if (!node) return null

  const handleSave = () => {
    let parsedConfig: Record<string, unknown> = {}
    try {
      parsedConfig = JSON.parse(configText) as Record<string, unknown>
      setConfigError('')
    } catch {
      setConfigError('Invalid JSON in config')
      return
    }

    onUpdate(node.id, {
      name,
      prompt,
      config: parsedConfig,
    })
  }

  const outputs = (node.data.outputs as string[]) ?? []

  const inputCls =
    'w-full bg-surface-container-lowest border border-outline-variant/30 rounded-md px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-primary-container transition-colors'

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-container-lowest border-l border-outline-variant/10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10 bg-surface-container-low">
        <div>
          <span className="text-on-surface text-sm font-semibold">Node Inspector</span>
          <span className="ml-2 text-outline text-xs font-mono">{node.id}</span>
        </div>
        <button
          onClick={onClose}
          className="text-outline hover:text-on-surface transition-colors rounded p-1 hover:bg-surface-container"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Type (read-only) */}
        <div>
          <label className="block text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-1.5">
            Type
          </label>
          <div className="bg-surface-container-low border border-outline-variant/20 rounded-md px-3 py-2 text-on-surface-variant text-sm font-mono">
            {node.data.type as string}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-1.5">
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className={`${inputCls} resize-y leading-relaxed`}
            placeholder="What should the agent say / do at this node?"
          />
        </div>

        {/* Outputs (read-only) */}
        <div>
          <label className="block text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-1.5">
            Output Ports
          </label>
          {outputs.length === 0 ? (
            <span className="text-outline text-xs italic">No outputs (terminal node)</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {outputs.map((port) => (
                <span
                  key={port}
                  className="bg-surface-container border border-outline-variant/20 rounded px-2 py-0.5
                             text-xs font-mono text-on-surface-variant"
                >
                  {port}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Config JSON */}
        <div>
          <label className="block text-xs text-on-surface-variant font-semibold uppercase tracking-wider mb-1.5">
            Config (JSON)
          </label>
          <textarea
            value={configText}
            onChange={(e) => {
              setConfigText(e.target.value)
              setConfigError('')
            }}
            rows={8}
            className={`${inputCls} text-xs font-mono resize-y leading-relaxed
                        ${configError ? 'border-error' : ''}`}
            spellCheck={false}
          />
          {configError && (
            <p className="text-error text-xs mt-1">{configError}</p>
          )}
        </div>
      </div>

      {/* Save button */}
      <div className="px-4 py-3 border-t border-outline-variant/10 bg-surface-container-low">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 bg-primary-container hover:bg-primary text-white
                     text-sm font-medium px-4 py-2 rounded-md transition-colors w-full justify-center"
        >
          <Save size={14} />
          Save Changes
        </button>
      </div>
    </div>
  )
}
