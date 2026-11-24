/* Homepage appearance and product previews. Links work without JavaScript. */
(function () {
  'use strict';

  var root = document.documentElement;
  var themeChoices = document.querySelectorAll('[data-home-theme]');

  function applyTheme(mode, persist) {
    mode = mode === 'light' ? 'light' : 'dark';
    root.dataset.homeMode = mode;
    root.setAttribute('data-theme', mode === 'light' ? 'day' : 'dark');
    themeChoices.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-home-theme') === mode));
    });
    document.querySelectorAll('[data-theme-mark]').forEach(function (mark) {
      mark.setAttribute('src', mode === 'light' ? 'brand/mark-on-light.svg' : 'brand/mark-on-dark.svg');
    });

    var styles = window.getComputedStyle(document.body);
    var background = styles.getPropertyValue('--home-bg').trim() || styles.getPropertyValue('--bg').trim();
    if (!background || background.indexOf('var(') !== -1) background = styles.backgroundColor;
    if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)') {
      background = mode === 'light' ? '#FFFCF5' : '#12101A';
    }
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      meta.setAttribute('content', background);
    });

    if (persist) {
      try {
        localStorage.setItem('tb.home.theme', mode);
        localStorage.setItem('tb.theme', mode === 'light' ? 'day' : 'dark');
      } catch (error) { /* Appearance still works when browser storage is unavailable. */ }
    }
  }

  var initialMode = root.dataset.homeMode;
  if (initialMode !== 'dark' && initialMode !== 'light') {
    initialMode = root.getAttribute('data-theme') === 'day' ? 'light' : 'dark';
  }
  applyTheme(initialMode, false);
  themeChoices.forEach(function (button) {
    button.addEventListener('click', function () {
      applyTheme(button.getAttribute('data-home-theme'), true);
    });
  });

  var previews = {
    board: { src: 'shots/home-board-dc.jpg', title: 'Washington DC / Live board', href: 'dc.html', label: 'Open the Washington live board', alt: 'Transit Project’s Washington DC board with a live transit map and departure panels centered on Union Station.' },
    departures: { src: 'shots/home-departures.jpg', title: 'Washington DC / Departure board', href: 'flipboard.html?city=dc', label: 'Open the departure board', alt: 'The Transit Project departure board displaying nearby rail departures in a station-style layout.' },
    sky: { src: 'shots/home-sky.jpg', title: 'Washington DC / Sky view', href: 'night.html?city=dc', label: 'Open Sky view', alt: 'The Transit Project Sky view showing the nearest flight, its route, and a map.' }
  };
  function bindPreviews(attribute, imageId, linkId, titleId, actionId) {
    var image = document.getElementById(imageId);
    var link = document.getElementById(linkId);
    var title = document.getElementById(titleId);
    var action = actionId ? document.getElementById(actionId) : null;
    var actionLabel = document.getElementById('previewOpenText');
    var choices = document.querySelectorAll('[' + attribute + ']');
    if (!image || !link || !choices.length) return;

    function select(view) {
      var selected = previews[view];
      if (!selected) return;
      choices.forEach(function (choice) {
        choice.setAttribute('aria-pressed', String(choice.getAttribute(attribute) === view));
      });
      image.src = selected.src;
      image.alt = selected.alt;
      link.href = selected.href;
      link.setAttribute('aria-label', selected.label);
      if (action) {
        action.href = selected.href;
        action.setAttribute('aria-label', selected.label);
      }
      if (actionLabel) actionLabel.textContent = view === 'sky' ? selected.label : 'Open this view';
      if (title) title.textContent = selected.title;
    }

    choices.forEach(function (button) {
      button.addEventListener('click', function () {
        select(button.getAttribute(attribute));
      });
    });

    var initialChoice = Array.prototype.find.call(choices, function (button) {
      return button.getAttribute('aria-pressed') === 'true' && previews[button.getAttribute(attribute)];
    });
    select(initialChoice ? initialChoice.getAttribute(attribute) : 'board');
  }

  bindPreviews('data-preview', 'previewImage', 'previewLink', 'previewLocation', 'previewOpen');
}());
