import test from "ava"
import { Pool } from "pg"
import { getTestPostgresDatabaseFactory } from "~/index"
import { GenericContainer } from "testcontainers"

const getTestServer = getTestPostgresDatabaseFactory({
  postgresVersion: process.env.POSTGRES_VERSION,
})

test("gets a valid Pool instance", async (t) => {
  const { pool } = await getTestServer()
  const {
    rows: [row],
  } = await pool.query("SELECT 1 + 1 AS result")
  t.is(row.result, 2)
})

test("using connection details manually works", async (t) => {
  const connectionDetails = await getTestServer()
  const pool = new Pool({
    host: connectionDetails.host,
    port: connectionDetails.port,
    database: connectionDetails.database,
    user: connectionDetails.username,
    password: connectionDetails.password,
  })
  const {
    rows: [row],
  } = await pool.query("SELECT 1 + 1 AS result")
  t.is(row.result, 2)
})

test("connect from another container", async (t) => {
  const { connectionStringDocker, networkNameDocker } = await getTestServer()

  const container = await new GenericContainer("postgres:14")
    .withEnvironment({ POSTGRES_HOST_AUTH_METHOD: "trust" })
    .withNetworkMode(networkNameDocker)
    .withStartupTimeout(120_000)
    .start()

  const result = await container.exec([
    "psql",
    "-d",
    connectionStringDocker,
    "-c",
    "SELECT 1 + 1 AS result",
  ])

  t.is(result.exitCode, 0)
})
