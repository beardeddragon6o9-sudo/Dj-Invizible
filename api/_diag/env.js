export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    env: {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN: !!process.env.GOOGLE_REFRESH_TOKEN,
      GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "unset",
      TIME_ZONE: process.env.TIME_ZONE || "unset",
    }
  });
}
