/* A static preview drawn by the same renderer as the projector view. */
(function () {
  'use strict';

  var canvas = document.getElementById('featurePanorama');
  var caption = document.getElementById('featureCityName');
  var buttons = document.querySelectorAll('[data-projector-city]');
  if (!canvas) return;

  var selected = 'dc';
  var lastDraw = '';

  function cityFor(id) {
    try {
      return window.TBProjectorCities && window.TBProjectorCities.get(id);
    } catch (error) {
      return null;
    }
  }

  function render() {
    var city = cityFor(selected);
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-projector-city') === selected));
    });
    canvas.setAttribute('role', 'img');
    if (caption) caption.textContent = city ? city.name : 'Projector panorama';
    canvas.setAttribute('aria-label', city ? 'Detailed illustrative skyline of ' + city.name + ' from the Projector view.' : 'Projector panorama preview unavailable.');

    try {
      var rect = canvas.getBoundingClientRect();
      var width = Math.round(rect.width);
      var height = Math.round(rect.height);
      if (!width || !height) return;
      var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      var key = [selected, width, height, dpr].join('|');
      if (key === lastDraw) return;
      lastDraw = key;

      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      var context = canvas.getContext('2d');
      if (!context || !city || !window.TBProjectorScene || typeof window.TBProjectorScene.draw !== 'function') {
        throw new Error('Projector preview unavailable');
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      window.TBProjectorScene.draw(context, {
        city: city,
        width: width,
        height: height,
        baseline: height * 0.78,
        detail: true,
        labels: false,
        motion: false
      });
    } catch (error) {
      canvas.setAttribute('aria-label', (city ? city.name + ' projector panorama. ' : '') + 'Preview unavailable; open the Projector collection to explore.');
      if (caption) caption.textContent = (city ? city.name + ' / ' : '') + 'Preview unavailable';
    }
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var next = button.getAttribute('data-projector-city');
      if (!cityFor(next)) return;
      selected = next;
      render();
    });
  });

  render();
  if (typeof window.ResizeObserver === 'function') {
    var observer = new ResizeObserver(render);
    observer.observe(canvas.parentElement || canvas);
  } else {
    window.addEventListener('resize', render);
  }
}());
