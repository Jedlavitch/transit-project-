/* City shortcuts — deliberately separate from feed configuration.
   Coordinates point to named transit access points, not aircraft/runway centres.
   Connection notes link to their official source and are not live travel advice;
   the linked operators hold current timetables, disruptions and accessibility.
   Reviewed 2026-11-04. No fares, frequencies or journey times are baked in. */
window.TBCityShortcutsData = {
  dc: {
    name: "Washington, DC",
    tagline: "Three airports. One place to untangle the connections.",
    places: [
      { id: "dca", label: "Reagan National · Metro", lat: 38.8534, lon: -77.0438, kind: "airport",
        note: "Blue and Yellow lines serve DCA; follow the covered walkways to the terminals.",
        source: "https://www.wmata.com/ride/guides/airports-and-train-stations.html" },
      { id: "iad", label: "Dulles · Metro", lat: 38.9547, lon: -77.4482, kind: "airport",
        note: "Silver Line access, with a walk between the station and the main terminal.",
        source: "https://www.wmata.com/ride/guides/airports-and-train-stations.html" },
      { id: "bwi", label: "BWI · Rail station", lat: 39.1923, lon: -76.6949, kind: "airport",
        note: "MARC Penn Line or Amtrak to BWI Rail Station, then the airport terminal shuttle.",
        source: "https://www.wmata.com/ride/guides/airports-and-train-stations.html" },
      { id: "union", label: "Union Station", lat: 38.8974, lon: -77.0063, kind: "station",
        note: "Red Line, Amtrak, MARC and VRE meet here. Check your operator before transferring.",
        source: "https://www.wmata.com/ride/guides/airports-and-train-stations.html" }
    ],
    resources: [
      { label: "Metro service alerts", url: "https://www.wmata.com/ride/alerts-and-advisories.html" },
      { label: "Elevator & escalator status", url: "https://www.wmata.com/ride/elevators-escalators/status.html" },
      { label: "MARC service alerts", url: "https://www.mta.maryland.gov/service-alerts" }
    ]
  },
  philadelphia: {
    name: "Philadelphia",
    tagline: "Airport trains, cross-river trips and the way home after a game.",
    places: [
      { id: "phl", label: "PHL · Terminal C/D rail", lat: 39.87806, lon: -75.24, kind: "airport",
        note: "The Airport Line serves Center City. Choose the correct terminal station for your flight.",
        source: "https://www.phl.org/getting-around/public-transportation" },
      { id: "30th", label: "30th Street Station", lat: 39.9557, lon: -75.1824, kind: "station",
        note: "A connection point for SEPTA Regional Rail, Amtrak and NJ TRANSIT Atlantic City trains.",
        source: "https://www.phl.org/getting-around/public-transportation" },
      { id: "patco", label: "12/13th & Locust · PATCO", lat: 39.94794, lon: -75.16236, kind: "station",
        note: "PATCO for South Jersey; the Broad Street Line is a separate street-level connection.",
        source: "https://www.ridepatco.org/stations/12th.asp" },
      { id: "stadiums", label: "NRG · Stadium district", lat: 39.9053, lon: -75.1739, kind: "event",
        note: "Use the Broad Street Line for the sports complex; check service before the event ends.",
        source: "https://www.ridepatco.org/travel/faqs.html" }
    ],
    resources: [
      { label: "SEPTA alerts & advisories", url: "https://www.septa.org/systemstatus" },
      { label: "SEPTA elevator status", url: "https://www3.septa.org/elevator/m/" },
      { label: "PATCO schedules & changes", url: "https://www.ridepatco.org/schedules/schedules.asp" }
    ]
  },
  nyc: {
    name: "New York City",
    tagline: "Find the airport connection before you head underground.",
    places: [
      { id: "jfk", label: "JFK · Terminal 4 AirTrain", lat: 40.6444, lon: -73.7824, kind: "airport",
        note: "AirTrain connects the terminals with Jamaica and Howard Beach. Confirm your terminal.",
        source: "https://www.jfkairport.com/transportation/airtrain" },
      { id: "lga", label: "LaGuardia · Terminal B", lat: 40.7747, lon: -73.8719, kind: "airport",
        note: "The Q70 links Terminals B/C with Jackson Heights subway connections. Other terminals need their own route.",
        source: "https://www.laguardiaairport.com/transportation/public-transport" },
      { id: "ewr", label: "Newark Airport · Rail link", lat: 40.7044, lon: -74.1907, kind: "airport",
        note: "NJ TRANSIT to Newark Airport Rail Station, then AirTrain to the airport. This is not Newark Penn.",
        source: "https://www.njtransit.com/ewr" },
      { id: "penn", label: "New York Penn Station", lat: 40.7506, lon: -73.9935, kind: "station",
        note: "LIRR, NJ TRANSIT and Amtrak use different concourses; allow time to find your boarding area.",
        source: "https://content.njtransit.com/sites/default/files/pdfs/maps/directories/NY%20Penn%20Station%20Directory_091922.pdf" }
    ],
    resources: [
      { label: "MTA status & trip planner", url: "https://www.mta.info/" },
      { label: "Elevator & escalator status", url: "https://www.mta.info/elevator-escalator-status" },
      { label: "JFK travel advisories", url: "https://www.jfkairport.com/alerts-advisories" }
    ]
  },
  boston: {
    name: "Boston",
    tagline: "Logan connections and the right side of the commuter-rail network.",
    places: [
      { id: "logan", label: "Logan · Airport station", lat: 42.3743, lon: -71.0304, kind: "airport",
        note: "The Blue Line station connects to terminals by Massport shuttle; SL1 serves the terminals from South Station.",
        source: "https://www.massport.com/logan-airport/getting-to-logan/public-transportation" },
      { id: "south", label: "South Station", lat: 42.35227, lon: -71.05524, kind: "station",
        note: "Southern commuter-rail routes, Red Line and Silver Line connections. North Station is a different terminal.",
        source: "https://www.mbta.com/stops/place-sstat" },
      { id: "north", label: "North Station", lat: 42.36558, lon: -71.06129, kind: "station",
        note: "Northern commuter-rail routes and Green/Orange Line connections beside TD Garden.",
        source: "https://www.mbta.com/stops/place-north" }
    ],
    resources: [
      { label: "MBTA service alerts", url: "https://www.mbta.com/alerts" },
      { label: "Accessible travel on the T", url: "https://www.mbta.com/accessibility" },
      { label: "Logan terminal shuttles", url: "https://www.massport.com/logan-airport/getting-to-logan/on-airport-shuttle" }
    ]
  },
  newjersey: {
    name: "New Jersey",
    tagline: "Know which Newark station. Keep a cross-Hudson backup handy.",
    places: [
      { id: "ewr", label: "Newark Airport · Rail link", lat: 40.7044, lon: -74.1907, kind: "airport",
        note: "Change to AirTrain at Newark Airport Rail Station; Newark Penn is a different stop.",
        source: "https://www.njtransit.com/ewr" },
      { id: "newark-penn", label: "Newark Penn Station", lat: 40.734221, lon: -74.164554, kind: "station",
        note: "A rail and PATH connection point. Check both operators when comparing Manhattan routes.",
        source: "https://www.njtransit.com/ewr" },
      { id: "hoboken", label: "Hoboken Terminal", lat: 40.734843, lon: -74.028046, kind: "station",
        note: "Rail, Hudson-Bergen Light Rail, PATH and ferry connections offer different onward journeys.",
        source: "https://www.njtransit.com/station/hoboken-terminal" },
      { id: "secaucus", label: "Secaucus Junction", lat: 40.761188, lon: -74.075821, kind: "station",
        note: "A transfer point for many northern New Jersey rail journeys; check your connecting train and platform.",
        source: "https://www.njtransit.com/station/secaucus-junction-station" }
    ],
    resources: [
      { label: "NJ TRANSIT service status", url: "https://www.njtransit.com/travel-alerts-to" },
      { label: "PATH alerts", url: "https://www.panynj.gov/path/en/alerts.html" },
      { label: "Accessible rail travel", url: "https://www.njtransit.com/accessibility/train-accessibility/" }
    ]
  },
  sanfrancisco: {
    name: "San Francisco Bay Area",
    tagline: "Two airports, plus the BART–Caltrain handoff people miss.",
    places: [
      { id: "sfo", label: "SFO · BART station", lat: 37.61609, lon: -122.39195, kind: "airport",
        note: "BART is at the International Terminal; AirTrain connects the other terminals.",
        source: "https://www.bart.gov/stations/sfia" },
      { id: "oak", label: "OAK · Airport station", lat: 37.71326, lon: -122.21224, kind: "airport",
        note: "The airport connector links OAK with Coliseum BART. Allow for the transfer.",
        source: "https://www.caltrain.com/rider-information/bay-area-airports-caltrain" },
      { id: "sf-caltrain", label: "San Francisco · Caltrain", lat: 37.7764, lon: -122.39491, kind: "station",
        note: "The 4th & King Caltrain terminal is separate from the downtown Market Street BART stations.",
        source: "https://www.caltrain.com/station/sanfrancisco" },
      { id: "millbrae", label: "Millbrae · BART / Caltrain", lat: 37.5999, lon: -122.38675, kind: "station",
        note: "The transfer between Caltrain and BART for SFO. Use each operator's planner to check the connection.",
        source: "https://www.flysfo.com/passengers/ground-transportation/public-transit" }
    ],
    resources: [
      { label: "BART service advisories", url: "https://www.bart.gov/schedules/advisories" },
      { label: "BART elevator status", url: "https://www.bart.gov/stations/elevators" },
      { label: "Caltrain alerts & planner", url: "https://www.caltrain.com/" }
    ]
  },
  losangeles: {
    name: "Los Angeles",
    tagline: "LAX connections without mistaking the train station for the terminal.",
    places: [
      { id: "lax-metro", label: "LAX / Metro Transit Center", lat: 33.9469, lon: -118.378, kind: "airport",
        note: "C and K lines connect here. Check the airport connection guide for the onward terminal shuttle.",
        source: "https://www.metro.net/destinations/lax/" },
      { id: "union", label: "Union Station", lat: 34.0562, lon: -118.2365, kind: "station",
        note: "Metro, regional rail and Amtrak connections; the LAX FlyAway has its own boarding area.",
        source: "https://unionstationla.com/transportation/" },
      { id: "flyaway", label: "Union Station · LAX FlyAway", lat: 34.0559, lon: -118.2334, kind: "airport",
        note: "FlyAway buses serve LAX terminals from Union Station. Check the boarding location and current departures.",
        source: "https://www.metro.net/destinations/lax/" }
    ],
    resources: [
      { label: "Metro service alerts", url: "https://www.metro.net/service/advisories/" },
      { label: "Accessible travel on Metro", url: "https://www.metro.net/riding/accessibility-guide/" },
      { label: "LAX terminal connections", url: "https://www.flylax.com/lax-traffic-and-ground-transportation" }
    ]
  },
  amsterdam: {
    name: "Amsterdam",
    tagline: "Airport trains, mainline connections and the IJ crossing.",
    places: [
      { id: "schiphol", label: "Schiphol Airport", lat: 52.3096, lon: 4.7618, kind: "airport",
        note: "The railway station is beneath Schiphol Plaza; lifts and escalators connect to the terminal.",
        source: "https://www.schiphol.nl/en/sustainability/to-and-from-the-airport/rail-hub-beneath-the-terminal/" },
      { id: "centraal", label: "Amsterdam Centraal", lat: 52.3791, lon: 4.9003, kind: "station",
        note: "Use the station map to find your train platform and the IJ-side ferry exits.",
        source: "https://www.nsinternational.com/nl/download/plattegrond-amsterdam-centraal" },
      { id: "buiksloterweg", label: "Buiksloterweg ferry", lat: 52.3835, lon: 4.902, kind: "station",
        note: "The F3 ferry links Buiksloterweg and Centraal Station across the IJ.",
        source: "https://gvb.nl/en/travel-products/ferry-tickets" }
    ],
    resources: [
      { label: "GVB disruptions & diversions", url: "https://www.gvb.nl/en/travel-information/diversions" },
      { label: "NS travel assistance", url: "https://www.ns.nl/en/travel/traveling-with-a-disability/ns-travel-assistance" },
      { label: "NS journey planner", url: "https://www.ns.nl/en" }
    ]
  },
  zurich: {
    name: "Zurich",
    tagline: "Airport rail, city trams and connections across Switzerland.",
    places: [
      { id: "airport", label: "Zürich Flughafen", lat: 47.4504, lon: 8.5638, kind: "airport",
        note: "The airport connects to the rail, tram and bus networks; check the onward connection before travelling.",
        source: "https://www.flughafen-zuerich.ch/en/passengers/practical/parking-and-transport/train-tram-and-bus" },
      { id: "hb", label: "Zürich HB", lat: 47.3782, lon: 8.5402, kind: "station",
        note: "Check the station plan for the correct level and allow time to change platforms.",
        source: "https://company.sbb.ch/content/dam/infrastruktur/trafimage/bahnhofplaene/plan-zuerich-hb-a4.pdf" },
      { id: "oerlikon", label: "Zürich Oerlikon", lat: 47.4116, lon: 8.544, kind: "station",
        note: "A northern transfer point with rail, tram and bus connections.",
        source: "https://company.sbb.ch/content/dam/infrastruktur/trafimage/bahnhofplaene/plan-zuerich-oerlikon-a4.pdf" }
    ],
    resources: [
      { label: "ZVV journey planner", url: "https://www.zvv.ch/en/timetable-and-information.html" },
      { label: "Accessible connections", url: "https://www.zvv.ch/en/service/travel-without-barriers/connection-search.html" },
      { label: "SBB operations & disruptions", url: "https://www.sbb.ch/en/travel-information/rail-traffic-information/operations-disruptions.expandedheader.html" }
    ]
  },
  cologne: {
    name: "Cologne",
    tagline: "Find the right Rhine-side station and your airport connection.",
    places: [
      { id: "airport", label: "Köln/Bonn Flughafen", lat: 50.8789, lon: 7.1193, kind: "airport",
        note: "The airport railway station is close to both terminals; check the planner for your train or bus.",
        source: "https://www.cologne-bonn-airport.com/en/passengers/transport/train-bus.html" },
      { id: "hbf", label: "Köln Hbf", lat: 50.9431, lon: 6.9587, kind: "station",
        note: "Check the station plan and lift information when changing between rail and local transport.",
        source: "https://www.bahnhof.de/koeln-hbf" },
      { id: "deutz", label: "Köln Messe/Deutz", lat: 50.9409, lon: 6.975, kind: "station",
        note: "Check your ticket: Messe/Deutz and Köln Hbf are separate stations on opposite sides of the Rhine.",
        source: "https://www.bahnhof.de/koeln-messe-deutz" }
    ],
    resources: [
      { label: "KVB service & lift disruptions", url: "https://kvb.koeln/fahrtinfo/betriebslage/index.html" },
      { label: "Step-free travel information", url: "https://www.kvb.cologne/service/barrierefreiheit.html" },
      { label: "DB journey planner", url: "https://www.bahn.de/" }
    ]
  },
  stuttgart: {
    name: "Stuttgart",
    tagline: "Airport connections and useful transfers around the city.",
    places: [
      { id: "airport", label: "Flughafen/Messe", lat: 48.6906, lon: 9.1934, kind: "airport",
        note: "The S-Bahn station is inside the terminal; the U6 stop has a separate walk to the terminals.",
        source: "https://www.stuttgart-airport.com/en/travellers-visitors/arrival-parking/public-transport" },
      { id: "hbf", label: "Stuttgart Hbf", lat: 48.7846, lon: 9.1817, kind: "station",
        note: "Check your platform and walking route before changing trains at the main station.",
        source: "https://www.bahnhof.de/stuttgart-hbf" },
      { id: "vaihingen", label: "Stuttgart-Vaihingen", lat: 48.7261, lon: 9.1131, kind: "station",
        note: "A transfer point south of the centre; check current connections and station access.",
        source: "https://www.bahnhof.de/stuttgart-vaihingen" }
    ],
    resources: [
      { label: "VVS service & lift disruptions", url: "https://www.vvs.de/verbindungen-und-mobilitaet/aktuelle-meldungen" },
      { label: "VVS accessible travel", url: "https://www.vvs.de/service/barrierefreiheit" },
      { label: "VVS journey planner", url: "https://www.vvs.de/" }
    ]
  },
  rome: {
    name: "Rome",
    tagline: "Two airports, three metro lines and the stations that join them.",
    places: [
      { id: "fco", label: "Fiumicino Aeroporto · rail", lat: 41.7936, lon: 12.2517, kind: "airport",
        note: "The rail station adjoins the terminals by covered walkway. The Leonardo Express runs to Termini; the FL1 serves Trastevere, Ostiense and Tiburtina.",
        source: "https://www.adr.it/web/aeroporti-di-roma-en/" },
      { id: "cia", label: "Ciampino Airport · bus", lat: 41.7991, lon: 12.5905, kind: "airport",
        note: "No rail or metro at the terminal: take a bus to Ciampino station or to Anagnina on Metro A.",
        source: "https://www.adr.it/web/aeroporti-di-roma-en/" },
      { id: "termini", label: "Roma Termini", lat: 41.9012, lon: 12.5017, kind: "station",
        note: "Metro A and B cross beneath the station; allow time for the walk from the far platforms.",
        source: "https://www.rfi.it/en/stations.html" },
      { id: "tiburtina", label: "Roma Tiburtina", lat: 41.9108, lon: 12.5307, kind: "station",
        note: "High-speed and regional trains, with Metro B at the Tiburtina F.S. stop.",
        source: "https://www.rfi.it/en/stations.html" },
      { id: "ostiense", label: "Roma Ostiense", lat: 41.8725, lon: 12.4839, kind: "station",
        note: "Connected to Piramide on Metro B; check the walking route between the two.",
        source: "https://www.rfi.it/en/stations.html" }
    ],
    resources: [
      { label: "ATAC service & lift status", url: "https://www.atac.roma.it/en" },
      { label: "Roma Mobilità traffic and transit news", url: "https://romamobilita.it/en/" },
      { label: "Trenitalia journey planner", url: "https://www.trenitalia.com/en.html" }
    ]
  }
};
