import test from "ava"
import os from "node:os"
import fs from "node:fs/promises"
import getRandomDatabaseName from "~/lib/get-random-database-name"
import { getTestPostgresDatabaseFactory } from ".."

test("bind mounts", async (t) => {
  const testSQLScript1Path = os.tmpdir() + `/${getRandomDatabaseName()}.sql`
  const testSQLScript2Path = os.tmpdir() + `/${getRandomDatabaseName()}.sql`

  await fs.writeFile(testSQLScript1Path, "CREATE TABLE foo ();")
  await fs.writeFile(testSQLScript2Path, "CREATE TABLE bar ();")

  const getTestPostgresDatabase = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "bindMounts",
    container: {
      bindMounts: [
        {
          source: testSQLScript1Path,
          target: "/test1.sql",
        },
        {
          source: testSQLScript2Path,
          target: "/test2.sql",
        },
      ],
    },
    beforeTemplateIsBaked: async ({
      connection: { username, database },
      containerExec,
    }) => {
      const loadSQLFile = async (fileName: string) => {
        const { exitCode, output } = await containerExec(
          `psql -U ${username} -d ${database} -f ${fileName}`.split(" ")
        )

        if (exitCode !== 0) {
          t.log(output)
          throw new Error(`Failed to load test schema`)
        }
      }

      await loadSQLFile("/test1.sql")
      await loadSQLFile("/test2.sql")
    },
  })

  const { pool } = await getTestPostgresDatabase()

  await t.notThrowsAsync(async () => await pool.query("SELECT * FROM foo"))
  await t.notThrowsAsync(async () => await pool.query("SELECT * FROM bar"))
})
