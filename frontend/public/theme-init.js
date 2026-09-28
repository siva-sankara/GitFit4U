(function () {
  var preference = "light";
  try {
    preference = localStorage.getItem("gfu_theme_preference") === "dark" ? "dark" : "light";
    localStorage.setItem("gfu_theme_preference", preference);
  } catch (_) {
    /* Storage is optional. */
  }
  document.documentElement.dataset.theme = preference;
})();
