export interface ProjectFile {
  path: string
  data: Uint8Array
}

export interface TypstCompileRequest {
  type: 'compile'
  id: number
  source: string
  /** Supplied once when a session's worker is created. */
  files?: ProjectFile[]
  fonts?: Uint8Array[]
  baseUrl: string
}

export type TypstRequest = TypstCompileRequest | { type: 'cancel'; id: number }

export type TypstResponse =
  | { type: 'progress'; id: number; message: string }
  | { type: 'result'; id: number; pdf: Uint8Array; diagnostics: string[] }
  | { type: 'error'; id: number; message: string }
