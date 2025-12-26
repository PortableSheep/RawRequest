import { RequestPreview, ResponseData } from '../../models/http.models';

export type ParseGoResponseFn = (responseStr: string, responseTime: number) => ResponseData;

export type ChainResponseParserLogger = {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

export function parseConcatenatedChainResponses(
  responseStr: string,
  previews: RequestPreview[],
  parseGoResponse: ParseGoResponseFn,
  logger: ChainResponseParserLogger = {}
): ResponseData[] {
  const responses: ResponseData[] = [];
  const parts = responseStr.split('\n\n');

  logger.log?.('[HTTP Service] Split into', parts.length, 'response parts');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.trim()) {
      continue;
    }

    logger.log?.('[HTTP Service] Parsing response part', i, ':', part.substring(0, 100) + '...');
    try {
      const response = parseGoResponse(part, 0);
      const preview = previews[i];
      if (preview) {
        response.requestPreview = preview;
        response.processedUrl = preview.url;
      }
      responses.push(response);
    } catch (parseError) {
      logger.error?.('[HTTP Service] Failed to parse response part', i, ':', parseError);
      responses.push({
        status: 0,
        statusText: 'Parse Error',
        headers: {},
        body: `Failed to parse response: ${parseError}\n\nRaw response:\n${part}`,
        responseTime: 0
      });
    }
  }

  logger.log?.('[HTTP Service] Parsed', responses.length, 'responses');
  return responses;
}
