import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"
import { countDatabaseTemplates } from "./utils/count-database-templates"
import { doesDatabaseExist } from "./utils/does-database-exist"

test("beforeTemplateIsBaked", async (t) => {
  let wasHookCalled = false

  type TestFactoryParams = {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBaked",
    beforeTemplateIsBaked: async ({
      connection: { pool },
      params: { tableName },
    }) => {
      wasHookCalled = true
      await pool.query(`CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`)
    },
  })

  const { pool } = await getTestServer(t, { tableName: "foo" })

  t.true(wasHookCalled)
  await t.notThrowsAsync(async () => await pool.query('SELECT * FROM "foo"'))
})

test("beforeTemplateIsBaked (params are de-duped)", async (t) => {
  type TestFactoryParams = {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedDedupeParams",
    beforeTemplateIsBaked: async ({
      connection: { pool },
      params: { tableName },
    }) => {
      await pool.query(`CREATE TABLE "${tableName}" ("id" SERIAL PRIMARY KEY)`)
    },
  })

  // Create first template
  await Promise.all([
    getTestServer(t, { tableName: "foo" }),
    // Re-use created template
    getTestServer(t, { tableName: "foo" }),
    // Create second template
    getTestServer(t, { tableName: "bar" }),
  ])

  const { pool } = await getTestServer(t, { tableName: "foo" })
  // Should have created two templates
  t.is(await countDatabaseTemplates(pool), 2)
})

test("beforeTemplateIsBaked (get result of hook)", async (t) => {
  type TestFactoryParams = {
    tableName: string
  }

  const getTestServer = getTestPostgresDatabaseFactory<TestFactoryParams>({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookResult",
    beforeTemplateIsBaked: async ({ params: { tableName } }) => {
      return { tableName }
    },
  })

  t.like(await getTestServer(t, { tableName: "foo" }), {
    beforeTemplateIsBakedResult: { tableName: "foo" },
  })

  t.like(await getTestServer(t, { tableName: "bar" }), {
    beforeTemplateIsBakedResult: { tableName: "bar" },
  })

  t.like(await getTestServer(t, { tableName: "foo" }), {
    beforeTemplateIsBakedResult: { tableName: "foo" },
  })
})

test("beforeTemplateIsBaked (if hook throws, worker doesn't crash)", async (t) => {
  const getTestServer = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookThrows",
    beforeTemplateIsBaked: async () => {
      throw new Error("foo")
    },
  })

  await t.throwsAsync(
    async () => {
      await getTestServer(t)
    },
    {
      message: /foo/,
    }
  )
})

test("beforeTemplateIsBaked (propagates error that isn't serializable)", async (t) => {
  const getTestServer = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookThrowsNonSerializable",
    beforeTemplateIsBaked: async () => {
      const error = new Error("foo")
      // Typed arrays aren't serializable
      ;(error as any).bar = new Uint16Array(1)
      throw error
    },
  })

  await t.throwsAsync(
    async () => {
      await getTestServer(t)
    },
    {
      message: /foo/,
    }
  )
})

test("beforeTemplateIsBaked (result isn't serializable)", async (t) => {
  const getTestServer = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookNonSerializable",
    beforeTemplateIsBaked: async () => {
      return {
        foo: () => "bar",
      }
    },
  })

  // Should throw error with clear message
  await t.throwsAsync(
    async () => {
      await getTestServer(t)
    },
    {
      message: /could not be serialized/,
    }
  )
})

test("beforeTemplateIsBaked, get nested database", async (t) => {
  type DatabaseParams = {
    type: "foo" | "bar"
  }

  let nestedDatabaseName: string | undefined = undefined

  const getTestServer = getTestPostgresDatabaseFactory<DatabaseParams>({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookNestedDatabase",
    beforeTemplateIsBaked: async ({
      params,
      connection: { pool },
      beforeTemplateIsBaked,
    }) => {
      if (params.type === "foo") {
        await pool.query(`CREATE TABLE "foo" ("id" SERIAL PRIMARY KEY)`)
        return { createdFoo: true }
      }

      await pool.query(`CREATE TABLE "bar" ("id" SERIAL PRIMARY KEY)`)
      const fooDatabase = await beforeTemplateIsBaked({
        params: { type: "foo" },
      })
      t.deepEqual(fooDatabase.beforeTemplateIsBakedResult, { createdFoo: true })

      nestedDatabaseName = fooDatabase.database

      await t.notThrowsAsync(async () => {
        await fooDatabase.pool.query(`INSERT INTO "foo" DEFAULT VALUES`)
      })

      return { createdBar: true }
    },
  })

  const database = await getTestServer(t, { type: "bar" })
  t.deepEqual(database.beforeTemplateIsBakedResult, { createdBar: true })

  t.false(
    await doesDatabaseExist(database.pool, nestedDatabaseName!),
    "Nested database should have been cleaned up after the parent hook completed"
  )
})
