import { AssertionResult, ResponseData } from '../../models/http.models';

export function parseGoResponse(responseStr: string, responseTime: number): ResponseData {
  // Check if this is an error response from Go backend
  if (responseStr.startsWith('Error: ') || responseStr.startsWith('Error reading')) {
    return {
      status: 0,
      statusText: 'Request Error',
      headers: {},
      body: responseStr,
      responseTime
    };
  }

  // Parse Go backend response format: "Status: 200 OK\nHeaders: {...}\nBody: ..."
  const lines = responseStr.split('\n');
  let status = 0;
  let statusText = '';
  let headers: { [key: string]: string } = {};
  let body = '';
  let timing: any = null;
  let size: number | undefined;
  let requestPreview: { method: string; url: string; headers: { [key: string]: string }; body?: string } | undefined;
  let assertions: AssertionResult[] | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Status: ')) {
      const statusLine = line.substring(8); // Remove "Status: "
      const parts = statusLine.split(' ');
      status = parseInt(parts[0]) || 0;
      statusText = parts.slice(1).join(' ');
    } else if (line.startsWith('Request: ')) {
      try {
        const requestStr = line.substring(9).trim();
        if (requestStr) {
          const parsed = JSON.parse(requestStr);
          if (parsed && typeof parsed === 'object') {
            requestPreview = {
              method: String(parsed.method ?? ''),
              url: String(parsed.url ?? ''),
              headers: (parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : {}) as any,
              body: typeof parsed.body === 'string' ? parsed.body : undefined
            };
          }
        }
      } catch (e) {
        // Ignore request metadata parse errors; not critical for response parsing.
      }
    } else if (line.startsWith('Headers: ')) {
      try {
        const headersStr = line.substring(9).trim();
        if (headersStr) {
          // New format: Headers contains ResponseMetadata JSON with timing, size, and headers
          const metadata = JSON.parse(headersStr);
          if (metadata.headers) {
            headers = metadata.headers;
          }
          if (metadata.timing) {
            timing = metadata.timing;
          }
          if (typeof metadata.size === 'number') {
            size = metadata.size;
          }
        }
      } catch (e) {
        console.error('Failed to parse headers/metadata:', e, 'Headers string:', line.substring(9));
        headers = {};
      }
    } else if (line.startsWith('Body: ')) {
      // Body is everything after "Body: "
      body = line.substring(6);
      // If there are more lines, append them (multiline body)
      if (i + 1 < lines.length) {
        body += '\n' + lines.slice(i + 1).join('\n');
      }
      break;
    } else if (line.startsWith('Asserts: ')) {
      try {
        const assertsStr = line.substring(9).trim();
        if (assertsStr) {
          const parsed = JSON.parse(assertsStr);
          if (Array.isArray(parsed)) {
            assertions = parsed as AssertionResult[];
          }
        }
      } catch {
        // Ignore assertion parse errors.
      }
    }
  }

  // If we didn't parse anything, treat the whole response as an error
  if (status === 0 && !statusText && !body) {
    return {
      status: 0,
      statusText: 'Parse Error',
      headers: {},
      body: responseStr,
      responseTime
    };
  }

  const responseData: ResponseData = {
    status,
    statusText,
    headers,
    body,
    responseTime: timing?.total ?? responseTime,
    timing,
    size
  };

  if (assertions && assertions.length) {
    responseData.assertions = assertions;
  }


  if (requestPreview?.method && requestPreview?.url) {
    responseData.requestPreview = requestPreview as any;
  }

  // Try to parse JSON
  if (body) {
    try {
      responseData.json = JSON.parse(body);
    } catch (e) {
      // Not JSON, that's fine
    }
  }

  return responseData;
}
