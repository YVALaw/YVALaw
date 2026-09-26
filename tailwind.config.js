// Tailwind CSS v3 config for the marketing site.
// `node build.js` (run on every Netlify deploy) compiles assets/css/tailwind.src.css
// into assets/css/tailwind.css using the classes found in the files below.
// Classes built from string pieces at runtime are NOT detected — always write full class names.
module.exports = {
  content: ['./*.html', './build.js'],
  future: {
    // Only apply hover: styles on devices with a real pointer, so a tap on a phone
    // doesn't leave cards/buttons stuck in their hover colours.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
