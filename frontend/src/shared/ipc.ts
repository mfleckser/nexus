// Types shared by the main process, preload and renderer (type-only: never
// import runtime values from here, the sandboxed preload can't load them).

// Result of an API call proxied through the main process: the shared client's
// transport result. Failures come back as data rather than a rejected promise:
// Electron reduces errors crossing IPC to a prefixed message string, dropping
// the status code.
export type { TransportResult as ApiResult } from "@nexus/shared";
