const fs = require('fs').promises;
const path = require('path');

async function preprocessCities(inputFile, outputFile) {
  try {
    // Check if input file exists
    try {
      await fs.access(inputFile);
    } catch (error) {
      throw new Error(`Input file ${inputFile} not found`);
    }

    // Read the input file
    const data = await fs.readFile(inputFile, 'utf8');
    if (!data.trim()) {
      throw new Error('Input file is empty');
    }

    const lines = data.split('\n');
    const cities = [];
    
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      
      const fields = line.split('\t');
      
      // Log first few lines and problematic lines for debugging
      if (index < 3 || index >= 31542) {
        console.log(`Line ${index + 1} fields:`, fields);
      }

      // Ensure line has at least 19 fields (GeoNames format)
      if (fields.length < 19) {
        console.warn(`Skipping line ${index + 1}: Insufficient fields (${fields.length})`);
        continue;
      }

      // Check feature_class (index 6)
      if (fields[6] !== 'P') {
        continue;
      }
      
      try {
        // Map fields according to GeoNames format
        const city = {
          cityName: fields[1], // name
          cityCode: fields[0], // geonameid
          country: fields[8], // country_code
          airports: [], // Placeholder for IATA codes
          latitude: parseFloat(fields[4]), // latitude
          longitude: parseFloat(fields[5]) // longitude
        };
        
        // Validate data
        if (
          city.cityName &&
          city.country &&
          !isNaN(city.latitude) &&
          !isNaN(city.longitude) &&
          city.latitude >= -90 &&
          city.latitude <= 90 &&
          city.longitude >= -180 &&
          city.longitude <= 180
        ) {
          cities.push(city);
        } else {
          console.warn(`Skipping line ${index + 1}: Invalid data`, city);
        }
      } catch (error) {
        console.warn(`Error processing line ${index + 1}: ${line.slice(0, 50)}... - ${error.message}`);
      }
    }
    
    if (cities.length === 0) {
      console.warn('No cities were processed. Check if feature_class=P exists and fields are correctly aligned.');
    }
    
    // Sort cities by name for consistent querying
    cities.sort((a, b) => a.cityName.localeCompare(b.cityName));
    
    // Write to JSON file
    await fs.writeFile(outputFile, JSON.stringify(cities, null, 2), 'utf8');
    
    console.log(`Successfully processed ${cities.length} cities to ${outputFile}`);
    
    // Example MongoDB import command
    console.log('\nTo import into MongoDB, run:');
    console.log(`mongoimport --db yourDatabase --collection cities --file ${outputFile} --jsonArray`);
    
    // Example MongoDB schema (for reference)
    console.log('\nExample MongoDB schema and query:');
    console.log(`
    const mongoose = require('mongoose');
    
    const citySchema = new mongoose.Schema({
      cityName: String,
      cityCode: String,
      country: String,
      airports: [String],
      latitude: Number,
      longitude: Number
    });
    
    const City = mongoose.model('City', citySchema);
    
    // Example autocomplete query
    async function findCities(query) {
      return await City.find({ cityName: { $regex: '^' + query, $options: 'i' } }).limit(20);
    }
    `);
    
    return cities;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    throw error;
  }
}

async function main() {
  const inputFile = 'cities15000.txt';
  const outputFile = 'cities.json';
  
  try {
    await preprocessCities(inputFile, outputFile);
  } catch (error) {
    console.error('Failed to process cities:', error);
    process.exit(1);
  }
}

main();