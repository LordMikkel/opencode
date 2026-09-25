import { dlopen, ptr } from "bun:ffi"
import type { ReadStream } from "node:tty"

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001

const kernel = () =>
  dlopen("kernel32.dll", {
    GetStdHandle: { args: ["i32"], returns: "ptr" },
    GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
    SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
    FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
  })

const crt = () =>
  dlopen("ucrtbase.dll", {
    _get_osfhandle: { args: ["i32"], returns: "ptr" },
  })

let k32: ReturnType<typeof kernel> | undefined
let c32: ReturnType<typeof crt> | undefined

function load() {
  if (process.platform !== "win32") return false
  try {
    k32 ??= kernel()
    return true
  } catch {
    return false
  }
}

// process.stdin maps to STD_INPUT_HANDLE; a separately opened CONIN$ stream
// (used when stdin is piped) needs its CRT fd translated to a console handle.
function inputHandle(stdin: ReadStream) {
  if (!stdin.isTTY) return
  if (!load()) return
  if (stdin === process.stdin) return k32!.symbols.GetStdHandle(STD_INPUT_HANDLE)
  if (!("fd" in stdin) || typeof stdin.fd !== "number") return
  try {
    c32 ??= crt()
  } catch {
    return
  }
  return c32.symbols._get_osfhandle(stdin.fd)
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput(stdin: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return
  const handle = inputHandle(stdin as ReadStream)
  if (!handle) return

  const buf = new Uint32Array(1)
  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0]!
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer(stdin: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return
  const handle = inputHandle(stdin as ReadStream)
  if (!handle) return
  k32!.symbols.FlushConsoleInputBuffer(handle)
}

let unhook: (() => void) | undefined

/**
 * Keep ENABLE_PROCESSED_INPUT disabled.
 *
 * On Windows, Ctrl+C becomes a CTRL_C_EVENT (instead of stdin input) when
 * ENABLE_PROCESSED_INPUT is set. Various runtimes can re-apply console modes
 * (sometimes on a later tick), and the flag is console-global, not per-process.
 *
 * We combine:
 * - A `setRawMode(...)` hook to re-clear after known raw-mode toggles.
 * - A low-frequency poll as a backstop for native/external mode changes.
 */
export function win32InstallCtrlCGuard(input: NodeJS.ReadStream = process.stdin) {
  if (process.platform !== "win32") return
  if (unhook) return unhook

  const stdin = input as ReadStream
  const original = stdin.setRawMode

  const handle = inputHandle(stdin)
  if (!handle) return
  const buf = new Uint32Array(1)

  if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
  const initial = buf[0]!

  const enforce = () => {
    if (k32!.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
    const mode = buf[0]!
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    k32!.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: ReadStream["setRawMode"] | undefined

  if (typeof original === "function") {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      later()
      return result
    }

    stdin.setRawMode = wrapped
  }

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  const interval = setInterval(enforce, 100)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) {
      stdin.setRawMode = original
    }

    k32!.symbols.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
