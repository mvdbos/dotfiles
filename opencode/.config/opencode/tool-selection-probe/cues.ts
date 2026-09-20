import type { ProbeCue } from "./helpers"

export const FIXTURE_FILES: Record<string, string> = {
  "package.json": `${JSON.stringify(
    {
      name: "ledger-sync",
      version: "0.4.2",
      type: "module",
      private: true,
      scripts: { start: "bun src/cli.ts" },
    },
    null,
    2,
  )}\n`,
  "src/cli.ts": `import { runSync } from "./sync.ts"

const command = process.argv[2]
if (command !== "sync") {
  console.error("usage: ledger-sync sync")
  process.exit(1)
}

const summary = await runSync(process.env.LEDGER_CONFIG ?? "config.json")
console.log(\`applied \${summary.applied} of \${summary.planned} planned mutations\`)
`,
  "src/sync.ts": `import { loadConfig } from "./config.ts"
import { fetchRemote } from "./transport.ts"
import { loadStore, saveStore } from "./store.ts"
import { planMutations, applyMutations } from "./mutations.ts"

export type SyncSummary = { planned: number; applied: number }

export async function runSync(configPath: string): Promise<SyncSummary> {
  const config = await loadConfig(configPath)
  const local = await loadStore(config.storePath)
  const remote = await fetchRemote(config.endpoint, config.token, config.retries)
  const plan = planMutations(local, remote)
  const applied = applyMutations(local, plan)
  await saveStore(config.storePath, local)
  return { planned: plan.length, applied: applied.length }
}
`,
  "src/config.ts": `import { readFile } from "node:fs/promises"

export type Config = {
  endpoint: string
  token: string
  storePath: string
  retries: number
}

const DEFAULTS = { storePath: "./ledger.json", retries: 2 }

export async function loadConfig(path: string): Promise<Config> {
  const raw = JSON.parse(await readFile(path, "utf8"))
  return { ...DEFAULTS, ...raw }
}
`,
  "src/transport.ts": `export type RemoteAccount = { id: string; balance: number; revision: number }

export async function fetchRemote(endpoint: string, token: string, retries = 2): Promise<RemoteAccount[]> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(\`\${endpoint}/accounts\`, {
      headers: { authorization: \`Bearer \${token}\` },
    })
    if (response.ok) return (await response.json()) as RemoteAccount[]
    if (response.status < 500) throw new Error(\`ledger endpoint rejected the request: \${response.status}\`)
  }
  throw new Error("ledger endpoint unavailable after retries")
}
`,
  "src/store.ts": `import { readFile, writeFile } from "node:fs/promises"
import type { RemoteAccount } from "./transport.ts"

export type Ledger = { accounts: RemoteAccount[] }

export async function loadStore(path: string): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Ledger
  } catch {
    return { accounts: [] }
  }
}

export async function saveStore(path: string, ledger: Ledger): Promise<void> {
  await writeFile(path, JSON.stringify(ledger, null, 2))
}
`,
  "src/mutations.ts": `import type { RemoteAccount } from "./transport.ts"
import type { Ledger } from "./store.ts"

export type Mutation = { id: string; balance: number }

export function planMutations(local: Ledger, remote: RemoteAccount[]): Mutation[] {
  const known = new Map(local.accounts.map((account) => [account.id, account]))
  return remote
    .filter((account) => known.get(account.id)?.revision !== account.revision)
    .map((account) => ({ id: account.id, balance: account.balance }))
}

export function applyMutations(local: Ledger, plan: Mutation[]): Mutation[] {
  for (const mutation of plan) {
    const account = local.accounts.find((candidate) => candidate.id === mutation.id)
    if (account) {
      account.balance = mutation.balance
    } else {
      local.accounts.push({ id: mutation.id, balance: mutation.balance, revision: 0 })
    }
  }
  return plan
}
`,
  "src/legacy/sync-v1.ts": `// Superseded by src/sync.ts. Retained only for the v1 data migration.
export async function runLegacySync(endpoint: string): Promise<void> {
  const response = await fetch(\`\${endpoint}/export\`)
  if (!response.ok) throw new Error("legacy export failed")
  await response.text()
}
`,
  "docs/architecture.md": `# ledger-sync architecture

- \`src/cli.ts\` parses the command and delegates to \`runSync\`.
- \`src/sync.ts\` orchestrates one sync run: config, store, remote fetch, plan, apply, save.
- \`src/config.ts\` merges defaults with the JSON config file.
- \`src/transport.ts\` talks to the ledger endpoint and retries on server errors.
- \`src/store.ts\` loads and saves the local ledger JSON.
- \`src/mutations.ts\` plans and applies balance mutations.
- \`src/legacy/sync-v1.ts\` is the retired v1 path; only the migration uses it.
`,
}

export const PROBE_CUES: ProbeCue[] = [
  {
    id: "exploration",
    expectation: "task:explore",
    forbidden: ["task:general", "question"],
    prompt:
      "I'm new to this repository. Explore the codebase and give me an end-to-end map of how one sync run flows through it: every module involved, in order, with concrete file and function references. I need a complete picture of the whole flow, not a partial guess.",
  },
  {
    id: "research-review",
    expectation: "task:general",
    forbidden: ["task:explore"],
    prompt:
      "Do a thorough code review of this whole project. Report concrete findings: correctness risks, inconsistencies between modules, and improvement opportunities. Cover all modules, not just one file.",
  },
  {
    id: "user-input",
    expectation: "question",
    forbidden: [],
    prompt:
      "I want to improve this project, but I haven't decided what to change yet. Don't guess: get what you need from me first, then you can start.",
  },
  {
    id: "ambiguous-request",
    expectation: "question",
    forbidden: [],
    prompt: "I want to add a new subcommand to the ledger-sync CLI.",
  },
  {
    id: "narrow-lookup",
    expectation: "none",
    forbidden: ["task:explore", "task:general", "question"],
    prompt: "What is the package name in this project's package.json? Reply with just the name.",
  },
]
