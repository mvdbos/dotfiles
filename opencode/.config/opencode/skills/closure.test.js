import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const repoRoot = resolve(packageRoot, "../../../")
const home = mkdtempSync(join(tmpdir(), "opencode-skills-"))
afterAll(() => rmSync(home, { recursive: true, force: true }))

const names = [
  "audit-opencode-session", "code-review", "codebase-design", "diagnosing-bugs",
  "domain-modeling", "grill-me", "grill-with-docs", "handoff", "implement",
  "improve-codebase-architecture", "prototype", "research", "resolving-merge-conflicts",
  "setup-matt-pocock-skills", "tdd", "to-spec", "to-tickets", "triage", "writing-for-agents",
]

test("a fresh Stow installation contains the full workflow skill dependency closure", () => {
  const install = Bun.spawnSync(["stow", "--dir", repoRoot, "--target", home, "--restow", "opencode"])
  expect(install.exitCode).toBe(0)

  const config = join(home, ".config/opencode")
  const skills = join(config, "skills")
  expect(readdirSync(skills).filter((name) => existsSync(join(skills, name, "SKILL.md"))).sort()).toEqual(names.slice().sort())
  expect(existsSync(join(skills, "hf-cli", "SKILL.md"))).toBe(false)

  const files = [join(config, "command/afk.md")]
  for (const name of names) {
    const root = join(skills, name)
    const skill = join(root, "SKILL.md")
    expect(readFileSync(skill, "utf8")).toMatch(new RegExp(`^name: ${name}$`, "m"))
    const visit = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (entry.name.endsWith(".md")) files.push(path)
      }
    }
    visit(root)
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8")
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "")
    expect(text).not.toContain("~/.agents/references/")
    expect(text).not.toMatch(/(?:[Ll]oad|[Cc]all the Skill tool (?:twice, )?for)\s+["'`]grilling["'`]/)
    for (const [, target] of prose.matchAll(/\]\((\.?\.?\/[^)#\s]+|[^:/)#\s]+\.(?:md|sh))\)/g)) {
      if (!existsSync(resolve(dirname(file), target))) throw new Error(`Broken pointer in ${file}: ${target}`)
    }
    for (const [, target] of prose.matchAll(/`(scripts\/[^`\s]+\.(?:sh|ts|py))`/g)) {
      if (!existsSync(resolve(dirname(file), target))) throw new Error(`Missing script in ${file}: ${target}`)
    }
    for (const [, target] of text.matchAll(/~\/\.config\/opencode\/(references\/[^`\s)]+)/g)) {
      expect(existsSync(join(config, target))).toBe(true)
    }
    for (const [, name] of prose.matchAll(/(?:\bload|\buse|\bcall the Skill tool with)\s+[`"]([a-z][a-z0-9-]+)[`"']/gi)) {
      expect(existsSync(join(skills, name, "SKILL.md"))).toBe(true)
    }
  }
  expect(readFileSync(join(config, "command/afk.md"), "utf8")).toContain("load the `implement` skill")
})
