/* Architectural studies for the projector's North American city scenes.
   Each landmark is an illustrative elevation, not a surveyed sightline.
   Coordinates are normalized: ground y=0, roof/spire y=-100. */
(function () {
  "use strict";
  var cities = window.TBProjectorLandmarks = window.TBProjectorLandmarks || {};

  function path(c, p, points, fill, stroke) {
    c.beginPath(); points.forEach(function (v, i) { i ? c.lineTo(v[0], v[1]) : c.moveTo(v[0], v[1]); });
    c.closePath(); c.fillStyle = fill || p.body; c.fill(); c.strokeStyle = stroke || p.edge; c.stroke();
  }
  function line(c, points, color, width) {
    c.beginPath(); points.forEach(function (v, i) { i ? c.lineTo(v[0], v[1]) : c.moveTo(v[0], v[1]); });
    c.strokeStyle = color; c.lineWidth = width || .65; c.stroke();
  }
  function block(c, p, x, y, w, h, fill) {
    c.fillStyle = fill || p.body; c.fillRect(x, y, w, h);
    c.strokeStyle = p.edge; c.strokeRect(x, y, w, h);
  }
  function windows(c, p, x, y, w, h, cols, rows, seed) {
    var dx = w / cols, dy = h / rows;
    for (var j = 0; j < rows; j++) for (var i = 0; i < cols; i++) {
      c.fillStyle = ((i * 7 + j * 11 + (seed || 0)) % 9 < 3) ? p.window : p.dim;
      c.fillRect(x + i * dx + dx * .3, y + j * dy + dy * .27, dx * .38, dy * .36);
    }
  }
  function ribs(c, p, x, y, w, h, count) {
    for (var i = 0; i <= count; i++) line(c, [[x + w * i / count, y], [x + w * i / count, y + h]], p.dim, .5);
  }
  function clock(c, p, x, y, r) {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = p.dim; c.fill(); c.strokeStyle = p.accent; c.stroke();
    for (var i = 0; i < 12; i++) {
      var a = i * Math.PI / 6;
      line(c, [[x + Math.cos(a) * r * .79, y + Math.sin(a) * r * .79], [x + Math.cos(a) * r * .94, y + Math.sin(a) * r * .94]], p.accent, .5);
    }
    line(c, [[x - r * .44, y - r * .25], [x, y], [x + r * .15, y - r * .67]], p.window, .9);
  }
  function arch(c, p, x, y, w, h) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h + w / 2); c.arc(x + w / 2, y - h + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w, y);
    c.fillStyle = p.dim; c.fill(); c.strokeStyle = p.edge; c.stroke();
  }
  function dome(c, p, x, y, w, h) {
    c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + w * .06, y - h, x + w * .94, y - h, x + w, y);
    c.closePath(); c.fillStyle = p.body; c.fill(); c.strokeStyle = p.accent; c.stroke();
    for (var i = 1; i < 5; i++) {
      var q = i / 5;
      c.beginPath(); c.moveTo(x + w * q, y); c.quadraticCurveTo(x + w * .5, y - h * 1.15, x + w * .5, y - h * .75); c.strokeStyle = p.dim; c.stroke();
    }
  }
  function landmark(name, x, width, height, draw) {
    return { name: name, x: x, width: width, height: height, draw: function (c, p) {
      c.save(); c.lineWidth = .65; c.lineJoin = "round"; c.lineCap = "round"; draw(c, p); c.restore();
    } };
  }

  cities.dc = [
    landmark("Lincoln Memorial", .055, .19, .32, function (c, p) {
      block(c, p, 0, -9, 100, 9); block(c, p, 5, -18, 90, 9); block(c, p, 10, -78, 80, 60);
      path(c, p, [[5,-79],[95,-79],[90,-93],[10,-93]]); block(c, p, 8, -99, 84, 6);
      for (var i = 0; i < 10; i++) { block(c, p, 13 + i * 7.7, -75, 3.5, 54, p.accent); line(c, [[12+i*7.7,-73],[17+i*7.7,-73]], p.window); }
      line(c, [[5,-12],[95,-12]], p.dim); line(c, [[9,-86],[91,-86]], p.accent);
    }),
    landmark("Washington Monument", .335, .025, .93, function (c, p) {
      path(c, p, [[7,0],[22,-91],[50,-100],[78,-91],[93,0]]);
      path(c, p, [[50,-100],[78,-91],[93,0],[53,0]], p.dim, p.edge);
      for (var j = 0; j < 23; j++) line(c, [[22-j*.63,-89+j*3.8],[78+j*.63,-89+j*3.8]], p.dim, .45);
      line(c, [[22,-91],[78,-91]], p.accent); line(c, [[12,-11],[88,-11]], p.accent);
    }),
    landmark("Smithsonian Castle", .455, .13, .38, function (c, p) {
      block(c, p, 2, -40, 96, 40); block(c, p, 12, -60, 19, 60); block(c, p, 65, -80, 19, 80);
      path(c, p, [[8,-60],[21.5,-82],[35,-60]]); path(c, p, [[61,-80],[74.5,-100],[88,-80]]);
      block(c, p, 43, -49, 16, 49); path(c,p,[[38,-49],[51,-66],[64,-49]]);
      windows(c, p, 14, -57, 14, 53, 2, 5, 2); windows(c, p, 68, -77, 13, 73, 2, 7, 4);
      for(var i=0;i<8;i++) arch(c,p,5+i*11.5,-1,7,23);
      arch(c,p,45,-1,12,29);
    }),
    landmark("United States Capitol", .67, .25, .70, function (c, p) {
      block(c,p,0,-32,100,32); block(c,p,7,-42,27,10); block(c,p,66,-42,27,10);
      block(c,p,32,-47,36,47); block(c,p,38,-60,24,13);
      dome(c,p,32,-60,36,42); block(c,p,46,-92,8,8); dome(c,p,45,-92,10,6);
      line(c,[[50,-97],[50,-100]],p.accent,1.1);
      for(var i=0;i<9;i++) block(c,p,35+i*3.7,-43,1.5,36,p.accent);
      for(var j=0;j<7;j++) { block(c,p,3+j*4,-27,1,22,p.edge); block(c,p,72+j*4,-27,1,22,p.edge); }
      windows(c,p,5,-38,26,7,8,1,5); windows(c,p,69,-38,26,7,8,1,5);
      block(c,p,27,-6,46,6); line(c,[[29,-3],[71,-3]],p.accent);
    })
  ];

  cities.philly = [
    landmark("Comcast Technology Center", .145, .07, .98, function(c,p){
      block(c,p,12,-83,70,83); block(c,p,21,-94,52,11); block(c,p,39,-100,13,6);
      path(c,p,[[82,0],[82,-83],[91,-76],[91,0]],p.dim);
      windows(c,p,16,-80,60,77,7,24,3); ribs(c,p,15,-82,64,82,7);
      line(c,[[16,-83],[76,-83]],p.accent,1.2); line(c,[[40,-99],[51,-99]],p.window);
    }),
    landmark("One Liberty Place", .325, .095, .83, function(c,p){
      path(c,p,[[8,0],[8,-58],[20,-58],[20,-72],[31,-72],[31,-81],[40,-81],[50,-95],[60,-81],[69,-81],[69,-72],[80,-72],[80,-58],[92,-58],[92,0]]);
      line(c,[[50,-95],[50,-100]],p.accent,1.3); line(c,[[50,-94],[50,0]],p.accent);
      line(c,[[20,-72],[50,-87],[80,-72]],p.accent); line(c,[[31,-81],[50,-89],[69,-81]],p.window);
      windows(c,p,14,-55,72,53,8,17,2); ribs(c,p,10,-57,80,57,8);
    }),
    landmark("Philadelphia City Hall", .545, .195, .63, function(c,p){
      block(c,p,0,-26,100,26); block(c,p,9,-39,82,13); block(c,p,35,-63,30,63);
      block(c,p,40,-78,20,15); path(c,p,[[38,-78],[43,-86],[57,-86],[62,-78]]);
      block(c,p,45,-92,10,6); line(c,[[50,-100],[50,-93]],p.accent,2.1);
      clock(c,p,50,-68,6); arch(c,p,43,-1,14,25);
      for(var i=0;i<9;i++) { arch(c,p,4+i*10.5,-4,5,15); arch(c,p,4+i*10.5,-29,5,8); }
      path(c,p,[[7,-39],[16,-49],[25,-39]]); path(c,p,[[75,-39],[84,-49],[93,-39]]);
      line(c,[[3,-25],[97,-25]],p.accent); line(c,[[35,-57],[65,-57]],p.accent);
    }),
    landmark("Two Liberty Place", .805, .085, .68, function(c,p){
      path(c,p,[[8,0],[8,-62],[22,-62],[22,-76],[35,-76],[50,-100],[65,-76],[78,-76],[78,-62],[92,-62],[92,0]]);
      line(c,[[22,-76],[50,-89],[78,-76]],p.accent); line(c,[[35,-76],[50,-98],[65,-76]],p.window);
      windows(c,p,15,-59,70,57,9,20,1); ribs(c,p,14,-60,72,60,8);
    })
  ];

  cities.nyc = [
    landmark("Brooklyn Bridge", .025, .255, .38, function(c,p){
      block(c,p,0,-21,100,5); block(c,p,20,-88,14,88); block(c,p,69,-88,14,88);
      path(c,p,[[18,-88],[36,-88],[33,-100],[21,-100]]); path(c,p,[[67,-88],[85,-88],[82,-100],[70,-100]]);
      arch(c,p,22.7,-25,3.9,46); arch(c,p,28,-25,3.9,46); arch(c,p,71.7,-25,3.9,46); arch(c,p,77,-25,3.9,46);
      c.beginPath(); c.moveTo(-10,-30); c.quadraticCurveTo(12,-41,27,-93); c.quadraticCurveTo(51,-22,76,-93); c.quadraticCurveTo(91,-45,110,-30); c.strokeStyle=p.accent; c.lineWidth=.8; c.stroke();
      for(var i=0;i<15;i++){var x=2+i*6.8; var tower=x<51?27:76; line(c,[[tower,-92],[x,-22]],p.dim,.45);}
      for(var j=0;j<17;j++) line(c,[[j*6,-21],[j*6,-16]],p.edge,.45);
    }),
    landmark("One World Trade Center", .345, .068, .98, function(c,p){
      path(c,p,[[3,0],[14,-27],[8,-85],[36,-92],[65,-92],[92,-85],[85,-27],[97,0]]);
      path(c,p,[[14,-27],[49,-92],[85,-27],[97,0],[3,0]],p.dim,p.edge);
      line(c,[[49,-100],[49,-92]],p.accent,1.5); line(c,[[49,-91],[49,-2]],p.accent,.7);
      for(var j=0;j<23;j++) line(c,[[14,-84+j*3.6],[86,-84+j*3.6]],j%5===0?p.accent:p.edge,.45);
      line(c,[[8,-85],[49,-40],[92,-85]],p.accent,.65);
    }),
    landmark("Empire State Building", .555, .075, .86, function(c,p){
      path(c,p,[[1,0],[1,-40],[12,-40],[12,-63],[25,-63],[25,-79],[37,-79],[37,-88],[44,-88],[44,-96],[56,-96],[56,-88],[63,-88],[63,-79],[75,-79],[75,-63],[88,-63],[88,-40],[99,-40],[99,0]]);
      line(c,[[50,-100],[50,-96]],p.accent,1.6); windows(c,p,5,-37,90,35,11,13,6);
      windows(c,p,16,-60,68,20,9,7,2); windows(c,p,29,-76,42,12,6,4,8);
      ribs(c,p,27,-77,46,77,7); line(c,[[37,-86],[63,-86]],p.accent,1.2);
      block(c,p,44,-95,12,7,p.accent);
    }),
    landmark("Chrysler Building", .755, .07, .72, function(c,p){
      path(c,p,[[5,0],[5,-47],[18,-47],[18,-64],[27,-64],[27,-76],[36,-76],[36,-87],[45,-94],[50,-100],[55,-94],[64,-87],[64,-76],[73,-76],[73,-64],[82,-64],[82,-47],[95,-47],[95,0]]);
      for(var j=0;j<4;j++) { var y=-85+j*8, w=9+j*8; c.beginPath();c.moveTo(50-w,y+7);c.quadraticCurveTo(50,y-9,50+w,y+7);c.strokeStyle=p.accent;c.stroke(); }
      windows(c,p,11,-44,78,42,10,15,4); windows(c,p,24,-62,52,15,7,5,1);
      line(c,[[20,-64],[10,-61],[20,-58]],p.accent,1); line(c,[[80,-64],[90,-61],[80,-58]],p.accent,1);
    })
  ];

  cities.nj = [
    landmark("Hoboken Terminal", .055, .235, .49, function(c,p){
      block(c,p,0,-31,100,31); path(c,p,[[1,-31],[9,-44],[91,-44],[99,-31]]);
      block(c,p,42,-81,16,81); block(c,p,39,-86,22,5); path(c,p,[[39,-86],[50,-100],[61,-86]]);
      clock(c,p,50,-74,5); line(c,[[45,-88],[55,-88]],p.accent);
      for(var i=0;i<10;i++) arch(c,p,3+i*9.6,-2,6,25);
      line(c,[[5,-35],[95,-35]],p.accent); windows(c,p,44,-65,12,27,2,4,1);
    }),
    landmark("30 Hudson Street", .405, .085, .96, function(c,p){
      path(c,p,[[6,0],[6,-72],[13,-72],[13,-85],[26,-85],[26,-94],[39,-100],[61,-100],[74,-94],[74,-85],[87,-85],[87,-72],[94,-72],[94,0]]);
      windows(c,p,12,-70,76,67,9,24,2); ribs(c,p,10,-71,80,71,10);
      line(c,[[26,-86],[74,-86]],p.accent); line(c,[[39,-99],[61,-99]],p.window);
    }),
    landmark("99 Hudson", .59, .072, .87, function(c,p){
      path(c,p,[[6,0],[6,-80],[17,-80],[17,-91],[29,-91],[29,-100],[72,-100],[72,-90],[84,-90],[84,-80],[94,-80],[94,0]]);
      windows(c,p,12,-77,76,74,10,29,3); ribs(c,p,11,-79,78,79,7);
      line(c,[[29,-99],[72,-99]],p.accent); line(c,[[17,-90],[84,-90]],p.accent);
    }),
    landmark("Colgate Clock", .80, .081, .36, function(c,p){
      var pts=[];for(var i=0;i<8;i++){var a=-Math.PI/8+i*Math.PI/4;pts.push([50+43*Math.cos(a),-55+43*Math.sin(a)]);}path(c,p,pts);
      clock(c,p,50,-55,37); line(c,[[24,-15],[16,0]],p.edge,2); line(c,[[76,-15],[84,0]],p.edge,2);
      line(c,[[11,-6],[89,-6]],p.dim); block(c,p,25,-8,50,8);
      c.font="600 7px system-ui";c.textAlign="center";c.fillStyle=p.accent;c.fillText("COLGATE",50,-6);
    })
  ];

  cities.boston = [
    landmark("Longfellow Bridge", .035, .255, .32, function(c,p){
      block(c,p,0,-30,100,7); for(var i=0;i<6;i++) arch(c,p,2+i*16.2,-1,13,22);
      [23,66].forEach(function(x){block(c,p,x,-76,11,49);dome(c,p,x-2,-76,15,23);block(c,p,x+3,-96,5,5);line(c,[[x+5.5,-99],[x+5.5,-96]],p.accent);});
      line(c,[[0,-34],[100,-34]],p.accent);for(var j=0;j<25;j++)line(c,[[j*4,-39],[j*4,-34]],p.dim,.4);
    }),
    landmark("Custom House Tower", .365, .085, .65, function(c,p){
      block(c,p,7,-37,86,37);block(c,p,28,-70,44,70);block(c,p,35,-85,30,15);
      path(c,p,[[31,-85],[50,-100],[69,-85]]);clock(c,p,50,-76,9);
      for(var i=0;i<6;i++)block(c,p,11+i*14,-32,4,29,p.accent);
      windows(c,p,33,-66,34,28,4,7,1);line(c,[[27,-69],[73,-69]],p.accent);
      line(c,[[10,-37],[50,-48],[90,-37]],p.edge);
    }),
    landmark("200 Clarendon", .565, .105, .94, function(c,p){
      path(c,p,[[4,0],[4,-95],[72,-100],[96,-90],[96,0]]);
      path(c,p,[[72,-100],[96,-90],[96,0],[72,0]],p.dim);
      for(var j=0;j<33;j++)line(c,[[7,-92+j*2.8],[70,-97+j*2.8]],j%6===0?p.edge:p.dim,.45);
      ribs(c,p,7,-92,63,92,11);line(c,[[72,-99],[72,0]],p.accent,1);
      windows(c,p,12,-89,54,86,9,28,5);
    }),
    landmark("Prudential Tower", .795, .085, .86, function(c,p){
      block(c,p,8,-89,84,89);block(c,p,18,-98,64,9);line(c,[[50,-100],[50,-98]],p.accent,1.2);
      windows(c,p,14,-84,72,81,9,29,2);ribs(c,p,12,-87,76,87,9);
      block(c,p,14,-88,72,4,p.accent);line(c,[[18,-96],[82,-96]],p.window);
    })
  ];

  cities.chicago = [
    landmark("Marina City", .085, .14, .52, function(c,p){
      [4,56].forEach(function(x){
        path(c,p,[[x,0],[x,-85],[x+5,-95],[x+20,-100],[x+35,-95],[x+40,-85],[x+40,0]]);
        for(var j=0;j<19;j++){var y=-90+j*4.6;c.beginPath();c.moveTo(x-2,y);c.quadraticCurveTo(x+20,y+5,x+42,y);c.strokeStyle=j%4===0?p.accent:p.edge;c.stroke();}
        for(var i=0;i<5;i++)line(c,[[x+4+i*8,-91],[x+4+i*8,0]],p.dim,.45);
        windows(c,p,x+5,-83,30,80,4,18,2);
      });
    }),
    landmark("Willis Tower", .355, .105, .96, function(c,p){
      path(c,p,[[0,0],[0,-50],[15,-50],[15,-73],[29,-73],[29,-91],[69,-91],[69,-75],[84,-75],[84,-55],[100,-55],[100,0]]);
      line(c,[[35,-100],[35,-91]],p.accent,1.1);line(c,[[62,-100],[62,-91]],p.accent,1.1);
      [14,28,42,56,70,84].forEach(function(x){line(c,[[x,-(x<28?48:x>70?53:x>56?73:89)],[x,0]],p.accent,.6);});
      windows(c,p,4,-48,92,46,12,19,4);windows(c,p,20,-70,59,20,8,8,2);windows(c,p,33,-88,32,16,5,6,1);
      line(c,[[29,-91],[69,-91]],p.window);
    }),
    landmark("Tribune Tower", .62, .085, .66, function(c,p){
      path(c,p,[[5,0],[5,-55],[14,-55],[14,-74],[23,-74],[23,-88],[31,-88],[31,-95],[41,-95],[50,-100],[59,-95],[69,-95],[69,-88],[77,-88],[77,-74],[86,-74],[86,-55],[95,-55],[95,0]]);
      windows(c,p,11,-51,78,49,9,14,5);windows(c,p,28,-86,44,29,6,9,2);
      for(var i=0;i<7;i++)line(c,[[23+i*9,-87],[10+i*13,-60]],p.accent,.65);
      line(c,[[23,-74],[77,-74]],p.accent);line(c,[[31,-94],[69,-94]],p.window);
    }),
    landmark("875 North Michigan Avenue", .815, .09, .84, function(c,p){
      path(c,p,[[2,0],[18,-91],[82,-91],[98,0]]);line(c,[[26,-100],[26,-91]],p.accent,1.3);line(c,[[73,-100],[73,-91]],p.accent,1.3);
      windows(c,p,22,-87,56,82,8,27,3);
      for(var j=0;j<4;j++){var top=-88+j*22;line(c,[[18-j*4,top],[86+j*4,top+22]],p.accent,1);line(c,[[82+j*4,top],[14-j*4,top+22]],p.accent,1);}
      line(c,[[18,-90],[82,-90]],p.window);
    })
  ];

  cities.la = [
    landmark("Griffith Observatory", .035, .245, .38, function(c,p){
      block(c,p,0,-36,100,36);block(c,p,34,-48,32,48);dome(c,p,30,-48,40,52);
      block(c,p,4,-42,21,6);dome(c,p,1,-42,27,35);block(c,p,75,-42,21,6);dome(c,p,72,-42,27,35);
      for(var i=0;i<6;i++)block(c,p,37+i*4.6,-43,1.3,38,p.accent);
      windows(c,p,4,-31,25,25,5,3,2);windows(c,p,71,-31,25,25,5,3,2);
      block(c,p,29,-4,42,4);line(c,[[3,-35],[97,-35]],p.accent);line(c,[[42,-88],[58,-88]],p.accent);
    }),
    landmark("U.S. Bank Tower", .43, .09, .79, function(c,p){
      path(c,p,[[5,0],[5,-68],[13,-68],[13,-80],[22,-80],[22,-89],[33,-89],[33,-97],[42,-100],[58,-100],[67,-97],[67,-89],[78,-89],[78,-80],[87,-80],[87,-68],[95,-68],[95,0]]);
      windows(c,p,11,-65,78,63,10,22,2);windows(c,p,27,-87,46,20,6,6,1);ribs(c,p,10,-66,80,66,10);
      for(var i=0;i<4;i++)line(c,[[22+i*5,-88-i*3],[78-i*5,-88-i*3]],p.accent,.8);
    }),
    landmark("Wilshire Grand Center", .655, .095, .98, function(c,p){
      path(c,p,[[3,0],[3,-72],[16,-80],[43,-88],[73,-89],[94,-82],[94,0]]);
      c.beginPath();c.moveTo(16,-80);c.bezierCurveTo(20,-94,67,-96,86,-85);c.strokeStyle=p.accent;c.lineWidth=1.2;c.stroke();
      line(c,[[73,-100],[73,-89]],p.accent,1.2);windows(c,p,10,-70,77,67,10,24,5);
      ribs(c,p,11,-72,74,72,11);line(c,[[44,-87],[44,-2]],p.accent,.65);
    }),
    landmark("Los Angeles palms", .84, .12, .48, function(c,p){
      function palm(x,y,lean,s){
        c.save();c.translate(x,y);c.scale(s,s);
        c.beginPath();c.moveTo(1,0);c.quadraticCurveTo(lean*.4,-38,lean,-78);c.lineTo(lean+3,-78);c.quadraticCurveTo(lean*.4+3,-38,5,0);c.fillStyle=p.body;c.fill();
        for(var i=0;i<9;i++){var a=(i/8)*Math.PI*1.45-Math.PI*.2;var dx=Math.cos(a)*29,dy=Math.sin(a)*18;c.beginPath();c.moveTo(lean+1,-78);c.quadraticCurveTo(lean+dx*.75,-90+dy*.3,lean+dx,-78+dy);c.strokeStyle=i%3===0?p.accent:p.edge;c.lineWidth=1.4;c.stroke();}
        c.restore();
      }
      palm(27,0,9,1.1);palm(76,0,-6,.83);line(c,[[0,-1],[100,-1]],p.dim);
    })
  ];

  cities.sf = [
    landmark("Golden Gate Bridge", .015, .315, .52, function(c,p){
      block(c,p,0,-24,100,4);[22,74].forEach(function(x){block(c,p,x,-95,2.4,95);block(c,p,x+7,-95,2.4,95);block(c,p,x-1,-99,11.5,4);[-86,-66,-42].forEach(function(y){block(c,p,x+2,y,5,3,p.accent);});});
      c.beginPath();c.moveTo(-8,-35);c.quadraticCurveTo(12,-45,26.7,-97);c.quadraticCurveTo(51,-23,78.7,-97);c.quadraticCurveTo(94,-47,109,-35);c.strokeStyle=p.accent;c.lineWidth=.85;c.stroke();
      for(var i=0;i<34;i++){var x=i*3;var y;if(x<27)y=-35-62*Math.pow(x/27,2);else if(x<79)y=-97+74*(1-Math.pow((x-53)/26,2));else y=-97+62*Math.pow((x-79)/27,.65);line(c,[[x,y],[x,-24]],p.edge,.42);}
      for(var j=0;j<25;j++)line(c,[[j*4,-20],[j*4+3,-24]],p.dim,.45);
    }),
    landmark("Transamerica Pyramid", .415, .09, .88, function(c,p){
      path(c,p,[[4,0],[40,-81],[49,-100],[58,-81],[96,0]]);
      path(c,p,[[49,-100],[58,-81],[96,0],[51,0]],p.dim,p.edge);
      block(c,p,14,-48,9,27);block(c,p,77,-48,9,27);
      for(var j=0;j<22;j++){var y=-79+j*3.5,half=(y+100)*.46;line(c,[[50-half,y],[50+half,y]],j%5===0?p.accent:p.edge,.45);}
      line(c,[[49,-98],[49,-1]],p.accent,.7);
    }),
    landmark("Salesforce Tower", .645, .10, .98, function(c,p){
      c.beginPath();c.moveTo(7,0);c.lineTo(9,-67);c.bezierCurveTo(10,-91,29,-100,50,-100);c.bezierCurveTo(72,-100,90,-91,91,-67);c.lineTo(93,0);c.closePath();c.fillStyle=p.body;c.fill();c.strokeStyle=p.edge;c.stroke();
      for(var j=0;j<29;j++){var y=-88+j*3,indent=Math.max(0,(-y-67)*.46);line(c,[[11+indent,y],[89-indent,y]],j<5?p.accent:p.dim,.55);}
      windows(c,p,16,-65,68,62,10,22,4);ribs(c,p,16,-68,68,68,10);
      c.beginPath();c.ellipse(50,-91,22,6,0,0,Math.PI*2);c.strokeStyle=p.accent;c.stroke();
    }),
    landmark("Coit Tower", .845, .055, .48, function(c,p){
      path(c,p,[[19,0],[25,-88],[19,-88],[19,-96],[32,-100],[68,-100],[81,-96],[81,-88],[75,-88],[81,0]]);
      for(var i=0;i<5;i++)arch(c,p,28+i*9,-77,5.5,16);
      ribs(c,p,29,-74,42,72,6);line(c,[[21,-92],[79,-92]],p.accent);line(c,[[19,-5],[81,-5]],p.edge);
    })
  ];
}());
