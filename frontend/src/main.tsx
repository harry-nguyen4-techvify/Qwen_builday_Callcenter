import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './Layout'
import Dashboard from './pages/Dashboard'
import LiveCallConsole from './pages/LiveCallConsole'
import CallsPage from './pages/CallsPage'
import FlowDesigner from './pages/FlowDesigner'
import VoiceTest from './pages/VoiceTest'
import Templates from './pages/Templates'
import SettingsPage from './pages/SettingsPage'
import PhoneSimulator from './pages/PhoneSimulator'
import PhoneV2 from './pages/PhoneV2'
import OperatorJoin from './pages/OperatorJoin'
import CallTranscriptPage from './pages/CallTranscriptPage'
import Analytics from './pages/Analytics'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Standalone page without Layout */}
        <Route path="/phone" element={<PhoneSimulator />} />
        <Route path="/phone-v2" element={<PhoneV2 />} />
        <Route path="/operator-join/:callId" element={<OperatorJoin />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calls" element={<CallsPage />} />
          <Route path="/calls/:callId" element={<LiveCallConsole />} />
          <Route path="/calls/:callId/transcript" element={<CallTranscriptPage />} />
          <Route path="/flows" element={<FlowDesigner />} />
          <Route path="/voice-test" element={<VoiceTest />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Placeholder routes for new nav items */}
          <Route path="/customers" element={<PlaceholderPage title="Customer Vault" icon="account_balance" />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/ai-trainer" element={<PlaceholderPage title="AI Trainer" icon="psychology" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

function PlaceholderPage({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <span className="material-symbols-outlined text-6xl text-primary/30">{icon}</span>
        <h2 className="text-2xl font-bold text-navy font-headline">{title}</h2>
        <p className="text-on-surface-variant text-sm">Coming soon</p>
      </div>
    </div>
  )
}
