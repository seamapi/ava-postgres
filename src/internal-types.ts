import { ExecResult } from "testcontainers/dist/docker/types"
import { Except, JsonObject } from "type-fest"
import {
  ConnectionDetails,
  GetTestPostgresDatabaseFactoryOptions,
} from "./public-types"

export interface InitialWorkerData {
  postgresVersion: string
  containerOptions?: GetTestPostgresDatabaseFactoryOptions<any>["container"]
}

export type ConnectionDetailsFromWorker = Except<ConnectionDetails, "pool">

export interface RequestDatabaseFromWorkerMessage {
  type: "GET_TEST_DATABASE"
  params?: JsonObject
}

export interface RequestBeforeTemplateIsBakedHookToBeRunMessage {
  type: "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED"
  connectionDetails: ConnectionDetailsFromWorker
}

export interface FinishedRunningBeforeTemplateIsBakedHookMessage {
  type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED"
  result: any
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
  beforeTemplateIsBakedResult: any
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