let trainLayerGroup = L.layerGroup();

async function updateLiveTrains(map, apiKey) {
    try {
        // Fetch current train track circuit positions
        const trainResponse = await fetch('https://api.wmata.com/TrainPositions/TrainPositions?contentType=json', {
            headers: { 'api_key': apiKey }
        });
        const trainData = await trainResponse.json();

        // Fetch station coordinate key-value map
        const stationsResponse = await fetch('https://api.wmata.com/Rail.svc/json/jStations', {
            headers: { 'api_key': apiKey }
        });
        const stationsData = await stationsResponse.json();

        const stationLookup = {};
        stationsData.Stations.forEach(s => {
            stationLookup[s.Code] = { lat: s.Lat, lon: s.Lon, name: s.Name };
        });

        trainLayerGroup.clearLayers();

        trainData.TrainPositions.forEach(train => {
            const station = stationLookup[train.DestinationStationCode];
            if (station) {
                const color = LINE_COLORS[train.LineCode] || '#777';
                const marker = L.marker([station.lat, station.lon], {
                    icon: L.divIcon({
                        className: 'live-train-marker',
                        html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff;"></div>`,
                        iconSize: [12, 12]
                    })
                });

                marker.bindPopup(`
                    <strong>${train.LineCode} Line Train</strong><br>
                    Destination: ${station.name}<br>
                    Cars: ${train.CarCount || 'N/A'}
                `);

                trainLayerGroup.addLayer(marker);
            }
        });

        trainLayerGroup.addTo(map);
    } catch (err) {
        console.error('Error tracking live trains: ', err);
    }
}

// Polling setup for active train positioning (20-second interval)
setInterval(() => updateLiveTrains(map, 'YOUR_WMATA_API_KEY'), 20000);