import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { user, signInWithEmail, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to="/brand-setup" replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: err } = await signInWithEmail(email)
    if (err) {
      setError(err.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-0)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🍳</div>
          <h1 className="text-xl font-semibold text-white mb-1">Creative Kitchen</h1>
          <p className="text-zinc-500 text-sm">Static Ad Generator</p>
        </div>

        <div className="card">
          {sent ? (
            <div className="text-center py-4">
              <div className="text-2xl mb-3">📧</div>
              <p className="text-white font-medium mb-1">Check your email</p>
              <p className="text-zinc-400 text-sm">
                We sent a login link to <span className="text-white">{email}</span>
              </p>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-zinc-400 mb-1.5 block">Email address</label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <button
                  type="submit"
                  className="btn btn-primary w-full justify-center"
                  disabled={loading}
                >
                  {loading ? 'Sending...' : 'Send magic link'}
                </button>
              </form>

              <div className="flex items-center gap-3 my-4">
                <div className="h-px bg-zinc-800 flex-1" />
                <span className="text-zinc-600 text-xs">or</span>
                <div className="h-px bg-zinc-800 flex-1" />
              </div>

              <button
                onClick={signInWithGoogle}
                className="btn btn-secondary w-full justify-center"
              >
                Continue with Google
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
