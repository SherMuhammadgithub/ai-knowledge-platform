// Kept out of the "use client" theme provider so the server layout can read the string.
export const THEME_STORAGE_KEY = "theme";

// Runs in the browser before the page is painted, so there is no flash of the wrong theme.
// Sets the `dark` class on <html> from the saved choice, or from the operating system.
// If storage is blocked, it still follows the operating system.
export const THEME_INIT_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(_){}try{var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`;
