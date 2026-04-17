import { NavLink, Outlet } from 'react-router-dom'
import Icon from './components/Icon'

const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: 'Dashboard' },
  { to: '/calls', icon: 'history', label: 'Call History', fill: true },
  { to: '/analytics', icon: 'insights', label: 'Analytics' },
  { to: '/flows', icon: 'account_tree', label: 'Flow Designer' },
]

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="fixed left-0 top-0 h-full w-64 flex flex-col py-6 bg-navy text-white z-50">
        {/* Logo */}
        <div className="px-6 mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
              <Icon name="account_balance" className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-black tracking-tight leading-tight text-sm">
                TECHVIFY
              </h1>
              <p className="text-[11px] text-blue-200/60 font-medium">AI Call Center Hub</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                isActive
                  ? 'flex items-center gap-3 bg-primary-container text-white rounded-lg mx-2 my-1 px-4 py-3 transition-all duration-200 translate-x-1 font-semibold text-sm'
                  : 'flex items-center gap-3 text-blue-200/70 hover:text-white px-6 py-3 hover:bg-white/10 transition-all duration-200 text-sm'
              }
            >
              <Icon name={item.icon} fill={item.fill} />
              <span className="font-body">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="px-4 mt-auto">
          <a
            href="#"
            className="flex items-center gap-3 text-blue-200/70 hover:text-white px-4 py-2 hover:bg-white/10 transition-all duration-200"
          >
            <Icon name="logout" size={20} />
            <span className="text-xs">Sign Out</span>
          </a>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="pl-64 h-full flex flex-col flex-1 bg-surface">
        <Outlet />
      </main>
    </div>
  )
}
