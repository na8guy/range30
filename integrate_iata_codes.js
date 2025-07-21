const fs = require('fs');

// Haversine formula to calculate distance between two points in km
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
}

// Parse airports.dat
function parseAirports(fileContent) {
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    return lines.map(line => {
        const fields = line.split(',').map(field => field.replace(/^"|"$/g, '')); // Remove quotes
        return {
            id: fields[0],
            name: fields[1],
            city: fields[2],
            country: fields[3],
            iata: fields[4],
            latitude: parseFloat(fields[6]),
            longitude: parseFloat(fields[7])
        };
    }).filter(airport => airport.iata && airport.iata !== '\\N' && !isNaN(airport.latitude) && !isNaN(airport.longitude));
}

// Read cities.json and airports.dat
const citiesData = JSON.parse(fs.readFileSync('cities.json', 'utf8'));
const airportsData = parseAirports(fs.readFileSync('airports.dat', 'utf8'));

// Update cities with airports
const updatedCities = citiesData.map(city => {
    // Find matching airports by city name or proximity (within 50 km)
    const matchingAirports = airportsData.filter(airport => {
        const cityNameMatch = airport.city.toLowerCase() === city.cityName.toLowerCase();
        const distance = haversineDistance(city.latitude, city.longitude, airport.latitude, airport.longitude);
        const proximityMatch = distance <= 50; // 50 km radius
        return cityNameMatch || proximityMatch;
    });

    let iataCodes = [...new Set(matchingAirports.map(airport => airport.iata))].sort();

    // If no matching airports, find the nearest one
    if (iataCodes.length === 0) {
        let nearestAirport = null;
        let minDistance = Infinity;

        for (const airport of airportsData) {
            const distance = haversineDistance(city.latitude, city.longitude, airport.latitude, airport.longitude);
            if (distance < minDistance) {
                minDistance = distance;
                nearestAirport = airport;
            }
        }

        iataCodes = nearestAirport ? [nearestAirport.iata] : [];
    }

    return {
        ...city,
        airports: iataCodes
    };
});

// Write updated cities to a new file
fs.writeFileSync('updated_cities.json', JSON.stringify(updatedCities, null, 2), 'utf8');
console.log('Updated cities.json has been written to updated_cities.json');