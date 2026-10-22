const RENDER_API_ORIGIN = 'https://lumio-api-trial.onrender.com';

export async function onRequest({ request }) {
  const upstreamUrl = new URL(request.url);
  upstreamUrl.protocol = 'https:';
  upstreamUrl.host = new URL(RENDER_API_ORIGIN).host;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
    duplex: 'half',
    redirect: 'manual',
  });
  const upstreamResponse = await fetch(upstreamRequest, { cache: 'no-store' });
  const response = new Response(upstreamResponse.body, upstreamResponse);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
