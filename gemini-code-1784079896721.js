// Define standard Metro line colors
const LINE_COLORS = {
    'RD': '#e60000', // Red
    'OR': '#dc4405', // Orange
    'BL': '#0072ce', // Blue
    'GR': '#00b050', // Green
    'YL': '#ffd100', // Yellow
    'SV': '#a0a2a0'  // Silver
};

// Fetch all station coordinates and draw lines connecting them
async function drawTrainRoutes(map, apiKey) {
    try {
        const response = await fetch('https://api.wmata.com/Rail.svc/json/jStations', {
            headers: { 'api_key': apiKey }
        });
        const data = await response.json();
        
        // Group stations by Line
        const lines = {};
        data.Stations.forEach(station => {
            ['LineCode1', 'LineCode2', 'LineCode3', 'LineCode4'].forEach(key => {
                const lineCode = station[key];
                if (lineCode) {
                    if (!lines[lineCode]) lines[lineCode] = [];
                    lines[lineCode].push(station);
                }
            });
        });

        // Draw the polylines on your Leaflet map
        for (const [lineCode, stations] of Object.entries(lines)) {
            // Sort stations geographically (or by their sequence order)
            // Note: For perfect sequence, you'd use WMATA's jPath API, 
            // but a basic sorted line or pre-loaded GeoJSON works best.
            const latLngs = stations.map(s => [s.Lat, s.Lon]);
            
            L.polyline(latLngs, {
                color: LINE_COLORS[lineCode] || '#333',
                weight: 4,
                opacity: 0.8
            }).addTo(map);
        }
    } catch (error) {
        console.error('Error drawing lines:', error);
    }
}