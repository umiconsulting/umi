// Re-export from adapter for backward compatibility.
// All existing consumers importing from './claude.ts' continue to work unchanged.
export { getAnthropicClient } from './adapters/anthropic.ts'
