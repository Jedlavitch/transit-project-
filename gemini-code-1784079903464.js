let busMarkersGroup = L.layerGroup(); // To easily clear old markers on refresh

async function updateLiveBuses(map, apiKey) {
    try {
        // Fetch all live bus positions
        const response = await fetch('https://api.wmata.com/Bus.svc/json/jBusPositions', {
            headers: { 'api_key': apiKey }
        });
        const data = await response.json();

        // Clear existing markers
        busMarkersGroup.clearLayers();

        data.BusPositions.forEach(bus => {
            // Filter out buses without valid coordinates
            if (bus.Lat && bus.Lon) {
                const marker = L.circleMarker([bus.Lat, bus.Lon], {
                    radius: 5,
                    fillColor: '#FF6F00', // Bus Orange
                    color: '#FFF',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });

                // Create popup with route details
                marker.bindPopup(`
                    <strong>Bus Route: ${bus.RouteID}</strong><br>
                    Destination: ${bus.TripHeadsign || 'Unknown'}<br>
                    Vehicle ID: ${bus.VehicleID}<br>
                    Delay: ${bus.Deviation} mins
                `);

                busMarkersGroup.addLayer(marker);
            }
        });

        busMarkersGroup.addTo(map);
    } catch (error) {
        console.error('Error fetching bus positions:', error);
    }
}

// Auto-refresh every 30 seconds
setInterval(() => updateLiveBuses(map, apiKey), 30000);