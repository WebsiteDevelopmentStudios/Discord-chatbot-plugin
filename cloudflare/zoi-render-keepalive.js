addEventListener("fetch", (event) => {
  event.respondWith(new Response(JSON.stringify({
    service: "zoi-render-keepalive",
    status: "ready",
    target: "discord-chatbot-intelligence-api.onrender.com",
    schedule: "*/5 * * * *"
  }), { headers: { "content-type": "application/json" } }));
});

addEventListener("scheduled", (event) => {
  event.waitUntil((async () => {
    const url = "https://discord-chatbot-intelligence-api.onrender.com/health";
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "user-agent": "zoi-cloudflare-keepalive/1.0" }
      });
      const body = await response.text();
      console.log(JSON.stringify({
        event: "keepalive",
        status: response.status,
        ok: response.ok,
        body: body.slice(0, 500),
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.log(JSON.stringify({
        event: "keepalive_error",
        error: String(error),
        timestamp: new Date().toISOString()
      }));
    }
  })());
});
