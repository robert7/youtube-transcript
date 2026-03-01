# youtube-transcript

[![npm version](https://img.shields.io/npm/v/@danielxceron/youtube-transcript.svg)](https://www.npmjs.com/package/@danielxceron/youtube-transcript)

## About This Fork

This is a fork of the original youtube-transcript package that adds a **fallback system** for improved reliability. The original package used only HTML scraping, which sometimes fails or returns empty results. This version automatically falls back to YouTube's InnerTube API when needed.

⚠️ **Note**: The InnerTube API fallback works best in client-side and local server environments.

## What's New

- **Dual extraction methods**: HTML scraping + InnerTube API fallback
- **YouTube Shorts support**: Enhanced URL regex for `/shorts/` URLs
- **Better error handling**: New `YoutubeTranscriptEmptyError` class
- **Improved reliability**: Automatic fallback increases success rate

## Usage

### CLI

Build first:

```bash
npm run build
```

Fetch transcript as JSON:

```bash
node cli.js "https://www.youtube.com/watch?v=VIDEO_ID"
```

Pretty print:

```bash
node cli.js "https://www.youtube.com/watch?v=VIDEO_ID" --pretty
```

Specific language:

```bash
node cli.js "https://www.youtube.com/watch?v=VIDEO_ID" --lang en
```

Write output to file:

```bash
node cli.js "https://www.youtube.com/watch?v=VIDEO_ID" --out transcript.json --pretty
```

### Library API

```js
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

YoutubeTranscript.fetchTranscript('videoId or URL').then(console.log);
```

### Supported URL Formats

- Standard videos: `https://www.youtube.com/watch?v=VIDEO_ID`
- Short URLs: `https://youtu.be/VIDEO_ID`
- **YouTube Shorts**: `https://www.youtube.com/shorts/VIDEO_ID`
- Embedded videos: `https://www.youtube.com/embed/VIDEO_ID`
- Direct video IDs: `VIDEO_ID`

### Methods

- `fetchTranscript(videoId: string [,options: TranscriptConfig]): Promise<TranscriptResponse[]>`

## Environment Compatibility

| Method        | Client-Side | Local Server | Production Server       |
| ------------- | ----------- | ------------ | ----------------------- |
| HTML Scraping | ✅          | ✅           | ✅                      |
| InnerTube API | ✅          | ✅           | ⚠️ May have limitations |

The package automatically uses the best available method for your environment.

## Error Handling

- `YoutubeTranscriptTooManyRequestError`: Rate limiting detected
- `YoutubeTranscriptVideoUnavailableError`: Video not accessible
- `YoutubeTranscriptDisabledError`: Transcripts disabled for video
- `YoutubeTranscriptNotAvailableError`: No transcripts available
- `YoutubeTranscriptNotAvailableLanguageError`: Requested language not available
- `YoutubeTranscriptEmptyError`: Empty response (triggers fallback method)

## License

**[MIT](LICENSE)** Licensed
