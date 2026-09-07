/** Standard MCP tools sharing the authenticated application's local account store. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AuthenticatorStore } from './store.ts'
import { parseAccountId } from './store.ts'

/**
 * Create one MCP server for a stateless HTTP request.
 * @param store - the same accounts used by Settings and native session tools.
 * @returns a server exposing account discovery and current codes, never provisioning secrets.
 */
export function createAuthenticatorMcp(store: AuthenticatorStore): McpServer {
  const server = new McpServer({ name: 'dsh-authenticator', version: '0.1.0' })
  server.registerTool('authenticator_list_accounts', {
    description: 'List stored authenticator account ids, issuers and labels. Does not return provisioning secrets.',
    inputSchema: {},
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ accounts: await store.list() }) }] }))
  server.registerTool('authenticator_get_code', {
    description: 'Get the current six-digit TOTP code for a stored account id and its expiration time.',
    inputSchema: { id: z.uuid() },
  }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await store.getCode(parseAccountId(id))) }] }))
  return server
}
