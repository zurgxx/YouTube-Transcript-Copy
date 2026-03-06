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

## Notes and Limitations

This extension depends on YouTube's current transcript UI rather than a stable public transcript API for browser extensions.
Because of that, behavior can change when YouTube changes its DOM structure, rendering timing, transcript panel layout, or Content Security Policy.

Current implementation details:

- The extension primarily reads transcript text from the transcript panel rendered on the YouTube watch page.
- It waits for transcript rows to stabilize before exporting because YouTube may render the panel incrementally.
- It may scroll the transcript container during extraction to reduce partial captures when the panel is lazily populated.
- A secondary caption-track fallback exists in code, but it may be blocked by YouTube CSP or stop working when YouTube changes internal response formats.

What this means in practice:

- The extension can become unstable without any code changes on this side.
- The same video may behave differently depending on timing, playlist state, page layout experiments, transcript panel state, or how much of the transcript YouTube has already rendered.
- A transcript can appear on screen while automated extraction still fails or returns only part of the text if the panel has not fully stabilized yet.

## Recommended Usage

To improve reliability:

1. Open the YouTube watch page directly.
2. If YouTube shows a transcript entry point such as `Show transcript` or `文字起こしを表示`, open it before using the extension.
3. Wait a moment until the transcript panel looks fully populated.
4. Then use `Copy` or `Download`.
5. If the result looks too short, reload the page and try again.

`Download` is usually more reliable than `Copy` because clipboard writes can fail when the document loses focus.

## Troubleshooting

Common failure patterns:

- `Transcript panel did not load.`
  The extension could not detect the transcript DOM in time, or YouTube changed the panel structure.
- `Transcript is unavailable.`
  Transcript text could not be obtained after the available retrieval steps.
- Clipboard errors such as `Document is not focused.`
  The transcript was likely fetched, but the browser blocked clipboard write due to focus restrictions.

If extraction stops working again, likely causes are:

- YouTube changed transcript-related DOM elements
- YouTube changed lazy-rendering behavior for transcript rows
- YouTube tightened CSP or changed internal player-response structures
- The page is in a transient UI state and transcript rows are not fully rendered yet

When checking a regression, first confirm:

1. The transcript panel is visible on the page.
2. Transcript rows are actually present in the DOM.
3. The exported result reaches roughly the expected final timestamp.

This project should be treated as a practical UI-dependent tool, not as an integration backed by a guaranteed stable YouTube interface.
