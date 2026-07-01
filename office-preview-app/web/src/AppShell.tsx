// AppShell — 顶层错误边界 + a11y skip link
// 模型：claude-sonnet-4-6
import React from 'react'

interface State { hasError: boolean; error: Error | null }

export class AppShell extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppShell] uncaught error:', error, info)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, fontFamily: 'system-ui', maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ fontSize: 24, color: '#ff4d4f', marginBottom: 16 }}>
            页面出错了
          </h1>
          <pre style={{ background: '#f5f6f7', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {this.state.error?.stack || this.state.error?.message || 'Unknown error'}
          </pre>
          <button
            onClick={this.reset}
            style={{
              marginTop: 16, padding: '8px 16px', background: '#1677ff', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return <>{this.props.children}</>
  }
}