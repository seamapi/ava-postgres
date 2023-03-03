import { Pool } from "pg"
import { JsonObject } from "type-fest"
import { BindMode, ExecResult } from "testcontainers/dist/docker/types"
import { StartedNetwork } from "testcontainers"

export interface ConnectionDetails {
  connectionString: string
  connectionStringDocker: string
  networkDocker: StartedNetwork

  host: string
  port: number
  username: string
  password: string
  database: string

  pool: Pool
}

export interface GetTestPostgresDatabaseFactoryOptions<
  Params extends JsonObject
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
   * Ava shared workers are used to manage the postgres container. You can set this key
   * to create separate workers, each with a separate postgres container it manages.
   * For example, setting `app1` on one factory, and `app2` on another factory will mean
   * that two separate containers are managed by the separate factories.
   *
   * Note that this is different to the key that's passed in to `getTestPostgresDatabase`
   * to share a database between Ava _test workers_. See GetTestPostgresDatabaseOptions.
   */
  key?: string
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
  key?: string
}

// https://github.com/microsoft/TypeScript/issues/23182#issuecomment-379091887
type IsNeverType<T> = [T] extends [never] ? true : false

export type GetTestPostgresDatabase<Params> = IsNeverType<Params> extends true
  ? (
      args?: null,
      options?: GetTestPostgresDatabaseOptions
    ) => Promise<GetTestPostgresDatabaseResult>
  : (
      args: Params,
      options?: GetTestPostgresDatabaseOptions
    ) => Promise<GetTestPostgresDatabaseResult>
