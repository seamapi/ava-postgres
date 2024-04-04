import type { ExecResult } from "testcontainers"
import type { Jsonifiable } from "type-fest"

import type {
  ConnectionDetails,
  GetTestPostgresDatabaseFactoryOptions,
} from "./public-types"

export interface InitialWorkerData {
  postgresVersion: string
  containerOptions?: GetTestPostgresDatabaseFactoryOptions<any>["container"]
  pgbouncerOptions?: GetTestPostgresDatabaseFactoryOptions<any>["pgbouncer"]
}

export type ConnectionDetailsFromWorker = Omit<ConnectionDetails, "pool">

export interface TestWorkerFunctions {
  runBeforeTemplateIsBakedHook: (
    connectionDetails: ConnectionDetailsFromWorker,
    params?: Jsonifiable
  ) => Promise<unknown>
}

export interface SharedWorkerFunctions {
  getTestDatabase: (options: {
    databaseDedupeKey?: string
    params?: Jsonifiable
  }) => Promise<{
    connectionDetails: ConnectionDetailsFromWorker
    beforeTemplateIsBakedResult: unknown
  }>
  execCommandInContainer: (command: string[]) => Promise<ExecResult>
}
