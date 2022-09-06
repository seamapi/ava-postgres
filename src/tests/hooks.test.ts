import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"

test("beforeTemplateIsBaked", async (t) => {
  let wasHookCalled = false

  interface TestFactoryParams {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    key: "beforeTemplateIsBaked",
    hooks: {
      beforeTemplateIsBaked: async ({ pool }, { tableName }) => {
        wasHookCalled = true
        await pool.query(
          `CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`
        )
      },
    },
  })

  const { pool } = await getTestServer({ tableName: "foo" })

  t.true(wasHookCalled)
  await t.notThrowsAsync(async () => await pool.query('SELECT * FROM "foo"'))
})
