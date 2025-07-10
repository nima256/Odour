function isLoggedIn(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "لطفا ابتدا وارد حساب کاربری خود شوید",
    });
  }
  next();
}

module.exports = { isLoggedIn };
