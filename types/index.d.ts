export type RsvpRev = number

declare module 'claude-code' {
  interface PluginState {
    'rsvp-reader': { rev: RsvpRev }
  }
}
