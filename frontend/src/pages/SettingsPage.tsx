import { useState } from 'react'
import Icon from '../components/Icon'

export default function SettingsPage() {
  const [language, setLanguage] = useState('vi')
  const [ttsVoice, setTtsVoice] = useState('vi-VN-HoaiMyNeural')
  const [apiUrl, setApiUrl] = useState('http://localhost:8000')
  const [maxRetries, setMaxRetries] = useState('3')

  const inputCls =
    'w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary-container'

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy font-headline">Settings</h1>
        <p className="text-sm text-on-surface-variant mt-1">Configure the voice agent system</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Language */}
        <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="language" className="text-primary" size={20} />
            <h2 className="text-sm font-bold text-on-surface">Language &amp; Locale</h2>
          </div>
          <div>
            <label className="text-xs text-on-surface-variant mb-1 block font-label">Default Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
            </select>
          </div>
        </div>

        {/* Voice */}
        <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="record_voice_over" className="text-tertiary" size={20} />
            <h2 className="text-sm font-bold text-on-surface">Voice Settings</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block font-label">TTS Voice</label>
              <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} className={inputCls}>
                <option value="vi-VN-HoaiMyNeural">vi-VN-HoaiMyNeural (Female)</option>
                <option value="vi-VN-NamMinhNeural">vi-VN-NamMinhNeural (Male)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block font-label">Max Retries per Field</label>
              <input
                type="number"
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* API */}
        <div className="rounded-xl bg-surface-container-lowest p-6 shadow-ambient">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="dns" className="text-success" size={20} />
            <h2 className="text-sm font-bold text-on-surface">Backend API</h2>
          </div>
          <div>
            <label className="text-xs text-on-surface-variant mb-1 block font-label">API Base URL</label>
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>
    </div>
  )
}
