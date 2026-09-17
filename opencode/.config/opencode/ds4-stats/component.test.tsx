import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Stats } from "../tui-plugins/ds4-stats"
import type { SessionStats } from "./helpers"

// Run with: bun test --preload @opentui/solid/preload ./ds4-stats/component.test.tsx
//
// The preload mirrors what the OpenCode TUI does at runtime: it rewrites bare
// `solid-js` imports to the client build and installs the JSX transform. This
// component is built for the hostile case anyway (external file plugins are
// NOT Solid-transformed in 1.18.31, so compiled JSX never re-evaluates and all
// updates go through renderable refs).

const theme = {
  success: "#50fa7b",
  warning: "#f1fa8c",
  error: "#ff5555",
  textMuted: "#6272a4",
}

const api = { theme: { current: theme } } as unknown as TuiPluginApi
const source = { variant: "custom", label: "DUNK", log: "/tmp/x" } as const

function statsFor(decodeRate: number, durationSecs = 5160): SessionStats {
  return {
    turns: 1,
    matched: 1,
    prefillTokens: 100,
    prefillSecs: 1,
    prefillRate: 500,
    decodeTokens: 10,
    decodeSecs: 1,
    decodeRate,
    hitRead: 80,
    hitTotal: 100,
    hitPercent: 80,
    durationSecs,
  }
}

test("writes stats into the frame and refreshes when they change", async () => {
  const [decode, setDecode] = createSignal(10)
  const setup = await testRender(
    () => <Stats api={api} sessionID="ses_test" source={source} stats={() => statsFor(decode())} />,
    { width: 60, height: 8 },
  )
  await setup.renderOnce()

  const first = await setup.waitForFrame((frame) => frame.includes("10.0"), { maxPasses: 50 })
  expect(first).toContain("DUNK · session avg")
  expect(first).toContain("pp")
  expect(first).toContain("500")
  expect(first).toContain("tg")
  expect(first).toContain("80.0%")
  expect(first).toContain("model work")
  expect(first).toContain("1h 26m")

  setDecode(42)
  const second = await setup.waitForFrame((frame) => frame.includes("42.0"), { maxPasses: 50 })
  expect(second).not.toContain("10.0")
})

test("hides work time below one minute", async () => {
  const setup = await testRender(
    () => <Stats api={api} sessionID="ses_test" source={source} stats={() => statsFor(10, 59)} />,
    { width: 60, height: 8 },
  )
  await setup.renderOnce()
  const frame = await setup.waitForFrame((f) => f.includes("pp"), { maxPasses: 50 })
  expect(frame).not.toContain("work")
})

test("collapses the block when the session is not on ds4", async () => {
  const [enabled, setEnabled] = createSignal(true)
  const setup = await testRender(
    () => (
      <Stats
        api={api}
        sessionID="ses_test"
        source={source}
        stats={() => (enabled() ? statsFor(10) : undefined)}
      />
    ),
    { width: 60, height: 8 },
  )
  await setup.renderOnce()
  await setup.waitForFrame((frame) => frame.includes("pp"), { maxPasses: 50 })

  setEnabled(false)
  await setup.waitForFrame((frame) => !frame.includes("pp"), { maxPasses: 50 })
})
