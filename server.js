const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const Amadeus = require('amadeus');
const OpenAI = require('openai');
const Stripe = require('stripe');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5001;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB Atlas');
}).catch(error => {
  console.error('MongoDB connection error:', error);
  process.exit(1);
});

// Firebase Admin Initialization
try {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CREDENTIALS))
  });
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
  process.exit(1);
};

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  notificationToken: String
});
const subscriptionSchema = new mongoose.Schema({
  name: String,
  price: Number,
  features: [String]
});
const referralSchema = new mongoose.Schema({
  userId: String,
  email: String,
  reward: Number
});
const tripSchema = new mongoose.Schema({
  userId: String,
  destination: String,
  cost: Number,
  activities: [String],
  hotels: [String],
  flights: [String],
  carbonFootprint: Number,
  topUpRequired: Boolean,
  topUpAmount: Number,
  planType: String,
  priceStatus: String
});

const User = mongoose.model('User', userSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Referral = mongoose.model('Referral', referralSchema);
const Trip = mongoose.model('Trip', tripSchema);

// Authentication Middleware
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Get Amadeus Access Token (for v3 API)
async function getAmadeusAccessToken() {
  try {
    const response = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(process.env.AMADEUS_API_KEY)}&client_secret=${encodeURIComponent(process.env.AMADEUS_API_SECRET)}`
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to get Amadeus token: ${errorData.error_description || response.statusText}`);
    }
    const { access_token } = await response.json();
    return access_token;
  } catch (error) {
    console.error('Amadeus token error:', error.message);
    throw error;
  }
}

// Get city code and nearest airport
async function getCityDetails(cityName, amadeus) {
  try {
    const response = await amadeus.referenceData.locations.get({
      subType: 'CITY',
      keyword: cityName,
      'page[limit]': 1
    });
    if (response.data.length === 0) {
      return null;
    }
    const city = response.data[0];
    // Get airports for the city
    const airportResponse = await amadeus.referenceData.locations.get({
      subType: 'AIRPORT',
      keyword: city.address.cityCode
    });
    const airports = airportResponse.data.map(a => a.iataCode);
    return {
      cityCode: city.address.cityCode,
      cityName: city.name || city.address.cityName,
      country: city.address.countryName || 'Unknown',
      airports: airports.length > 0 ? airports : [city.address.cityCode], // Fallback to city code
      latitude: city.geoCode?.latitude || 0,
      longitude: city.geoCode?.longitude || 0
    };
  } catch (error) {
    console.error('City details error:', error.response?.data || error.message);
    return null;
  }
}

// API Routes

// Firebase Config
app.get('/api/firebase-config', (req, res) => {
  console.log('Serving Firebase config');
  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: 'range30trips.firebaseapp.com',
    projectId: 'range30trips',
    storageBucket: 'range30trips.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    vapidKey: process.env.FIREBASE_VAPID_KEY
  };
  if (!config.apiKey || !config.projectId || !config.appId || !config.vapidKey) {
    console.error('Invalid Firebase config:', config);
    return res.status(500).json({ error: 'Server error: Invalid Firebase configuration' });
  }
  res.json(config);
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRecord = await admin.auth().createUser({ email, password });
    const user = new User({ name, email, password: hashedPassword });
    await user.save();
    console.log('Register: Created user with ID:', userRecord.uid);
    const token = await admin.auth().createCustomToken(userRecord.uid);
    res.json({ token, userId: userRecord.uid });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === 'auth/email-already-exists') {
      res.status(400).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: 'Server error: Failed to register user' });
    }
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log('Login: Generating Firebase token for user ID:', user._id);
    const token = await admin.auth().createCustomToken(user._id.toString());
    res.json({ token, userId: user._id });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error: Failed to login' });
  }
});

// Subscriptions
app.get('/api/subscriptions', async (req, res) => {
  try {
    const subscriptions = await Subscription.find();
    res.json(subscriptions);
  } catch (error) {
    console.error('Subscriptions error:', error);
    res.status(500).json({ error: 'Server error: Failed to fetch subscriptions' });
  }
});

// Create Checkout Session (Stripe)
app.post('/api/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    const { subscriptionId, userId } = req.body;
    if (!subscriptionId || !userId) {
      return res.status(400).json({ error: 'Missing subscriptionId or userId' });
    }
    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: { name: subscription.name },
          unit_amount: subscription.price * 100
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.RENDER_FRONTEND_URL}/#subscriptions`,
      cancel_url: `${process.env.RENDER_FRONTEND_URL}/#subscriptions`,
      metadata: { userId, subscriptionId }
    });
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({ error: 'Server error: Failed to create checkout session' });
  }
});

// Create Top-Up Session (Stripe)
app.post('/api/create-topup-session', authMiddleware, async (req, res) => {
  try {
    const { amount, userId } = req.body;
    if (!amount || !userId) {
      return res.status(400).json({ error: 'Missing amount or userId' });
    }
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: { name: 'Top-Up' },
          unit_amount: amount * 100
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.RENDER_FRONTEND_URL}/#planner`,
      cancel_url: `${process.env.RENDER_FRONTEND_URL}/#planner`,
      metadata: { userId, type: 'topup' }
    });
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Top-up session error:', error);
    res.status(500).json({ error: 'Server error: Failed to create top-up session' });
  }
});

// Referrals
app.post('/api/referrals', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    const referral = new Referral({
      userId: req.user.uid,
      email,
      reward: 10
    });
    await referral.save();
    res.json({ message: 'Referral submitted' });
  } catch (error) {
    console.error('Referral error:', error);
    res.status(500).json({ error: 'Server error: Failed to submit referral' });
  }
});

app.get('/api/referrals', authMiddleware, async (req, res) => {
  try {
    const referrals = await Referral.find({ userId: req.user.uid });
    res.json(referrals);
  } catch (error) {
    console.error('Referrals fetch error:', error);
    res.status(500).json({ error: 'Server error: Failed to fetch referrals' });
  }
});

// Save Notification Token
app.post('/api/save-notification-token', authMiddleware, async (req, res) => {
  try {
    const { token, userId } = req.body;
    if (!token || !userId) {
      return res.status(400).json({ error: 'Missing token or userId' });
    }
    await User.updateOne({ _id: userId }, { notificationToken: token });
    res.json({ message: 'Notification token saved' });
  } catch (error) {
    console.error('Notification token error:', error);
    res.status(500).json({ error: 'Server error: Failed to save notification token' });
  }
});

// City Suggestions
app.get('/api/city-suggestions', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }
    const amadeus = new Amadeus({
      clientId: process.env.AMADEUS_API_KEY,
      clientSecret: process.env.AMADEUS_API_SECRET
    });
    const response = await amadeus.referenceData.locations.get({
      subType: 'CITY',
      keyword: query.toUpperCase(),
      'page[limit]': 10
    });
    const suggestions = response.data.map(city => ({
      cityCode: city.address.cityCode,
      cityName: city.name || city.address.cityName,
      country: city.address.countryName || 'Unknown'
    }));
    res.json(suggestions);
  } catch (error) {
    console.error('City suggestions error:', error.response?.data || error.message);
    res.status(500).json({ error: `Failed to fetch city suggestions: ${error.response?.data?.errors?.[0]?.detail || error.message}` });
  }
});

// Destination Suggestions
app.get('/api/destination-suggestions', async (req, res) => {
  try {
    const amadeus = new Amadeus({
      clientId: process.env.AMADEUS_API_KEY,
      clientSecret: process.env.AMADEUS_API_SECRET
    });
    const originCityDetails = await getCityDetails('Paris', amadeus);
    if (!originCityDetails || !originCityDetails.airports.length) {
      return res.status(400).json({ error: 'Invalid origin city: Paris' });
    }
    const originAirport = originCityDetails.airports[0]; // Use first airport (e.g., CDG)
    const response = await amadeus.shopping.flightDestinations.get({
      origin: originAirport,
      maxPrice: 200
    });
    const suggestions = [];
    for (const dest of response.data) {
      const destCityDetails = await getCityDetails(dest.destination, amadeus);
      suggestions.push({
        cityCode: destCityDetails?.cityCode || dest.destination,
        cityName: destCityDetails?.cityName || dest.destination,
        country: destCityDetails?.country || 'Unknown',
        price: parseFloat(dest.price.total).toFixed(2),
        departureDate: dest.departureDate,
        returnDate: dest.returnDate
      });
    }
    res.json(suggestions);
  } catch (error) {
    console.error('Destination suggestions error:', error.response?.data || error.message);
    res.status(500).json({ error: `Failed to fetch destination suggestions: ${error.response?.data?.errors?.[0]?.detail || error.message}` });
  }
});

// Trip Planner
app.post('/api/ai-trip-planner', authMiddleware, async (req, res) => {
  try {
    const { destination, dates, preferences, budget, allowTopUp, language } = req.body;
    const userId = req.user.uid;

    // Validate input
    if (!destination || !dates || !preferences || !budget) {
      console.error('Missing required fields:', { destination, dates, preferences, budget });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const [startDate, endDate] = dates.split(' to ');
    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      console.error('Invalid date format:', dates);
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD to YYYY-MM-DD' });
    }

    // Validate environment variables
    if (!process.env.AMADEUS_API_KEY || !process.env.AMADEUS_API_SECRET) {
      console.error('Missing Amadeus API credentials');
      return res.status(500).json({ error: 'Server error: Amadeus API credentials not configured' });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OpenAI API key');
      return res.status(500).json({ error: 'Server error: OpenAI API key not configured' });
    }

    // Initialize Amadeus
    const amadeus = new Amadeus({
      clientId: process.env.AMADEUS_API_KEY,
      clientSecret: process.env.AMADEUS_API_SECRET
    });

    // Get city details for destination
    const destCityDetails = await getCityDetails(destination, amadeus);
    if (!destCityDetails || !destCityDetails.cityCode) {
      console.error('Invalid destination city:', destination);
      return res.status(400).json({ error: `Invalid destination city: ${destination}` });
    }
    const cityCode = destCityDetails.cityCode;
    const destAirport = destCityDetails.airports[0]; // Use first airport

    // Get origin city details (Paris)
    const originCityDetails = await getCityDetails('Paris', amadeus);
    if (!originCityDetails || !originCityDetails.airports.length) {
      console.error('Invalid origin city: Paris');
      return res.status(400).json({ error: 'Invalid origin city: Paris' });
    }
    const originAirport = originCityDetails.airports[0]; // e.g., CDG

    // Fetch flight offers (v3 REST API)
    let flightOffers = { data: [] };
    try {
      console.log('Fetching flight offers (v3):', { origin: originAirport, destination: destAirport, startDate, endDate, budget });
      const accessToken = await getAmadeusAccessToken();
      const response = await fetch(`https://test.api.amadeus.com/v3/shopping/flight-offers?originLocationCode=${originAirport}&destinationLocationCode=${destAirport}&departureDate=${startDate}&returnDate=${endDate}&adults=1&maxPrice=${Math.floor(budget * 1.5)}&currencyCode=GBP&max=10`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Flight offers v3 error:', errorData);
        // Fallback to v2
        console.log('Falling back to v2 Flight Offers Search');
        flightOffers = await amadeus.shopping.flightOffersSearch.get({
          originLocationCode: originAirport,
          destinationLocationCode: destAirport,
          departureDate: startDate,
          returnDate: endDate,
          adults: 1,
          maxPrice: Math.floor(budget * 1.5),
          currencyCode: 'GBP',
          max: 10
        });
      } else {
        flightOffers = await response.json();
      }
      if (!flightOffers.data?.length) {
        console.warn('No flight offers found:', { destination: destAirport, startDate, endDate });
      }
    } catch (amadeusError) {
      console.error('Amadeus flight search error:', amadeusError.response?.data || amadeusError.message);
      return res.status(500).json({ error: `Failed to fetch flight data from Amadeus: ${amadeusError.response?.data?.errors?.[0]?.detail || amadeusError.message}` });
    }

    // Verify flight prices
    let priceStatus = 'unknown';
    try {
      const priceAnalysis = await amadeus.analytics.flightPriceAnalysis.get({
        originLocationCode: originAirport,
        destinationLocationCode: destAirport,
        departureDate: startDate,
        returnDate: endDate,
        currencyCode: 'GBP'
      });
      const avgPrice = parseFloat(priceAnalysis.data?.averagePrice || Infinity);
      priceStatus = budget >= avgPrice ? 'reasonable' : 'below_average';
      console.log('Flight price analysis:', { averagePrice: avgPrice, budget, status: priceStatus });
    } catch (error) {
      console.warn('Flight price analysis error:', error.response?.data || error.message);
    }

    // Fetch hotel offers
    let hotelOffers = { data: [] };
    try {
      console.log('Fetching hotel offers:', { cityCode, startDate, endDate });
      hotelOffers = await amadeus.shopping.hotelOffersSearch.get({
        cityCode: cityCode,
        checkInDate: startDate,
        checkOutDate: endDate,
        adults: 1,
        max: 10
      });
      if (!hotelOffers.data?.length) {
        console.warn('No hotel offers found:', { cityCode, startDate, endDate });
      }
    } catch (amadeusError) {
      console.error('Amadeus hotel search error:', amadeusError.response?.data || amadeusError);
      return res.status(500).json({ error: `Failed to fetch hotel data from Amadeus: ${amadeusError.response?.data?.errors?.[0]?.detail || amadeusError.message}` });
    }

    // Fetch points of interest
    let activities = ['Explore local attractions'];
    try {
      const poiResponse = await amadeus.referenceData.locations.pointsOfInterest.get({
        latitude: destCityDetails.latitude,
        longitude: destCityDetails.longitude,
        radius: 10,
        category: preferences.toUpperCase().includes('ADVENTURE') ? 'SIGHTS' : 'RESTAURANT'
      });
      activities = poiResponse.data.slice(0, 5).map(poi => poi.name || 'Unnamed attraction');
      console.log('Points of interest fetched:', activities);
    } catch (error) {
      console.warn('Points of interest error:', error.response?.data || error.message);
    }

    // Generate multiple trip plans
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const plans = [];
    const planTypes = [
      { type: 'budget', budgetFactor: 0.8, maxFlights: 1, maxHotels: 1 },
      { type: 'mid-range', budgetFactor: 1.0, maxFlights: 2, maxHotels: 2 },
      { type: 'luxury', budgetFactor: 1.5, maxFlights: 3, maxHotels: 3 }
    ];

    for (const plan of planTypes) {
      const planBudget = budget * plan.budgetFactor;
      const prompt = `Plan a ${plan.type} trip to ${destCityDetails.cityName} from ${startDate} to ${endDate} with a budget of £${planBudget}. Preferences: ${preferences}. Include activities, hotels, and flights. Return a list of activities starting with "-".`;
      try {
        console.log('Generating trip plan:', { type: plan.type, prompt });
        const completion = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        });

        const filteredFlights = flightOffers.data
          .filter(f => parseFloat(f.price?.total || Infinity) <= planBudget)
          .slice(0, plan.maxFlights);
        const filteredHotels = hotelOffers.data
          .filter(h => parseFloat(h.offers?.[0]?.price?.total || Infinity) <= planBudget)
          .slice(0, plan.maxHotels);

        const cost = calculateTotalCost(filteredFlights, filteredHotels);
        const tripPlan = {
          destination: destCityDetails.cityName,
          cost,
          activities: activities.length > 1 ? activities : completion.choices[0].message.content.split('\n').filter(line => line.startsWith('-')),
          hotels: filteredHotels.length ? filteredHotels.map(h => h.hotel?.name || 'Unknown Hotel') : ['No hotels available'],
          flights: filteredFlights.length ? filteredFlights.map(f => `${f.itineraries[0].segments[0].departure.iataCode}-${f.itineraries[0].segments[0].arrival.iataCode}`) : ['No flights available'],
          carbonFootprint: calculateCarbonFootprint(filteredFlights),
          topUpRequired: allowTopUp && cost > budget,
          topUpAmount: cost > budget ? cost - budget : 0,
          planType: plan.type,
          priceStatus
        };

        await Trip.create({ userId, ...tripPlan });
        plans.push(tripPlan);
      } catch (openaiError) {
        console.error('OpenAI error for plan:', plan.type, openaiError.response?.data || openaiError.message);
        plans.push({ planType: plan.type, error: `Failed to generate ${plan.type} plan: ${openaiError.message}` });
      }
    }

    console.log('Trip plans generated for user:', userId, plans);
    res.json(plans);
  } catch (error) {
    console.error('Trip planner error:', error.message, error.stack);
    res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// Placeholder functions
function calculateTotalCost(flights, hotels) {
  const flightCost = flights.reduce((sum, f) => sum + parseFloat(f.price?.total || 0), 0);
  const hotelCost = hotels.reduce((sum, h) => sum + parseFloat(h.offers?.[0]?.price?.total || 0), 0);
  return (flightCost + hotelCost) || 100;
}

function calculateCarbonFootprint(flights) {
  return flights.reduce((sum, f) => sum + (f.itineraries?.[0]?.segments?.length * 100 || 100), 0);
}

// Catch-all route for frontend
app.get(/^(?!\/api\/).*/, (req, res) => {
  console.log('Serving index.html for non-API route:', req.path);
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).json({ error: 'Error serving frontend' });
    }
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});