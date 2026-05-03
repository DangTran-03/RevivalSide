# Captures And Fixtures

Raw captures and extracted fixtures are intentionally not tracked.

## Start Manual Continuous Capture

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\watch-counterside-capture.ps1
```

This writes `*.pcapng` files into `captures/`.

## Extract TCP Login/Contents Fixtures

Find the TCP stream for login/content traffic, then run:

```powershell
node .\tools\extract-cs-pcap-fixtures.js .\captures\your-capture.pcapng .\server-data\captured-tcp tcp <stream>
```

## Extract Game Flow Fixtures

Find the game TCP stream, usually port `22000`, then run:

```powershell
node .\tools\extract-cs-pcap-fixtures.js .\captures\your-capture.pcapng .\server-data\captured-game-flow game <stream> <client-ip>
```

## HTTP Mirror Fixtures

The listener serves captured HTTP patch/config responses from:

```text
server-data\captured-flows
```

Those files are regenerated from your own traffic or local tooling and stay out of git.
