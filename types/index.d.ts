/** A recap and the transcript length it summarizes. */
export type Recap = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'desktop-recap': { recap: Recap | null; isDismissed: boolean }
  }
}
