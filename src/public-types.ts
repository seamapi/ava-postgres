import { Pool } from "pg"
import { JsonObject } from "type-fest"
import { BindMode, ExecResult } from "testcontainers/dist/docker/types"

export interface ConnectionDetails {
  connectionString: string
  connectionStringDocker: string
  networkNameDocker: string

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
   * Test workers will be de-duped by this key. You probably don't need to set this.
   */
  key?: string
  /**
   * When true, the same database will be used for all tests (across workers) and only created once.
   */
  useSingletonDatabase?: boolean
  beforeTemplateIsBaked?: (options: {
    connection: ConnectionDetails
    params: Params
    containerExec: (command: string[]) => Promise<ExecResult>
  }) => Promise<any>
}

export interface GetTestPostgresDatabaseResult extends ConnectionDetails {
  beforeTemplateIsBakedResult: any
}

export type GetTestPostgresDatabase<Params> = (
  ...args: Params extends never ? [never] : [Params]
) => Promise<GetTestPostgresDatabaseResult>
