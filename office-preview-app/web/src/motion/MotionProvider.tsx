// 模型：claude-sonnet-4-6
// MotionProvider — wraps tree with MotionConfig honoring reduced-motion
// Phase 0: pure wrapper, no actual motion config yet (Phase 1.B adds primitives)

import { ReactNode } from 'react'

export interface MotionProviderProps {
  children: ReactNode
}

export function MotionProvider({ children }: MotionProviderProps) {
  // Phase 0: pass-through. Phase 1.B will wrap with <MotionConfig reducedMotion="user">
  return <>{children}</>
}
