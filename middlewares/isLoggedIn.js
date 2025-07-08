const isLoggedIn = (req, res, next) => {
  if (!req.session.userId) {
    req.session.icon = "error";
    req.session.text = "ابتدا در سایت ما عضو شوید";
    req.flash("error", req.session.text);
    return res.redirect("/authentication");
  }
  next();
};

module.exports = isLoggedIn;
