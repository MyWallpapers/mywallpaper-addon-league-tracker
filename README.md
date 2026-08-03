# League Tracker for MyWallpaper

League Tracker displays a League of Legends player's Riot ID, level, ranked
queues and active-match state on a MyWallpaper canvas.

The add-on never receives a Riot API key. It calls the bounded MyWallpaper
platform endpoint, which keeps the credential server-side and limits upstream
traffic. Riot's public API can confirm an active match; it does not expose a
general friend-presence or queue-state feed, so the add-on deliberately does
not label players as online, offline or queued.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Use `mywallpaper dev` to load the add-on in the desktop development runtime.

League Tracker is not endorsed by Riot Games and does not reflect the views or
opinions of Riot Games or anyone officially involved in producing or managing
Riot Games properties. Riot Games and all associated properties are trademarks
or registered trademarks of Riot Games, Inc.
