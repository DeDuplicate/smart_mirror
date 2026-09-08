# Reminder ringtones

Drop audio files here and they appear in **Settings → יומני לוח שנה → צליל
התזכורת**, alongside the four built-in synthesised tones (beep / alarm /
chime / bell).

```
backend/data/sounds/reminders/
├── README.md          <- committed
└── my-alarm.mp3       <- your files, NOT committed
```

- **Formats:** `.mp3`, `.ogg`, `.wav`, `.m4a`
- **Length:** keep it short (1–3 s). The alarm re-rings every 30 s up to 10
  times, so a long clip will overlap itself.
- **Naming:** the filename (without extension) is the label shown in Settings.
  Use something readable — `Soft Bell.mp3`, not `ES_2847_final_v3.mp3`.
- **No restart or rebuild needed.** Files are served straight from this
  directory by the backend at `/api/sounds/reminders/<name>`, so you can add
  sounds to a running Pi over SSH and just reopen Settings.

## Licensing

Everything in this directory except `README.md` is gitignored on purpose.

Audio from subscription libraries (Epidemic Sound, Artlist, Soundstripe, …) is
licensed to **you**, not to this repository. Committing it — or baking it into
a flashable `.img` that gets shared — would breach those terms. Keeping the
files here and out of git means your licensed audio stays on your device.

If you want tones that *can* be redistributed, use a public-domain / CC0
source (e.g. freesound.org filtered to CC0) and commit them deliberately with
the licence noted.

## If a file won't play

The player falls back to the built-in beep rather than staying silent, so a
missing or unsupported file never means a silent alarm. Check:

1. It's listed by `curl localhost:3001/api/settings/reminder-tones`
2. The browser can fetch it: `curl -I localhost:3001/api/sounds/reminders/<name>`
3. The codec is one Chromium supports — re-encode exotic files as MP3.
