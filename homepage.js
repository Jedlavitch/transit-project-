/* Homepage-only product preview. Image links continue to work without JS. */
(function () {
  'use strict';
  var previews = {
    board: { src: 'shots/home-board-dc.jpg', title: 'Washington DC / Live board', href: 'dc.html', label: 'Open the Washington live board', alt: 'Transit Project’s Washington DC board with a live transit map and departure panels centered on Union Station.', caption: 'Your city at a glance. Live vehicles, nearby departures, and the details that keep you connected.' },
    departures: { src: 'shots/home-departures.jpg', title: 'Washington DC / Departure board', href: 'flipboard.html?city=dc', label: 'Open the departure board', alt: 'The Transit Project departure board displaying nearby rail departures in a station-style layout.', caption: 'Station-concourse clarity. Nearby departures in a full-screen board, made for a quick glance.' },
    sky: { src: 'shots/home-sky.jpg', title: 'Washington DC / Sky view', href: 'night.html?city=dc', label: 'Open Sky view', alt: 'The Transit Project Sky view showing the nearest flight, its route, and a map.', caption: 'Ever wondered where that plane is going? Get a closer look at the nearest aircraft overhead.' }
  };
  var image = document.getElementById('previewImage');
  var link = document.getElementById('previewLink');
  var caption = document.getElementById('previewCaption');
  var title = document.getElementById('previewLocation');
  var choices = document.querySelectorAll('[data-preview]');
  if (!image || !link) return;
  choices.forEach(function (button) {
    button.addEventListener('click', function () {
      var selected = previews[button.getAttribute('data-preview')];
      if (!selected) return;
      choices.forEach(function (choice) { choice.setAttribute('aria-pressed', String(choice === button)); });
      image.src = selected.src;
      image.alt = selected.alt;
      link.href = selected.href;
      link.setAttribute('aria-label', selected.label);
      title.textContent = selected.title;
      caption.textContent = selected.caption;
    });
  });
}());
