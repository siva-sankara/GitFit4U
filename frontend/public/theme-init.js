(function () {
  var preference = "system";
  try {
    preference = localStorage.getItem("gfu_theme_preference") || "system";
  } catch (_) {
    /* Storage is optional. */
  }
  var dark =
    preference === "dark" ||
    (preference !== "light" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
