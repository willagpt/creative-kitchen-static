import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const WorkspaceContext = createContext({})

export function WorkspaceProvider({ children }) {
  const { user } = useAuth()
  const [workspace, setWorkspace] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [currentRun, setCurrentRun] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setWorkspace(null)
      setWorkspaces([])
      setCurrentRun(null)
      setLoading(false)
      return
    }
    fetchWorkspaces()
  }, [user])

  const fetchWorkspaces = async () => {
    setLoading(true)
    const { data: memberships } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces(id, name, slug, owner_id, settings)')
      .eq('user_id', user.id)

    const ws = (memberships || []).map(m => ({ ...m.workspaces, role: m.role }))
    setWorkspaces(ws)

    if (ws.length > 0 && !workspace) {
      setWorkspace(ws[0])
    }
    setLoading(false)
  }

  const selectWorkspace = (ws) => {
    setWorkspace(ws)
    setCurrentRun(null)
  }

  const selectRun = (run) => {
    setCurrentRun(run)
  }

  return (
    <WorkspaceContext.Provider value={{
      workspace, workspaces, currentRun,
      loading, selectWorkspace, selectRun,
      fetchWorkspaces
    }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export const useWorkspace = () => useContext(WorkspaceContext)
