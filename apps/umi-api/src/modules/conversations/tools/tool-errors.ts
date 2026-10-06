/**
 * Tool error builders. Verbatim port of the `ToolError` helpers from `tools.ts`.
 * The shape is loose-compatible with `ToolResult` (success:false + error_type),
 * which the tool loop reads for clarification / retry handling.
 */
export interface ToolError {
  success: false;
  error: string;
  error_type: 'retryable' | 'needs_input' | 'terminal';
  suggestion?: string;
  auto_recovery?: { tool: string; input: Record<string, unknown> };
  // Loose-compatible with ToolResult (the tool loop reads these off the result).
  [key: string]: unknown;
}

export function terminalToolError(error: string, suggestion?: string): ToolError {
  return { success: false, error, error_type: 'terminal', suggestion };
}

export function needsInputToolError(error: string, suggestion?: string): ToolError {
  return { success: false, error, error_type: 'needs_input', suggestion };
}

export function retryableToolError(
  error: string,
  auto_recovery?: { tool: string; input: Record<string, unknown> },
  suggestion?: string,
): ToolError {
  return { success: false, error, error_type: 'retryable', auto_recovery, suggestion };
}
