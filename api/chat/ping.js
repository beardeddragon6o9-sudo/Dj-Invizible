export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow","GET");
    return res.status(405).end("Method Not Allowed");
  }
  res.setHeader("Content-Type","text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control","no-cache, no-transform");
  res.setHeader("Connection","keep-alive");
  res.flushHeaders?.();

  try {
    for (let i = 1; i <= 3; i++) {
      res.write(`data: ${JSON.stringify({ tick: i })}\n\n`);
      await new Promise(r => setTimeout(r, 300));
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } finally {
    res.end();
  }
}
