# Launches the TUI with piped stdin inside a real terminal, types a word and
# checks whether the TUI received it. Usage: check.py works|broken
import os
import re
import sys
import threading
import time

expect = sys.argv[1]
word = "zqxjkw"
cwd = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "cli")
out = bytearray()
lock = threading.Lock()


def append(data):
    with lock:
        out.extend(data)


if os.name == "nt":
    from winpty import PtyProcess

    proc = PtyProcess.spawn('cmd /c "echo piped| bun run src/index.ts --standalone"', cwd=cwd, dimensions=(40, 120))

    def reader():
        while True:
            try:
                append(proc.read(4096).encode("utf-8", "replace"))
            except EOFError:
                return

    write = proc.write
    stop = lambda: proc.terminate(force=True)
else:
    import fcntl
    import pty
    import signal
    import struct
    import termios

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.environ["TERM"] = "xterm-256color"
        os.execvp("sh", ["sh", "-c", "echo piped | bun run src/index.ts --standalone"])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

    def reader():
        while True:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if not data:
                return
            append(data)

    write = lambda text: os.write(fd, text.encode())
    stop = lambda: os.kill(pid, signal.SIGKILL)

threading.Thread(target=reader, daemon=True).start()


def snapshot():
    with lock:
        return bytes(out)


deadline = time.time() + 240
while b"Ask anything" not in snapshot() and time.time() < deadline:
    time.sleep(1)
ready = b"Ask anything" in snapshot()
before = len(snapshot())
write(word)
time.sleep(5)
after = snapshot()[before:]
stop()

print("tui ready:", ready)
print("output after typing:", repr(after[:800]))
if not ready:
    print("tail:", repr(snapshot()[-3000:]))
    sys.exit(2)

# On POSIX a TUI that ignores the keys still shows them through the tty echo,
# so only count the word when the TUI drew it with its own colors.
pattern = re.escape(word).encode() if os.name == "nt" else rb"\x1b\[[0-9;]*m" + word.encode()
received = re.search(pattern, after) is not None
print("tui received keys:", received)
sys.exit(0 if received == (expect == "works") else 1)
