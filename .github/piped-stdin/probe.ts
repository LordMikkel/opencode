import fs from "node:fs"
import tty from "node:tty"

console.log("bun", Bun.version, "stdin isTTY", process.stdin.isTTY)
for (const [path, flags] of [
  ["CONIN$", "r"],
  ["CONIN$", "r+"],
  ["\\\\.\\CONIN$", "r+"],
] as const) {
  try {
    const fd = fs.openSync(path, flags)
    const stream = new tty.ReadStream(fd)
    let raw = "ok"
    try {
      stream.setRawMode(true)
      stream.setRawMode(false)
    } catch (error) {
      raw = String(error)
    }
    console.log(JSON.stringify({ path, flags, fd, isatty: tty.isatty(fd), isTTY: stream.isTTY, raw }))
    stream.destroy()
  } catch (error) {
    console.log(JSON.stringify({ path, flags, open: String(error) }))
  }
}
