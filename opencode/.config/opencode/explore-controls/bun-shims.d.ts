declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string)
    run(sql: string, ...bindings: unknown[]): { changes: number }
    query(sql: string): {
      get(...bindings: unknown[]): unknown
      all(...bindings: unknown[]): unknown[]
    }
    transaction<T>(work: () => T): { immediate: () => T }
    close(): void
  }
}

declare const Bun: {
  argv: string[]
  spawn(
    command: string[],
    options?: { stdout?: "pipe" | "inherit"; stderr?: "pipe" | "inherit" },
  ): {
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    exited: Promise<number>
    kill(signal?: string): void
  }
  spawnSync(args: string[]): {
    success: boolean
    stdout: { toString(): string }
  }
  sleep(milliseconds: number): Promise<void>
}

declare module "bun:test" {
  export function afterEach(callback: () => void): void
  export function describe(name: string, callback: () => void): void
  export function expect(value: unknown): any
  export function test(name: string, callback: () => void | Promise<void>): void
}

interface ImportMeta {
  dir: string
}
