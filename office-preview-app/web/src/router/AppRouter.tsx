// 模型：claude-sonnet-4-6
// AppRouter — wraps the app with BrowserRouter and provides route-driven layout
// Phase 0: minimal; Phase 1 adds route-level lazy loading and transitions

import { ReactNode } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { routeToMenuKey, MenuKey } from '../routes'

export interface AppRouterProps {
  children: ReactNode
}

function RouteLogger() {
  const loc = useLocation()
  const ts = new Date().toISOString()
  const menuKey = routeToMenuKey(loc.pathname) as MenuKey
  console.info(`[router ${ts}] navigate: ${loc.pathname} -> ${menuKey}`)
  return null
}

export function AppRouter({ children }: AppRouterProps) {
  return (
    <BrowserRouter>
      <RouteLogger />
      {children}
    </BrowserRouter>
  )
}