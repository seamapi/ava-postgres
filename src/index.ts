import { registerSharedWorker, SharedWorker } from "ava/plugin"
import hash from "object-hash"
import path from "node:path"
import {
  ConnectionDetailsFromWorker,
  FinishedRunningBeforeTemplateIsBakedHookMessage,
  InitialWorkerData,
  MessageFromWorker,
  MessageToWorker,
} from "./internal-types"
import {
  ConnectionDetails,
  GetTestPostgresDatabase,
  GetTestPostgresDatabaseFactoryOptions,
  GetTestPostgresDatabaseOptions,
  GetTestPostgresDatabaseResult,
} from "./public-types"
import { Pool } from "pg"
import { JsonObject } from "type-fest"
import { StartedNetwork } from "testcontainers"

const mapWorkerConnectionDetailsToConnectionDetails = (
  connectionDetailsFromWorker: ConnectionDetailsFromWorker
): ConnectionDetails => ({
  ...connectionDetailsFromWorker,
  networkDocker: new StartedNetwork(
    connectionDetailsFromWorker.networkDocker.id,
    connectionDetailsFromWorker.networkDocker.options
  ),
  pool: new Pool({
    connectionString: connectionDetailsFromWorker.connectionString,
  }),
})

const getWorker = async (
  initialData: InitialWorkerData,
  options?: GetTestPostgresDatabaseFactoryOptions<any>
) => {
  const key = hash({
    initialData,
    key: options?.key,
  })

  if (process.env.IS_TESTING_AVA_POSTGRES) {
    const { registerSharedTypeScriptWorker } = await import(
      "ava-typescript-worker"
    )
    return registerSharedTypeScriptWorker({
      filename: new URL(
        `file:${path.resolve(__dirname, "worker-wrapper.ts")}#${key}`
      ),
      initialData: initialData as any,
    })
  }

  return registerSharedWorker({
    filename: new URL(
      `file:${path.resolve(__dirname, "worker-wrapper.mjs")}#${key}`
    ),
    initialData: initialData as any,
    supportedProtocols: ["ava-4"],
  })
}

export const getTestPostgresDatabaseFactory = <
  Params extends JsonObject = never
>(
  options?: GetTestPostgresDatabaseFactoryOptions<Params>
) => {
  const initialData: InitialWorkerData = {
    postgresVersion: options?.postgresVersion ?? "14",
    containerOptions: options?.container,
  }

  const workerPromise = getWorker(initialData, options as any)

  const getTestPostgresDatabase: GetTestPostgresDatabase<Params> = async (
    params: any,
    getTestDatabaseOptions?: GetTestPostgresDatabaseOptions
  ) => {
    const worker = await workerPromise
    await worker.available

    const waitForAndHandleReply = async (
      message: SharedWorker.Plugin.PublishedMessage
    ): Promise<GetTestPostgresDatabaseResult> => {
      let reply = await message.replies().next()
      const replyData: MessageFromWorker = reply.value.data

      if (replyData.type === "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
        let result: FinishedRunningBeforeTemplateIsBakedHookMessage["result"] =
          {
            status: "success",
            result: undefined,
          }

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

          try {
            const hookResult = await options.beforeTemplateIsBaked({
              params,
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

            result = {
              status: "success",
              result: hookResult,
            }
          } catch (error) {
            result = {
              status: "error",
              error: error as Error,
            }
          } finally {
            await connectionDetails.pool.end()
          }
        }

        return waitForAndHandleReply(
          reply.value.reply({
            type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED",
            result,
          } as MessageToWorker)
        )
      } else if (replyData.type === "GOT_DATABASE") {
        if (replyData.beforeTemplateIsBakedResult.status === "error") {
          throw replyData.beforeTemplateIsBakedResult.error
        }

        return {
          ...mapWorkerConnectionDetailsToConnectionDetails(
            replyData.connectionDetails
          ),
          beforeTemplateIsBakedResult:
            replyData.beforeTemplateIsBakedResult.result,
        }
      }

      throw new Error(`Unexpected message type: ${replyData.type}`)
    }

    return waitForAndHandleReply(
      worker.publish({
        type: "GET_TEST_DATABASE",
        params,
        key: getTestDatabaseOptions?.key,
      } as MessageToWorker)
    )
  }

  return getTestPostgresDatabase
}

export * from "./public-types"
