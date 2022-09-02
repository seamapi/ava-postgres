import { SharedWorker } from "ava/plugin"
import hash from "object-hash"
import path from "node:path"
import { registerSharedTypeScriptWorker } from "ava-typescript-worker"
import {
  InitialWorkerData,
  MessageFromWorker,
  MessageToWorker,
} from "./internal-types"
import {
  ConnectionDetails,
  GetTestPostgresDatabase,
  GetTestPostgresDatabaseFactoryOptions,
} from "./public-types"
import { Pool } from "pg"

export const getTestPostgresDatabaseFactory = <Params>(
  options?: GetTestPostgresDatabaseFactoryOptions<Params>
) => {
  const initialData: InitialWorkerData = {
    postgresVersion: options?.postgresVersion ?? "14",
    containerOptions: options?.container,
  }

  const worker = registerSharedTypeScriptWorker({
    filename: new URL(
      `file:${path.resolve(__dirname, "worker.ts")}#${hash(initialData)}`
    ),
    initialData: initialData as any,
  })

  const getTestPostgresDatabase: GetTestPostgresDatabase<Params> = async (
    params?: Params
  ) => {
    const waitForAndHandleReply = async (
      message: SharedWorker.Plugin.PublishedMessage
    ): Promise<ConnectionDetails> => {
      const reply = await message.replies().next()
      const replyData: MessageFromWorker = reply.value.data

      if (replyData.type === "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
        if (options?.hooks?.beforeTemplateIsBaked) {
          await options.hooks.beforeTemplateIsBaked(
            {
              ...replyData.connectionDetails,
              pool: new Pool({
                connectionString: replyData.connectionDetails.connectionString,
              }),
            },
            params
          )
        }

        return waitForAndHandleReply(
          worker.publish({
            type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED",
            requestId: replyData.requestId,
          } as MessageToWorker)
        )
      } else if (replyData.type === "GOT_DATABASE") {
        const connectionDetails = {
          ...replyData.connectionDetails,
          pool: new Pool({
            connectionString: replyData.connectionDetails.connectionString,
          }),
        }

        if (options?.hooks?.afterTemplateIsBaked) {
          await options.hooks.afterTemplateIsBaked(connectionDetails, params)
        }
        return connectionDetails
      }

      throw new Error("Unexpected reply", replyData)
    }

    return waitForAndHandleReply(
      worker.publish({
        type: "GET_TEST_DATABASE",
        params,
      } as MessageToWorker)
    )
  }

  return getTestPostgresDatabase
}
