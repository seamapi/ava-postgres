import pg from "pg"
import { GenericContainer, Network } from "testcontainers"
import { Mutex } from "async-mutex"
import hash from "object-hash"
import {
  GotDatabaseMessage,
  InitialWorkerData,
  MessageFromWorker,
  MessageToWorker,
  WorkerMessage,
} from "./internal-types"
import getRandomDatabaseName from "./lib/get-random-database-name"
import { SharedWorker } from "ava/plugin"
import { parentPort } from "node:worker_threads"

export class Worker {
  private paramsHashToTemplateCreationPromise = new Map<
    string,
    ReturnType<typeof this.createTemplate>
  >()
  private keyToDatabaseName = new Map<string, string>()
  private keyToCreationMutex = new Map<string, Mutex>()
  private getOrCreateKeyToCreationMutex = new Mutex()
  private createdDatabasesByTestWorkerId = new Map<string, string[]>()
  private getOrCreateTemplateNameMutex = new Mutex()

  private startContainerPromise: ReturnType<typeof this.startContainer>

  constructor(private initialData: InitialWorkerData) {
    this.startContainerPromise = this.startContainer()
  }

  public async handleTestWorker(testWorker: SharedWorker.TestWorker<unknown>) {
    testWorker.teardown(async () => {
      await this.handleTestWorkerTeardown(testWorker)
    })

    for await (const message of testWorker.subscribe()) {
      await this.handleMessage(message as any)
    }
  }

  public async handleMessage(
    message: SharedWorker.ReceivedMessage<WorkerMessage>
  ) {
    if (message.data.type === "GET_TEST_DATABASE") {
      // Get template name
      const paramsHash = hash(message.data.params ?? null)
      let neededToCreateTemplate = false
      // (Mutex avoids race conditions where two identical templates get built)
      await this.getOrCreateTemplateNameMutex.runExclusive(() => {
        if (!this.paramsHashToTemplateCreationPromise.has(paramsHash)) {
          neededToCreateTemplate = true
          this.paramsHashToTemplateCreationPromise.set(
            paramsHash,
            this.createTemplate(message)
          )
        }
      })
      const {
        templateName,
        beforeTemplateIsBakedResult,
        lastMessage: lastMessageFromTemplateCreation,
      } = await this.paramsHashToTemplateCreationPromise.get(paramsHash)!

      // Create database using template
      const { postgresClient } = await this.startContainerPromise

      // Only relevant when a `key` is provided
      const fullDatabaseKey = `${paramsHash}-${message.data.key}`

      let databaseName = message.data.key
        ? this.keyToDatabaseName.get(fullDatabaseKey)
        : undefined
      if (!databaseName) {
        const createDatabase = async () => {
          databaseName = getRandomDatabaseName()
          await postgresClient.query(
            `CREATE DATABASE ${databaseName} WITH TEMPLATE ${templateName};`
          )
          this.createdDatabasesByTestWorkerId.set(
            message.testWorker.id,
            (
              this.createdDatabasesByTestWorkerId.get(message.testWorker.id) ??
              []
            ).concat(databaseName)
          )
        }

        if (message.data.key) {
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

      const gotDatabaseMessage: GotDatabaseMessage = {
        type: "GOT_DATABASE",
        connectionDetails: await this.getConnectionDetails(databaseName!),
        beforeTemplateIsBakedResult,
      }

      if (neededToCreateTemplate) {
        lastMessageFromTemplateCreation.value.reply(gotDatabaseMessage)
      } else {
        message.reply(gotDatabaseMessage)
      }

      return
    }

    throw new Error(`Unknown message: ${JSON.stringify(message.data)}`)
  }

  private async handleTestWorkerTeardown(
    testWorker: SharedWorker.TestWorker<unknown>
  ) {
    const databases = this.createdDatabasesByTestWorkerId.get(testWorker.id)

    if (databases) {
      const { postgresClient } = await this.startContainerPromise

      const databasesAssociatedWithKeys = new Set(
        this.keyToDatabaseName.values()
      )

      await Promise.all(
        databases
          .filter((d) => !databasesAssociatedWithKeys.has(d))
          .map(async (database) => {
            await this.forceDisconnectClientsFrom(database)
            await postgresClient.query(`DROP DATABASE ${database}`)
          })
      )
    }
  }

  private async createTemplate(
    message: SharedWorker.ReceivedMessage<WorkerMessage>
  ) {
    const databaseName = getRandomDatabaseName()

    // Create database
    const { postgresClient, container } = await this.startContainerPromise
    await postgresClient.query(`CREATE DATABASE ${databaseName};`)

    const msg = message.reply({
      type: "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED",
      connectionDetails: await this.getConnectionDetails(databaseName),
    })

    let reply = await msg.replies().next()

    while (
      reply.value.data.type !== "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED"
    ) {
      const replyValue = reply.value.data as MessageToWorker

      if (replyValue.type === "EXEC_COMMAND_IN_CONTAINER") {
        const result = await container.exec(replyValue.command)
        const message = reply.value.reply({
          type: "EXEC_COMMAND_IN_CONTAINER_RESULT",
          result,
        } as MessageFromWorker)

        reply = await message.replies().next()
      }
    }

    // Disconnect any clients
    await this.forceDisconnectClientsFrom(databaseName)

    // Convert database to template
    await postgresClient.query(
      `ALTER DATABASE ${databaseName} WITH is_template TRUE;`
    )

    return {
      templateName: databaseName,
      beforeTemplateIsBakedResult: reply.value.data.result,
      lastMessage: reply,
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
    const { container, network } = await this.startContainerPromise
    const externalDatabaseUrl = `postgresql://postgres:@${container.getHost()}:${container.getMappedPort(
      5432
    )}/${databaseName}`

    return {
      connectionString: externalDatabaseUrl,
      connectionStringDocker: `postgresql://postgres:@${container
        .getName()
        .replace("/", "")}:5432/${databaseName}`,
      networkDocker: {
        id: network.getId(),
        // StartedNetwork.options is private, however we must access it here
        // using type-safe string index notation for serialization.
        options: network["options"],
      },
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: databaseName,
      username: "postgres",
      password: "",
    }
  }

  private async startContainer() {
    parentPort!.postMessage({
      type: "ava-postgres",
      message: "starting container...",
      postgresVersion: this.initialData.postgresVersion,
    })

    const network = await new Network().start()

    parentPort!.postMessage({
      type: "ava-postgres",
      message: "stared network",
    })

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

    parentPort!.postMessage({
      type: "ava-postgres",
      message: "starting generic container instance...",
    })

    const startedContainer = await container.start()

    const connectionString = `postgresql://postgres:@${startedContainer.getHost()}:${startedContainer.getMappedPort(
      5432
    )}/postgres`

    parentPort!.postMessage({
      type: "ava-postgres",
      message: "container started",
      port: startedContainer.getMappedPort(5432),
      host: startedContainer.getHost(),
      connectionString,
    })

    const { exitCode, output } = await startedContainer.exec(["pg_isready"])
    if (exitCode !== 0) {
      parentPort!.postMessage({
        type: "ava-postgres",
        message: "Postgres Container failed to start",
        output,
        exitCode,
      })

      throw new Error(
        `pg_isready exited with code ${exitCode} (database container didn't finish starting)`
      )
    }

    parentPort!.postMessage({
      type: "ava-postgres",
      message: "pg_isready succeeded",
      exitCode,
      output,
    })

    const postgresClient = new pg.Pool({
      connectionString,
      query_timeout: 5000,
    })

    postgresClient.on("error", (err) => {
      parentPort!.postMessage({
        type: "ava-postgres",
        message: "postgres client error",
        errMessage: err.message,
        stack: err.stack,
      })
    })

    const heartbeat = async () => {
      try {
        parentPort!.postMessage({
          type: "ava-postgres",
          message: "running postgres heartbeat...",
        })

        const { rows } = await postgresClient.query("SELECT 1")

        parentPort!.postMessage({
          type: "ava-postgres",
          message: "postgres heartbeat success",
          rows,
        })
      } catch (err: any) {
        parentPort!.postMessage({
          type: "ava-postgres",
          message: "postgres heartbeat failure",
          errMessage: err.message,
          stack: err.stack,
        })
      }

      setTimeout(heartbeat, 5000)
    }

    heartbeat()

    return {
      container: startedContainer,
      network,
      postgresClient,
    }
  }
}
