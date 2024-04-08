import type { Pool } from "pg"
import type { Jsonifiable } from "type-fest"
import { ExecutionContext } from "ava"
import { ExecResult } from "testcontainers"
import { BindMode } from "testcontainers/build/types"

export interface ConnectionDetails {
  connectionString: string
  connectionStringDocker: string
  pgbouncerConnectionString?: string
  pgbouncerConnectionStringDocker?: string
  dockerNetworkId: string

  host: string
  port: number
  username: string
  password: string
  database: string

  pool: Pool

  // TODO if pgbouncer is enabled, this is defined, otherwise undefined
  pgbouncerPool?: Pool
}

export interface GetTestPostgresDatabaseFactoryOptions<
  Params extends Jsonifiable
> {
  /**
   * Any tag of the official `postgres` image.
   */
  postgresVersion?: string
  container?: {
    bindMounts?: {
      source: string
      target: string
      mode?: BindMode
    }[]
  }

  /**
   * Pgbouncer container settings, disabled by default.
   */
  pgbouncer?: {
    enabled: boolean
    version?: string
    poolMode?: "session" | "transaction" | "statement"
  }

  /**
   * In rare cases, you may want to spawn more than one Postgres container.
   * Internally, this library uses an AVA "shared worker". A shared worker is a singleton shared with the entire running test suite, and so one `ava-postgres` shared worker maps to exactly one Postgres container.
   * To spawn separate shared workers and thus additional Postgres containers, you can specify a custom key here.
   * Each unique key will map to a unique shared worker/unique Postgres container.
   */
  workerDedupeKey?: string
  beforeTemplateIsBaked?: (options: {
    connection: ConnectionDetails
    params: Params
    containerExec: (command: string[]) => Promise<ExecResult>
    /**
     *
     * In some cases, if you do extensive setup in your `beforeTemplateIsBaked` hook, you might want to obtain a separate, additional database within it if your application uses several databases for different purposes. This is possible by using the passed `beforeTemplateIsBaked` to your hook callback.
     * Be very careful when using this to avoid infinite loops.
     * @example
     * ```ts
     * type DatabaseParams = {
     *   type: "foo" | "bar"
     * }

     * const getTestServer = getTestPostgresDatabaseFactory<DatabaseParams>({
     *   beforeTemplateIsBaked: async ({
     *     params,
     *     connection: { pool },
     *     beforeTemplateIsBaked,
     *   }) => {
     *     if (params.type === "foo") {
     *       await pool.query(`CREATE TABLE "foo" ("id" SERIAL PRIMARY KEY)`)
     *       // Important: return early to avoid infinite loop
     *       return
     *     }

     *     await pool.query(`CREATE TABLE "bar" ("id" SERIAL PRIMARY KEY)`)
     *     // This created database will be torn down at the end of the top-level `beforeTemplateIsBaked` call
     *     const fooDatabase = await beforeTemplateIsBaked({
     *       params: { type: "foo" },
     *     })

     *     // This works now
     *     await fooDatabase.pool.query(`INSERT INTO "foo" DEFAULT VALUES`)
     *   },
     * })
     * ```
     */
    beforeTemplateIsBaked: (
      options: {
        params: Params
      } & Pick<GetTestPostgresDatabaseOptions, "databaseDedupeKey">
    ) => Promise<GetTestPostgresDatabaseResult>
  }) => Promise<any>
}

export interface GetTestPostgresDatabaseResult extends ConnectionDetails {
  beforeTemplateIsBakedResult: any
}

export type GetTestPostgresDatabaseOptions = {
  /**
   * By default, `ava-postgres` will create a new database for each test. If you want to share a database between tests, you can use the `databaseDedupeKey` option.
   * This works across the entire test suite.
   *
   * Note that if unique parameters are passed to the `beforeTemplateIsBaked` (`null` in the above example), separate databases will still be created.
   * @example
   * ```ts
   * import test from "ava"
   *
   * const getTestPostgresDatabase = getTestPostgresDatabaseFactory({})
   *
   * test("foo", async (t) => {
   *   const connection1 = await getTestPostgresDatabase(t, null, {
   *     databaseDedupeKey: "foo",
   *   })
   *   const connection2 = await getTestPostgresDatabase(t, null, {
   *     databaseDedupeKey: "foo",
   *   })
   *   t.is(connection1.database, connection2.database)
   * })
   * ```
   */
  /**
   * By default, `ava-postgres` will create a new database for each test. If you want to share a database between tests, you can use the `databaseDedupeKey` option.
   * This works across the entire test suite.
   *
   * Note that if unique parameters are passed to the `beforeTemplateIsBaked` (`null` in the above example), separate databases will still be created.
   * @example
   * ```ts
   * import test from "ava"
   *
   * const getTestPostgresDatabase = getTestPostgresDatabaseFactory({})
   *
   * test("foo", async (t) => {
   *   const connection1 = await getTestPostgresDatabase(t, null, {
   *     databaseDedupeKey: "foo",
   *   })
   *   const connection2 = await getTestPostgresDatabase(t, null, {
   *     databaseDedupeKey: "foo",
   *   })
   *   t.is(connection1.database, connection2.database)
   * })
   * ```
   */
  databaseDedupeKey?: string
}

// https://github.com/microsoft/TypeScript/issues/23182#issuecomment-379091887
type IsNeverType<T> = [T] extends [never] ? true : false

export type GetTestPostgresDatabase<Params> = IsNeverType<Params> extends true
  ? (
      t: ExecutionContext,
      args?: null,
      options?: GetTestPostgresDatabaseOptions
    ) => Promise<GetTestPostgresDatabaseResult>
  : (
      t: ExecutionContext,
      args: Params,
      options?: GetTestPostgresDatabaseOptions
    ) => Promise<GetTestPostgresDatabaseResult>
