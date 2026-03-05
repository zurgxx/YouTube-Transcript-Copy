# YouTube Transcript Copy

Chrome extension to copy or download transcripts from YouTube watch pages.

## Features

- Copy transcript text to clipboard
- Download transcript as `.txt`
- Toggle transcript mode and timestamp output
- Works only on YouTube domains

## Install (Local)

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select this folder

## How to Use

1. Open a YouTube watch page (`https://www.youtube.com/watch?...`)
2. Click the extension icon
3. Use `Copy` or `Download`

## Permissions

- `activeTab`: access current tab when user triggers extension
- `scripting`: inject content script on demand
- `clipboardWrite`: copy transcript to clipboard
- `*://*.youtube.com/*`: run only on YouTube pages

## Privacy

- No external server calls for transcript processing
- No analytics, no personal data collection
- Transcript handling is local in your browser

## License

This project is MIT licensed. See `LICENSE` and `NOTICE`.