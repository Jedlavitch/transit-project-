let trainMarkersGroup = L.layerGroup();

async function updateLiveTrains(map, apiKey) {
    try {
        // 1. Fetch live train positions
        const trainPosRes = await fetch('https://api.wmata.com/TrainPositions/TrainPositions?contentType=json', {
            headers: { 'api_key': apiKey }
        });
        const trainPosData = await trainPosRes.json();

        // 2. Fetch station locations to map against
        const stationsRes = await fetch('https://api.wmata.com/Rail.svc/json/jStations', {
            headers: { 'api_key': apiKey }
        });
        const stationsData = await stationsRes.json();

        // Map station codes to their lat/lon coordinates
        const stationCoords = {};
        stationsData.Stations.forEach(s => {
            stationCoords[s.Code] = { lat: s.Lat, lon: s.Lon, name: s.Name };
        });

        trainMarkersGroup.clearLayers();

        trainPosData.TrainPositions.forEach(train => {
            // Find coordinates of the train's destination or nearest station
            // (Standard API maps to CircuitIds, but you can map to CircuitId neighbor stations)
            // As a lightweight fallback: plot them at their Destination/Current station if available
            const targetStation = stationCoords[train.DestinationStationCode];
            
            if (targetStation) {
                const trainMarker = L.marker([targetStation.lat, targetStation.lon], {
                    icon: L.divIcon({
                        className: 'custom-train-icon',
                        html: `<div style="background-color: ${LINE_COLORS[train.LineCode] || '#888'}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>`,
                        iconSize: [14, 14]
                    })
                });

                trainMarker.bindPopup(`
                    <strong>${train.LineCode} Line Train</strong><br>
                    Heading to: ${targetStation.name}<br>
                    Cars: ${train.CarCount}
                `);

                trainMarkersGroup.addLayer(trainMarker);
            }
        });

        trainMarkersGroup.addTo(map);
    } catch (error) {
        console.error('Error updating live trains:', error);
    }
}

// Auto-refresh every 20 seconds (WMATA's train system polls roughly at this speed)
setInterval(() => updateLiveTrains(map, apiKey), 20000);