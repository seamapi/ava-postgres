import { Pool } from "pg"
import { GenericContainer } from "testcontainers"
import { Mutex } from "async-mutex"
import hash from "object-hash"
import {
  InitialWorkerData,
  MessageToWorker,
  WorkerMessage,
} from "./internal-types"
import getRandomDatabaseName from "./lib/get-random-database-name"
import { SharedWorker } from "ava/plugin"

// todo: delete database when done

export class Worker {
  private paramsHashToTemplateCreationPromise = new Map<
    string,
    ReturnType<typeof this.createTemplate>
  >()
  private getOrCreateTemplateNameMutex = new Mutex()

  private startContainerPromise: ReturnType<typeof this.startContainer>

  constructor(private initialData: InitialWorkerData) {
    this.startContainerPromise = this.startContainer()
  }

  public async handleTestWorker(testWorker: SharedWorker.TestWorker<unknown>) {
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
      const { templateName, lastMessage: lastMessageFromTemplateCreation } =
        await this.paramsHashToTemplateCreationPromise.get(paramsHash)!

      // Create database using template
      const { postgresClient } = await this.startContainerPromise

      const databaseName = getRandomDatabaseName()
      await postgresClient.query(
        `CREATE DATABASE ${databaseName} WITH TEMPLATE ${templateName};`
      )

      if (neededToCreateTemplate) {
        lastMessageFromTemplateCreation.value.reply({
          type: "GOT_DATABASE",
          connectionDetails: await this.getConnectionDetails(databaseName),
        })
      } else {
        message.reply({
          type: "GOT_DATABASE",
          connectionDetails: await this.getConnectionDetails(databaseName),
        })
      }

      return
    }

    throw new Error(`Unknown message: ${JSON.stringify(message.data)}`)
  }

  private async createTemplate(
    message: SharedWorker.ReceivedMessage<WorkerMessage>
  ) {
    const databaseName = getRandomDatabaseName()

    // Create database
    const { postgresClient } = await this.startContainerPromise
    await postgresClient.query(`CREATE DATABASE ${databaseName};`)

    const msg = message.reply({
      type: "RUN_HOOK_BEFORE_TEMPLATE_IS_BAKED",
      connectionDetails: await this.getConnectionDetails(databaseName),
    })

    const reply = await msg.replies().next()
    const replyValue = reply.value.data as MessageToWorker

    if (replyValue.type !== "FINISHED_RUNNING_HOOK_BEFORE_TEMPLATE_IS_BAKED") {
      throw new Error(`Unexpected reply: ${JSON.stringify(replyValue)}`)
    }

    // Disconnect any clients
    await postgresClient.query(
      `REVOKE CONNECT ON DATABASE ${databaseName} FROM public`
    )
    await postgresClient.query(`
      SELECT pid, pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();
      `)

    // Convert database to template
    await postgresClient.query(
      `ALTER DATABASE ${databaseName} WITH is_template TRUE;`
    )

    return {
      templateName: databaseName,
      lastMessage: reply,
    }
  }

  private async getConnectionDetails(databaseName: string) {
    const { container } = await this.startContainerPromise
    const externalDatabaseUrl = `postgresql://postgres:@${container.getHost()}:${container.getMappedPort(
      5432
    )}/${databaseName}`

    return {
      connectionString: externalDatabaseUrl,
      // todo: populate
      connectionStringDocker: "",

      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: databaseName,
      username: "postgres",
      password: "",
    }
  }

  private async startContainer() {
    let container = new GenericContainer(
      `postgres:${this.initialData.postgresVersion}`
    )
      .withExposedPorts(5432)
      .withEnv("POSTGRES_HOST_AUTH_METHOD", "trust")
      .withEnv("PGDATA", "/var/lib/postgresql/data")
      .withCmd([
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
      // todo: add startup check to speed this up?
      .withStartupTimeout(120_000)

    if (this.initialData.containerOptions?.bindMounts) {
      for (const bindMount of this.initialData.containerOptions.bindMounts) {
        container = container.withBindMount(
          bindMount.source,
          bindMount.target,
          bindMount.mode
        )
      }
    }

    const startedContainer = await container.start()

    return {
      container: startedContainer,
      postgresClient: new Pool({
        connectionString: `postgresql://postgres:@${startedContainer.getHost()}:${startedContainer.getMappedPort(
          5432
        )}/postgres`,
      }),
    }
  }
}
