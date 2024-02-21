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
   * Pgbouncer container settings, disabled by default. Container settings are
   * by default inherited from parent "container" param.
   */
  pgbouncer?: {
    enabled: boolean
    version?: string
    poolMode?: "session" | "transaction" | "statement"
  }

  /**
   * Test workers will be de-duped by this key. You probably don't need to set this.
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
