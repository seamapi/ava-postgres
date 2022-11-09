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
  beforeTemplateIsBaked?: (options: {
    connection: ConnectionDetails
    params: Params
    containerExec: (command: string[]) => Promise<ExecResult>
  }) => Promise<any>
}

export interface GetTestPostgresDatabaseResult extends ConnectionDetails {
  beforeTemplateIsBakedResult: any
}

export type GetTestPostgresDatabase<Params = any> = (
  args?: Params,
  /**
   * When true, created databases will automatically be dropped after the test completes.
   * This should normally be set to `true` to avoid the container running out of memory.
   * @default true
   */
  automaticallyTeardownDatabase?: boolean
) => Promise<GetTestPostgresDatabaseResult>
