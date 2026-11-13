/** OpenAPI 3.1 description of the read-only Lockbox AI feed (no data, safe to serve publicly). */
export function aiOpenApi(serverUrl) {
  const msg = { type: 'object', description: 'Email preview. Hidden parts are replaced by "[hidden: Label]".', additionalProperties: true };
  return {
    openapi: '3.1.0',
    info: { title: 'Lockbox mailbox (read-only)', version: '1.0.0', description: 'Read emails the owner has reviewed. Hidden content is redacted server-side as [hidden: Label]. Never guess hidden content.' },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: { Message: msg } },
    security: [{ bearerAuth: [] }],
    paths: {
      '/messages': { get: { operationId: 'listMessages', summary: 'List reviewed emails, newest first',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, { name: 'mailbox', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Emails', content: { 'application/json': { schema: { type: 'object', properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } } } } } } } } } },
      '/messages/{id}': { get: { operationId: 'getMessage', summary: 'Read one reviewed email',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Email', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } }, 404: { description: 'Not found or not shared' } } } },
    },
  };
}
