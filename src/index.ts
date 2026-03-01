const RE_YOUTUBE =
  /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
const RE_XML_TRANSCRIPT =
  /<text start="([^"]*)" dur="([^"]*)">([\s\S]*?)<\/text>/g;
const RE_XML_TRANSCRIPT_ASR =
  /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
const RE_XML_TRANSCRIPT_ASR_SEGMENT =
  /<s[^>]*>([^<]*)<\/s>/g;
const RETRYABLE_HTTP_STATUS = [400, 408, 429, 500, 502, 503, 504];
const TRANSIENT_RETRY_DELAY_MS = 250;
const MAX_FETCH_RETRIES = 3;

export class YoutubeTranscriptError extends Error {
  constructor(message) {
    super(`[YoutubeTranscript] 🚨 ${message}`);
  }
}

export class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {
  constructor() {
    super(
      'YouTube is receiving too many requests from this IP and now requires solving a captcha to continue'
    );
  }
}

export class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {
  constructor(videoId: string) {
    super(`The video is no longer available (${videoId})`);
  }
}

export class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {
  constructor(videoId: string) {
    super(`Transcript is disabled on this video (${videoId})`);
  }
}

export class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {
  constructor(videoId: string) {
    super(`No transcripts are available for this video (${videoId})`);
  }
}

export class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {
  constructor(lang: string, availableLangs: string[], videoId: string) {
    super(
      `No transcripts are available in ${lang} this video (${videoId}). Available languages: ${availableLangs.join(
        ', '
      )}`
    );
  }
}

export class YoutubeTranscriptEmptyError extends YoutubeTranscriptError {
  constructor(videoId: string, method: string) {
    super(`The transcript file URL returns an empty response using ${method} (${videoId})`);
  }
}
export interface TranscriptConfig {
  lang?: string;
}
export interface TranscriptResponse {
  text: string;
  duration: number;
  offset: number;
  lang?: string;
}

interface YoutubePageContext {
  captions?: any;
  apiKey?: string;
  clientVersion?: string;
  hasPlayabilityStatus: boolean;
  hasRecaptcha: boolean;
}

/**
 * Class to retrieve transcript if exist
 */
export class YoutubeTranscript {
  /**
   * Fetch transcript from YTB Video
   * @param videoId Video url or video identifier
   * @param config Get transcript in a specific language ISO
   */
  public static async fetchTranscript(
    videoId: string,
    config?: TranscriptConfig
  ): Promise<TranscriptResponse[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
      try {
        return await this.fetchTranscriptWithHtmlScraping(videoId, config);
      } catch (e) {
        lastError = e;
        const canRetry = attempt < MAX_FETCH_RETRIES;

        if (
          e instanceof YoutubeTranscriptTooManyRequestError ||
          e instanceof YoutubeTranscriptVideoUnavailableError ||
          e instanceof YoutubeTranscriptNotAvailableLanguageError
        ) {
          throw e;
        }

        if (this.shouldTryInnerTube(e)) {
          try {
            return await this.fetchTranscriptWithInnerTube(videoId, config);
          } catch (innerError) {
            lastError = innerError;
            if (!canRetry || !this.isRetryableError(innerError)) {
              throw innerError;
            }
            await this.sleep(TRANSIENT_RETRY_DELAY_MS * attempt);
            continue;
          }
        }

        if (!canRetry || !this.isRetryableError(e)) {
          throw e;
        }

        await this.sleep(TRANSIENT_RETRY_DELAY_MS * attempt);
      }
    }

    throw lastError;
  }

  /**
   * Fetch transcript from YTB Video using HTML scraping
   * @param videoId Video url or video identifier
   * @param config Get transcript in a specific language ISO
   */
  private static async fetchTranscriptWithHtmlScraping(videoId: string, config?: TranscriptConfig) {
    const identifier = this.retrieveVideoId(videoId);
    const pageContext = await this.fetchVideoPageContext(identifier, config);

    if (!pageContext.captions) {
      if (pageContext.hasRecaptcha) {
        throw new YoutubeTranscriptTooManyRequestError();
      }
      if (!pageContext.hasPlayabilityStatus) {
        throw new YoutubeTranscriptVideoUnavailableError(videoId);
      }
      throw new YoutubeTranscriptEmptyError(videoId, 'HTML scraping');
    }

    const processedTranscript = await this.processTranscriptFromCaptions(
      pageContext.captions,
      videoId,
      config
    );

    if (!processedTranscript.length) {
      throw new YoutubeTranscriptEmptyError(videoId, 'HTML scraping');
    }

    return processedTranscript;
  }

  /**
   * Fetch transcript from YTB Video using InnerTube API
   * @param videoId Video url or video identifier
   * @param config Get transcript in a specific language ISO
   */
  private static async fetchTranscriptWithInnerTube(
    videoId: string,
    config?: TranscriptConfig
  ): Promise<TranscriptResponse[]> {
    const identifier = this.retrieveVideoId(videoId);
    const pageContext = await this.fetchVideoPageContext(identifier, config);
    const clientVersion = pageContext.clientVersion ?? '2.20250122.01.00';
    const webEndpoint = pageContext.apiKey
      ? `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(pageContext.apiKey)}`
      : 'https://www.youtube.com/youtubei/v1/player';

    const requestVariants = [
      {
        endpoint: webEndpoint,
        options: {
          method: 'POST',
          headers: {
            ...(config?.lang && { 'Accept-Language': config.lang }),
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientVersion,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB',
                clientVersion,
                hl: config?.lang ?? 'en',
                gl: 'US'
              }
            },
            videoId: identifier,
          }),
        } as RequestInit
      },
      {
        endpoint: 'https://www.youtube.com/youtubei/v1/player',
        options: {
          method: 'POST',
          headers: {
            ...(config?.lang && { 'Accept-Language': config.lang }),
            'Content-Type': 'application/json',
            'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; Android 13)',
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'ANDROID',
                clientVersion: '19.09.37',
                androidSdkVersion: 33,
                hl: config?.lang ?? 'en',
                gl: 'US'
              }
            },
            videoId: identifier,
          }),
        } as RequestInit
      }
    ];

    for (const variant of requestVariants) {
      const innerTubeApiResponse = await this.fetchWithRetry(
        variant.endpoint,
        variant.options
      );

      if (!innerTubeApiResponse.ok) {
        continue;
      }

      const responseJson = await innerTubeApiResponse.json();
      const captions = responseJson?.captions?.playerCaptionsTracklistRenderer;

      if (!captions) {
        continue;
      }

      const processedTranscript = await this.processTranscriptFromCaptions(
        captions,
        videoId,
        config
      );

      if (processedTranscript.length) {
        return processedTranscript;
      }
    }

    throw new YoutubeTranscriptDisabledError(identifier);
  }

  private static decodeHTMLEntities(text: string): string {
    if (!text) return '';

    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      return doc.documentElement.textContent ?? '';
    }

    if (typeof globalThis !== 'undefined') {
      return text
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'");
    }

    return text;
  }

  /**
   * Process transcript from data captions
   * @param captions Data captions
   * @param videoId Video url or video identifier
   * @param config Get transcript in a specific language ISO
   */
  private static async processTranscriptFromCaptions(
    captions: any,
    videoId: string,
    config?: TranscriptConfig
  ): Promise<TranscriptResponse[]> {
    if (!captions) {
      throw new YoutubeTranscriptDisabledError(videoId);
    }

    if (!('captionTracks' in captions)) {
      throw new YoutubeTranscriptNotAvailableError(videoId);
    }

    if (
      config?.lang &&
      !captions.captionTracks.some(
        (track) => track.languageCode === config?.lang
      )
    ) {
      throw new YoutubeTranscriptNotAvailableLanguageError(
        config?.lang,
        captions.captionTracks.map((track) => track.languageCode),
        videoId
      );
    }

    const selectedTrack = (
      config?.lang
        ? captions.captionTracks.find(
            (track) => track.languageCode === config?.lang ||
            track.languageCode.startsWith(config.lang + '-')
          )
        : captions.captionTracks.find(t => t.kind === 'asr') ||
        captions.captionTracks[0]
    );
    const transcriptURL = selectedTrack.baseUrl;
    const transcriptLang = config?.lang ?? selectedTrack.languageCode;
    const transcriptResponse = await this.fetchWithRetry(transcriptURL, {
      headers: {
        ...(config?.lang && { 'Accept-Language': config.lang }),
        'User-Agent': USER_AGENT,
      },
    });
    if (!transcriptResponse.ok) {
      throw new YoutubeTranscriptNotAvailableError(videoId);
    }
    const transcriptBody = await transcriptResponse.text();
    const parsedTranscript = this.parseTranscriptBody(transcriptBody, transcriptLang);
    if (parsedTranscript.length) {
      return parsedTranscript;
    }

    const srv3TranscriptURL = this.withQueryParam(transcriptURL, 'fmt', 'srv3');
    if (srv3TranscriptURL === transcriptURL) {
      return parsedTranscript;
    }

    const srv3TranscriptResponse = await this.fetchWithRetry(srv3TranscriptURL, {
      headers: {
        ...(config?.lang && { 'Accept-Language': config.lang }),
        'User-Agent': USER_AGENT,
      },
    });

    if (!srv3TranscriptResponse.ok) {
      return parsedTranscript;
    }

    const srv3TranscriptBody = await srv3TranscriptResponse.text();
    return this.parseTranscriptBody(srv3TranscriptBody, transcriptLang);
  }

  private static parseTranscriptBody(transcriptBody: string, transcriptLang: string) {
    const results = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT)];
    if (results.length) {
      return results
        .map((result) => {
          const text = this.decodeHTMLEntities(
            result[3].replace(/<[^>]*>/g, '').trim()
          );
          if (!text) return null;
          return {
            text,
            duration: parseFloat(result[2]),
            offset: parseFloat(result[1]),
            lang: transcriptLang,
          };
        })
        .filter(Boolean) as TranscriptResponse[];
    }

    const asrResults = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT_ASR)];
    return asrResults.map((block) => {
      let text: string
      const matchAllASRSegment = [...block[3].matchAll(RE_XML_TRANSCRIPT_ASR_SEGMENT)]
      if (matchAllASRSegment.length) {
        text = matchAllASRSegment
          .map((s) => s[1])
          .join('')
          .trim();
      } else {
        text = block[3].replace(/<[^>]*>/g, '').trim();
      }

      if (!text || text.trim() === '') return null;

      return {
        text: this.decodeHTMLEntities(text),
        duration: Number(block[2]) / 1000,
        offset: Number(block[1]) / 1000,
        lang: transcriptLang,
      };

    }).filter(Boolean) as TranscriptResponse[];
  }

  private static shouldTryInnerTube(error: unknown): boolean {
    return (
      error instanceof YoutubeTranscriptEmptyError ||
      error instanceof YoutubeTranscriptDisabledError ||
      error instanceof YoutubeTranscriptNotAvailableError
    );
  }

  private static isRetryableError(error: unknown): boolean {
    return (
      error instanceof TypeError ||
      error instanceof YoutubeTranscriptEmptyError ||
      error instanceof YoutubeTranscriptDisabledError
    );
  }

  private static async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
      try {
        const response = await fetch(url, options);
        const canRetry = attempt < MAX_FETCH_RETRIES;
        if (canRetry && RETRYABLE_HTTP_STATUS.includes(response.status)) {
          await this.sleep(TRANSIENT_RETRY_DELAY_MS * attempt);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_FETCH_RETRIES) {
          throw error;
        }
        await this.sleep(TRANSIENT_RETRY_DELAY_MS * attempt);
      }
    }
    throw lastError;
  }

  private static async fetchVideoPageContext(
    identifier: string,
    config?: TranscriptConfig
  ): Promise<YoutubePageContext> {
    const videoPageResponse = await this.fetchWithRetry(
      `https://www.youtube.com/watch?v=${identifier}`,
      {
        headers: {
          ...(config?.lang && { 'Accept-Language': config.lang }),
          'User-Agent': USER_AGENT,
        },
      }
    );

    const videoPageBody = await videoPageResponse.text();
    const playerResponse = this.extractJsonObject(videoPageBody, 'ytInitialPlayerResponse =');
    const ytcfg = this.extractJsonObject(videoPageBody, 'ytcfg.set(');

    return {
      captions: playerResponse?.captions?.playerCaptionsTracklistRenderer,
      apiKey: ytcfg?.INNERTUBE_API_KEY ?? this.extractConfigValue(videoPageBody, 'INNERTUBE_API_KEY'),
      clientVersion: ytcfg?.INNERTUBE_CLIENT_VERSION ?? this.extractConfigValue(videoPageBody, 'INNERTUBE_CLIENT_VERSION'),
      hasPlayabilityStatus: videoPageBody.includes('"playabilityStatus":'),
      hasRecaptcha: videoPageBody.includes('class="g-recaptcha"'),
    };
  }

  private static extractJsonObject(source: string, marker: string) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
      return undefined;
    }

    const jsonStart = source.indexOf('{', markerIndex + marker.length);
    if (jsonStart === -1) {
      return undefined;
    }

    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = jsonStart; i < source.length; i++) {
      const char = source[i];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (char === '\\') {
          isEscaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        depth++;
        continue;
      }
      if (char === '}') {
        depth--;
        if (depth === 0) {
          const jsonText = source.slice(jsonStart, i + 1);
          try {
            return JSON.parse(jsonText);
          } catch (error) {
            return undefined;
          }
        }
      }
    }

    return undefined;
  }

  private static withQueryParam(url: string, key: string, value: string) {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has(key)) {
        return url;
      }
      parsed.searchParams.set(key, value);
      return parsed.toString();
    } catch (error) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}${key}=${encodeURIComponent(value)}`;
    }
  }

  private static extractConfigValue(source: string, key: string) {
    const configPattern = new RegExp(`"${key}":"([^"]+)"`);
    const match = source.match(configPattern);
    return match ? match[1] : undefined;
  }

  private static async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retrieve video id from url or string
   * @param videoId video url or video id
   */
  private static retrieveVideoId(videoId: string) {
    if (videoId.length === 11) {
      return videoId;
    }
    const matchId = videoId.match(RE_YOUTUBE);
    if (matchId && matchId.length) {
      return matchId[1];
    }
    throw new YoutubeTranscriptError(
      'Impossible to retrieve Youtube video ID.'
    );
  }
}
