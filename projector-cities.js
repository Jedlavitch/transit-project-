/* City identity for projector scenes. Artwork is an illustrative panorama;
   astronomy and aircraft use the observer coordinates, independently. */
(function(root){
  'use strict';
  const cities = [
    {id:'dc',name:'Washington, DC',short:'DC',region:'United States',lat:38.8895,lon:-77.0353,tz:'America/New_York',board:'dc.html',accent:'#93b5e6',water:'Potomac River',style:'civic',terrain:'flat',description:'Monuments in moonlight',district:'The Mall · Capitol Hill · Potomac',station:'Metro Center',routes:[['RD','Shady Grove','#bf4266'],['BL','Largo','#56a6cf']]},
    {id:'philly',name:'Philadelphia',short:'PHL',region:'United States',lat:39.9526,lon:-75.1652,tz:'America/New_York',board:'philadelphia.html',accent:'#75c7bc',water:'Schuylkill River',style:'brick',terrain:'flat',description:'A city of spires and glass',district:'Center City · Schuylkill Banks',station:'City Hall',routes:[['B','Fern Rock','#db914d'],['L','69th Street','#6cace4']]},
    {id:'nyc',name:'New York',short:'NYC',region:'United States',lat:40.7128,lon:-74.0060,tz:'America/New_York',board:'nyc.html',accent:'#d1af78',water:'East River',style:'towers',terrain:'flat',description:'The city beyond the river',district:'Lower Manhattan · Midtown · Brooklyn',station:'Times Sq–42 St',routes:[['1','Van Cortlandt Park','#d06a76'],['N','Astoria','#c6ac59']]},
    {id:'nj',name:'New Jersey',short:'NJ',region:'United States',lat:40.7178,lon:-74.0431,tz:'America/New_York',board:'newjersey.html',accent:'#c69b7b',water:'Hudson River',style:'towers',terrain:'flat',description:'Along the Hudson waterfront',district:'Jersey City · Hoboken · Exchange Place',station:'Exchange Place',routes:[['PATH','World Trade Center','#69b297'],['HBLR','Tonnelle Avenue','#c8ad77']]},
    {id:'boston',name:'Boston',short:'BOS',region:'United States',lat:42.3601,lon:-71.0589,tz:'America/New_York',board:'boston.html',accent:'#84b69c',water:'Charles River',style:'brick',terrain:'flat',description:'Old stone, new light',district:'Back Bay · Beacon Hill · Charles River',station:'Park Street',routes:[['Red','Alewife','#bd6471'],['Green','Medford/Tufts','#79ac8a']]},
    {id:'chicago',name:'Chicago',short:'CHI',region:'United States',lat:41.8781,lon:-87.6298,tz:'America/Chicago',board:'chicago.html',accent:'#78adcb',water:'Chicago River',style:'towers',terrain:'flat',description:'Architecture after dark',district:'The Loop · River North · Lakefront',station:'Clark/Lake',routes:[['Blue',"O’Hare",'#69a3d1'],['Brown','Kimball','#b9957b']]},
    {id:'la',name:'Los Angeles',short:'LA',region:'United States',lat:34.0522,lon:-118.2437,tz:'America/Los_Angeles',board:'losangeles.html',accent:'#afa0cd',water:null,style:'modern',terrain:'hills',description:'Downtown under the hills',district:'Downtown · Hollywood Hills · Griffith Park',station:'7th St/Metro Center',routes:[['A','Azusa','#73a2ce'],['E','East LA','#cfb15c']]},
    {id:'sf',name:'San Francisco',short:'SF',region:'United States',lat:37.7749,lon:-122.4194,tz:'America/Los_Angeles',board:'sanfrancisco.html',accent:'#ce9897',water:'San Francisco Bay',style:'victorian',terrain:'hills',description:'Where the hills meet the bay',district:'Golden Gate · Telegraph Hill · Downtown',station:'Embarcadero',routes:[['BART','Richmond','#d4ab65'],['N','Ocean Beach','#7a9fd3']]},
    {id:'amsterdam',name:'Amsterdam',short:'AMS',region:'Netherlands',lat:52.3676,lon:4.9041,tz:'Europe/Amsterdam',board:'amsterdam.html',accent:'#a0b9d3',water:'The canals',style:'canal',terrain:'flat',description:'Gables along the water',district:'Canal Belt · Westerkerk · Centraal',station:'Amsterdam Centraal',routes:[['52','Station Zuid','#80a8d2'],['14','Flevopark','#ce9d73']]},
    {id:'cologne',name:'Cologne',short:'CGN',region:'Germany',lat:50.9375,lon:6.9603,tz:'Europe/Berlin',board:'cologne.html',accent:'#c6aa76',water:'Rhine River',style:'oldtown',terrain:'flat',description:'Twin spires over the Rhine',district:'Altstadt · Dom · Hohenzollernbrücke',station:'Dom/Hbf',routes:[['5','Butzweilerhof','#ba8b9d'],['18','Bonn Hbf','#9ba8ce']]},
    {id:'stuttgart',name:'Stuttgart',short:'STR',region:'Germany',lat:48.7758,lon:9.1829,tz:'Europe/Berlin',board:'stuttgart.html',accent:'#c29595',water:null,style:'oldtown',terrain:'hills',description:'A city held by the hills',district:'Schlossplatz · Hauptbahnhof · Fernsehturm',station:'Hauptbahnhof',routes:[['U5','Killesberg','#b4a6cb'],['S1','Herrenberg','#8aa8cb']]},
    {id:'rome',name:'Rome',short:'ROM',region:'Italy',lat:41.9028,lon:12.4964,tz:'Europe/Rome',board:'rome.html',accent:'#c3a081',water:'Tiber River',style:'roman',terrain:'hills',description:'The layers of an eternal city',district:'Ancient Rome · Vatican · Tiber',station:'Termini',routes:[['A','Battistini','#cba56c'],['B','Laurentina','#77a2cf']]},
    {id:'zurich',name:'Zürich',short:'ZRH',region:'Switzerland',lat:47.3769,lon:8.5417,tz:'Europe/Zurich',board:'zurich.html',accent:'#8bb9ae',water:'Limmat River',style:'oldtown',terrain:'alps',description:'Church towers and distant Alps',district:'Altstadt · Limmat · Lake Zürich',station:'Zürich HB',routes:[['4','Altstetten Nord','#91a9d4'],['S3','Wetzikon','#b8b084']]}
  ];
  const byId = new Map(cities.map(c=>[c.id,c]));
  const aliases = {washington:'dc',philadelphia:'philly',newyork:'nyc',newjersey:'nj',losangeles:'la',sanfrancisco:'sf'};
  const get = id => byId.get(aliases[id]||id) || null;
  const validLocation = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180;
  function nearest(p){
    if(!validLocation(p)) return byId.get('dc');
    return cities.reduce((a,b)=>distance(p,a)<distance(p,b)?a:b);
  }
  function distance(a,b){return Math.hypot(a.lat-b.lat,(a.lon-b.lon)*Math.cos(a.lat*Math.PI/180));}
  root.TBProjectorCities = {all:cities,get,nearest,validLocation};
})(window);
