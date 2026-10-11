/**
 * OpenAI-compatible: GET /api/openai/v1/models
 * Lists the panel's proxy model aliases (Bearer OPENAI_PROXY_KEY).
 */
import { CORS_HEADERS, PROXY_MODELS, openaiError, verifyBearer } from '@/lib/openai-proxy'

export const dynamic = 'force-dynamic'

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export function GET(req: Request) {
  if (!verifyBearer(req.headers.get('authorization'))) {
    return openaiError(401, 'Invalid API key — کلید را از تب «API و اتصال» پنل بردار', 'invalid_request_error', 'invalid_api_key')
  }
  return new Response(
    JSON.stringify({
      object: 'list',
      data: PROXY_MODELS.map((m) => ({
        id: m.id,
        object: 'model',
        created: 1700000000,
        owned_by: 'starvpn-panel',
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
  )
}
