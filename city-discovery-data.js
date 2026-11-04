/* Curated outings, reviewed against destination/operator/municipal sources
   in November 2026. Coordinates are approximate points for distance sorting;
   directions use named destinations. Hours, prices and live availability
   belong to the linked official pages, not this static catalogue. */
window.TBCityDiscoveryData = {
  philadelphia: {
    edition: "Market stalls, old stories, river air.",
    adventure: { name: "A taste of Old City", note: "Start with the market, then make room for a piece of history.", stops: ["reading", "liberty"] },
    places: [
      { id:"reading", name:"Reading Terminal Market", kind:"food", lat:39.9533, lon:-75.1593, address:"1136 Arch Street, Philadelphia, PA", blurb:"Browse the food stalls of Philadelphia’s historic indoor market.", prompt:"Find a stall you have never tried before.", url:"https://readingterminalmarket.org/" },
      { id:"liberty", name:"Liberty Bell Center", kind:"culture", lat:39.9496, lon:-75.1503, address:"526 Market Street, Philadelphia, PA", blurb:"Meet a familiar symbol in person and explore its story in Old City.", prompt:"Look for the story behind the bell’s famous crack.", url:"https://www.nps.gov/inde/planyourvisit/libertybellcenter.htm" },
      { id:"banks", name:"Schuylkill Banks", kind:"outdoors", lat:39.9522, lon:-75.1808, address:"Schuylkill Banks, Walnut Street, Philadelphia, PA", blurb:"Trade city blocks for the riverside trail and skyline views. Start at the Walnut Street access.", prompt:"Find a river view you would put on a postcard.", url:"https://www.schuylkillbanks.org/find-your-way-schuylkill-banks" }
    ]
  },
  dc: {
    edition: "Big landmarks. Small discoveries.",
    adventure: { name:"Monuments & masterpieces", note:"Pair an iconic memorial with time inside the galleries.", stops:["lincoln","gallery"] },
    places: [
      { id:"lincoln", name:"Lincoln Memorial", kind:"outdoors", lat:38.8893, lon:-77.0502, address:"2 Lincoln Memorial Circle NW, Washington, DC", blurb:"Take in the memorial chamber and the view along the Reflecting Pool.", prompt:"Find a detail beyond the familiar statue.", url:"https://www.nps.gov/linc/planyourvisit/index.htm" },
      { id:"gallery", name:"National Gallery of Art", kind:"culture", lat:38.8913, lon:-77.0200, address:"6th Street and Constitution Avenue NW, Washington, DC", blurb:"Make your own art detour through the National Gallery’s collections.", prompt:"Pick one artwork you would come back to see.", url:"https://www.nga.gov/visit" },
      { id:"union-market", name:"Union Market", kind:"food", lat:38.9080, lon:-76.9976, address:"1309 5th Street NE, Washington, DC", blurb:"Explore the food hall and the surrounding Union Market District.", prompt:"Try a new flavor or browse a new shop.", url:"https://unionmarketdc.com/" }
    ]
  },
  nyc: {
    edition: "An elevated walk and a city full of possibilities.",
    adventure: { name:"West Side wander", note:"Pair the High Line with a browse through Chelsea Market.", stops:["high-line","chelsea"] },
    places: [
      { id:"high-line", name:"The High Line", kind:"outdoors", lat:40.7396, lon:-74.0088, address:"High Line at West 16th Street, New York, NY", blurb:"Explore the planting, art and city views along a former elevated rail line.", prompt:"Notice where the old railway meets the living garden.", url:"https://www.thehighline.org/visit/" },
      { id:"chelsea", name:"Chelsea Market", kind:"food", lat:40.7424, lon:-74.0061, address:"75 9th Avenue, New York, NY", blurb:"Follow your appetite through this neighborhood market’s food and shops.", prompt:"Choose something you have never ordered before.", url:"https://www.chelseamarket.com/" },
      { id:"grand-central", name:"Grand Central Terminal", kind:"culture", lat:40.7527, lon:-73.9772, address:"89 East 42nd Street, New York, NY", blurb:"Make the station itself the destination, from its Main Concourse to the market.", prompt:"Look up before you look at the departure board.", url:"https://grandcentralterminal.com/visit/" }
    ]
  },
  boston: {
    edition:"A little green, a good book, a local bite.",
    adventure:{name:"Books & blooms", note:"Take a park break, then explore the Central Library in Copley Square.", stops:["garden","library"]},
    places:[
      {id:"garden",name:"Boston Public Garden",kind:"outdoors",lat:42.3545,lon:-71.0709,address:"Boston Public Garden, Boston, MA",blurb:"Wander the paths of Boston’s historic botanical garden.",prompt:"Find a quiet spot among the paths and planting.",url:"https://www.boston.gov/parks/public-garden"},
      {id:"library",name:"Central Library · Copley Square",kind:"culture",lat:42.3493,lon:-71.0780,address:"700 Boylston Street, Boston, MA",blurb:"An architectural stop as well as a place for books, right on Copley Square.",prompt:"Find an architectural detail you would usually walk past.",url:"https://www.bpl.org/locations/central/"},
      {id:"public-market",name:"Boston Public Market",kind:"food",lat:42.3619,lon:-71.0574,address:"100 Hanover Street, Boston, MA",blurb:"Browse New England food producers and artisans in an indoor market.",prompt:"Look for something made or grown in New England.",url:"https://bostonpublicmarket.org/"}
    ]
  },
  newjersey: {
    edition:"Waterfront views and discoveries across North Jersey.",
    adventure:{name:"Two sides of the Hudson view",note:"Compare the waterfront at Hoboken with Liberty State Park. Plan each leg before setting off.",stops:["pier-a","liberty-state"]},
    places:[
      {id:"pier-a",name:"Pier A Park",kind:"outdoors",lat:40.7362,lon:-74.0261,address:"100 Sinatra Drive, Hoboken, NJ",blurb:"A waterfront lawn and promenade with views across the Hudson.",prompt:"Find your favorite angle on the Manhattan skyline.",url:"https://hobokennj.gov/location/pier-a-park"},
      {id:"liberty-state",name:"Liberty State Park · CRRNJ Terminal",kind:"outdoors",lat:40.7074,lon:-74.0337,address:"1 Audrey Zapp Drive, Jersey City, NJ",blurb:"Start by the historic rail terminal and explore the park’s waterfront.",prompt:"Spot a trace of the waterfront’s railway past.",url:"https://dep.nj.gov/parksandforests/state-park/liberty-state-park/"},
      {id:"newark-art",name:"The Newark Museum of Art",kind:"culture",lat:40.7431,lon:-74.1716,address:"49 Washington Street, Newark, NJ",blurb:"Make Newark your next stop for art and discovery.",prompt:"Choose an exhibit that takes you somewhere unexpected.",url:"https://newarkmuseumart.org/visit/plan-your-visit/"}
    ]
  },
  sanfrancisco: {
    edition:"Waterfront flavors, curious minds, open space.",
    adventure:{name:"An Embarcadero afternoon",note:"Start with the Ferry Building, then make a discovery at the Exploratorium.",stops:["ferry-building","exploratorium"]},
    places:[
      {id:"ferry-building",name:"Ferry Building Marketplace",kind:"food",lat:37.7955,lon:-122.3937,address:"1 Ferry Building, San Francisco, CA",blurb:"Food, shops and a waterfront landmark at the foot of Market Street.",prompt:"Find a local flavor to remember the city by.",url:"https://www.ferrybuildingmarketplace.com/"},
      {id:"exploratorium",name:"Exploratorium",kind:"culture",lat:37.8008,lon:-122.3980,address:"Pier 15, San Francisco, CA",blurb:"A waterfront museum built around hands-on curiosity.",prompt:"Try an exhibit that changes how you see an everyday thing.",url:"https://www.exploratorium.edu/visit"},
      {id:"golden-gate",name:"Golden Gate Park · Music Concourse",kind:"outdoors",lat:37.7700,lon:-122.4660,address:"Music Concourse, Golden Gate Park, San Francisco, CA",blurb:"Start at the Music Concourse and choose a path through the park.",prompt:"Take a park detour you have not taken before.",url:"https://sfrecpark.org/770/Golden-Gate-Park"}
    ]
  },
  losangeles: {
    edition:"Downtown bites, bold art, a wider view.",
    adventure:{name:"Downtown, with a side of art",note:"Pair Grand Central Market with a visit to The Broad. Check museum tickets before you go.",stops:["market","broad"]},
    places:[
      {id:"market",name:"Grand Central Market",kind:"food",lat:34.0508,lon:-118.2490,address:"317 South Broadway, Los Angeles, CA",blurb:"Explore the cuisines and food stalls of this historic downtown market.",prompt:"Make your next bite something new.",url:"https://grandcentralmarket.com/visit-the-market/"},
      {id:"broad",name:"The Broad",kind:"culture",lat:34.0544,lon:-118.2506,address:"221 South Grand Avenue, Los Angeles, CA",blurb:"Plan a contemporary-art stop on Grand Avenue.",prompt:"Find a work you want to talk about on the ride home.",url:"https://www.thebroad.org/visit"},
      {id:"griffith",name:"Griffith Observatory",kind:"outdoors",lat:34.1184,lon:-118.3004,address:"2800 East Observatory Road, Los Angeles, CA",blurb:"A hillside destination for city views and a closer look at the cosmos.",prompt:"Look out over the city, then look up.",url:"https://griffithobservatory.lacity.gov/visit/"}
    ]
  },
  amsterdam: {
    edition:"Art, a market, and a greener way around.",
    adventure:{name:"Museum to market",note:"Pair the Rijksmuseum with a browse along the Albert Cuypmarkt.",stops:["rijks","cuyp"]},
    places:[
      {id:"rijks",name:"Rijksmuseum",kind:"culture",lat:52.3599,lon:4.8852,address:"Museumstraat 1, Amsterdam, Netherlands",blurb:"Explore Dutch art and history at Museumplein.",prompt:"Pick a detail in an artwork that deserves a second look.",url:"https://www.rijksmuseum.nl/en/visit"},
      {id:"cuyp",name:"Albert Cuypmarkt",kind:"food",lat:52.3550,lon:4.8935,address:"Albert Cuypstraat, Amsterdam, Netherlands",blurb:"Browse the market stalls in the De Pijp neighborhood.",prompt:"Find a Dutch treat you have not tried before.",url:"https://www.iamsterdam.com/uit/agenda/winkelen/markten/albert-cuypmarkt"},
      {id:"vondel",name:"Vondelpark",kind:"outdoors",lat:52.3619,lon:4.8781,address:"Vondelpark entrance at Stadhouderskade, Amsterdam, Netherlands",blurb:"Step away from busy streets and choose a path through the park.",prompt:"Find a small moment of calm in the city.",url:"https://www.iamsterdam.com/en/whats-on/calendar/attractions-and-sights/nature-and-active/vondelpark"}
    ]
  },
  zurich: {
    edition:"Old-town views and fresh perspectives.",
    adventure:{name:"History with a view",note:"Explore the National Museum, then head to Lindenhof for a different perspective.",stops:["national-museum","lindenhof"]},
    places:[
      {id:"lindenhof",name:"Lindenhof",kind:"outdoors",lat:47.3730,lon:8.5412,address:"Lindenhof, Zurich, Switzerland",blurb:"An old-town hilltop with a view across the Limmat.",prompt:"Find a rooftop or landmark to recognize from below later.",url:"https://www.zuerich.com/en/visit/nature/lindenhof"},
      {id:"national-museum",name:"National Museum Zurich",kind:"culture",lat:47.3790,lon:8.5405,address:"Museumstrasse 2, Zurich, Switzerland",blurb:"A stop for Swiss history beside Zurich’s main station.",prompt:"Find a story about Switzerland you did not know.",url:"https://www.landesmuseum.ch/en/your-visit"},
      {id:"viadukt",name:"Markthalle IM VIADUKT",kind:"food",lat:47.3856,lon:8.5189,address:"Limmatstrasse 231, Zurich, Switzerland",blurb:"Browse the market hall in the railway-arch district of Zurich West.",prompt:"Notice how the railway shapes the neighborhood.",url:"https://im-viadukt.ch/en/infos"}
    ]
  },
  cologne: {
    edition:"A cathedral, a river, a little chocolate.",
    adventure:{name:"Cathedral to chocolate",note:"Begin by the cathedral, then make a riverside detour to the Chocolate Museum.",stops:["cathedral","chocolate"]},
    places:[
      {id:"cathedral",name:"Cologne Cathedral",kind:"culture",lat:50.9413,lon:6.9583,address:"Domkloster 4, Cologne, Germany",blurb:"Explore the city’s landmark beside the main station. Check current visitor and ticket arrangements.",prompt:"Choose one detail among the many layers of stonework.",url:"https://www.koelner-dom.de/en"},
      {id:"rheinpark",name:"Rheinpark",kind:"outdoors",lat:50.9504,lon:6.9753,address:"Rheinpark, Auenweg, Cologne, Germany",blurb:"Gardens, paths and a different view of Cologne from the Rhine’s east bank.",prompt:"Find a place where the cathedral appears across the river.",url:"https://www.stadt-koeln.de/leben-in-koeln/freizeit-natur-sport/parks/rheinpark"},
      {id:"chocolate",name:"Chocolate Museum",kind:"culture",lat:50.9310,lon:6.9643,address:"Am Schokoladenmuseum 1a, Cologne, Germany",blurb:"Explore the story and making of chocolate beside the Rhine.",prompt:"Learn something new about the journey from cocoa to chocolate.",url:"https://www.schokoladenmuseum.de/en/"}
    ]
  },
  stuttgart: {
    edition:"Grand squares, good food, beautiful spaces.",
    adventure:{name:"A city-center sampler",note:"Enjoy Schlossplatz, then browse the stalls of the nearby Markthalle.",stops:["schlossplatz","markthalle"]},
    places:[
      {id:"schlossplatz",name:"Schlossplatz",kind:"outdoors",lat:48.7785,lon:9.1800,address:"Schlossplatz, Stuttgart, Germany",blurb:"A green square framed by some of Stuttgart’s best-known buildings.",prompt:"Look around the square and choose your favorite facade.",url:"https://www.stuttgart.de/en/tourismus/sehenswuerdigkeiten/schlossplatz"},
      {id:"library",name:"Stuttgart City Library",kind:"culture",lat:48.7902,lon:9.1827,address:"Mailänder Platz 1, Stuttgart, Germany",blurb:"Make an architecture-and-books stop at the city’s central library.",prompt:"Find a new perspective on the library’s interior.",url:"https://www.stuttgart.de/en/tourismus/sehenswuerdigkeiten/stadtbibliothek"},
      {id:"markthalle",name:"Stuttgart Markthalle",kind:"food",lat:48.7764,lon:9.1795,address:"Dorotheenstrasse 4, Stuttgart, Germany",blurb:"Browse regional and international specialties inside an Art Nouveau market hall.",prompt:"Choose one flavor to take into the rest of your day.",url:"https://www.markthalle-stuttgart.de/en/"}
    ]
  }
};
