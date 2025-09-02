module.exports = async (req, res) => {
  try {
    const keys = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "GOOGLE_REFRESH_TOKEN",
      "SWEEP_SECRET"
    ];
    const present = Object.fromEntries(keys.map(k => [k, !!process.env[k]]));
    return res.status(200).json({ ok:true, present });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
};
