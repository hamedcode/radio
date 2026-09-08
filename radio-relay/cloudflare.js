export default {
  async fetch(request) {
    const url = new URL(request.url);
    const stream = url.searchParams.get("url");

    if (!stream) {
      return new Response("Missing ?url=", { status: 400 });
    }

    const upstream = await fetch(stream, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
        cacheKey: undefined,
      },
    });

    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
    headers.set("Content-Type", "audio/mpeg");
    headers.set("Transfer-Encoding", "chunked");
    headers.set("Connection", "keep-alive");

    return new Response(upstream.body, {
      headers,
    });
  },
};
