# launchd Setup

These plist files run the node snapshot reporter every 120 seconds on macOS.

Use the checked-in samples if the workspace path is identical on the target machine:

- `com.leo.ai-monitor-hub.studio.plist`
- `com.leo.ai-monitor-hub.m4.plist`

If the machine has a different workspace path or Node path, regenerate the plist locally on that machine:

```bash
npm run launchd:generate -- \
  --node-id studio \
  --output ops/launchd/com.leo.ai-monitor-hub.studio.plist \
  --note "Mac Studio snapshot reporter"
```

Install or refresh a launch agent:

```bash
mkdir -p ~/Library/LaunchAgents
cp ops/launchd/com.leo.ai-monitor-hub.studio.plist ~/Library/LaunchAgents/
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.leo.ai-monitor-hub.studio.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.leo.ai-monitor-hub.studio.plist
launchctl kickstart -k "gui/$(id -u)/com.leo.ai-monitor-hub.studio"
```

Check status:

```bash
launchctl print "gui/$(id -u)/com.leo.ai-monitor-hub.studio"
tail -n 50 ~/Library/Logs/ai-monitor-hub/com.leo.ai-monitor-hub.studio.err.log
tail -n 50 ~/Library/Logs/ai-monitor-hub/com.leo.ai-monitor-hub.studio.out.log
```

To unload:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.leo.ai-monitor-hub.studio.plist
```
