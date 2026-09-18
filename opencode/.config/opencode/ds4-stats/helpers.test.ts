import { describe, expect, test } from "bun:test"
import {
  createParser,
  ds4ProviderIDs,
  formatCount,
  formatDuration,
  formatHit,
  formatRate,
  hitLevel,
  isDs4BaseURL,
  linkMessages,
  rateLevel,
  resolveSource,
  sessionModelRef,
  sessionStats,
  sourceForVariant,
  toolDurationSecs,
  usageMessages,
  type MessageLike,
  type RequestRecord,
  type ToolTime,
} from "./helpers"

const line = (suffix: string) => `0828 13:21:46 ds4-server: ${suffix}`

describe("createParser", () => {
  test("records a cold request like ds4-monitor does", () => {
    const parser = createParser()
    parser.push(line("chat ctx=0..42919:42919 RESPPROTO TOOLS prompt start"))
    parser.push(line("chat ctx=0..42919:42919 RESPPROTO TOOLS prefill chunk 28672/42919 (66.8%) chunk=463.42 t/s avg=521.02 t/s 55.031s"))
    parser.push(line("chat ctx=0..42919:42919 RESPPROTO TOOLS prompt done 88.191s"))
    parser.push(line("chat ctx=42919..42946:27 gen=27 RESPPROTO TOOLS decoding chunk=32.08 t/s avg=32.08 t/s 0.842s"))
    parser.push(line("chat ctx=0..42919:42919 gen=27 RESPPROTO TOOLS finish=stop 89.033s"))

    expect(parser.requests).toHaveLength(1)
    expect(parser.requests[0]).toEqual({
      id: 0,
      total: 42919,
      reused: 0,
      prefetched: 42919,
      prefillSecs: 88.191,
      gen: 27,
      decodeSecs: 0.842,
      finished: true,
    })
  })

  test("keeps reuse, gen and decode across a thinking turn", () => {
    const parser = createParser()
    parser.push(line("live kv cache miss live=42946 prompt=10 common=1 reason=token-mismatch"))
    parser.push(line("chat ctx=40000..42946:2946 prompt start"))
    parser.push(line("chat ctx=0..10:10 prompt done 22.459s"))
    parser.push(line("chat ctx=42946..42996:50 gen=50 THINKING decoding chunk=36.04 t/s avg=36.04 t/s 1.387s"))
    parser.push(line("chat ctx=42996..43010:14 gen=64 THINKING decoding chunk=43.42 t/s avg=37.43 t/s 1.710s"))
    parser.push(line("chat ctx=0..42946:42946 gen=64 THINKING finish=length 24.169s"))

    expect(parser.requests).toHaveLength(1)
    expect(parser.requests[0]).toMatchObject({
      total: 42946,
      reused: 40000,
      prefetched: 2946,
      prefillSecs: 22.459,
      gen: 64,
      decodeSecs: 1.71,
      finished: true,
    })
  })

  test("separates consecutive requests and finishes each once", () => {
    const parser = createParser()
    parser.push(line("chat ctx=0..10:10 prompt start"))
    parser.push(line("chat ctx=0..10:10 prompt done 1.5s"))
    parser.push(line("chat ctx=10..20:10 gen=10 decoding chunk=20.00 t/s avg=20.00 t/s 0.5s"))
    parser.push(line("chat ctx=0..10:10 gen=10 finish=stop 2.0s"))
    parser.push(line("chat ctx=0..10:10 gen=10 finish=stop 2.0s"))
    parser.push(line("chat ctx=20..30:10 prompt start"))
    parser.push(line("chat ctx=0..20:20 prompt done 2.0s"))
    parser.push(line("chat ctx=30..40:10 gen=10 decoding chunk=25.00 t/s avg=25.00 t/s 0.4s"))
    parser.push(line("chat ctx=0..20:20 gen=10 finish=length 2.4s"))

    expect(parser.requests.map((request) => request.id)).toEqual([0, 1])
    expect(parser.requests[0]).toMatchObject({ total: 10, reused: 0, prefetched: 10, prefillSecs: 1.5 })
    expect(parser.requests[1]).toMatchObject({ total: 30, reused: 20, prefetched: 10, prefillSecs: 2 })
  })

  test("ignores prompt done and finish seen before the seed window", () => {
    const parser = createParser()
    parser.push(line("chat ctx=0..10:10 prompt done 4.0s"))
    parser.push(line("chat ctx=0..10:10 gen=5 finish=stop 4.5s"))
    parser.push(line("some unrelated log line"))

    expect(parser.requests).toHaveLength(0)
  })
})

describe("resolveSource", () => {
  const home = "/Users/tester"
  const env = {}
  const never = () => false

  test("prefers q38fn when its pid file is alive", () => {
    const source = resolveSource({
      env,
      home,
      pidAlive: (pidFile) => pidFile === "/Users/tester/.cache/ds4-q38fn/ds4-q38fn-server.pid",
    })
    expect(source).toEqual({
      variant: "q38fn",
      label: "Qwen3.8 Flash Next",
      log: "/Users/tester/Library/Logs/ds4/ds4-q38fn-server.log",
    })
  })

  test("falls back to ds4", () => {
    expect(resolveSource({ env, home, pidAlive: never })).toEqual({
      variant: "ds4",
      label: "DwarfStar",
      log: "/Users/tester/Library/Logs/ds4/ds4-server.log",
    })
  })

  test("honors DS4_LOG_DIR and DS4_RUN_DIR overrides", () => {
    const source = resolveSource({
      env: { DS4_LOG_DIR: "/tmp/logs", DS4_RUN_DIR: "/tmp/run" },
      home,
      pidAlive: (pidFile) => pidFile === "/tmp/run/ds4-q38fn-server.pid",
    })
    expect(source.log).toBe("/tmp/logs/ds4-q38fn-server.log")
    expect(sourceForVariant("ds4", { DS4_LOG_DIR: "/tmp/logs" }, home).log).toBe("/tmp/logs/ds4-server.log")
  })
})

describe("linkMessages", () => {
  const request = (overrides: Partial<RequestRecord>): RequestRecord => ({
    id: 0,
    total: 100,
    reused: 0,
    prefetched: 100,
    prefillSecs: 1,
    gen: 10,
    decodeSecs: 0.5,
    finished: true,
    ...overrides,
  })

  const message = (id: string, input: number, read: number, created: number): MessageLike => ({
    id,
    role: "assistant",
    time: { created, completed: created + 1000 },
    tokens: { input, output: 10, reasoning: 0, cache: { read, write: 0 } },
  })

  test("claims a matching request once and reuses the claim later", () => {
    const requests = [request({ id: 7, total: 120 })]
    const claims = new Map<string, number>()
    const messages = [message("m1", 20, 100, 1)]

    const first = linkMessages({ messages, requests, claims })
    expect(first.get("m1")?.id).toBe(7)
    expect(claims.get("m1")).toBe(7)

    const again = linkMessages({ messages, requests, claims })
    expect(again.get("m1")?.id).toBe(7)
  })

  test("does not hand one request to two messages", () => {
    const requests = [request({ id: 7, total: 120 })]
    const claims = new Map<string, number>()
    const messages = [message("m1", 20, 100, 1), message("m2", 20, 100, 2)]

    const links = linkMessages({ messages, requests, claims })
    expect(links.get("m1")?.id).toBe(7)
    expect(links.has("m2")).toBe(false)
  })

  test("skips unfinished requests and unmatched totals", () => {
    const requests = [request({ id: 7, total: 120, finished: false }), request({ id: 8, total: 999 })]
    const links = linkMessages({ messages: [message("m1", 20, 100, 1)], requests, claims: new Map() })
    expect(links.size).toBe(0)
  })
})

describe("sessionStats", () => {
  const requests: RequestRecord[] = [
    { id: 0, total: 100, reused: 0, prefetched: 100, prefillSecs: 2, gen: 20, decodeSecs: 1, finished: true },
    { id: 1, total: 200, reused: 100, prefetched: 100, prefillSecs: 2, gen: 60, decodeSecs: 1, finished: true },
  ]
  const messages: MessageLike[] = [
    {
      id: "m1",
      tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    {
      id: "m2",
      tokens: { input: 100, output: 60, reasoning: 0, cache: { read: 100, write: 0 } },
    },
  ]

  test("weights rates by tokens and counts only linked requests", () => {
    const claims = new Map<string, number>()
    const links = linkMessages({ messages, requests, claims })
    const stats = sessionStats(messages, links)

    expect(stats.turns).toBe(2)
    expect(stats.matched).toBe(2)
    expect(stats.prefillRate).toBeCloseTo(200 / 4, 5)
    expect(stats.decodeRate).toBeCloseTo(80 / 2, 5)
    expect(stats.hitPercent).toBeCloseTo((100 / 300) * 100, 5)
    expect(stats.durationSecs).toBeCloseTo(6, 5)
  })

  test("reports undefined rates without links but keeps cache hit", () => {
    const stats = sessionStats(messages, new Map())
    expect(stats.matched).toBe(0)
    expect(stats.prefillRate).toBeUndefined()
    expect(stats.decodeRate).toBeUndefined()
    expect(stats.hitPercent).toBeCloseTo((100 / 300) * 100, 5)
    expect(stats.durationSecs).toBe(0)
    expect(stats.toolDurationSecs).toBe(0)
    expect(stats.totalDurationSecs).toBe(0)
  })

  test("adds tool wall time for counted messages to total work", () => {
    const claims = new Map<string, number>()
    const links = linkMessages({ messages, requests, claims })
    const parts: ToolTime[] = [
      { messageID: "m1", start: 0, end: 61_000 },
      { messageID: "m2", start: 61_000, end: 123_000 },
      { messageID: "other", start: 0, end: 999_000 },
    ]
    const stats = sessionStats(messages, links, parts)
    expect(stats.durationSecs).toBeCloseTo(6, 5)
    expect(stats.toolDurationSecs).toBeCloseTo(123, 5)
    expect(stats.totalDurationSecs).toBeCloseTo(129, 5)
  })
})

describe("toolDurationSecs", () => {
  const span = (messageID: string, start: number, end: number): ToolTime => ({ messageID, start, end })

  test("sums disjoint spans and merges overlapping ones", () => {
    const allowed = new Set(["m1"])
    expect(toolDurationSecs([span("m1", 0, 1000), span("m1", 2000, 5000)], allowed)).toBe(4)
    expect(toolDurationSecs([span("m1", 0, 3000), span("m1", 2000, 5000)], allowed)).toBe(5)
    expect(toolDurationSecs([span("m1", 0, 1000), span("m1", 1000, 2000)], allowed)).toBe(2)
  })

  test("ignores other messages, degenerate spans and non-finite times", () => {
    const allowed = new Set(["m1"])
    expect(toolDurationSecs([span("m2", 0, 5000)], allowed)).toBe(0)
    expect(toolDurationSecs([span("m1", 5, 5), span("m1", 10, 5)], allowed)).toBe(0)
    expect(toolDurationSecs([span("m1", Number.NaN, 10)], allowed)).toBe(0)
    expect(toolDurationSecs([], allowed)).toBe(0)
  })
})

describe("sessionModelRef", () => {
  test("reads assistant and user model references, latest wins", () => {
    const messages: MessageLike[] = [
      { id: "m1", role: "assistant", providerID: "ds4", modelID: "qwen3.8-flash-next" },
      { id: "m2", role: "user", model: { providerID: "ds4", modelID: "qwen3.8-flash-next" } },
      { id: "m3", role: "user", model: { providerID: "omlx", modelID: "Qwen3.5-4B-oQ4e-mtp" } },
    ]
    expect(sessionModelRef(messages)).toEqual({ providerID: "omlx", modelID: "Qwen3.5-4B-oQ4e-mtp" })
  })

  test("returns undefined without any model reference", () => {
    expect(sessionModelRef([{ id: "m1", role: "user" }])).toBeUndefined()
    expect(sessionModelRef([])).toBeUndefined()
  })
})

describe("ds4 provider gating", () => {
  test("matches host and port, including loopback aliases", () => {
    expect(isDs4BaseURL("http://127.0.0.1:8000/v1", "127.0.0.1", 8000)).toBe(true)
    expect(isDs4BaseURL("http://localhost:8000/v1", "127.0.0.1", "8000")).toBe(true)
    expect(isDs4BaseURL("http://127.0.0.1:8888/v1", "127.0.0.1", 8000)).toBe(false)
    expect(isDs4BaseURL("https://api.deepseek.com/v1", "127.0.0.1", 8000)).toBe(false)
    expect(isDs4BaseURL(undefined, "127.0.0.1", 8000)).toBe(false)
  })

  test("selects only providers pointed at the ds4 server", () => {
    const config = {
      provider: {
        ds4: { options: { baseURL: "http://127.0.0.1:8000/v1" } },
        omlx: { options: { baseURL: "http://127.0.0.1:8888/v1" } },
        deepseek: {},
      },
    }
    expect(ds4ProviderIDs(config, {})).toEqual(["ds4"])
    expect(ds4ProviderIDs(config, { DS4_PORT: "8888" })).toEqual(["omlx"])
    expect(ds4ProviderIDs(config, { DS4_HOST: "localhost" })).toEqual(["ds4"])
    expect(ds4ProviderIDs(undefined, {})).toEqual([])
  })
})

describe("usageMessages", () => {
  test("keeps only completed assistant usage from the ds4 providers", () => {
    const messages: MessageLike[] = [
      {
        id: "a",
        role: "assistant",
        providerID: "ds4",
        modelID: "qwen3.8-flash-next",
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      {
        id: "b",
        role: "assistant",
        providerID: "omlx",
        modelID: "Qwen3.5-4B-oQ4e-mtp",
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      { id: "c", role: "assistant", providerID: "ds4", modelID: "qwen3.8-flash-next" },
      { id: "d", role: "user", model: { providerID: "ds4", modelID: "qwen3.8-flash-next" } },
    ]
    expect(usageMessages(messages, ["ds4"]).map((message) => message.id)).toEqual(["a"])
  })
})

describe("levels and formatting", () => {
  test("matches ds4-monitor thresholds", () => {
    expect(rateLevel(20)).toBe("good")
    expect(rateLevel(19.9)).toBe("warn")
    expect(rateLevel(4.9)).toBe("bad")
    expect(rateLevel(undefined)).toBe("none")
    expect(hitLevel(80)).toBe("good")
    expect(hitLevel(79.9)).toBe("warn")
    expect(hitLevel(49.9)).toBe("bad")
    expect(hitLevel(undefined)).toBe("none")
  })

  test("formats one decimal or a dash", () => {
    expect(formatRate(41.234)).toBe("41.2")
    expect(formatRate(undefined)).toBe("--")
    expect(formatCount(1246.4)).toBe("1246")
    expect(formatCount(undefined)).toBe("--")
    expect(formatHit(87.01)).toBe("87.0%")
    expect(formatHit(undefined)).toBe("--")
  })

  test("formats elapsed time as minutes or hours+minutes, hidden below a minute", () => {
    expect(formatDuration(59.9)).toBeUndefined()
    expect(formatDuration(60)).toBe("1m")
    expect(formatDuration(3599)).toBe("59m")
    expect(formatDuration(3600)).toBe("1h")
    expect(formatDuration(5160)).toBe("1h 26m")
    expect(formatDuration(3720)).toBe("1h 2m")
    expect(formatDuration(undefined)).toBeUndefined()
  })
})
