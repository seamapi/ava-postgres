import { SharedWorker } from "ava/plugin"
import hash from "object-hash"
import path from "node:path"
import { registerSharedTypeScriptWorker } from "ava-typescript-worker"
import {
  ConnectionDetailsFromWorker,
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
import { JsonObject } from "type-fest"
import { pick } from "lodash"

const mapWorkerConnectionDetailsToConnectionDetails = (
  connectionDetailsFromWorker: ConnectionDetailsFromWorker
): ConnectionDetails => ({
  ...connectionDetailsFromWorker,
  pool: new Pool({
    connectionString: connectionDetailsFromWorker.connectionString,
  }),
})

export const getTestPostgresDatabaseFactory = <
  Params extends JsonObject = never
>(
  options?: GetTestPostgresDatabaseFactoryOptions<Params>
) => {
  const initialData: InitialWorkerData = {
    postgresVersion: options?.postgresVersion ?? "14",
    containerOptions: options?.container,
  }

  const worker = registerSharedTypeScriptWorker({
    filename: new URL(
      `file:${path.resolve(__dirname, "worker-wrapper.ts")}#${hash({
        initialData,
        // todo: add test to make sure workers are de-duped
        key: options?.key,
      })}`
    ),
    initialData: initialData as any,
  })

  const getTestPostgresDatabase: GetTestPostgresDatabase<Params> = async (
    params
  ) => {
    await worker.available

    const waitForAndHandleReply = async (
      message: SharedWorker.Plugin.PublishedMessage
    ): Promise<ConnectionDetails> => {
      const reply = await message.replies().next()
      const replyData: MessageFromWorker = reply.value.data

      if (replyData.type === "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
        if (options?.hooks?.beforeTemplateIsBaked) {
          const connectionDetails =
            mapWorkerConnectionDetailsToConnectionDetails(
              replyData.connectionDetails
            )

          await options.hooks.beforeTemplateIsBaked(connectionDetails, params)

          await connectionDetails.pool.end()
        }

        return waitForAndHandleReply(
          reply.value.reply({
            type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED",
          } as MessageToWorker)
        )
      } else if (replyData.type === "GOT_DATABASE") {
        return mapWorkerConnectionDetailsToConnectionDetails(
          replyData.connectionDetails
        )
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
