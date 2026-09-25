import { expect, test } from "bun:test"
import fs from "fs"
import { ReadStream } from "node:tty"
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from "../src/terminal-win32"

// Mirrors how the TUI opens the console when stdin is piped (`echo hi | opencode`).
test.skipIf(process.platform !== "win32")("console helpers accept a separately opened CONIN$ stream", () => {
  const stream = new ReadStream(fs.openSync("CONIN$", "r"))

  win32DisableProcessedInput(stream)
  const unhook = win32InstallCtrlCGuard(stream)
  expect(unhook).toBeFunction()
  unhook?.()
  win32FlushInputBuffer(stream)

  stream.destroy()
})
