const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Stripe = require('stripe');
const Amadeus = require('amadeus');
const OpenAI = require('openai');
const admin = require('firebase-admin');
require('dotenv').config();
const path = require('path');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const amadeus = new Amadeus({
  clientId: process.env.AMADEUS_API_KEY,
  clientSecret: process.env.AMADEUS_API_SECRET
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Firebase Admin with error handling
let firebaseInitialized = false;
try {
  if (!process.env.FIREBASE_CREDENTIALS) {
    throw new Error('FIREBASE_CREDENTIALS environment variable is missing');
  }
  const credentials = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
    throw new Error('Invalid FIREBASE_CREDENTIALS: missing required fields');
  }
  admin.initializeApp({
    credential: admin.credential.cert(credentials)
  });
  firebaseInitialized = true;
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase Admin initialization error:', error.message);
}

// Middleware
app.use(cors({ 
  origin: ['http://localhost:3000', 'http://localhost:5001', 'https://range30.onrender.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "script-src 'self' https://www.gstatic.com https://js.stripe.com; object-src 'none';");
  next();
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Error serving frontend');
    }
  });
});

// Endpoint for Firebase client config with VAPID key
app.get('/api/firebase-config', (req, res) => {
  try {
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: "range30trips.firebaseapp.com",
      projectId: "range30trips",
      storageBucket: "range30trips.firebasestorage.app",
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      vapidKey: process.env.FIREBASE_VAPID_KEY
    };
    if (!firebaseConfig.apiKey || !firebaseConfig.messagingSenderId || !firebaseConfig.appId) {
      throw new Error('Missing Firebase environment variables');
    }
    res.json(firebaseConfig);
  } catch (error) {
    console.error('Error serving Firebase config:', error.message);
    res.status(500).json({ error: 'Failed to load Firebase configuration' });
  }
});

// Catch-all route for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Error serving frontend');
    }
  });
});

// MongoDB Atlas Connection with retry
mongoose.set('strictQuery', true);
const connectToMongoDB = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000
      });
      console.log('Connected to MongoDB Atlas');
      return true;
    } catch (err) {
      console.error(`MongoDB connection attempt failed (${retries} retries left):`, err.message);
      retries -= 1;
      if (retries === 0) {
        console.error('MongoDB connection failed after all retries');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  referralCode: String,
  referrals: [{ email: String, reward: Number, date: { type: Date, default: Date.now } }],
  notificationToken: String
});

const subscriptionSchema = new mongoose.Schema({
  name: String,
  price: Number,
  budget: Number,
  features: [String]
});

const tripSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  destination: String,
  dates: String,
  activities: [String],
  hotels: [String],
  flights: [String],
  carbonFootprint: Number,
  cost: Number,
  topUpRequired: Boolean,
  topUpAmount: Number
});

const User = mongoose.model('User', userSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Trip = mongoose.model('Trip', tripSchema);

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification error:', error.message);
    res.status(403).json({ error: 'Forbidden' });
  }
};

// Routes
app.get('/api/subscriptions', async (req, res) => {
  try {
    const subscriptions = await Subscription.find();
    res.json(subscriptions);
  } catch (error) {
    console.error('Error fetching subscriptions:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!mongoose.connection.readyState) {
      throw new Error('MongoDB not connected');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const user = new User({ name, email, password: hashedPassword, referralCode });
    await user.save();
    const userId = user._id.toString();
    console.log('Register: Created user with ID:', userId);
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    if (!firebaseInitialized) {
      throw new Error('Firebase Admin not initialized');
    }
    const firebaseToken = await admin.auth().createCustomToken(userId);
    res.json({ token: firebaseToken });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(400).json({ error: error.code === 11000 ? 'Email already exists' : 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is missing');
    }
    if (!mongoose.connection.readyState) {
      throw new Error('MongoDB not connected');
    }
    console.log('Login: Querying user with email:', email);
    const user = await User.findOne({ email });
    if (!user) {
      console.log('Login: No user found for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log('Login: User found:', { email: user.email, id: user._id });
    const userId = user._id.toString();
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid user ID: ' + JSON.stringify(user._id));
    }
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.log('Login: Password mismatch for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    if (!firebaseInitialized) {
      throw new Error('Firebase Admin not initialized');
    }
    console.log('Login: Generating Firebase token for user ID:', userId);
    const firebaseToken = await admin.auth().createCustomToken(userId);
    res.json({ token: firebaseToken });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: `Login failed: ${error.message}` });
  }
});

app.get('/api/user', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('subscription');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('User fetch error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/referrals', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user.referrals);
  } catch (error) {
    console.error('Referrals fetch error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/referrals', authenticateToken, async (req, res) => {
  const { email } = req.body;
  try {
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    user.referrals.push({ email, reward: 50 });
    if (firebaseInitialized && user.notificationToken) {
      await admin.messaging().send({
        token: user.notificationToken,
        notification: { title: 'New Referral', body: `You earned £50 for referring ${email}!` }
      });
    }
    await user.save();
    res.json(user.referrals);
  } catch (error) {
    console.error('Referral error:', error.message);
    res.status(500).json({ error: 'Referral error' });
  }
});

app.post('/api/ai-trip-planner', authenticateToken, async (req, res) => {
  const { destination, dates, preferences, budget, allowTopUp, language } = req.body;
  try {
    const flights = await amadeus.shopping.flightOffersSearch.get({
      originLocationCode: 'LON',
      destinationLocationCode: destination.split(',')[0].toUpperCase(),
      departureDate: dates.split(' to ')[0],
      adults: 1
    });
    const flightPrice = flights.data[0]?.price?.total || 1000;
    const prompt = `Plan a trip to ${destination} from ${dates} with preferences: ${preferences}. Budget: £${budget}. Language: ${language}.`;
    const openaiResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }]
    });
    const itinerary = {
      destination,
      activities: openaiResponse.choices[0].message.content.split('\n').slice(0, 3),
      hotels: ['Sample Hotel'],
      flights: [`Flight from LON to ${destination}`],
      carbonFootprint: Math.floor(Math.random() * 1000),
      cost: parseFloat(flightPrice),
      topUpRequired: flightPrice > budget && allowTopUp,
      topUpAmount: flightPrice > budget ? flightPrice - budget : 0
    };
    await Trip.create({ ...itinerary, userId: req.user.id });
    res.json(itinerary);
  } catch (error) {
    console.error('AI trip planner error:', error.message);
    res.status(500).json({ error: 'Failed to plan trip' });
  }
});

app.get('/api/travel-options', authenticateToken, async (req, res) => {
  const { destination } = req.query;
  try {
    const flights = await amadeus.shopping.flightOffersSearch.get({
      originLocationCode: 'LON',
      destinationLocationCode: destination.split(',')[0].toUpperCase(),
      departureDate: '2025-08-01',
      adults: 1
    });
    res.json({
      destination,
      activities: ['Custom Activity 1', 'Custom Activity 2'],
      hotels: ['Custom Hotel'],
      flights: [flights.data[0]?.itineraries[0]?.segments[0]?.departure?.iataCode + ' to ' + flights.data[0]?.itineraries[0]?.segments[0]?.arrival?.iataCode],
      carbonFootprint: Math.floor(Math.random() * 1000)
    });
  } catch (error) {
    console.error('Travel options error:', error.message);
    res.status(500).json({ error: 'Failed to fetch travel options' });
  }
});

app.post('/api/create-checkout-session', authenticateToken, async (req, res) => {
  const { subscriptionId, userId } = req.body;
  try {
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
          unit_amount: Math.round(subscription.price * 100)
        },
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.RENDER_FRONTEND_URL}/#dashboard`,
      cancel_url: `${process.env.RENDER_FRONTEND_URL}/#subscriptions`,
      client_reference_id: userId
    });
    await User.findByIdAndUpdate(userId, { subscription: subscriptionId });
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Checkout error:', error.message);
    res.status(500).json({ error: 'Payment error' });
  }
});

app.post('/api/create-topup-session', authenticateToken, async (req, res) => {
  const { amount, userId } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: { name: 'Trip Top-Up' },
          unit_amount: Math.round(amount * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.RENDER_FRONTEND_URL}/#dashboard`,
      cancel_url: `${process.env.RENDER_FRONTEND_URL}/#planner`,
      client_reference_id: userId
    });
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Top-up error:', error.message);
    res.status(500).json({ error: 'Top-up error' });
  }
});

app.post('/api/save-notification-token', authenticateToken, async (req, res) => {
  const { token, userId } = req.body;
  try {
    await User.findByIdAndUpdate(userId, { notificationToken: token });
    res.json({ message: 'Notification token saved' });
  } catch (error) {
    console.error('Notification token error:', error.message);
    res.status(500).json({ error: 'Notification token error' });
  }
});

// Seed subscriptions
const seedSubscriptions = async () => {
  try {
    const connected = await connectToMongoDB();
    if (!connected) {
      console.error('Skipping seeding due to MongoDB connection failure');
      return;
    }
    const subscriptions = [
      { name: 'Solo Traveler', price: 60, budget: 1000, features: ['1 Trip/Year', '15% Discount', 'Travel Insurance', 'Solo Tours'] },
      { name: 'Couple', price: 100, budget: 2000, features: ['1 Trip/Year', '20% Discount', 'Romantic Activities', 'Travel Insurance'] },
      { name: 'Family', price: 200, budget: 4000, features: ['1 Trip/Year', '25% Discount', 'Family Activities', 'Travel Insurance'] },
      { name: 'Group', price: 29.99, budget: 3000, features: ['1 Trip/Year', '20% Discount', 'Group Activities', 'Travel Insurance'] }
    ];
    await Subscription.deleteMany({});
    await Subscription.insertMany(subscriptions);
    const hashedPassword = await bcrypt.hash('password123', 10);
    await User.deleteMany({});
    const testUser = await User.create({
      name: 'Test User',
      email: 'test@example.com',
      password: hashedPassword,
      referralCode: 'TEST123'
    });
    console.log('Database seeded successfully, test user ID:', testUser._id.toString());
  } catch (error) {
    console.error('Seeding error:', error.message);
  }
};

// Start server only after MongoDB connection attempt
connectToMongoDB().then(connected => {
  if (connected) {
    seedSubscriptions();
  } else {
    console.warn('Starting server without seeding due to MongoDB connection failure');
  }
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});