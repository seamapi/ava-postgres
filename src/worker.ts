import { SharedWorker } from "ava/plugin"
import { Pool } from "pg"
import { GenericContainer } from "testcontainers"
import { InitialWorkerData, WorkerMessage } from "./internal-types"
import getRandomDatabaseName from "./lib/get-random-database-name"

// todo: warn if too many templates

const startContainer = async (initialData: InitialWorkerData) => {
  let container = new GenericContainer(
    `postgres:${initialData.postgresVersion}`
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

  if (initialData.containerOptions?.bindMounts) {
    for (const bindMount of initialData.containerOptions.bindMounts) {
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

let startedContainerPromise: ReturnType<typeof startContainer>

const handleMessage = async (
  message: SharedWorker.ReceivedMessage<WorkerMessage>
) => {
  if (message.data.type === "GET_TEST_DATABASE") {
    const { postgresClient, container } = await startedContainerPromise

    const databaseName = getRandomDatabaseName()

    const externalDatabaseUrl = `postgresql://postgres:@${container.getHost()}:${container.getMappedPort(
      5432
    )}/${databaseName}`

    await postgresClient.query(`CREATE DATABASE ${databaseName};`)

    message.reply({
      type: "GOT_DATABASE",
      connectionDetails: {
        connectionString: externalDatabaseUrl,
        connectionStringDocker: "",

        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: databaseName,
        username: "postgres",
        password: "",
      },
    })

    return
  }

  throw new Error(`Unknown message: ${message.data}`)
}

const workerHandler = async (protocol: SharedWorker.Protocol) => {
  const { initialData } = protocol

  startedContainerPromise = startContainer(initialData as any)

  for await (const message of protocol.subscribe()) {
    void handleMessage(message as any)
  }
}

export default workerHandler
