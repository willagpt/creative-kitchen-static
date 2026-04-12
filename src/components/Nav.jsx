import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'

const navItems = [
  { path: '/competitor-ads', label: 'Competitor Ads' },
  { path: '/compare', label: 'Compare' },
  { path: '/brand-setup', label: 'Brand Setup' },
  { path: '/brand-dna', label: 'Brand DNA' },
  { path: '/templates', label: 'Templates' },
  { path: '/prompt-lab', label: 'Prompt Lab' },
  { path: '/generate', label: 'Generate' },
  { path: '/review', label: 'Review' },
]

export default function Nav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const { workspace } = useWorkspace()

  return (
    <header className="glass-nav sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-lg">\uD83C\uDF73</span>
          <span className="font-semibold text-sm text-white">Creative Kitchen</span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
            Static
          </span>
        </div>

        {/* Nav items */}
        <div className="hidden md:flex items-center gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-orange-500/15 text-orange-400'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-[var(--bg-1)]'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => navigate('/upload')}
            className="btn-ghost text-xs"
          >
            \uD83D\uDCE4 Upload
          </button>
          {workspace && (
            <span className="text-[10px] text-zinc-500">{workspace.name}</span>
          )}
          <button onClick={signOut} className="btn-ghost text-xs">
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
