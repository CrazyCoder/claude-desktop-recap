/** A recap, the transcript length it summarizes and the prompt that asked for it. */
export type Recap = { text: string; at: number; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    'desktop-recap': { recap: Recap | null; isDismissed: boolean }
  }
}
