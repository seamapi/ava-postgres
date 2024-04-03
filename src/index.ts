import { registerSharedWorker } from "ava/plugin"
import hash from "object-hash"
import path from "node:path"
import type {
  ConnectionDetailsFromWorker,
  InitialWorkerData,
} from "./internal-types"
import type {
  ConnectionDetails,
  GetTestPostgresDatabase,
  GetTestPostgresDatabaseFactoryOptions,
  GetTestPostgresDatabaseOptions,
} from "./public-types"
import { Pool } from "pg"
import type { Jsonifiable } from "type-fest"
import type { ExecutionContext } from "ava"
import { once } from "node:events"
import { createBirpc } from "birpc"
import { SharedWorkerFunctions, TestWorkerFunctions } from "./lib/rpc"
import { ExecResult } from "testcontainers"

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
        connectionString: connectionDetailsFromWorker.connectionString,
      })

      let pgbouncerPool: Pool | undefined
      if (connectionDetailsFromWorker.pgbouncerConnectionString) {
        pgbouncerPool = new Pool({
          connectionString:
            connectionDetailsFromWorker.pgbouncerConnectionString,
        })
      }

      t.teardown(async () => {
        try {
          await pool.end()
          await pgbouncerPool?.end()
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
        pgbouncerPool,
      }
    }

    const worker = await workerPromise
    await worker.available

    let rpcCallback: (data: any) => void

    const rpc = createBirpc<SharedWorkerFunctions, TestWorkerFunctions>(
      {
        runBeforeTemplateIsBakedHook: async (connection) => {
          if (options?.beforeTemplateIsBaked) {
            const connectionDetails =
              mapWorkerConnectionDetailsToConnectionDetails(connection)

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

            const hookResult = await options.beforeTemplateIsBaked({
              params,
              connection: connectionDetails,
              containerExec: async (command): Promise<ExecResult> =>
                rpc.execCommandInContainer(command),
            })

            return hookResult
          }
        },
      },
      {
        post: (data) => worker.publish(data),
        on: (data) => {
          rpcCallback = data
        },
      }
    )

    const messageHandlerAbortController = new AbortController()
    const messageHandlerPromise = Promise.race([
      once(messageHandlerAbortController.signal, "abort"),
      (async () => {
        for await (const msg of worker.subscribe()) {
          rpcCallback!(msg.data)

          if (messageHandlerAbortController.signal.aborted) {
            break
          }
        }
      })(),
    ])

    t.teardown(async () => {
      messageHandlerAbortController.abort()
      await messageHandlerPromise
    })

    const testDatabaseConnection = await rpc.getTestDatabase({
      // todo: rename?
      key: getTestDatabaseOptions?.databaseDedupeKey,
      params,
    })

    return {
      ...mapWorkerConnectionDetailsToConnectionDetails(
        testDatabaseConnection.connectionDetails
      ),
      beforeTemplateIsBakedResult:
        testDatabaseConnection.beforeTemplateIsBakedResult,
    }
  }

  return getTestPostgresDatabase
}

export * from "./public-types"
