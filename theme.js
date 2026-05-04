/* =============================================================================
   TN GRAPHICS ENGINE — SHOW THEMES
   Single source of truth for show-specific theming. Each template loads this
   file via <script src="../theme.js"></script> before its own <script>.
   The template's state holds a `show` id (default 'tn'); accent color and
   backdrop video are pulled from this registry at render time.

   To add a new show: append a new entry below. Theme will appear in every
   template's sidebar dropdown automatically.
   =============================================================================
*/
(function (root) {
  const SHOWS = [
    {
      id:     'tn',
      name:   'TN',
      accent: '#2668AC',                      // doprovodná barva (subtitle, callouts, …)
      fontColor: '#0a0a0a',                   // primary text — neutral black for TN
      video:  '../assets/bg-loop.mp4',        // path relative to a /templates/*.html file
    },
    {
      id:     'tn-mapy',
      name:   'TN mapy',
      accent: '#2668AC',
      fontColor: '#0a0a0a',
      video:  '../assets/bg-loop-blur.mp4',
    },
    {
      id:     'strepiny',
      name:   'Střepiny',
      accent: '#762929',
      fontColor: '#2d0e0e',                   // very dark wine — tonally ties to vinová accent
      video:  '../assets/bg-strepiny-loop.mp4',
    },
    {
      id:     'nvs',
      name:   'Na Vaší Straně',
      accent: '#315CD1',
      fontColor: '#08152e',                   // very dark navy — tonally ties to royal blue
      video:  '../assets/bg-nvs-loop.mp4',
    },
    {
      id:     'za512',
      name:   'Za 5min12',
      accent: '#306DB8',
      fontColor: '#0a1d33',                   // very dark blue
      video:  '../assets/bg-za512-loop.mp4',
    },
    {
      id:     'sh',
      name:   'Školní Hlášení',
      accent: '#837B00',
      fontColor: '#1a1900',                   // very dark olive
      video:  '../assets/bg-sh-loop.mp4',
    },
  ];

  const SHOWS_BY_ID = Object.fromEntries(SHOWS.map(s => [s.id, s]));
  const DEFAULT_SHOW_ID = 'tn';

  function get(id) {
    return SHOWS_BY_ID[id] || SHOWS_BY_ID[DEFAULT_SHOW_ID];
  }

  // Helper for templates that previously hard-coded TN_COLORS.blue.
  // Replaces all subtitle / callout / accent uses with the show's color.
  function accent(showId) {
    return get(showId).accent;
  }

  function video(showId) {
    return get(showId).video;
  }

  // Primary text color for a show. Templates use this for titles, names, row
  // values, etc. Defaults to dark (#0a0a0a) when a show doesn't define its own.
  function fontColor(showId) {
    return get(showId).fontColor || '#0a0a0a';
  }

  // Render the <option> list for a sidebar dropdown.
  function optionsHtml(currentId) {
    return SHOWS.map(s =>
      `<option value="${s.id}"${s.id === currentId ? ' selected' : ''}>${s.name}</option>`
    ).join('');
  }

  root.TN_THEMES = {
    SHOWS,
    SHOWS_BY_ID,
    DEFAULT_SHOW_ID,
    get,
    accent,
    video,
    fontColor,
    optionsHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
