import { registerSharedWorker } from "ava/plugin"
import hash from "object-hash"
import path from "node:path"
import type {
  ConnectionDetailsFromWorker,
  InitialWorkerData,
  SharedWorkerFunctions,
  TestWorkerFunctions,
} from "./internal-types"
import type {
  ConnectionDetails,
  GetTestPostgresDatabase,
  GetTestPostgresDatabaseFactoryOptions,
  GetTestPostgresDatabaseOptions,
  GetTestPostgresDatabaseResult,
} from "./public-types"
import { Pool } from "pg"
import type { Jsonifiable } from "type-fest"
import type { ExecutionContext } from "ava"
import { BirpcReturn, createBirpc } from "birpc"
import { ExecResult } from "testcontainers"
import isPlainObject from "lodash/isPlainObject"

// https://stackoverflow.com/a/30580513
const isSerializable = (obj: Record<any, any>): boolean => {
  var isNestedSerializable
  function isPlain(val: any) {
    return (
      typeof val === "undefined" ||
      typeof val === "string" ||
      typeof val === "boolean" ||
      typeof val === "number" ||
      val?.constructor === Date ||
      val === null ||
      Array.isArray(val) ||
      isPlainObject(val)
    )
  }
  if (!isPlain(obj)) {
    return false
  }
  for (var property in obj) {
    if (obj.hasOwnProperty(property)) {
      if (!isPlain(obj[property])) {
        return false
      }
      if (typeof obj[property] == "object") {
        isNestedSerializable = isSerializable(obj[property])
        if (!isNestedSerializable) {
          return false
        }
      }
    }
  }
  return true
}

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

const teardownConnection = async ({
  pool,
  pgbouncerPool,
}: ConnectionDetails) => {
  try {
    await pool.end()
    await pgbouncerPool?.end()
  } catch (error) {
    if (
      (error as Error).message.includes("Called end on pool more than once")
    ) {
      return
    }

    throw error
  }
}

export const getTestPostgresDatabaseFactory = <
  Params extends Jsonifiable = never
>(
  options?: GetTestPostgresDatabaseFactoryOptions<Params>
): GetTestPostgresDatabase<Params> => {
  const initialData: InitialWorkerData = {
    postgresVersion: options?.postgresVersion ?? "14",
    containerOptions: options?.container,
    pgbouncerOptions: options?.pgbouncer,
  }

  const workerPromise = getWorker(initialData, options as any)

  const mapWorkerConnectionDetailsToConnectionDetails = (
    connectionDetailsFromWorker: ConnectionDetailsFromWorker
  ): ConnectionDetails => {
    const pool = new Pool({
      connectionString: connectionDetailsFromWorker.connectionString,
    })

    let pgbouncerPool: Pool | undefined
    if (connectionDetailsFromWorker.pgbouncerConnectionString) {
      pgbouncerPool = new Pool({
        connectionString: connectionDetailsFromWorker.pgbouncerConnectionString,
      })
    }

    return {
      ...connectionDetailsFromWorker,
      pool,
      pgbouncerPool,
    }
  }

  let rpcCallback: (data: any) => void
  const rpc: BirpcReturn<SharedWorkerFunctions, TestWorkerFunctions> =
    createBirpc<SharedWorkerFunctions, TestWorkerFunctions>(
      {
        runBeforeTemplateIsBakedHook: async (connection, params) => {
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
              params: params as any,
              connection: connectionDetails,
              containerExec: async (command): Promise<ExecResult> =>
                rpc.execCommandInContainer(command),
              // This is what allows a consumer to get a "nested" database from within their beforeTemplateIsBaked hook
              manuallyBuildAdditionalTemplate: async () => {
                const connection =
                  mapWorkerConnectionDetailsToConnectionDetails(
                    await rpc.createEmptyDatabase()
                  )

                return {
                  connection,
                  finish: async () => {
                    await teardownConnection(connection)
                    return rpc.convertDatabaseToTemplate(connection.database)
                  },
                }
              },
            })

            await teardownConnection(connectionDetails)

            if (hookResult && !isSerializable(hookResult)) {
              throw new TypeError(
                "Return value of beforeTemplateIsBaked() hook could not be serialized. Make sure it returns only JSON-serializable values."
              )
            }

            return hookResult
          }
        },
      },
      {
        post: async (data) => {
          const worker = await workerPromise
          await worker.available
          worker.publish(data)
        },
        on: (data) => {
          rpcCallback = data
        },
      }
    )

  // Automatically cleaned up by AVA since each test file runs in a separate worker
  const _messageHandlerPromise = (async () => {
    const worker = await workerPromise
    await worker.available

    for await (const msg of worker.subscribe()) {
      rpcCallback!(msg.data)
    }
  })()

  const getTestPostgresDatabase = async (
    t: ExecutionContext,
    params: any,
    getTestDatabaseOptions?: GetTestPostgresDatabaseOptions
  ): Promise<GetTestPostgresDatabaseResult> => {
    const testDatabaseConnection = await rpc.getTestDatabase({
      databaseDedupeKey: getTestDatabaseOptions?.databaseDedupeKey,
      params,
    })

    const connectionDetails = mapWorkerConnectionDetailsToConnectionDetails(
      testDatabaseConnection.connectionDetails
    )

    t.teardown(async () => {
      await teardownConnection(connectionDetails)
    })

    return {
      ...connectionDetails,
      beforeTemplateIsBakedResult:
        testDatabaseConnection.beforeTemplateIsBakedResult,
    }
  }

  getTestPostgresDatabase.fromTemplate = async (
    t: ExecutionContext,
    templateName: string
  ) => {
    const connection = mapWorkerConnectionDetailsToConnectionDetails(
      await rpc.createDatabaseFromTemplate(templateName)
    )

    t.teardown(async () => {
      await teardownConnection(connection)
    })

    return connection
  }

  return getTestPostgresDatabase as any
}

export * from "./public-types"
