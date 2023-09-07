import type { StartedNetwork } from "testcontainers"
import type { Jsonifiable } from "type-fest"
import type {
  ConnectionDetails,
  GetTestPostgresDatabaseFactoryOptions,
} from "./public-types"
import type { ExecResult } from "testcontainers/dist/src/docker/types"

export interface InitialWorkerData {
  postgresVersion: string
  containerOptions?: GetTestPostgresDatabaseFactoryOptions<any>["container"]
}

export type ConnectionDetailsFromWorker = Omit<
  ConnectionDetails,
  "pool" | "networkDocker"
> & {
  networkDocker: {
    id: ConstructorParameters<typeof StartedNetwork>[0]
    options: ConstructorParameters<typeof StartedNetwork>[1]
  }
}

export interface RequestDatabaseFromWorkerMessage {
  type: "GET_TEST_DATABASE"
  key?: string
  params?: Jsonifiable
}

export interface RequestBeforeTemplateIsBakedHookToBeRunMessage {
  type: "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED"
  connectionDetails: ConnectionDetailsFromWorker
}

export interface FinishedRunningBeforeTemplateIsBakedHookMessage {
  type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED"
  result:
    | {
        status: "success"
        result: any
      }
    | {
        status: "error"
        error: Error | string
      }
}

export interface ExecCommandInContainerMessage {
  type: "EXEC_COMMAND_IN_CONTAINER"
  command: string[]
}

export interface ExecCommandInContainerResultMessage {
  type: "EXEC_COMMAND_IN_CONTAINER_RESULT"
  result: ExecResult
}

export interface GotDatabaseMessage {
  type: "GOT_DATABASE"
  connectionDetails: ConnectionDetailsFromWorker
  beforeTemplateIsBakedResult: FinishedRunningBeforeTemplateIsBakedHookMessage["result"]
}

export type MessageToWorker =
  | RequestDatabaseFromWorkerMessage
  | FinishedRunningBeforeTemplateIsBakedHookMessage
  | ExecCommandInContainerMessage
export type MessageFromWorker =
  | RequestBeforeTemplateIsBakedHookToBeRunMessage
  | GotDatabaseMessage
  | ExecCommandInContainerResultMessage
export type WorkerMessage = MessageToWorker | MessageFromWorker
