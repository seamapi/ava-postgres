import { customAlphabet } from "nanoid"

const nanoid = customAlphabet("1234567890abcdef", 10)

const getRandomDatabaseName = () => `test_${nanoid()}`

export default getRandomDatabaseName
