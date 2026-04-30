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
      accent: '#762929',                      // doprovodná barva (subtitle, callouts, …)
      video:  '../assets/bg-loop.mp4',        // path relative to a /templates/*.html file
    },
    {
      id:     'tn-mapy',
      name:   'TN mapy',
      accent: '#762929',
      video:  '../assets/bg-loop-blur.mp4',
    },
    {
      id:     'strepiny',
      name:   'Střepiny',
      accent: '#315CD1',
      video:  '../assets/bg-strepiny-loop.mp4',
    },
    {
      id:     'nvs',
      name:   'Na Vaší Straně',
      accent: '#306DB8',
      video:  '../assets/bg-nvs-loop.mp4',
    },
    {
      id:     'za512',
      name:   'Za 5min12',
      accent: '#24604A',
      video:  '../assets/bg-za512-loop.mp4',
    },
    {
      id:     'sh',
      name:   'Školní Hlášení',
      accent: '#837B00',
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
    optionsHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
