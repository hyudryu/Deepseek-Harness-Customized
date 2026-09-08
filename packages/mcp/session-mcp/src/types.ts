/** Message provenance contributed by the session supervision endpoint. */

/** External supervising-agent input; it carries no direct-human authority. */
export interface SessionMcpMessageSource {
  /** Durable discriminator retained through session replay. */
  readonly kind: 'session-mcp'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Input submitted by an external supervising agent through MCP. */
    'session-mcp': SessionMcpMessageSource
  }
}
