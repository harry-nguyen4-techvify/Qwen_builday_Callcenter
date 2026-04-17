import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'

const MOCK_TEMPLATES = [
  { name: 'credit_application.xlsx', fields: 8, lastUsed: '2026-04-14', flowId: 'don_dang_ky_tin_dung' },
  { name: 'medical_form.xlsx', fields: 12, lastUsed: '2026-04-13', flowId: 'phieu_kham_benh' },
  { name: 'labor_contract.xlsx', fields: 15, lastUsed: '2026-04-12', flowId: 'hop_dong_lao_dong' },
]

export default function Templates() {
  const navigate = useNavigate()
  const [dragActive, setDragActive] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    navigate('/flows?generate=true')
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy font-headline">Templates</h1>
        <p className="text-sm text-on-surface-variant mt-1">Upload Excel templates to generate voice flows</p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-outline-variant bg-surface-container-lowest hover:border-outline'
        }`}
      >
        <Icon
          name="upload_file"
          className={`mx-auto mb-3 ${dragActive ? 'text-primary' : 'text-on-surface-variant'}`}
          size={40}
        />
        <p className="text-sm text-on-surface mb-1">Drop your .xlsx template here</p>
        <p className="text-xs text-on-surface-variant">or click to browse</p>
        <input
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={() => navigate('/flows?generate=true')}
        />
      </div>

      {/* Existing templates */}
      <div>
        <h2 className="text-lg font-bold text-navy mb-4 font-headline">Existing Templates</h2>
        <div className="grid grid-cols-3 gap-4">
          {MOCK_TEMPLATES.map((tpl) => (
            <div
              key={tpl.name}
              className="rounded-xl bg-surface-container-lowest p-5 hover:bg-surface-container-low transition-colors cursor-pointer group shadow-ambient"
              onClick={() => navigate(`/flows?load=${tpl.flowId}`)}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="description" className="text-success" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-on-surface truncate">{tpl.name}</div>
                  <div className="text-xs text-on-surface-variant mt-0.5">{tpl.fields} fields</div>
                  <div className="text-xs text-outline mt-0.5">Last used: {tpl.lastUsed}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-3 text-xs text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Open flow</span>
                <Icon name="arrow_forward" size={14} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
