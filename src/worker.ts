import pg from "pg"
import { GenericContainer, Network } from "testcontainers"
import { Mutex } from "async-mutex"
import hash from "object-hash"
import type { InitialWorkerData } from "./internal-types"
import getRandomDatabaseName from "./lib/get-random-database-name"
import type { SharedWorker } from "ava/plugin"
import { type BirpcReturn, type ChannelOptions, createBirpc } from "birpc"
import { once } from "node:events"
import type { SharedWorkerFunctions, TestWorkerFunctions } from "./lib/rpc"

type WorkerRpc = BirpcReturn<TestWorkerFunctions, SharedWorkerFunctions>

export class Worker {
  private paramsHashToTemplateCreationPromise = new Map<
    string,
    ReturnType<typeof this.createTemplate>
  >()
  private keyToDatabaseName = new Map<string, string>()
  private keyToCreationMutex = new Map<string, Mutex>()
  private getOrCreateKeyToCreationMutex = new Mutex()
  private getOrCreateTemplateNameMutex = new Mutex()

  private startContainerPromise: ReturnType<typeof this.startContainer>

  constructor(private initialData: InitialWorkerData) {
    this.startContainerPromise = this.startContainer()
  }

  public async handleTestWorker(testWorker: SharedWorker.TestWorker<unknown>) {
    let workerRpcCallback: (data: any) => void
    const rpcChannel: ChannelOptions = {
      post: (data) => testWorker.publish(data),
      on: (data) => {
        workerRpcCallback = data
      },
    }

    const messageHandlerAbortController = new AbortController()
    const messageHandlerPromise = Promise.race([
      once(messageHandlerAbortController.signal, "abort"),
      (async () => {
        for await (const msg of testWorker.subscribe()) {
          workerRpcCallback!(msg.data)

          if (messageHandlerAbortController.signal.aborted) {
            break
          }
        }
      })(),
    ])

    testWorker.teardown(async () => {
      messageHandlerAbortController.abort()
      await messageHandlerPromise
    })

    const rpc: WorkerRpc = createBirpc<
      TestWorkerFunctions,
      SharedWorkerFunctions
    >(
      {
        getTestDatabase: async (options) => {
          return this.getTestDatabase(options, rpc, (teardown) => {
            testWorker.teardown(teardown)
          })
        },
        execCommandInContainer: async (command) => {
          const container = (await this.startContainerPromise).container
          return container.exec(command)
        },
      },
      rpcChannel
    )
  }

  private async getTestDatabase(
    options: Parameters<SharedWorkerFunctions["getTestDatabase"]>[0],
    rpc: WorkerRpc,
    registerTeardown: (teardown: () => Promise<void>) => void
  ) {
    // Get template name
    const paramsHash = hash(options.params ?? null)
    // (Mutex avoids race conditions where two identical templates get built)
    await this.getOrCreateTemplateNameMutex.runExclusive(() => {
      if (!this.paramsHashToTemplateCreationPromise.has(paramsHash)) {
        this.paramsHashToTemplateCreationPromise.set(
          paramsHash,
          this.createTemplate(rpc)
        )
      }
    })
    const templateCreationResult =
      await this.paramsHashToTemplateCreationPromise.get(paramsHash)!

    const { templateName, beforeTemplateIsBakedResult } =
      templateCreationResult!

    // Create database using template
    const { postgresClient } = await this.startContainerPromise

    // Only relevant when a `key` is provided
    const fullDatabaseKey = `${paramsHash}-${options.key}`

    let databaseName = options.key
      ? this.keyToDatabaseName.get(fullDatabaseKey)
      : undefined
    if (!databaseName) {
      const createDatabase = async () => {
        databaseName = getRandomDatabaseName()
        await postgresClient.query(
          `CREATE DATABASE ${databaseName} WITH TEMPLATE ${templateName};`
        )
      }

      if (options.key) {
        await this.getOrCreateKeyToCreationMutex.runExclusive(() => {
          if (!this.keyToCreationMutex.has(fullDatabaseKey)) {
            this.keyToCreationMutex.set(fullDatabaseKey, new Mutex())
          }
        })

        const mutex = this.keyToCreationMutex.get(fullDatabaseKey)!

        await mutex.runExclusive(async () => {
          if (!this.keyToDatabaseName.has(fullDatabaseKey)) {
            await createDatabase()
            this.keyToDatabaseName.set(fullDatabaseKey, databaseName!)
          }

          databaseName = this.keyToDatabaseName.get(fullDatabaseKey)!
        })
      } else {
        await createDatabase()
      }
    }

    registerTeardown(async () => {
      // Don't remove keyed databases
      if (options.key && this.keyToDatabaseName.has(fullDatabaseKey)) {
        return
      }

      await this.forceDisconnectClientsFrom(databaseName!)
      await postgresClient.query(`DROP DATABASE ${databaseName}`)
    })

    return {
      connectionDetails: await this.getConnectionDetails(databaseName!),
      beforeTemplateIsBakedResult,
    }
  }

  private async createTemplate(rpc: WorkerRpc) {
    const databaseName = getRandomDatabaseName()

    // Create database
    const { postgresClient } = await this.startContainerPromise

    await postgresClient.query(`CREATE DATABASE ${databaseName};`)

    const beforeTemplateIsBakedResult = await rpc.runBeforeTemplateIsBakedHook(
      await this.getConnectionDetails(databaseName)
    )

    // Disconnect any clients
    await this.forceDisconnectClientsFrom(databaseName)

    // Convert database to template
    await postgresClient.query(
      `ALTER DATABASE ${databaseName} WITH is_template TRUE;`
    )

    return {
      templateName: databaseName,
      beforeTemplateIsBakedResult,
    }
  }

  private async forceDisconnectClientsFrom(databaseName: string) {
    const { postgresClient } = await this.startContainerPromise

    await postgresClient.query(
      `REVOKE CONNECT ON DATABASE ${databaseName} FROM public`
    )

    // Nicely ask clients to disconnect
    await postgresClient.query(`
      SELECT pid, pg_cancel_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();
      `)

    // Forcefully disconnect clients
    await postgresClient.query(`
      SELECT pid, pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();
      `)
  }

  private async getConnectionDetails(databaseName: string) {
    const { container, network, pgbouncerContainer } = await this
      .startContainerPromise
    const externalDatabaseUrl = `postgresql://postgres:@${container.getHost()}:${container.getMappedPort(
      5432
    )}/${databaseName}`

    let pgbouncerConnectionString, pgbouncerConnectionStringDocker
    if (pgbouncerContainer) {
      pgbouncerConnectionString = `postgresql://postgres:@${pgbouncerContainer.getHost()}:${pgbouncerContainer.getMappedPort(
        6432
      )}/${databaseName}`
      pgbouncerConnectionStringDocker = `postgresql://postgres:@${pgbouncerContainer
        .getName()
        .replace("/", "")}:5432/${databaseName}`
    }

    return {
      connectionString: externalDatabaseUrl,
      connectionStringDocker: `postgresql://postgres:@${container
        .getName()
        .replace("/", "")}:5432/${databaseName}`,
      pgbouncerConnectionString,
      pgbouncerConnectionStringDocker,
      dockerNetworkId: network.getId(),
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: databaseName,
      username: "postgres",
      password: "",
    }
  }

  private async startContainer() {
    const network = await new Network().start()
    let container = new GenericContainer(
      `postgres:${this.initialData.postgresVersion}`
    )
      .withExposedPorts(5432)
      .withName(getRandomDatabaseName())
      .withEnvironment({
        POSTGRES_HOST_AUTH_METHOD: "trust",
        PGDATA: "/var/lib/postgresql/data",
      })
      .withCommand([
        "-c",
        "max_connections=1000",
        "-c",
        "fsync=off",
        "-c",
        "synchronous_commit=off",
        "-c",
        "full_page_writes=off",
      ])
      .withTmpFs({ "/var/lib/postgresql/data": "rw" })
      .withNetwork(network)
      .withStartupTimeout(120_000)
      .withBindMounts(this.initialData.containerOptions?.bindMounts ?? [])

    const startedContainer = await container.start()

    const { exitCode } = await startedContainer.exec(["pg_isready"])
    if (exitCode !== 0) {
      throw new Error(
        `pg_isready exited with code ${exitCode} (database container didn't finish starting)`
      )
    }

    const connectionString = `postgresql://postgres:@${startedContainer.getHost()}:${startedContainer.getMappedPort(
      5432
    )}/postgres`

    let startedPgbouncerContainer
    if (this.initialData.pgbouncerOptions?.enabled) {
      const pgbouncerContainer = new GenericContainer("edoburu/pgbouncer")
        .withExposedPorts(6432)
        .withName(getRandomDatabaseName())
        .withEnvironment({
          DB_HOST: startedContainer.getName().replace("/", ""),
          DB_USER: "postgres",
          DB_NAME: "*",
          POOL_MODE:
            this.initialData.pgbouncerOptions?.poolMode ?? "transaction",
          LISTEN_PORT: "6432",
          AUTH_TYPE: "trust",
        })
        .withStartupTimeout(120_000)
        .withNetwork(network)
      startedPgbouncerContainer = await pgbouncerContainer.start()
    }

    return {
      container: startedContainer,
      pgbouncerContainer: startedPgbouncerContainer,
      network,
      postgresClient: new pg.Pool({
        connectionString,
      }),
    }
  }
}
