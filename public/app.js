import { signInWithCustomToken, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getToken } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

const BACKEND_URL = 'https://range30.onrender.com';
const auth = window.firebaseAuth;
const messaging = window.firebaseMessaging;
const stripe = Stripe('pk_live_Dg82e49VRbGtBVT8Y9gF4v6d'); // Replace with your Stripe publishable key

// DOM elements
const getStartedBtn = document.getElementById('get-started');
const subscriptionsSection = document.getElementById('subscriptions');
const plannerSection = document.getElementById('planner');
const referralsSection = document.getElementById('referrals');
const loginSection = document.getElementById('login');
const registerSection = document.getElementById('register');
const authNav = document.getElementById('auth-nav');
const subscriptionsList = document.getElementById('subscriptions-list');
const tripPlannerForm = document.getElementById('trip-planner-form');
const tripResult = document.getElementById('trip-result');
const referralForm = document.getElementById('referral-form');
const referralsList = document.getElementById('referrals-list');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loading = document.getElementById('loading');

// Navigation
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionId = e.target.getAttribute('href').slice(1);
    showSection(sectionId);
  });
});

function showSection(sectionId) {
  [subscriptionsSection, plannerSection, referralsSection, loginSection, registerSection].forEach(section => {
    section.style.display = section.id === sectionId ? 'block' : 'none';
  });
}

// Authentication state
if (!auth) {
  console.error('Firebase Auth not initialized');
  document.getElementById('loading').innerText = 'Authentication service unavailable';
  document.getElementById('loading').style.display = 'block';
} else {
  onAuthStateChanged(auth, user => {
    if (user) {
      authNav.innerHTML = `<a href="#logout">Logout</a>`;
      authNav.querySelector('a').addEventListener('click', () => {
        signOut(auth).catch(error => console.error('Sign out error:', error));
      });
      fetchSubscriptions();
      fetchReferrals();
      showSection('subscriptions');
    } else {
      authNav.innerHTML = `<a href="#login">Login</a>`;
      showSection('login');
    }
  });
}

// Fetch subscriptions
async function fetchSubscriptions() {
  loading.style.display = 'block';
  try {
    const response = await fetch(`${BACKEND_URL}/api/subscriptions`);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const subscriptions = await response.json();
    if (!subscriptions || subscriptions.length === 0) {
      subscriptionsList.innerHTML = '<p>No subscriptions available</p>';
      return;
    }
    subscriptionsList.innerHTML = subscriptions.map(sub => `
      <div class="subscription-card">
        <h3>${sub.name}</h3>
        <p>£${sub.price}/month</p>
        <ul>${sub.features.map(f => `<li>${f}</li>`).join('')}</ul>
        <button onclick="subscribe('${sub._id}')">Subscribe</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    subscriptionsList.innerHTML = '<p>Error loading subscriptions: ${error.message}</p>';
  }
  loading.style.display = 'none';
}

// Subscribe with Stripe
async function subscribe(subscriptionId) {
  if (!auth.currentUser) {
    alert('Please log in to subscribe');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const user = auth.currentUser;
    const token = await user.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ subscriptionId, userId: user.uid })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const { sessionId } = await response.json();
    await stripe.redirectToCheckout({ sessionId });
  } catch (error) {
    console.error('Subscription error:', error);
    alert('Error processing subscription: ' + error.message);
  }
  loading.style.display = 'none';
}

// Trip planner
tripPlannerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!auth.currentUser) {
    alert('Please log in to plan a trip');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const user = auth.currentUser;
    const token = await user.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/ai-trip-planner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        destination: document.getElementById('destination').value,
        dates: document.getElementById('dates').value,
        preferences: document.getElementById('preferences').value,
        budget: parseFloat(document.getElementById('budget').value),
        allowTopUp: document.getElementById('allow-topup').checked,
        language: 'en'
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const trip = await response.json();
    tripResult.innerHTML = `
      <h3>Trip to ${trip.destination}</h3>
      <p>Cost: £${trip.cost}</p>
      <p>Activities: ${trip.activities.join(', ')}</p>
      <p>Hotels: ${trip.hotels.join(', ')}</p>
      <p>Flights: ${trip.flights.join(', ')}</p>
      <p>Carbon Footprint: ${trip.carbonFootprint} kg</p>
      ${trip.topUpRequired ? `<p>Top-Up Required: £${trip.topUpAmount}</p><button onclick="topUp(${trip.topUpAmount}, '${user.uid}')">Top Up</button>` : ''}
    `;
  } catch (error) {
    console.error('Trip planner error:', error);
    tripResult.innerHTML = `<p>Error planning trip: ${error.message}</p>`;
  }
  loading.style.display = 'none';
});

// Top-up with Stripe
async function topUp(amount, userId) {
  if (!auth.currentUser) {
    alert('Please log in to top up');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/create-topup-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amount, userId })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const { sessionId } = await response.json();
    await stripe.redirectToCheckout({ sessionId });
  } catch (error) {
    console.error('Top-up error:', error);
    alert('Error processing top-up: ' + error.message);
  }
  loading.style.display = 'none';
}

// Referrals
referralForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!auth.currentUser) {
    alert('Please log in to submit a referral');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const user = auth.currentUser;
    const token = await user.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ email: document.getElementById('referral-email').value })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    await response.json();
    fetchReferrals();
  } catch (error) {
    console.error('Referral error:', error);
    referralsList.innerHTML = `<p>Error submitting referral: ${error.message}</p>`;
  }
  loading.style.display = 'none';
});

async function fetchReferrals() {
  if (!auth.currentUser) {
    referralsList.innerHTML = '<p>Please log in to view referrals</p>';
    return;
  }
  loading.style.display = 'block';
  try {
    const user = auth.currentUser;
    const token = await user.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/referrals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const referrals = await response.json();
    referralsList.innerHTML = referrals.length
      ? referrals.map(r => `<p>Referred ${r.email} - Reward: £${r.reward}</p>`).join('')
      : '<p>No referrals yet</p>';
  } catch (error) {
    console.error('Error fetching referrals:', error);
    referralsList.innerHTML = `<p>Error loading referrals: ${error.message}</p>`;
  }
  loading.style.display = 'none';
}

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!auth) {
    alert('Authentication service unavailable');
    return;
  }
  loading.style.display = 'block';
  try {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const response = await fetch(`${BACKEND_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const { token } = await response.json();
    await signInWithCustomToken(auth, token);
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed: ' + error.message);
  }
  loading.style.display = 'none';
});

// Register
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!auth) {
    alert('Authentication service unavailable');
    return;
  }
  loading.style.display = 'block';
  try {
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const response = await fetch(`${BACKEND_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const { token } = await response.json();
    await signInWithCustomToken(auth, token);
  } catch (error) {
    console.error('Register error:', error);
    alert('Registration failed: ' + error.message);
  }
  loading.style.display = 'none';
});

// Get Started button
getStartedBtn.addEventListener('click', () => {
  showSection(auth?.currentUser ? 'subscriptions' : 'login');
});

// Request notification permission
if (messaging) {
  try {
    await messaging.requestPermission();
    const token = await getToken(messaging, { vapidKey: window.vapidKey });
    await fetch(`${BACKEND_URL}/api/save-notification-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await auth?.currentUser?.getIdToken()}` },
      body: JSON.stringify({ token, userId: auth?.currentUser?.uid })
    });
  } catch (error) {
    console.error('Notification permission error:', error);
  }
}