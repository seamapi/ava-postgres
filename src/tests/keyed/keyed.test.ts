import test from "ava"
import { execa } from "execa"

test("key works across test workers", async (t) => {
  const { stderr, stdout } = await execa("yarn", [
    "ava",
    "src/tests/keyed/1.ts",
    "src/tests/keyed/2.ts",
    "-T",
    "1m",
  ])

  t.log(stdout)

  const connectionStrings = stderr
    .match(/connectionString: (.*)/g)
    ?.map((line) => line.replace("connectionString: ", ""))

  t.is(connectionStrings?.length, 2)
  t.is(connectionStrings?.[0], connectionStrings?.[1])
})
