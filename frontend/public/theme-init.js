(function () {
  var preference = "dark";
  try {
    preference = localStorage.getItem("gfu_theme_preference") === "light" ? "light" : "dark";
    localStorage.setItem("gfu_theme_preference", preference);
  } catch (_) {
    /* Storage is optional. */
  }
  document.documentElement.dataset.theme = preference;
})();
