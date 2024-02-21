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
import { Jsonifiable } from "type-fest"
import { StartedNetwork } from "testcontainers"
import { ExecutionContext } from "ava"

const getWorker = async (
  initialData: InitialWorkerData,
  options?: GetTestPostgresDatabaseFactoryOptions<any>
) => {
  const key = hash({
    initialData,
    key: options?.workerDedupeKey,
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
  Params extends Jsonifiable = never
>(
  options?: GetTestPostgresDatabaseFactoryOptions<Params>
) => {
  const initialData: InitialWorkerData = {
    postgresVersion: options?.postgresVersion ?? "14",
    containerOptions: options?.container,
    pgbouncerOptions: options?.pgbouncer,
  }

  const workerPromise = getWorker(initialData, options as any)

  const getTestPostgresDatabase: GetTestPostgresDatabase<Params> = async (
    t: ExecutionContext,
    params: any,
    getTestDatabaseOptions?: GetTestPostgresDatabaseOptions
  ) => {
    const mapWorkerConnectionDetailsToConnectionDetails = (
      connectionDetailsFromWorker: ConnectionDetailsFromWorker
    ): ConnectionDetails => {
      const pool = new Pool({
        connectionString:
          connectionDetailsFromWorker.pgbouncerConnectionString ??
          connectionDetailsFromWorker.connectionString,
      })

      t.teardown(async () => {
        try {
          await pool.end()
        } catch (error) {
          if (
            (error as Error).message.includes(
              "Called end on pool more than once"
            )
          ) {
            return
          }

          throw error
        }
      })

      return {
        ...connectionDetailsFromWorker,
        pool,
      }
    }

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
              error:
                error instanceof Error
                  ? error.stack ?? error.message
                  : new Error(
                      "Unknown error type thrown in beforeTemplateIsBaked hook"
                    ),
            }
          } finally {
            // Otherwise connection will be killed by worker when converting to template
            await connectionDetails.pool.end()
          }
        }

        try {
          return waitForAndHandleReply(
            reply.value.reply({
              type: "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED",
              result,
            } as MessageToWorker)
          )
        } catch (error) {
          if (error instanceof Error && error.name === "DataCloneError") {
            throw new TypeError(
              "Return value of beforeTemplateIsBaked() hook could not be serialized. Make sure it returns only JSON-serializable values."
            )
          }

          throw error
        }
      } else if (replyData.type === "GOT_DATABASE") {
        if (replyData.beforeTemplateIsBakedResult.status === "error") {
          if (typeof replyData.beforeTemplateIsBakedResult.error === "string") {
            throw new Error(replyData.beforeTemplateIsBakedResult.error)
          }

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
        key: getTestDatabaseOptions?.databaseDedupeKey,
      } as MessageToWorker)
    )
  }

  return getTestPostgresDatabase
}

export * from "./public-types"
