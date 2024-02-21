import type { Pool } from "pg"
import type { Jsonifiable } from "type-fest"
import { ExecutionContext } from "ava"
import { ExecResult } from "testcontainers"
import { BindMode } from "testcontainers/build/types"

export interface ConnectionDetails {
  connectionString: string
  connectionStringDocker: string
  dockerNetworkId: string

  host: string
  port: number
  username: string
  password: string
  database: string

  pool: Pool
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
   * You probably don't need to set this.
   *
   * AVA Shared Workers are used to manage the Postgres container. You can set this key
   * to create multiple Shared Workers, each with a separate Postgres container it manages.
   * For example, setting `app1` on one factory, and `app2` on another factory will mean
   * that two separate containers are managed by the separate factories.
   *
   * Note that this is different to the key that's passed in to `getTestPostgresDatabase`
   * to share a database between AVA  _test workers_. See GetTestPostgresDatabaseOptions.
   */
  workerDedupeKey?: string
  beforeTemplateIsBaked?: (options: {
    connection: ConnectionDetails
    params: Params
    containerExec: (command: string[]) => Promise<ExecResult>
  }) => Promise<any>
}

export interface GetTestPostgresDatabaseResult extends ConnectionDetails {
  beforeTemplateIsBakedResult: any
}

export type GetTestPostgresDatabaseOptions = {
  /**
   * If `getTestPostgresDatabase()` is called multiple times with the same `key` and `params`, the same database is guaranteed to be returned.
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
