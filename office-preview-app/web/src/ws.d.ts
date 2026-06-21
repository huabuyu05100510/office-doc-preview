declare module 'ws' {
  export class WebSocket {
    constructor(url: string, protocols?: string | string[])
    readyState: number
    onopen: ((ev: any) => void) | null
    onclose: ((ev: any) => void) | null
    onerror: ((ev: any) => void) | null
    onmessage: ((ev: any) => void) | null
    send(data: string): void
    close(): void
    on(event: string, listener: (...args: any[]) => void): void
    off(event: string, listener: (...args: any[]) => void): void
    once(event: string, listener: (...args: any[]) => void): void
  }
  export class WebSocketServer {
    constructor(opts?: any)
    handleUpgrade(req: any, socket: any, head: any, cb: (ws: WebSocket) => void): void
    clients: Set<WebSocket>
    close(cb?: () => void): void
    on(event: string, listener: (...args: any[]) => void): void
  }
}
