import type { ExecResult } from "testcontainers"
import type { Jsonifiable } from "type-fest"
import type { ConnectionDetailsFromWorker } from "~/internal-types"

export interface TestWorkerFunctions {
  runBeforeTemplateIsBakedHook: (
    connectionDetails: ConnectionDetailsFromWorker,
    params?: Jsonifiable
  ) => Promise<unknown>
}

export interface SharedWorkerFunctions {
  getTestDatabase: (options: {
    key?: string
    params?: Jsonifiable
  }) => Promise<{
    connectionDetails: ConnectionDetailsFromWorker
    beforeTemplateIsBakedResult: unknown
  }>
  execCommandInContainer: (command: string[]) => Promise<ExecResult>
}
