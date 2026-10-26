import type { DevLineWebviewContext, DevLineWebviewSdk } from '@devline/extension-devkit'
export type StudioContext = DevLineWebviewContext
export type StudioSDK = DevLineWebviewSdk<StudioContext>

declare global { interface Window { devline: StudioSDK } }
export const sdk = window.devline
