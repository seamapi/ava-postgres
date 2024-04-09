import type { Pool } from "pg"
import type { Jsonifiable } from "type-fest"
import type { ExecutionContext } from "ava"
import type { ExecResult } from "testcontainers"
import type { BindMode } from "testcontainers/build/types"

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
     * In some cases, if you do extensive setup in your `beforeTemplateIsBaked` hook, you might want to obtain a separate, additional database within it if your application uses several databases for different purposes.
     *
     * @example
     * ```ts
     * import test from "ava"
     *
     * const getTestDatabase = getTestPostgresDatabaseFactory<DatabaseParams>({
     *   beforeTemplateIsBaked: async ({
     *     params,
     *     connection: { pool },
     *     manuallyBuildAdditionalTemplate,
     *   }) => {
     *     await pool.query(`CREATE TABLE "bar" ("id" SERIAL PRIMARY KEY)`)
     *
     *     const fooTemplateBuilder = await manuallyBuildAdditionalTemplate()
     *     await fooTemplateBuilder.connection.pool.query(
     *       `CREATE TABLE "foo" ("id" SERIAL PRIMARY KEY)`
     *     )
     *     const { templateName: fooTemplateName } = await fooTemplateBuilder.finish()
     *
     *     return { fooTemplateName }
     *   },
     * })
     *
     * test("foo", async (t) => {
     *   const barDatabase = await getTestDatabase({ type: "bar" })
     *
     *   // the "bar" database has the "bar" table...
     *   await t.notThrowsAsync(async () => {
     *     await barDatabase.pool.query(`SELECT * FROM "bar"`)
     *   })
     *
     *   // ...but not the "foo" table...
     *   await t.throwsAsync(async () => {
     *     await barDatabase.pool.query(`SELECT * FROM "foo"`)
     *   })
     *
     *   // ...and we can obtain a separate database with the "foo" table
     *   const fooDatabase = await getTestDatabase.fromTemplate(
     *     t,
     *     barDatabase.beforeTemplateIsBakedResult.fooTemplateName
     *   )
     *   await t.notThrowsAsync(async () => {
     *     await fooDatabase.pool.query(`SELECT * FROM "foo"`)
     *   })
     * })
     * ```
     */
    manuallyBuildAdditionalTemplate: () => Promise<{
      connection: ConnectionDetails
      finish: () => Promise<{ templateName: string }>
    }>
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
  databaseDedupeKey?: string
}

// https://github.com/microsoft/TypeScript/issues/23182#issuecomment-379091887
type IsNeverType<T> = [T] extends [never] ? true : false

interface BaseGetTestPostgresDatabase {
  fromTemplate(
    t: ExecutionContext,
    templateName: string
  ): Promise<ConnectionDetails>
}

export type GetTestPostgresDatabase<Params> = IsNeverType<Params> extends true
  ? ((
      t: ExecutionContext,
      args?: null,
      options?: GetTestPostgresDatabaseOptions
    ) => Promise<GetTestPostgresDatabaseResult>) &
      BaseGetTestPostgresDatabase
  : ((
      t: ExecutionContext,
      args: Params,
      options?: GetTestPostgresDatabaseOptions
    ) => Promise<GetTestPostgresDatabaseResult>) &
      BaseGetTestPostgresDatabase
