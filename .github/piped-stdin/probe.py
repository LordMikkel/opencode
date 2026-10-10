import os, sys, time, threading
from winpty import PtyProcess

proc = PtyProcess.spawn(["cmd", "/c", "echo piped| bun run .github/piped-stdin/probe.ts"], dimensions=(40, 200))
out = []
def reader():
    while True:
        try:
            out.append(proc.read(4096))
        except EOFError:
            return
threading.Thread(target=reader, daemon=True).start()
deadline = time.time() + 60
while proc.isalive() and time.time() < deadline:
    time.sleep(0.5)
time.sleep(1)
print("".join(out))
