import {
  SubagentAdmissionQueue,
  SubagentAdmissionTimeoutError,
} from "./concurrency-queue"

const [path, resource = "explore", timeoutText, holdText] = Bun.argv.slice(2)
if (!path) throw new Error("queue path is required")

const queue = new SubagentAdmissionQueue({
  path,
  resource,
  timeoutMs: Number(timeoutText ?? 60_000),
  pollMs: 5,
})

try {
  const lease = await queue.acquire()
  console.log("acquired")
  await Bun.sleep(Number(holdText ?? 0))
  lease.release()
} catch (error) {
  if (error instanceof SubagentAdmissionTimeoutError) console.log("timeout")
  else throw error
} finally {
  queue.close()
}
