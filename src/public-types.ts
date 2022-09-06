import { Pool } from "pg"
import { JsonObject } from "type-fest"
import { BindMode } from "testcontainers/dist/docker/types"

export interface ConnectionDetails {
  connectionString: string
  connectionStringDocker: string

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
  // Any Docker image tag
  postgresVersion?: string
  container?: {
    bindMounts?: {
      source: string
      target: string
      mode?: BindMode
    }[]
  }
  // This should be unnecessary 99% of the time
  key?: string
  hooks?: {
    beforeTemplateIsBaked?: (
      connection: ConnectionDetails,
      params: Params
    ) => Promise<void>
    afterTemplateIsBaked?: (
      connection: ConnectionDetails,
      params?: Params
    ) => Promise<void>
  }
}

export type GetTestPostgresDatabase<Params> = (
  ...args: Params extends never ? [never] : [Params]
) => Promise<ConnectionDetails>
