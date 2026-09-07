/**
 * WebMCP ambient types.
 *
 * Hand-written rather than pulled from `webmcp-types` for two reasons: the API
 * moved from `navigator.modelContext` to `document.modelContext` on 21 July
 * 2026 and Chrome 150 only deprecated the old location, so a real deployment
 * still has to probe both; and the origin trial shipped a `string | null`
 * return for `execute` while the explainer specifies MCP content blocks. Both
 * shapes are modelled here so the bridge can satisfy either consumer.
 */

export interface WebMCPToolAnnotations {
  /** Tool does not change state. Lets an agent skip a confirmation prompt. */
  readOnlyHint?: boolean;
  /** Output contains third-party data that must not be read as instructions. */
  untrustedContentHint?: boolean;
}

export interface WebMCPTextBlock {
  type: "text";
  text: string;
}

export interface WebMCPToolResult {
  content: WebMCPTextBlock[];
  isError?: boolean;
}

export interface JSONSchemaProperty {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  /** Present on grant-pinned parameters: the agent cannot vary the value. */
  const?: string | number | boolean;
  enum?: (string | number | boolean)[];
  /** Present on grant-capped numeric parameters. */
  maximum?: number;
  minimum?: number;
}

export interface JSONSchemaObject {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface WebMCPExecuteContext {
  signal?: AbortSignal;
}

export interface WebMCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: JSONSchemaObject;
  annotations?: WebMCPToolAnnotations;
  execute: (
    input: Record<string, unknown>,
    context?: WebMCPExecuteContext,
  ) => Promise<WebMCPToolResult | string | null>;
}

export interface RegisterToolOptions {
  /** Abort to unregister. This is the whole expiry mechanism in LABE. */
  signal?: AbortSignal;
  /** Origins permitted to see and call this tool. */
  exposedTo?: string[];
}

export interface ModelContextLike {
  registerTool(
    descriptor: WebMCPToolDescriptor,
    options?: RegisterToolOptions,
  ): Promise<unknown> | unknown;
  getTools?: (options?: { fromOrigins?: string[] }) => Promise<unknown[]>;
  executeTool?: (
    tool: unknown,
    args: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** Which global carried `modelContext`, for the status pill and the README. */
export type ModelContextSurface = "document" | "navigator" | "none";

export interface ModelContextProbe {
  surface: ModelContextSurface;
  ctx: ModelContextLike | null;
  /** True when the page is running without any WebMCP implementation. */
  simulated: boolean;
}

export function probeModelContext(): ModelContextProbe {
  if (typeof document !== "undefined") {
    const fromDocument = (document as unknown as { modelContext?: ModelContextLike })
      .modelContext;
    if (fromDocument && typeof fromDocument.registerTool === "function") {
      return { surface: "document", ctx: fromDocument, simulated: false };
    }
  }
  if (typeof navigator !== "undefined") {
    const fromNavigator = (navigator as unknown as { modelContext?: ModelContextLike })
      .modelContext;
    if (fromNavigator && typeof fromNavigator.registerTool === "function") {
      return { surface: "navigator", ctx: fromNavigator, simulated: false };
    }
  }
  return { surface: "none", ctx: null, simulated: true };
}
