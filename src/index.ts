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
      let reply = await message.replies().next()
      const replyData: MessageFromWorker = reply.value.data

      if (replyData.type === "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
        if (options?.beforeTemplateIsBaked) {
          const connectionDetails =
            mapWorkerConnectionDetailsToConnectionDetails(
              replyData.connectionDetails
            )

          // Ignore if the pool is terminated by the shared worker
          // (This happens in CI for some reason even though we drain the pool first.)
          connectionDetails.pool.on("error", (error) => {
            if (
              error.message.includes(
                "terminating connection due to administrator command"
              )
            ) {
              return
            }

            throw error
          })

          await options.beforeTemplateIsBaked({
            params: params as any,
            connection: connectionDetails,
            containerExec: async (command) => {
              const request = reply.value.reply({
                type: "EXEC_COMMAND_IN_CONTAINER",
                command,
              })

              reply = await request.replies().next()

              if (
                reply.value.data.type !== "EXEC_COMMAND_IN_CONTAINER_RESULT"
              ) {
                throw new Error(
                  "Expected EXEC_COMMAND_IN_CONTAINER_RESULT message"
                )
              }

              return reply.value.data.result
            },
          })

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

      throw new Error(`Unexpected message type: ${replyData.type}`)
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
