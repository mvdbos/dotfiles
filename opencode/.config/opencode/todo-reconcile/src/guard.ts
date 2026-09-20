/**
 * One-shot guard that keeps request-scoped injections out of the compaction
 * summarizer request. `experimental.session.compacting` arms the guard
 * immediately before OpenCode invokes the history transform for compaction;
 * the matching `experimental.chat.messages.transform` consumes it. Same
 * pattern as the trajectory watchdog.
 */
export class CompactionSkipGuard {
  private readonly skips = new Map<string, number>()

  arm(sessionID: string): void {
    this.skips.set(sessionID, (this.skips.get(sessionID) ?? 0) + 1)
  }

  consume(sessionID: string): boolean {
    const count = this.skips.get(sessionID)
    if (!count) return false
    if (count <= 1) this.skips.delete(sessionID)
    else this.skips.set(sessionID, count - 1)
    return true
  }

  clear(sessionID: string): void {
    this.skips.delete(sessionID)
  }

  clearAll(): void {
    this.skips.clear()
  }
}
