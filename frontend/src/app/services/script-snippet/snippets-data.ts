import type { ScriptSnippet } from '../script-snippet.service';

export const SCRIPT_SNIPPETS: ScriptSnippet[] = [
  // Variable Management
  {
    id: 'set-variable',
    name: 'Set Variable',
    description: 'Store a value for use in other requests',
    category: 'variables',
    postScript: `// Set a variable from response
const value = context.response.body.propertyName;
setVar('myVariable', value);
console.log('Saved:', value);`
  },
  {
    id: 'get-variable',
    name: 'Get Variable',
    description: 'Retrieve a stored variable value',
    category: 'variables',
    preScript: `// Get a variable
const myValue = getVar('myVariable');
console.log('Retrieved:', myValue);`
  },
  {
    id: 'extract-token',
    name: 'Extract Auth Token',
    description: 'Extract and save an authentication token from response',
    category: 'variables',
    postScript: `// Extract token from login response
const token = context.response.body.access_token 
           || context.response.body.token;
if (token) {
  setVar('authToken', token);
  console.log('Token saved successfully');
} else {
  console.error('No token found in response');
}`
  },

  // Assertions
  {
    id: 'assert-status-200',
    name: 'Assert Status 200',
    description: 'Verify the response status is 200 OK',
    category: 'assertions',
    postScript: `// Assert successful response
assert(context.response.status === 200, 
  'Expected status 200, got ' + context.response.status);
console.log('✓ Status is 200 OK');`
  },
  {
    id: 'assert-status-code',
    name: 'Assert Status Code',
    description: 'Verify the response has a specific status code',
    category: 'assertions',
    postScript: `// Assert specific status code
const expectedStatus = 201; // Change as needed
assert(context.response.status === expectedStatus,
  'Expected status ' + expectedStatus + ', got ' + context.response.status);
console.log('✓ Status is', expectedStatus);`
  },
  {
    id: 'assert-json-property',
    name: 'Assert JSON Property Exists',
    description: 'Verify a property exists in the JSON response',
    category: 'assertions',
    postScript: `// Assert property exists
const body = context.response.body;
assert(body.id !== undefined, 'Missing "id" in response');
assert(body.name !== undefined, 'Missing "name" in response');
console.log('✓ Required properties exist');`
  },
  {
    id: 'assert-array-length',
    name: 'Assert Array Length',
    description: 'Verify an array has expected minimum length',
    category: 'assertions',
    postScript: `// Assert array has items
const items = context.response.body.data || context.response.body;
assert(Array.isArray(items), 'Response is not an array');
assert(items.length > 0, 'Array is empty');
console.log('✓ Array has', items.length, 'items');`
  },
  {
    id: 'assert-response-time',
    name: 'Assert Response Time',
    description: 'Verify response time is under threshold',
    category: 'assertions',
    postScript: `// Assert response time is acceptable
const maxTime = 1000; // milliseconds
const timing = context.response.timing;
assert(timing.total < maxTime, 
  'Response too slow: ' + timing.total + 'ms (max: ' + maxTime + 'ms)');
console.log('✓ Response time:', timing.total + 'ms');`
  },

  // Response Handling
  {
    id: 'parse-json',
    name: 'Parse JSON Response',
    description: 'Parse and log the JSON response body',
    category: 'response',
    postScript: `// Parse and inspect response
const body = context.response.body;
console.log('Response type:', typeof body);
console.log('Response:', JSON.stringify(body, null, 2));`
  },
  {
    id: 'extract-from-array',
    name: 'Extract First Item from Array',
    description: 'Get the first item from an array response',
    category: 'response',
    postScript: `// Extract first item from array
const items = context.response.body.data || context.response.body;
if (Array.isArray(items) && items.length > 0) {
  const first = items[0];
  setVar('firstItemId', first.id);
  console.log('First item:', first);
} else {
  console.warn('No items found');
}`
  },
  {
    id: 'extract-pagination',
    name: 'Extract Pagination Info',
    description: 'Extract pagination details from response',
    category: 'response',
    postScript: `// Extract pagination info
const body = context.response.body;
const pagination = {
  page: body.page || body.current_page || 1,
  total: body.total || body.total_count,
  pages: body.pages || body.total_pages,
  hasNext: body.has_next || body.hasMore
};
console.log('Pagination:', pagination);
if (pagination.hasNext) {
  setVar('nextPage', pagination.page + 1);
}`
  },

  // Request Modification
  {
    id: 'add-auth-header',
    name: 'Add Authorization Header',
    description: 'Add Bearer token to request headers',
    category: 'request',
    preScript: `// Add authorization header
const token = getVar('authToken');
if (token) {
  setHeader('Authorization', 'Bearer ' + token);
  console.log('Auth header added');
} else {
  console.warn('No auth token found');
}`
  },
  {
    id: 'add-timestamp',
    name: 'Add Timestamp',
    description: 'Add current timestamp to request',
    category: 'request',
    preScript: `// Add timestamp variable
const timestamp = Date.now();
setVar('timestamp', timestamp.toString());
setVar('isoDate', new Date().toISOString());
console.log('Timestamp:', timestamp);`
  },
  {
    id: 'generate-uuid',
    name: 'Generate UUID',
    description: 'Generate a random UUID for the request',
    category: 'request',
    preScript: `// Generate UUID v4
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
const id = uuid();
setVar('uuid', id);
console.log('Generated UUID:', id);`
  },
  {
    id: 'random-data',
    name: 'Generate Random Test Data',
    description: 'Generate random name, email, and number',
    category: 'request',
    preScript: `// Generate random test data
const randomNum = Math.floor(Math.random() * 10000);
const randomName = 'TestUser' + randomNum;
const randomEmail = 'test' + randomNum + '@example.com';

setVar('randomName', randomName);
setVar('randomEmail', randomEmail);
setVar('randomNum', randomNum.toString());

console.log('Generated:', { randomName, randomEmail, randomNum });`
  },

  // Utility
  {
    id: 'delay',
    name: 'Add Delay',
    description: 'Wait before continuing (useful for rate limiting)',
    category: 'utility',
    preScript: `// Wait for 1 second
console.log('Waiting 1 second...');
delay(1000);
console.log('Done waiting');`
  },
  {
    id: 'conditional-skip',
    name: 'Conditional Execution',
    description: 'Skip logic based on a condition',
    category: 'utility',
    preScript: `// Conditional execution
const shouldRun = getVar('enableFeature') === 'true';
if (!shouldRun) {
  console.log('Skipping - feature disabled');
  // Note: You can't actually skip the request, but you can skip script logic
} else {
  console.log('Feature enabled, proceeding...');
}`
  },
  {
    id: 'log-all-variables',
    name: 'Log All Variables',
    description: 'Debug: log all current variables',
    category: 'utility',
    preScript: `// Log all variables
console.log('Current variables:', context.variables);`
  },
  {
    id: 'chain-reference',
    name: 'Reference Previous Response',
    description: 'Access data from a previous request in a chain',
    category: 'utility',
    preScript: `// Access previous request's response
// Use {{request1.response.body.id}} in your request URL/body
// Or access in script:
const prevResponse = context.responseStore['request1'];
if (prevResponse) {
  console.log('Previous response:', prevResponse.body);
}`
  }
];
