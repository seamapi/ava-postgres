import test from "ava"
import { getTestPostgresDatabaseFactory } from "~/index"
import { countDatabaseTemplates } from "./utils/count-database-templates"

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
  type HookReturn = {
    type: "function" | "date"
  }

  const getTestServer = getTestPostgresDatabaseFactory<HookReturn>({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookNonSerializable",
    beforeTemplateIsBaked: async ({ params: { type } }) => {
      return {
        foo: type === "function" ? () => "bar" : new Date(),
      }
    },
  })

  // Should throw error with clear message
  await t.throwsAsync(
    async () => {
      await getTestServer(t, { type: "function" })
    },
    {
      message: /could not be serialized/,
    }
  )

  // Can return a date
  const { beforeTemplateIsBakedResult } = await getTestServer(t, {
    type: "date",
  })
  t.true(beforeTemplateIsBakedResult.foo instanceof Date)
})

test("beforeTemplateIsBaked with manual template build", async (t) => {
  const getTestDatabase = getTestPostgresDatabaseFactory({
    postgresVersion: process.env.POSTGRES_VERSION,
    workerDedupeKey: "beforeTemplateIsBakedHookManualTemplateBuild",
    beforeTemplateIsBaked: async ({
      connection: { pool },
      manuallyBuildAdditionalTemplate,
    }) => {
      await pool.query(`CREATE TABLE "bar" ("id" SERIAL PRIMARY KEY)`)

      const fooTemplateBuilder = await manuallyBuildAdditionalTemplate()
      await fooTemplateBuilder.connection.pool.query(
        `CREATE TABLE "foo" ("id" SERIAL PRIMARY KEY)`
      )
      const { templateName: fooTemplateName } =
        await fooTemplateBuilder.finish()

      return { fooTemplateName }
    },
  })

  const barDatabase = await getTestDatabase(t)
  t.truthy(barDatabase.beforeTemplateIsBakedResult.fooTemplateName)

  const fooDatabase = await getTestDatabase.fromTemplate(
    t,
    barDatabase.beforeTemplateIsBakedResult.fooTemplateName
  )

  await t.notThrowsAsync(async () => {
    await fooDatabase.pool.query('SELECT * FROM "foo"')
  }, "foo table should exist on database manually created from template")

  await t.throwsAsync(async () => {
    await fooDatabase.pool.query('SELECT * FROM "bar"')
  })
})
