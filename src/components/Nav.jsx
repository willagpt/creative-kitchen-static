import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'

const steps = [
  { path: '/brand-setup', label: 'Brand Setup', index: 0 },
  { path: '/brand-dna', label: 'Brand DNA', index: 1 },
  { path: '/templates', label: 'Templates', index: 2 },
  { path: '/prompt-lab', label: 'Prompt Lab', index: 3 },
  { path: '/generate', label: 'Generate', index: 4 },
  { path: '/review', label: 'Review', index: 5 },
]

export default function Nav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut, user } = useAuth()
  const { workspace, currentRun } = useWorkspace()

  const currentStep = steps.findIndex(s => s.path === location.pathname)

  const canNavigate = (step) => {
    if (step.index === 0) return true
    if (step.index <= 1 && currentRun) return true
    if (step.index <= 5 && currentRun?.dna && Object.keys(currentRun.dna).length > 0) return true
    return false
  }

  return (
    <header className="glass-nav sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <span className="text-lg">\uD83C\uDF73</span>
          <span className="font-semibold text-sm text-white">Creative Kitchen</span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
            Static
          </span>
        </div>

        {/* Steps */}
        <div className="hidden md:flex items-center gap-1">
          {steps.map((step, i) => {
            const isActive = location.pathname === step.path
            const isAccessible = canNavigate(step)
            return (
              <div key={step.path} className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-700 text-xs mx-1">\u2014</span>}
                <div
                  className={`flex items-center gap-1 ${isAccessible ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => isAccessible && navigate(step.path)}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    isActive ? 'bg-orange-500' :
                    currentStep > step.index ? 'bg-green-500' :
                    'bg-zinc-600'
                  }`} />
                  <span className={`text-[11px] transition-colors ${
                    isActive ? 'text-white font-semibold' :
                    isAccessible ? 'text-zinc-400 hover:text-zinc-300' :
                    'text-zinc-600'
                  }`}>
                    {step.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
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
