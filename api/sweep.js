module.exports = async (req, res) => {
  return res.status(200).json({ ok: true, msg: "sweep alive" });
};
