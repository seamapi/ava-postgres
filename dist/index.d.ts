import { Pool } from 'pg';
import { Jsonifiable } from 'type-fest';
import { BindMode, ExecResult } from 'testcontainers/dist/docker/types';
import { StartedNetwork } from 'testcontainers';

interface ConnectionDetails {
    connectionString: string;
    connectionStringDocker: string;
    networkDocker: StartedNetwork;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    pool: Pool;
}
interface GetTestPostgresDatabaseFactoryOptions<Params extends Jsonifiable> {
    /**
     * Any tag of the official `postgres` image.
     */
    postgresVersion?: string;
    container?: {
        bindMounts?: {
            source: string;
            target: string;
            mode?: BindMode;
        }[];
    };
    /**
     * Test workers will be de-duped by this key. You probably don't need to set this.
     */
    key?: string;
    beforeTemplateIsBaked?: (options: {
        connection: ConnectionDetails;
        params: Params;
        containerExec: (command: string[]) => Promise<ExecResult>;
    }) => Promise<any>;
}
interface GetTestPostgresDatabaseResult extends ConnectionDetails {
    beforeTemplateIsBakedResult: any;
}
declare type GetTestPostgresDatabaseOptions = {
    /**
     * If `getTestPostgresDatabase()` is called multiple times with the same `key` and `params`, the same database is guaranteed to be returned.
     */
    key?: string;
};
declare type IsNeverType<T> = [T] extends [never] ? true : false;
declare type GetTestPostgresDatabase<Params> = IsNeverType<Params> extends true ? (args?: null, options?: GetTestPostgresDatabaseOptions) => Promise<GetTestPostgresDatabaseResult> : (args: Params, options?: GetTestPostgresDatabaseOptions) => Promise<GetTestPostgresDatabaseResult>;

declare const getTestPostgresDatabaseFactory: <Params extends Jsonifiable = never>(options?: GetTestPostgresDatabaseFactoryOptions<Params> | undefined) => GetTestPostgresDatabase<Params>;

export { ConnectionDetails, GetTestPostgresDatabase, GetTestPostgresDatabaseFactoryOptions, GetTestPostgresDatabaseOptions, GetTestPostgresDatabaseResult, getTestPostgresDatabaseFactory };
