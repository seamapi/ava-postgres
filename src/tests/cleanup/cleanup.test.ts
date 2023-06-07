import test from "ava"
import { execa } from "execa"

test("old test databases are cleaned up once the test worker exits", async (t) => {
  await t.notThrowsAsync(async () => {
    const { stdout } = await execa("yarn", [
      "ava",
      "src/tests/cleanup/create-database.ts",
      "src/tests/cleanup/does-database-exist.ts",
      "-T",
      "1m",
      "-c",
      "1",
    ])

    t.log(stdout)
  })
})
