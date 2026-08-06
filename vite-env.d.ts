declare module '@webxdc/vite-plugins' {
  import type { PluginOption, UserConfig } from 'vite'

  export function webxdcViteConfig(config?: UserConfig): UserConfig
  export function buildXDC(opts?: Record<string, unknown>): PluginOption
  export function eruda(debug?: boolean): PluginOption
  export function mockWebxdc(path?: string): PluginOption
  export function secureContext(): PluginOption
}
