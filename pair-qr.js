/* ============================================================================
   pair-qr.js -- a QR code drawn by the page, with nothing fetched to draw it.

   WHY NOT AN IMAGE SERVICE
   The obvious way to put a QR on screen is <img src="https://someqrapi/?data=...">,
   and it is the wrong way twice over:

     1. It hands the pairing code to a stranger. The code is the one string that
        lets a phone unlock this screen; posting it to a third party to have a
        picture drawn is a confidential value taking a detour through somebody
        else's logs. Whatever they do with it, we no longer decide.
     2. A wall display is offline more often than a laptop is. A board on a
        shop wall behind a flaky connection would show a broken image exactly
        when somebody is standing in front of it trying to set it up.

   So the code is drawn here. It is more lines than an <img> and it is the only
   version that keeps the secret and works with the internet down.

   WHAT IT SUPPORTS
   Byte mode, versions 1-10, all four error-correction levels. That is 271
   bytes at level M -- a pairing URL is about fifty, so the ceiling is never
   near. Numeric and alphanumeric modes are omitted: they would shrink a code
   made entirely of digits, and ours never is.

   WRITTEN IN ES5 ON PURPOSE, like gate.js. This runs on television browsers,
   and a 2016 Tizen set that chokes on an arrow function is exactly the device
   this whole feature exists for.

   Exposes window.TBQR:
     TBQR.matrix(text, opts) -> { size: n, modules: [[bool]] }
     TBQR.svg(text, opts)    -> "<svg ...>" string, ready for innerHTML
   opts = { ecc: "L"|"M"|"Q"|"H" (default "M"), quiet: modules of margin (4),
            dark: CSS colour, light: CSS colour }
   ============================================================================ */
(function () {
  "use strict";

  /* ---- GF(256), the field QR's error correction is built on ---------------
     Every byte is an element; multiplication is done by adding logarithms, so
     the two tables below replace a loop per multiply. 0x11D is the primitive
     polynomial the QR specification names. */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* Generator polynomial for `deg` error-correction bytes: the product of
     (x - a^0)(x - a^1)...(x - a^(deg-1)). Coefficients highest-power first. */
  function rsPoly(deg) {
    var poly = [1], d, i, next;
    for (d = 0; d < deg; d++) {
      next = [];
      for (i = 0; i <= poly.length; i++) next.push(0);
      for (i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];                        // multiply by x
        next[i + 1] ^= gmul(poly[i], EXP[d]);      // ... and by a^d
      }
      poly = next;
    }
    return poly;
  }

  /* Polynomial long division; the remainder is the error-correction block. */
  function rsEncode(data, ecLen) {
    var gen = rsPoly(ecLen), res = [], i, j, coef;
    for (i = 0; i < data.length; i++) res.push(data[i]);
    for (i = 0; i < ecLen; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      coef = res[i];
      if (coef === 0) continue;
      for (j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  /* ---- the block tables ---------------------------------------------------
     Per version and level: [ec bytes per block, blocks in group 1, data bytes
     each, blocks in group 2, data bytes each]. Straight from the standard;
     every row sums to that version's total codeword count, which is the check
     worth doing if one is ever edited. */
  var L = 0, M = 1, Q = 2, H = 3;
  var ECL_INDEX = { L: L, M: M, Q: Q, H: H };
  var ECL_BITS  = [0x01, 0x00, 0x03, 0x02];        // L, M, Q, H as the format field wants them

  var BLOCKS = [
    null,                                           // there is no version 0
    [[ 7,1, 19,0,0], [10,1, 16,0,0], [13,1, 13,0,0], [17,1,  9,0,0]],
    [[10,1, 34,0,0], [16,1, 28,0,0], [22,1, 22,0,0], [28,1, 16,0,0]],
    [[15,1, 55,0,0], [26,1, 44,0,0], [18,2, 17,0,0], [22,2, 13,0,0]],
    [[20,1, 80,0,0], [18,2, 32,0,0], [26,2, 24,0,0], [16,4,  9,0,0]],
    [[26,1,108,0,0], [24,2, 43,0,0], [18,2, 15,2,16], [22,2, 11,2,12]],
    [[18,2, 68,0,0], [16,4, 27,0,0], [24,4, 19,0,0], [28,4, 15,0,0]],
    [[20,2, 78,0,0], [18,4, 31,0,0], [18,2, 14,4,15], [26,4, 13,1,14]],
    [[24,2, 97,0,0], [22,2, 38,2,39], [22,4, 18,2,19], [26,4, 14,2,15]],
    [[30,2,116,0,0], [22,3, 36,2,37], [20,4, 16,4,17], [24,4, 12,4,13]],
    [[18,2, 68,2,69], [26,4, 43,1,44], [24,6, 19,2,20], [28,6, 15,2,16]]
  ];

  /* Centres of the alignment patterns, per version. */
  var ALIGN = [
    null, [], [6,18], [6,22], [6,26], [6,30], [6,34],
    [6,22,38], [6,24,42], [6,26,46], [6,28,50]
  ];

  var MAX_VERSION = 10;

  /* ---- text in, bytes out -------------------------------------------------
     Hand-rolled rather than TextEncoder, which some television browsers do not
     have. Pairing URLs are ASCII, but a caller passing anything else should
     get a correct code rather than a corrupt one. */
  function utf8(text) {
    var out = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) {
        // surrogate pair -> one code point
        c = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63),
                 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function dataCapacity(version, ecl) {
    var b = BLOCKS[version][ecl];
    return b[1] * b[2] + b[3] * b[4];
  }
  function countBits(version) { return version < 10 ? 8 : 16; }

  function pickVersion(byteLen, ecl) {
    for (var v = 1; v <= MAX_VERSION; v++)
      if (dataCapacity(v, ecl) * 8 >= 4 + countBits(v) + byteLen * 8) return v;
    return 0;
  }

  /* ---- the bit stream ----------------------------------------------------- */
  function buildCodewords(bytes, version, ecl) {
    var cap = dataCapacity(version, ecl), bits = [], i, j;

    function push(value, len) {
      for (var k = len - 1; k >= 0; k--) bits.push((value >> k) & 1);
    }

    push(4, 4);                                     // mode: byte
    push(bytes.length, countBits(version));
    for (i = 0; i < bytes.length; i++) push(bytes[i], 8);

    // Terminator, then up to a byte boundary, then the specified pad pair.
    for (i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (i = 0; data.length < cap; i++) data.push(i % 2 === 0 ? 0xEC : 0x11);

    // Split into blocks, error-correct each, then interleave -- QR spreads a
    // scratch across blocks so no single block loses everything.
    var spec = BLOCKS[version][ecl], ecLen = spec[0];
    var blocks = [], ecBlocks = [], at = 0, n;
    for (i = 0; i < spec[1]; i++) { n = spec[2]; blocks.push(data.slice(at, at + n)); at += n; }
    for (i = 0; i < spec[3]; i++) { n = spec[4]; blocks.push(data.slice(at, at + n)); at += n; }
    for (i = 0; i < blocks.length; i++) ecBlocks.push(rsEncode(blocks[i], ecLen));

    var out = [], maxLen = Math.max(spec[2], spec[4]);
    for (i = 0; i < maxLen; i++)
      for (j = 0; j < blocks.length; j++)
        if (i < blocks[j].length) out.push(blocks[j][i]);
    for (i = 0; i < ecLen; i++)
      for (j = 0; j < ecBlocks.length; j++) out.push(ecBlocks[j][i]);
    return out;
  }

  /* ---- the grid ----------------------------------------------------------- */
  function blank(size) {
    var g = [], r, c, row;
    for (r = 0; r < size; r++) { row = []; for (c = 0; c < size; c++) row.push(false); g.push(row); }
    return g;
  }

  function drawFunctions(mod, res, version) {
    var size = mod.length, i, j, r, c;

    function finder(r0, c0) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r0 + dr, cc = c0 + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var ring = (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        var core = (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        var inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        mod[rr][cc] = inside && (ring || core);     // outside the 7x7 is the separator: light
        res[rr][cc] = true;
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // Timing: the alternating rule that tells a scanner the module pitch.
    for (i = 0; i < size; i++) {
      if (!res[6][i]) { mod[6][i] = (i % 2 === 0); res[6][i] = true; }
      if (!res[i][6]) { mod[i][6] = (i % 2 === 0); res[i][6] = true; }
    }

    // Alignment patterns, minus the three that would sit on a finder.
    var ctr = ALIGN[version], last = ctr.length - 1;
    for (i = 0; i < ctr.length; i++) for (j = 0; j < ctr.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
        r = ctr[i] + dr2; c = ctr[j] + dc2;
        mod[r][c] = Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1;
        res[r][c] = true;
      }
    }

    // Reserve the format strip; its contents are written after a mask is chosen.
    for (i = 0; i <= 8; i++) {
      if (i !== 6) { res[8][i] = true; res[i][8] = true; }
    }
    for (i = 0; i < 8; i++) { res[8][size - 1 - i] = true; res[size - 1 - i][8] = true; }
    mod[size - 8][8] = true; res[size - 8][8] = true;      // the module that is always dark

    // Version information, from version 7 up.
    if (version >= 7) {
      var rem = version;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vbits = (version << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bit = ((vbits >> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        mod[b][a] = bit; res[b][a] = true;
        mod[a][b] = bit; res[a][b] = true;
      }
    }
  }

  /* Data snakes up and down in two-module columns, right to left, stepping over
     anything already reserved. */
  function placeData(mod, res, codewords) {
    var size = mod.length, total = codewords.length * 8, bit = 0;
    var row = size - 1, dir = -1, col = size - 1, i, cc, dark;
    while (col > 0) {
      if (col === 6) col--;                          // the vertical timing line is not a column
      for (;;) {
        for (i = 0; i < 2; i++) {
          cc = col - i;
          if (!res[row][cc]) {
            dark = false;
            if (bit < total) dark = ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
            mod[row][cc] = dark;
            bit++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
      col -= 2;
    }
  }

  function maskFn(n, r, c) {
    switch (n) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  /* The four penalty rules. A mask is only a scannability choice -- any of the
     eight decodes -- so this picks the least awkward-looking rather than
     deciding correctness. */
  function penalty(mod) {
    var size = mod.length, score = 0, r, c, run, last, dark = 0;

    function line(get) {
      run = 1; last = get(0);
      for (var i = 1; i < size; i++) {
        var v = get(i);
        if (v === last) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
        else { run = 1; last = v; }
      }
    }
    for (r = 0; r < size; r++) line((function (rr) { return function (i) { return mod[rr][i]; }; })(r));
    for (c = 0; c < size; c++) line((function (cc) { return function (i) { return mod[i][cc]; }; })(c));

    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++)
      if (mod[r][c] === mod[r][c + 1] && mod[r][c] === mod[r + 1][c] && mod[r][c] === mod[r + 1][c + 1])
        score += 3;

    // The finder-lookalike: 1011101 with four light modules on either side.
    var A = [true,false,true,true,true,false,true,false,false,false,false];
    var B = [false,false,false,false,true,false,true,true,true,false,true];
    function match(get, i, pat) {
      for (var k = 0; k < 11; k++) if (get(i + k) !== pat[k]) return false;
      return true;
    }
    for (r = 0; r < size; r++) {
      var rowGet = (function (rr) { return function (i) { return mod[rr][i]; }; })(r);
      for (c = 0; c + 11 <= size; c++) {
        if (match(rowGet, c, A)) score += 40;
        if (match(rowGet, c, B)) score += 40;
      }
    }
    for (c = 0; c < size; c++) {
      var colGet = (function (cc) { return function (i) { return mod[i][cc]; }; })(c);
      for (r = 0; r + 11 <= size; r++) {
        if (match(colGet, r, A)) score += 40;
        if (match(colGet, r, B)) score += 40;
      }
    }

    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (mod[r][c]) dark++;
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function drawFormat(mod, version, ecl, mask) {
    var size = mod.length, data = (ECL_BITS[ecl] << 3) | mask, rem = data << 10, i;
    for (i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function bit(i) { return ((bits >> i) & 1) === 1; }

    for (i = 0; i <= 5; i++) mod[i][8] = bit(i);
    mod[7][8] = bit(6);
    mod[8][8] = bit(7);
    mod[8][7] = bit(8);
    for (i = 9; i < 15; i++) mod[8][14 - i] = bit(i);

    for (i = 0; i < 8; i++) mod[8][size - 1 - i] = bit(i);
    for (i = 8; i < 15; i++) mod[size - 15 + i][8] = bit(i);
    mod[size - 8][8] = true;
  }

  function matrix(text, opts) {
    opts = opts || {};
    var ecl = ECL_INDEX[String(opts.ecc || "M").toUpperCase()];
    if (ecl === undefined) ecl = M;
    var bytes = utf8(String(text));
    var version = pickVersion(bytes.length, ecl);
    if (!version) throw new Error("pair-qr: " + bytes.length + " bytes is too long for version " + MAX_VERSION);

    var codewords = buildCodewords(bytes, version, ecl);
    var size = version * 4 + 17;
    var base = blank(size), res = blank(size);
    drawFunctions(base, res, version);
    placeData(base, res, codewords);

    var best = null, bestScore = Infinity, m, r, c, cand, s;
    for (m = 0; m < 8; m++) {
      cand = [];
      for (r = 0; r < size; r++) {
        cand.push(base[r].slice());
        for (c = 0; c < size; c++) if (!res[r][c] && maskFn(m, r, c)) cand[r][c] = !cand[r][c];
      }
      drawFormat(cand, version, ecl, m);
      s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    return { size: size, version: version, modules: best };
  }

  /* One <path> for every dark module rather than one <rect> each: a version-4
     code is 1089 modules, and a thousand elements is a slow thing to hand a
     television's compositor. */
  function svg(text, opts) {
    opts = opts || {};
    var qr = matrix(text, opts);
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var dim = qr.size + quiet * 2;
    var d = "", r, c;
    for (r = 0; r < qr.size; r++) for (c = 0; c < qr.size; c++)
      if (qr.modules[r][c]) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" ' +
      'shape-rendering="crispEdges" width="100%" height="100%" role="img" ' +
      'aria-label="Pairing QR code">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + (opts.light || "#ffffff") + '"/>' +
      '<path d="' + d + '" fill="' + (opts.dark || "#000000") + '"/></svg>';
  }

  window.TBQR = { matrix: matrix, svg: svg, maxVersion: MAX_VERSION };
})();
