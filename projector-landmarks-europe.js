/* Hand-drawn architectural vignettes for the projector's illustrated horizon.
   Decorative compositions, not survey silhouettes. Every drawing uses a
   100 × 100 local space, ground at y=0, and the caller's low-light palette.
   The scene renderer caches these drawings; there is no animation here. */
(function () {
  "use strict";
  var L = window.TBProjectorLandmarks = window.TBProjectorLandmarks || {};
  var TAU = Math.PI * 2;

  function poly(c, a, fill, stroke, width) {
    c.beginPath();
    a.forEach(function (pt, i) { i ? c.lineTo(pt[0], pt[1]) : c.moveTo(pt[0], pt[1]); });
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width || 0.55; c.stroke(); }
  }
  function line(c, a, color, width) {
    c.beginPath();
    a.forEach(function (pt, i) { i ? c.lineTo(pt[0], pt[1]) : c.moveTo(pt[0], pt[1]); });
    c.strokeStyle = color; c.lineWidth = width || 0.55; c.stroke();
  }
  function rect(c, x, y, w, h, fill, stroke, width) {
    if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width || 0.5; c.strokeRect(x, y, w, h); }
  }
  function ellipse(c, x, y, rx, ry, fill, stroke, width) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width || 0.5; c.stroke(); }
  }
  function arch(c, x, y, w, h, fill, stroke, gothic) {
    c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y + w * 0.5);
    if (gothic) {
      c.quadraticCurveTo(x, y + w * 0.18, x + w * 0.5, y);
      c.quadraticCurveTo(x + w, y + w * 0.18, x + w, y + w * 0.5);
    } else {
      c.bezierCurveTo(x, y - w * 0.16, x + w, y - w * 0.16, x + w, y + w * 0.5);
    }
    c.lineTo(x + w, y + h); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 0.5; c.stroke(); }
  }
  function windows(c, x, y, cols, rows, sx, sy, w, h, p) {
    for (var j = 0; j < rows; j++) for (var i = 0; i < cols; i++) {
      var lit = (i * 7 + j * 11 + Math.floor(x)) % 5 !== 0;
      rect(c, x + i * sx, y + j * sy, w, h, lit ? p.window : p.dim);
      if (w > 2.3) line(c, [[x + i * sx + w / 2, y + j * sy], [x + i * sx + w / 2, y + j * sy + h]], p.body, 0.4);
    }
  }
  function stone(c, x, y, w, h, p, step) {
    step = step || 5;
    for (var yy = y; yy < y + h; yy += step) {
      line(c, [[x, yy], [x + w, yy]], p.dim, 0.3);
      for (var xx = x + ((Math.round((yy - y) / step) % 2) ? step : 0); xx < x + w; xx += step * 2) {
        line(c, [[xx, yy], [xx, Math.min(yy + step, y + h)]], p.dim, 0.3);
      }
    }
  }
  function clock(c, x, y, r, p) {
    ellipse(c, x, y, r, r, p.body, p.accent, 0.65);
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * TAU;
      line(c, [[x + Math.sin(a) * r * 0.76, y + Math.cos(a) * r * 0.76], [x + Math.sin(a) * r * 0.9, y + Math.cos(a) * r * 0.9]], p.accent, 0.4);
    }
    line(c, [[x - r * 0.42, y + r * 0.1], [x, y], [x + r * 0.18, y - r * 0.63]], p.window, 0.75);
  }
  function cross(c, x, y, s, p) {
    line(c, [[x, y], [x, y + s * 1.8]], p.accent, 0.65);
    line(c, [[x - s * 0.55, y + s * 0.6], [x + s * 0.55, y + s * 0.6]], p.accent, 0.65);
  }
  function spire(c, x, y, w, h, p) {
    poly(c, [[x, y], [x + w / 2, y - h], [x + w, y]], p.body, p.edge);
    line(c, [[x + w / 2, y - h], [x + w / 2, y]], p.dim, 0.4);
  }
  function drawCanalHouses(c, p) {
    var heights = [70, 83, 73, 91, 78, 67];
    for (var i = 0; i < 6; i++) {
      var x = i * 16.6, top = -heights[i], w = 15.5;
      rect(c, x, top + 15, w, -top - 15, p.body, p.edge);
      if (i % 3 === 0) {
        poly(c, [[x, top + 16], [x + 2, top + 16], [x + 2, top + 11], [x + 4.5, top + 11], [x + 4.5, top + 6], [x + 6, top + 6], [x + 6, top], [x + 9.5, top], [x + 9.5, top + 6], [x + 11, top + 6], [x + 11, top + 11], [x + 13.5, top + 11], [x + 13.5, top + 16]], p.body, p.edge);
      } else if (i % 3 === 1) {
        c.beginPath(); c.moveTo(x, top + 16); c.bezierCurveTo(x + 6, top + 16, x + 2, top + 3, x + 6.4, top + 3);
        c.lineTo(x + 6.4, top); c.lineTo(x + 9.1, top); c.lineTo(x + 9.1, top + 3);
        c.bezierCurveTo(x + 13.5, top + 3, x + 9.5, top + 16, x + w, top + 16);
        c.closePath(); c.fillStyle = p.body; c.fill(); c.strokeStyle = p.edge; c.lineWidth = 0.6; c.stroke();
      } else poly(c, [[x, top + 16], [x + w / 2, top], [x + w, top + 16]], p.body, p.edge);
      line(c, [[x + 1, top + 18], [x + w - 1, top + 18]], p.accent, 0.65);
      windows(c, x + 2.8, top + 23, 2, Math.floor((-top - 29) / 15), 6.3, 15, 3.8, 7.5, p);
      rect(c, x + 6, -10, 4, 10, p.dim, p.edge);
      rect(c, x + 3, -15, 9, 1, p.edge);
      line(c, [[x + 7.7, top - 0.8], [x + 7.7, top - 4], [x + 10.5, top - 4]], p.accent, 0.5);
      for (var j = 0; j < 4; j++) line(c, [[x + 1.5, -20 - j * 13], [x + w - 1.5, -20 - j * 13]], p.dim, 0.25);
    }
    line(c, [[0, -1.5], [100, -1.5]], p.accent, 0.75);
    for (var b = 2; b < 100; b += 12) rect(c, b, -6, 0.8, 6, p.edge);
  }

  L.amsterdam = [
    {name: "Canal houses", x: 0.015, width: 0.25, height: 0.50, draw: drawCanalHouses},
    {name: "Westerkerk", x: 0.30, width: 0.085, height: 0.90, draw: function (c, p) {
      rect(c, 27, -45, 46, 45, p.body, p.edge); stone(c, 27, -45, 46, 45, p, 6);
      rect(c, 20, -49, 60, 5, p.body, p.accent);
      rect(c, 33, -66, 34, 17, p.body, p.edge); rect(c, 28, -69, 44, 4, p.body, p.accent);
      clock(c, 50, -56, 6.5, p);
      rect(c, 37, -79, 26, 11, p.body, p.edge);
      arch(c, 41, -77, 5.5, 8, p.dim, p.accent); arch(c, 53.5, -77, 5.5, 8, p.dim, p.accent);
      poly(c, [[32, -80], [37, -85], [63, -85], [68, -80]], p.body, p.accent);
      rect(c, 42, -90, 16, 6, p.body, p.edge);
      c.beginPath(); c.moveTo(39, -90); c.bezierCurveTo(39, -96, 61, -96, 61, -90); c.strokeStyle = p.accent; c.lineWidth = 1; c.stroke();
      line(c, [[43, -90], [44, -96], [50, -98], [56, -96], [57, -90]], p.accent, 0.9);
      cross(c, 50, -100, 1.6, p);
      for (var x = 34; x < 70; x += 11) arch(c, x, -36, 7, 20, p.dim, p.edge);
      line(c, [[28, -8], [72, -8]], p.edge, 0.6);
      rect(c, 4, -15, 23, 15, p.body, p.edge); spire(c, 1, -15, 29, 10, p);
      rect(c, 73, -15, 23, 15, p.body, p.edge); spire(c, 70, -15, 29, 10, p);
    }},
    {name: "Amsterdam Centraal", x: 0.43, width: 0.32, height: 0.66, draw: function (c, p) {
      rect(c, 3, -50, 94, 50, p.body, p.edge); stone(c, 3, -50, 94, 50, p, 7);
      poly(c, [[0, -50], [4, -58], [96, -58], [100, -50]], p.body, p.edge);
      rect(c, 6, -64, 12, 64, p.body, p.edge); rect(c, 82, -64, 12, 64, p.body, p.edge);
      [6, 82].forEach(function (x) { spire(c, x - 1, -64, 14, 15, p); rect(c, x + 5.3, -83, 1.4, 7, p.accent); });
      rect(c, 36, -64, 28, 64, p.body, p.edge);
      poly(c, [[33, -64], [50, -92], [67, -64]], p.body, p.accent);
      rect(c, 43, -72, 14, 1.5, p.accent); clock(c, 50, -78, 5, p);
      for (var k = 0; k < 5; k++) {
        var xx = 21 + k * 12.2;
        if (k === 2) continue;
        arch(c, xx, -39, 7, 14, p.window, p.edge); arch(c, xx, -19, 7, 19, p.dim, p.edge);
      }
      for (var t = 0; t < 3; t++) arch(c, 39 + t * 8, -31, 6, 30, p.dim, p.accent);
      windows(c, 9, -54, 1, 3, 1, 13, 6, 6, p); windows(c, 85, -54, 1, 3, 1, 13, 6, 6, p);
      line(c, [[4, -43], [96, -43]], p.accent, 0.8); line(c, [[4, -23], [96, -23]], p.edge, 0.7);
      for (var q = 19; q < 82; q += 5.5) rect(c, q, -58, 1, 7, p.edge);
      rect(c, 48.5, -98, 1, 7, p.edge); line(c, [[50, -98], [57, -96], [50, -94]], p.accent, 0.7);
    }},
    {name: "Magere Brug", x: 0.79, width: 0.195, height: 0.42, draw: function (c, p) {
      rect(c, 1, -17, 98, 4, p.body, p.accent); line(c, [[0, -22], [100, -22]], p.edge, 0.7);
      [24, 69].forEach(function (x) {
        rect(c, x, -72, 4, 62, p.body, p.accent); rect(c, x + 8, -72, 4, 62, p.body, p.accent);
        line(c, [[x - 5, -73], [x + 17, -73]], p.accent, 1.7);
        line(c, [[x - 3, -72], [x + 6, -91], [x + 15, -72]], p.edge, 1.2);
        line(c, [[x + 5.5, -86], [x + 5.5, -31]], p.edge, 0.7);
        line(c, [[x + 1, -70], [x + 33 * (x < 30 ? 1 : -1), -19]], p.accent, 0.9);
        rect(c, x - 1, -9, 14, 9, p.body, p.edge);
      });
      for (var n = 3; n < 100; n += 5) line(c, [[n, -22], [n, -17]], p.edge, 0.5);
      for (var m = 8; m < 98; m += 16) ellipse(c, m, -23, 0.85, 1.7, p.window);
      line(c, [[35, -17], [65, -17]], p.window, 1);
    }}
  ];

  L.cologne = [
    {name: "Hohenzollern Bridge", x: 0.015, width: 0.335, height: 0.44, draw: function (c, p) {
      rect(c, 0, -16, 100, 5, p.body, p.edge); rect(c, 0, -25, 100, 2, p.accent);
      for (var j = 0; j < 3; j++) {
        var x = 1 + j * 33;
        c.beginPath(); c.moveTo(x, -25); c.bezierCurveTo(x + 4, -93, x + 28, -93, x + 32, -25);
        c.strokeStyle = p.edge; c.lineWidth = 2; c.stroke();
        c.beginPath(); c.moveTo(x, -25); c.bezierCurveTo(x + 5, -76, x + 27, -76, x + 32, -25);
        c.strokeStyle = p.accent; c.lineWidth = 0.65; c.stroke();
        for (var k = 1; k < 8; k++) {
          var xx = x + k * 4, yy = -25 - Math.sin(k / 8 * Math.PI) * 47;
          line(c, [[xx, yy], [xx, -25]], p.edge, 0.55);
          if (k < 7) line(c, [[xx, yy], [xx + 4, -25]], p.dim, 0.65);
        }
      }
      [0, 32, 65, 97].forEach(function (x) { rect(c, x, -11, 3, 11, p.body, p.edge); });
      for (var i = 2; i < 100; i += 3.4) line(c, [[i, -22], [i, -17]], p.dim, 0.4);
      for (var z = 5; z < 100; z += 12) rect(c, z, -14, 1, 1.7, p.window);
    }},
    {name: "Cologne Cathedral", x: 0.395, width: 0.245, height: 0.95, draw: function (c, p) {
      rect(c, 12, -43, 76, 43, p.body, p.edge); stone(c, 12, -43, 76, 43, p, 5);
      poly(c, [[28, -38], [50, -61], [72, -38]], p.body, p.edge);
      [14, 64].forEach(function (x) {
        rect(c, x, -57, 22, 57, p.body, p.edge); rect(c, x + 2, -70, 18, 14, p.body, p.edge);
        poly(c, [[x + 2, -70], [x + 11, -98], [x + 20, -70]], p.body, p.accent);
        for (var rib = 3; rib <= 18; rib += 5) line(c, [[x + 11, -97], [x + rib, -70]], p.dim, 0.45);
        [x + 2, x + 20].forEach(function (xx) { spire(c, xx - 1.8, -61, 3.6, 13, p); });
        for (var yy = -59; yy < -12; yy += 13) {
          arch(c, x + 5, yy, 4.2, 9.5, p.dim, p.edge, true);
          arch(c, x + 12.5, yy, 4.2, 9.5, p.dim, p.edge, true);
          line(c, [[x - 1, yy + 11], [x + 23, yy + 11]], p.edge, 0.65);
        }
        line(c, [[x + 11, -99], [x + 11, -100]], p.accent, 0.7);
        for (var a = 0; a < 3; a++) arch(c, x + 3 + a * 5.7, -11, 4.8, 11, p.dim, p.accent, true);
      });
      ellipse(c, 50, -35, 8, 8, p.dim, p.edge, 0.7);
      ellipse(c, 50, -35, 5.7, 5.7, null, p.accent, 0.45);
      for (var spoke = 0; spoke < 12; spoke++) {
        var aa = spoke / 12 * TAU;
        line(c, [[50, -35], [50 + Math.cos(aa) * 7.6, -35 + Math.sin(aa) * 7.6]], p.edge, 0.4);
      }
      arch(c, 40, -22, 20, 22, p.dim, p.accent, true);
      arch(c, 43, -18, 14, 18, null, p.edge, true);
      [8, 38, 60, 88].forEach(function (x) {
        poly(c, [[x - 1.5, 0], [x, -39], [x + 2.3, 0]], p.body, p.edge);
        spire(c, x - 1.5, -39, 3, 8, p);
      });
      line(c, [[45, -48], [50, -54], [55, -48]], p.accent, 0.6);
    }},
    {name: "Great St Martin", x: 0.705, width: 0.11, height: 0.70, draw: function (c, p) {
      rect(c, 18, -33, 64, 33, p.body, p.edge); poly(c, [[10, -33], [49, -53], [90, -33]], p.body, p.edge);
      rect(c, 29, -72, 42, 44, p.body, p.edge); stone(c, 29, -72, 42, 44, p, 5);
      spire(c, 25, -72, 50, 23, p);
      [23, 65].forEach(function (x) { rect(c, x, -76, 12, 38, p.body, p.edge); spire(c, x - 2, -76, 16, 16, p); });
      for (var x = 38; x < 67; x += 10) arch(c, x, -65, 5, 17, p.dim, p.accent);
      for (var k = 0; k < 3; k++) arch(c, 24 + k * 22, -24, 9, 18, p.dim, p.edge);
      line(c, [[28, -45], [72, -45]], p.accent, 0.7); line(c, [[27, -69], [73, -69]], p.edge, 0.7);
      for (var r = 0; r < 4; r++) line(c, [[29 + r * 14, -30], [29 + r * 14, -1]], p.dim, 0.5);
    }},
    {name: "Rheinauhafen crane houses", x: 0.86, width: 0.125, height: 0.53, draw: function (c, p) {
      [[0, -62, 42], [49, -88, 48]].forEach(function (b) {
        poly(c, [[b[0], 0], [b[0], b[1]], [b[0] + b[2], b[1]], [b[0] + b[2], b[1] + 19], [b[0] + 19, b[1] + 19], [b[0] + 19, 0]], p.body, p.edge);
        for (var y = b[1] + 3; y < b[1] + 18; y += 4) line(c, [[b[0] + 2, y], [b[0] + b[2] - 2, y]], p.accent, 0.5);
        for (var yy = b[1] + 23; yy < -1; yy += 5) line(c, [[b[0] + 2, yy], [b[0] + 17, yy]], p.dim, 0.55);
        windows(c, b[0] + 3, b[1] + 24, 3, Math.floor((-b[1] - 26) / 8), 4, 8, 1.3, 2.5, p);
        for (var x = b[0] + 5; x < b[0] + b[2] - 1; x += 6) line(c, [[x, b[1] + 1], [x, b[1] + 18]], p.dim, 0.4);
      });
    }}
  ];

  L.stuttgart = [
    {name: "Hauptbahnhof tower", x: 0.035, width: 0.165, height: 0.65, draw: function (c, p) {
      rect(c, 8, -25, 84, 25, p.body, p.edge); stone(c, 8, -25, 84, 25, p, 6);
      rect(c, 39, -82, 35, 82, p.body, p.edge); stone(c, 39, -82, 35, 82, p, 6);
      rect(c, 37, -85, 39, 4, p.body, p.accent); rect(c, 41, -90, 31, 5, p.body, p.edge);
      clock(c, 56.5, -71, 7.7, p);
      for (var i = 0; i < 3; i++) rect(c, 48 + i * 7, -52, 3, 28, p.dim, p.edge);
      [17, 29, 81].forEach(function (x) { rect(c, x, -19, 6, 19, p.dim, p.edge); });
      ellipse(c, 56.5, -96, 5.5, 4, null, p.accent, 0.6);
      for (var j = 0; j < 3; j++) { var a = -Math.PI / 2 + j * TAU / 3; line(c, [[56.5, -96], [56.5 + Math.cos(a) * 5.5, -96 + Math.sin(a) * 4]], p.accent, 0.6); }
      line(c, [[40, -18], [73, -18]], p.accent, 0.7);
    }},
    {name: "Neues Schloss", x: 0.245, width: 0.335, height: 0.48, draw: function (c, p) {
      rect(c, 1, -52, 98, 52, p.body, p.edge);
      poly(c, [[0, -52], [5, -68], [95, -68], [100, -52]], p.body, p.edge);
      [3, 36, 78].forEach(function (x) { rect(c, x, -61, x === 36 ? 28 : 18, 61, p.body, p.edge); });
      poly(c, [[32, -61], [50, -82], [68, -61]], p.body, p.accent);
      for (var i = 0; i < 3; i++) arch(c, 40 + i * 8, -24, 5.5, 24, p.dim, p.accent);
      windows(c, 5, -44, 4, 2, 7.3, 17, 3.5, 8, p); windows(c, 68, -44, 4, 2, 7.3, 17, 3.5, 8, p);
      windows(c, 40, -52, 3, 1, 8, 1, 5, 11, p);
      for (var q = 3; q < 100; q += 8) { rect(c, q, -7, 2, 7, p.edge); rect(c, q + 0.4, -10, 1.2, 3, p.accent); }
      line(c, [[1, -28], [99, -28]], p.edge, 0.7); line(c, [[0, -55], [100, -55]], p.accent, 0.7);
      for (var k = 10; k < 95; k += 14) { rect(c, k, -73, 4, 5, p.body, p.edge); poly(c, [[k - 1, -73], [k + 2, -79], [k + 5, -73]], p.body, p.edge); }
      ellipse(c, 50, -70, 3.7, 4.3, p.dim, p.edge);
      rect(c, 49.5, -96, 0.8, 13, p.edge); poly(c, [[50.5, -95], [60, -92], [50.5, -89]], p.accent);
    }},
    {name: "Stiftskirche", x: 0.625, width: 0.13, height: 0.71, draw: function (c, p) {
      rect(c, 10, -36, 80, 36, p.body, p.edge); poly(c, [[8, -36], [50, -56], [92, -36]], p.body, p.edge);
      rect(c, 11, -72, 25, 72, p.body, p.edge); stone(c, 11, -72, 25, 72, p, 7);
      spire(c, 6, -72, 35, 23, p); clock(c, 23.5, -61, 6.6, p);
      rect(c, 66, -63, 22, 63, p.body, p.edge); rect(c, 63, -67, 28, 5, p.body, p.accent);
      poly(c, [[64, -67], [67, -78], [72, -84], [82, -84], [88, -78], [91, -67]], p.body, p.edge);
      line(c, [[77, -84], [77, -91]], p.edge, 0.65);
      arch(c, 73, -59, 8, 12, p.dim, p.edge, true);
      [41, 51].forEach(function (x) { arch(c, x, -30, 7.2, 23, p.window, p.edge, true); });
      for (var b = 39; b < 65; b += 10) poly(c, [[b, 0], [b + 1.5, -26], [b + 3.2, 0]], p.body, p.edge);
      arch(c, 18, -21, 11, 21, p.dim, p.accent, true);
      line(c, [[11, -44], [36, -44]], p.edge, 0.7);
    }},
    {name: "Fernsehturm", x: 0.845, width: 0.055, height: 0.95, draw: function (c, p) {
      poly(c, [[38, 0], [47, -69], [53, -69], [62, 0]], p.body, p.edge);
      line(c, [[50, -68], [50, 0]], p.dim, 0.5);
      poly(c, [[15, -68], [9, -76], [17, -83], [83, -83], [91, -76], [85, -68]], p.body, p.edge);
      rect(c, 11, -77, 78, 5, p.dim, p.accent);
      for (var i = 17; i < 88; i += 9) rect(c, i, -76, 4, 2, p.window);
      line(c, [[20, -81], [80, -81]], p.accent, 0.7);
      rect(c, 46, -91, 8, 8, p.body, p.edge);
      line(c, [[50, -100], [50, -90]], p.accent, 1.2);
      [0, 1, 2].forEach(function (r) { rect(c, 47, -98 + r * 3, 6, 1, p.dim); });
      ellipse(c, 50, -99.6, 1.5, 0.55, p.accent);
    }}
  ];

  L.rome = [
    {name: "Colosseum", x: 0.02, width: 0.315, height: 0.56, draw: function (c, p) {
      c.beginPath(); c.moveTo(1, -9); c.lineTo(1, -68); c.quadraticCurveTo(45, -89, 99, -68);
      c.lineTo(99, -10); c.quadraticCurveTo(50, 8, 1, -9); c.closePath(); c.fillStyle = p.body; c.fill(); c.strokeStyle = p.edge; c.lineWidth = 0.75; c.stroke();
      for (var row = 0; row < 3; row++) {
        for (var i = 0; i < 13; i++) {
          var x = 3.5 + i * 7.2, curve = Math.sin((i + 0.5) / 13 * Math.PI) * 9;
          arch(c, x, -60 + row * 18 - curve, 4.5, 13, p.dim, p.edge);
          line(c, [[x - 0.9, -61 + row * 18 - curve], [x - 0.9, -46 + row * 18 - curve]], p.edge, 0.6);
          rect(c, x - 1.5, -61 + row * 18 - curve, 1.3, 1, p.accent);
        }
        c.beginPath(); c.moveTo(1, -45 + row * 18); c.quadraticCurveTo(50, -64 + row * 18, 99, -45 + row * 18); c.strokeStyle = p.accent; c.lineWidth = 0.65; c.stroke();
      }
      for (var j = 3; j < 99; j += 6) rect(c, j, -71 - Math.sin(j / 100 * Math.PI) * 9, 2, 3, p.dim);
      poly(c, [[70, -80], [72, -88], [76, -88], [76, -84], [81, -84], [81, -78], [88, -78], [88, -74], [95, -74], [99, -68]], p.body, p.edge);
      line(c, [[3, -6], [97, -6]], p.dim, 0.8);
    }},
    {name: "Roman Forum columns", x: 0.375, width: 0.12, height: 0.52, draw: function (c, p) {
      rect(c, 2, -5, 96, 5, p.body, p.edge); rect(c, 8, -10, 84, 5, p.body, p.edge);
      [17, 43, 69].forEach(function (x) {
        poly(c, [[x, -12], [x + 2, -80], [x + 12, -80], [x + 14, -12]], p.body, p.edge);
        rect(c, x - 3, -83, 20, 4, p.body, p.accent); rect(c, x - 1.5, -14, 17, 4, p.body, p.edge);
        for (var n = 1; n < 4; n++) line(c, [[x + 2 + n * 2.4, -78], [x + n * 3, -16]], p.dim, 0.5);
        ellipse(c, x, -83, 2.8, 1.7, null, p.edge); ellipse(c, x + 14, -83, 2.8, 1.7, null, p.edge);
      });
      poly(c, [[10, -83], [10, -91], [87, -91], [89, -86], [86, -83]], p.body, p.edge);
      line(c, [[12, -88], [85, -88]], p.accent, 0.8);
      for (var i = 16; i < 85; i += 7) rect(c, i, -88, 3, 2, p.dim);
      poly(c, [[84, -10], [90, -17], [96, -14], [99, -5]], p.body, p.edge);
    }},
    {name: "St Peter's Basilica", x: 0.55, width: 0.235, height: 0.93, draw: function (c, p) {
      rect(c, 2, -28, 96, 28, p.body, p.edge); stone(c, 2, -28, 96, 28, p, 5);
      rect(c, 30, -49, 40, 27, p.body, p.edge); rect(c, 27, -51, 46, 3, p.body, p.accent);
      for (var i = 0; i < 7; i++) {
        var x = 32 + i * 5.1; arch(c, x, -44, 3.5, 10, p.dim, p.edge);
        line(c, [[x - 1, -47], [x - 1, -32]], p.edge, 0.6);
      }
      c.beginPath(); c.moveTo(28, -51); c.bezierCurveTo(29, -74, 37, -82, 50, -85);
      c.bezierCurveTo(63, -82, 71, -74, 72, -51); c.closePath(); c.fillStyle = p.body; c.fill(); c.strokeStyle = p.edge; c.lineWidth = 0.8; c.stroke();
      for (var rib = -2; rib <= 2; rib++) {
        c.beginPath(); c.moveTo(50, -84); c.quadraticCurveTo(50 + rib * 8, -72, 50 + rib * 9, -51); c.strokeStyle = p.accent; c.lineWidth = 0.45; c.stroke();
      }
      rect(c, 45, -91, 10, 7, p.body, p.edge); arch(c, 48, -90, 4, 6, p.dim, p.accent);
      ellipse(c, 50, -91, 6.5, 2, p.body, p.accent); cross(c, 50, -100, 3, p);
      poly(c, [[22, -28], [50, -40], [78, -28]], p.body, p.edge);
      for (var j = 0; j < 11; j++) {
        var xx = 7 + j * 8;
        rect(c, xx, -22, 2, 21, p.edge); rect(c, xx - 0.7, -24, 3.4, 2, p.accent);
      }
      for (var k = 0; k < 5; k++) arch(c, 28 + k * 9.2, -16, 5.5, 16, p.dim, p.accent);
      line(c, [[1, -26], [99, -26]], p.accent, 0.75);
      for (var q = 7; q < 97; q += 10) { rect(c, q, -31.5, 1.5, 3, p.edge); ellipse(c, q + 0.75, -33, 1, 1.5, p.edge); }
    }},
    {name: "Castel Sant'Angelo", x: 0.835, width: 0.15, height: 0.56, draw: function (c, p) {
      rect(c, 0, -16, 100, 16, p.body, p.edge); stone(c, 0, -16, 100, 16, p, 5);
      c.beginPath(); c.moveTo(12, -18); c.lineTo(12, -61); c.quadraticCurveTo(50, -73, 88, -61); c.lineTo(88, -18); c.closePath(); c.fillStyle = p.body; c.fill(); c.strokeStyle = p.edge; c.lineWidth = 0.7; c.stroke();
      for (var y = -56; y < -19; y += 6) { c.beginPath(); c.moveTo(13, y); c.quadraticCurveTo(50, y - 9, 87, y); c.strokeStyle = p.dim; c.lineWidth = 0.4; c.stroke(); }
      ellipse(c, 50, -61, 38, 8, p.body, p.edge);
      for (var i = 14; i < 87; i += 7) rect(c, i, -70, 3, 8, p.body, p.edge);
      rect(c, 30, -79, 40, 12, p.body, p.edge); rect(c, 28, -82, 44, 3, p.body, p.accent);
      windows(c, 35, -77, 4, 1, 8, 1, 3, 5, p);
      rect(c, 48, -89, 4, 7, p.body, p.edge); ellipse(c, 50, -92, 2.2, 3, p.edge);
      poly(c, [[48, -90], [40, -96], [36, -95], [42, -90], [48, -87]], p.body, p.edge);
      poly(c, [[52, -90], [60, -97], [64, -95], [58, -90], [52, -87]], p.body, p.edge);
      line(c, [[52, -92], [59, -100]], p.accent, 0.6);
      arch(c, 44, -24, 12, 24, p.dim, p.edge);
      [22, 72].forEach(function (x) { rect(c, x, -46, 4, 7, p.window); });
    }}
  ];

  L.zurich = [
    {name: "St Peter", x: 0.025, width: 0.10, height: 0.78, draw: function (c, p) {
      rect(c, 16, -67, 68, 67, p.body, p.edge); stone(c, 16, -67, 68, 67, p, 7);
      rect(c, 12, -72, 76, 6, p.body, p.accent); poly(c, [[9, -72], [50, -100], [91, -72]], p.body, p.edge);
      clock(c, 50, -52, 21, p);
      rect(c, 13, -27, 74, 3, p.body, p.edge);
      arch(c, 42, -18, 16, 18, p.dim, p.edge);
      line(c, [[50, -98], [50, -74]], p.dim, 0.5);
      rect(c, 34, -82, 9, 7, p.dim, p.edge); rect(c, 57, -82, 9, 7, p.dim, p.edge);
    }},
    {name: "Limmat old town", x: 0.18, width: 0.235, height: 0.49, draw: function (c, p) {
      var hs = [54, 67, 75, 61, 85, 64];
      for (var i = 0; i < 6; i++) {
        var x = i * 16.5, y = -hs[i]; rect(c, x, y, 15.5, -y, p.body, p.edge);
        poly(c, [[x - 1, y], [x + 7.75, y - 15], [x + 16.5, y]], p.body, p.edge);
        line(c, [[x + 7.75, y - 14], [x + 16, y]], p.dim, 0.5);
        rect(c, x + 11.5, y - 12, 2, 7, p.body, p.edge);
        windows(c, x + 2.8, y + 7, 2, Math.floor((hs[i] - 13) / 14), 6.5, 14, 3.5, 6, p);
        for (var j = 0; j < 2; j++) {
          rect(c, x + 1 + j * 6.5, y + 7, 1, 6, p.accent);
          rect(c, x + 6.8 + j * 6.5, y + 7, 1, 6, p.dim);
        }
        arch(c, x + 4.6, -10, 6.5, 10, p.dim, p.edge);
        line(c, [[x, -14], [x + 15.5, -14]], p.accent, 0.5);
      }
      rect(c, 0, -3, 100, 3, p.body, p.accent);
    }},
    {name: "Grossmünster", x: 0.475, width: 0.195, height: 0.90, draw: function (c, p) {
      rect(c, 7, -39, 86, 39, p.body, p.edge); poly(c, [[5, -39], [49, -59], [96, -39]], p.body, p.edge);
      [17, 62].forEach(function (x) {
        rect(c, x, -72, 22, 72, p.body, p.edge); stone(c, x, -72, 22, 72, p, 7);
        rect(c, x - 2, -76, 26, 5, p.body, p.accent);
        c.beginPath(); c.moveTo(x - 1, -76); c.bezierCurveTo(x, -86, x + 4, -87, x + 4, -92);
        c.quadraticCurveTo(x + 11, -99, x + 18, -92); c.bezierCurveTo(x + 18, -87, x + 22, -86, x + 23, -76); c.closePath();
        c.fillStyle = p.body; c.fill(); c.strokeStyle = p.edge; c.lineWidth = 0.65; c.stroke();
        rect(c, x + 9, -100, 4, 6, p.body, p.edge);
        arch(c, x + 4, -66, 5.5, 14, p.dim, p.edge); arch(c, x + 12.5, -66, 5.5, 14, p.dim, p.edge);
        line(c, [[x - 1, -48], [x + 23, -48]], p.accent, 0.6);
        arch(c, x + 6, -40, 10, 15, p.dim, p.edge);
        rect(c, x + 4, -20, 4, 6, p.window); rect(c, x + 14, -20, 4, 6, p.dim);
      });
      arch(c, 41, -26, 18, 26, p.dim, p.accent);
      ellipse(c, 50, -38, 5, 5, p.dim, p.edge);
      [8, 88].forEach(function (x) { rect(c, x, -24, 3, 24, p.body, p.edge); });
      line(c, [[4, -6], [96, -6]], p.dim, 0.6);
    }},
    {name: "Fraumünster", x: 0.765, width: 0.085, height: 0.95, draw: function (c, p) {
      rect(c, 24, -52, 52, 52, p.body, p.edge); stone(c, 24, -52, 52, 52, p, 6);
      rect(c, 20, -57, 60, 5, p.body, p.edge); clock(c, 50, -42, 12, p);
      rect(c, 29, -67, 42, 10, p.body, p.edge);
      spire(c, 20, -67, 60, 32, p); line(c, [[50, -100], [50, -99]], p.accent, 0.7);
      arch(c, 38, -65, 7, 7, p.dim, p.edge); arch(c, 55, -65, 7, 7, p.dim, p.edge);
      rect(c, 20, -25, 60, 3, p.body, p.accent);
      for (var x = 33; x < 72; x += 12) arch(c, x, -20, 7, 15, p.dim, p.edge, true);
      line(c, [[31, -67], [50, -96], [69, -67]], p.dim, 0.5);
      rect(c, 1, -13, 23, 13, p.body, p.edge); poly(c, [[0, -13], [12, -25], [25, -13]], p.body, p.edge);
      rect(c, 76, -13, 23, 13, p.body, p.edge); poly(c, [[75, -13], [87, -25], [100, -13]], p.body, p.edge);
    }},
    {name: "Münsterbrücke", x: 0.87, width: 0.115, height: 0.40, draw: function (c, p) {
      poly(c, [[0, -44], [100, -44], [100, 0], [0, 0]], p.body, p.edge);
      for (var i = 0; i < 3; i++) arch(c, 5 + i * 32, -34, 26, 34, p.dim, p.edge);
      rect(c, 0, -49, 100, 5, p.body, p.accent);
      for (var x = 2; x < 100; x += 6) line(c, [[x, -57], [x, -49]], p.edge, 0.6);
      line(c, [[0, -57], [100, -57]], p.edge, 0.8);
      [6, 94].forEach(function (x) { line(c, [[x, -57], [x, -83]], p.edge, 1); ellipse(c, x, -85, 3, 5, p.window, p.edge); });
      line(c, [[0, -40], [100, -40]], p.dim, 0.5);
    }}
  ];
})();
