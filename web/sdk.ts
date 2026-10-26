export interface StudioContext {
  locale: string
  theme: string
  visible: boolean
  view?: { id: string; location: 'dock' | 'sidebar' | 'settings' }
  document?: { path: string }
}
export interface StudioSDK {
  ready: Promise<StudioContext>
  getContext(): StudioContext
  getState(): unknown
  setState(value: unknown): void
  onContextChanged(callback: (context: StudioContext) => void): () => void
  onBeforeDocumentSave(callback: () => Promise<void>): () => void
  call<T = unknown>(method: string, arguments_?: Record<string, unknown>): Promise<T>
}
declare global { interface Window { devline: StudioSDK } }
export const sdk = window.devline
