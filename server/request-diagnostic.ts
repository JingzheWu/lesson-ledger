// Fixed marker distinguishes this deployed handler from older generic errors.
const revision = 'wechat-request-v2'
const actions = new Set(['identity', 'getConfig', 'saveConfig', 'saveRecord', 'saveStatus',
  'configStatus', 'getRecord', 'listRecords', 'deleteRecord', 'createShare', 'getShare', 'revokeShare'])

function kind(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}
function fields(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: kind(value) }
  const entries = Object.entries(value)
  return {
    type: 'object', count: entries.length,
    fields: entries.slice(0, 20).map(([name, item]) => ({
      name: /^[a-zA-Z_$][a-zA-Z0-9_$]{0,63}$/.test(name) ? name : '[redacted]',
      type: kind(item),
    })),
  }
}

// Only top-level field names/types and a known operation name, never field values,
// nested identity metadata, request payloads, or raw SDK exceptions.
export function requestDiagnostic(event: unknown) {
  const record = event && typeof event === 'object' && !Array.isArray(event)
    ? event as Record<string, unknown> : undefined
  return {
    revision,
    action: typeof record?.action === 'string' && actions.has(record.action) ? record.action : '[unknown]',
    envelope: fields(event),
    payload: fields(record?.payload),
  }
}
