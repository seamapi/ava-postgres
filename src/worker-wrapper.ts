import { SharedWorker } from "ava/plugin"
import { Worker } from "./worker"

const workerWrapper = async (protocol: SharedWorker.Protocol) => {
  const { initialData } = protocol

  const worker = new Worker(initialData as any)

  for await (const testWorker of protocol.testWorkers()) {
    void worker.handleTestWorker(testWorker)
  }
}

export default workerWrapper
