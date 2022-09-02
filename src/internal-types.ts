import { Except, JsonObject } from "type-fest"
import {
  ConnectionDetails,
  GetTestPostgresDatabaseFactoryOptions,
} from "./public-types"

export interface InitialWorkerData {
  postgresVersion: string
  containerOptions?: GetTestPostgresDatabaseFactoryOptions<any>["container"]
}

export interface RequestDatabaseFromWorkerMessage {
  type: "GET_TEST_DATABASE"
  params?: JsonObject
}

export interface RequestBeforeTemplateIsBakedHookToBeRunMessage {
  type: "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED"
  requestId: string
  connectionDetails: Except<ConnectionDetails, "pool">
}

export interface FinishedRunningBeforeTemplateIsBakedHookMessage {
  type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED"
  requestId: string
}

export interface GotDatabaseMessage {
  type: "GOT_DATABASE"
  connectionDetails: Except<ConnectionDetails, "pool">
}

export type MessageToWorker =
  | RequestDatabaseFromWorkerMessage
  | FinishedRunningBeforeTemplateIsBakedHookMessage
export type MessageFromWorker =
  | RequestBeforeTemplateIsBakedHookToBeRunMessage
  | GotDatabaseMessage
export type WorkerMessage = MessageToWorker | MessageFromWorker
