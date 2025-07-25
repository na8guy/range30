import { signInWithCustomToken, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getToken } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

const BACKEND_URL = 'https://range30.onrender.com';
const stripe = Stripe('pk_live_Dg82e49VRbGtBVT8Y9gF4v6d');

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
const destinationInput = document.getElementById('destination');
const suggestionsContainer = document.createElement('div');
suggestionsContainer.id = 'destination-suggestions';
destinationInput.parentNode.appendChild(suggestionsContainer);

// Navigation
document.querySelectorAll('nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionId = e.target.getAttribute('href').slice(1);
    console.log('Nav clicked, showing section:', sectionId);
    showSection(sectionId);
  });
});

// Handle hash changes
window.addEventListener('hashchange', () => {
  const sectionId = window.location.hash.slice(1) || 'login';
  console.log('Hash changed, showing section:', sectionId);
  showSection(sectionId);
});

// Initialize section
document.addEventListener('DOMContentLoaded', () => {
  const sectionId = window.location.hash.slice(1) || 'login';
  console.log('Page loaded, showing section:', sectionId);
  showSection(sectionId);
});

function showSection(sectionId) {
  console.log('Showing section:', sectionId);
  const sections = {
    subscriptions: subscriptionsSection,
    planner: plannerSection,
    referrals: referralsSection,
    login: loginSection,
    register: registerSection
  };
  if (!sections[sectionId]) {
    console.error('Invalid section ID:', sectionId);
    return showSection('login');
  }
  Object.values(sections).forEach(section => {
    if (section) {
      section.classList.toggle('active', section.id === sectionId);
    } else {
      console.error('Section DOM element not found:', sectionId);
    }
  });
  if (sectionId === 'subscriptions' && window.firebaseAuth?.currentUser) {
    fetchSubscriptions();
    fetchReferrals();
  }
}

// Wait for Firebase
async function waitForFirebase() {
  const maxAttempts = 30;
  let attempts = 0;
  while (!window.firebaseInitialized || !window.firebaseAuth || typeof window.firebaseAuth !== 'object') {
    if (attempts >= maxAttempts) {
      console.error('Firebase initialization timed out after', maxAttempts, 'attempts');
      loading.innerText = 'Authentication service unavailable. Please check your network or try again later.';
      loading.style.display = 'block';
      return false;
    }
    console.log('Waiting for Firebase auth, attempt', attempts + 1);
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }
  if (!window.firebaseInitialized) {
    console.error('Firebase initialized but window.firebaseInitialized is false');
    loading.innerText = 'Authentication service failed to initialize.';
    loading.style.display = 'block';
    return false;
  }
  console.log('Firebase auth ready');
  return true;
}

// Authentication
async function initializeAuth() {
  console.log('Starting auth initialization...');
  if (!(await waitForFirebase())) {
    console.error('Failed to initialize auth due to timeout or error');
    alert('Authentication service unavailable. Please try again later or contact support.');
    return;
  }
  const auth = window.firebaseAuth;
  if (!auth || typeof auth !== 'object') {
    console.error('Firebase Auth not initialized:', auth);
    loading.innerText = 'Authentication service unavailable';
    loading.style.display = 'block';
    return;
  }
  try {
    console.log('Setting up onAuthStateChanged...');
    onAuthStateChanged(auth, user => {
      console.log('Auth state changed:', user ? 'User logged in: ' + user.uid : 'No user');
      if (user) {
        authNav.innerHTML = `<a href="#logout">Logout</a>`;
        authNav.querySelector('a').addEventListener('click', () => {
          signOut(auth).catch(error => console.error('Sign out error:', error));
        });
        showSection('subscriptions');
      } else {
        authNav.innerHTML = `<a href="#login">Login</a>`;
        const sectionId = window.location.hash.slice(1) || 'login';
        showSection(sectionId);
      }
    });
  } catch (error) {
    console.error('Error setting up auth listener:', error);
    loading.innerText = 'Authentication error. Please try again.';
    loading.style.display = 'block';
  }
}

// Retry fetch with exponential backoff
async function fetchWithRetry(url, options, retries = 3, backoff = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP error! Status: ${response.status}, Response: ${text}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed for ${url}:`, error.message);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoff * Math.pow(2, i)));
      } else {
        throw error;
      }
    }
  }
}

// Fetch subscriptions
async function fetchSubscriptions() {
  loading.style.display = 'block';
  try {
    console.log('Fetching subscriptions from:', `${BACKEND_URL}/api/subscriptions`);
    const subscriptions = await fetchWithRetry(`${BACKEND_URL}/api/subscriptions`, {});
    if (!subscriptions || subscriptions.length === 0) {
      subscriptionsList.innerHTML = '<p>No subscriptions available</p>';
      return;
    }
    subscriptionsList.innerHTML = subscriptions.map(sub => `
      <div class="subscription-card">
        <h3>${sub.name}</h3>
        <p>£${sub.price}/month</p>
        <ul>${sub.features.map(f => `<li>${f}</li>`).join('')}</ul>
        <button class="subscribe-btn" data-sub-id="${sub._id}">Subscribe</button>
      </div>
    `).join('');
    document.querySelectorAll('.subscribe-btn').forEach(btn => {
      btn.addEventListener('click', () => subscribe(btn.dataset.subId));
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    subscriptionsList.innerHTML = `<p>Error loading subscriptions: ${error.message}</p>`;
  }
  loading.style.display = 'none';
}

// Subscribe with Stripe
async function subscribe(subscriptionId) {
  if (!(await waitForFirebase()) || !window.firebaseAuth?.currentUser) {
    alert('Please log in to subscribe');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const user = window.firebaseAuth.currentUser;
    const token = await user.getIdToken();
    console.log('Subscribing with user ID:', user.uid);
    const response = await fetchWithRetry(`${BACKEND_URL}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ subscriptionId, userId: user.uid })
    });
    const { sessionId } = response;
    await stripe.redirectToCheckout({ sessionId });
  } catch (error) {
    console.error('Subscription error:', error);
    alert('Error processing subscription: ' + error.message);
  }
  loading.style.display = 'none';
}

// City suggestions
async function fetchCitySuggestions(query) {
  try {
    const response = await fetchWithRetry(`${BACKEND_URL}/api/city-suggestions?query=${encodeURIComponent(query)}`, {});
    suggestionsContainer.innerHTML = response.map(s => `
      <div class="suggestion" data-city="${s.cityName}">
        ${s.cityName}, ${s.country}
      </div>
    `).join('');
    suggestionsContainer.style.display = response.length ? 'block' : 'none';
    document.querySelectorAll('.suggestion').forEach(item => {
      item.addEventListener('click', () => {
        destinationInput.value = item.dataset.city;
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.style.display = 'none';
        fetchDestinationSuggestions();
      });
    });
  } catch (error) {
    console.error('City suggestions error:', error.message);
    suggestionsContainer.innerHTML = `<p>Error loading suggestions: ${error.message}. Please try again.</p>`;
  }
}

// Destination suggestions
async function fetchDestinationSuggestions() {
  try {
    const response = await fetchWithRetry(`${BACKEND_URL}/api/destination-suggestions`, {});
    suggestionsContainer.innerHTML = response.map(s => `
      <div class="suggestion" data-city="${s.cityName}">
        ${s.cityName}, ${s.country} - £${(parseFloat(s.price) * 0.85).toFixed(2)} (Depart: ${s.departureDate}, Return: ${s.returnDate})
      </div>
    `).join('');
    suggestionsContainer.style.display = response.length ? 'block' : 'none';
    document.querySelectorAll('.suggestion').forEach(item => {
      item.addEventListener('click', () => {
        destinationInput.value = item.dataset.city;
        suggestionsContainer.innerHTML = '';
        suggestionsContainer.style.display = 'none';
      });
    });
  } catch (error) {
    console.error('Destination suggestions error:', error.message);
    suggestionsContainer.innerHTML = `<p>Error loading suggestions: ${error.message}. Please try again.</p>`;
  }
}

// Trigger city suggestions on input
destinationInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  if (query.length >= 1) {
    fetchCitySuggestions(query);
  } else {
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.style.display = 'none';
  }
});

// Trigger destination suggestions on focus if input is empty
destinationInput.addEventListener('focus', () => {
  if (!destinationInput.value.trim()) {
    fetchDestinationSuggestions();
  }
});

// Trip planner
tripPlannerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await waitForFirebase()) || !window.firebaseAuth?.currentUser) {
    alert('Please log in to plan a trip');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const user = window.firebaseAuth.currentUser;
    const token = await user.getIdToken();
    const formData = {
      destination: document.getElementById('destination').value,
      dates: document.getElementById('dates').value,
      preferences: document.getElementById('preferences').value,
      budget: parseFloat(document.getElementById('budget').value),
      allowTopUp: document.getElementById('allow-topup').checked,
      language: 'en'
    };
    console.log('Planning trip for user ID:', user.uid, 'with data:', formData);
    const plans = await fetchWithRetry(`${BACKEND_URL}/api/ai-trip-planner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(formData)
    });
    console.log('Trip plans received:', plans);
    tripResult.innerHTML = plans.map((plan, index) => `
      <div class="trip-plan">
        <h3>${plan.planType.charAt(0).toUpperCase() + plan.planType.slice(1)} Trip to ${plan.destination}</h3>
        ${plan.error ? `<p>Error: ${plan.error}</p>` : `
          <p>Cost: £${plan.cost.toFixed(2)}</p>
          <p>Price Status: ${plan.priceStatus === 'reasonable' ? 'Within average market rates' : 'Below average market rates'}</p>
          <p>Activities: ${plan.activities.join(', ')}</p>
          <p>Hotels: ${plan.hotels.join(', ')}</p>
          <p>Flights: ${plan.flights.join(', ')}</p>
          <p>Carbon Footprint: ${plan.carbonFootprint} kg</p>
          ${plan.topUpRequired ? `<p>Top-Up Required: £${plan.topUpAmount.toFixed(2)}</p><button onclick="topUp(${plan.topUpAmount}, '${user.uid}')">Top Up</button>` : ''}
        `}
      </div>
    `).join('');
  } catch (error) {
    console.error('Trip planner error:', error.message, error.stack);
    tripResult.innerHTML = `<p>Error planning trip: ${error.message}. Please try again later.</p>`;
  }
  loading.style.display = 'none';
});

// Top-up with Stripe
async function topUp(amount, userId) {
  if (!(await waitForFirebase()) || !window.firebaseAuth?.currentUser) {
    alert('Please log in to top up');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const token = await window.firebaseAuth.currentUser.getIdToken();
    console.log('Top-up for user ID:', userId, 'amount:', amount);
    const response = await fetchWithRetry(`${BACKEND_URL}/api/create-topup-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amount, userId })
    });
    const { sessionId } = response;
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
  if (!(await waitForFirebase()) || !window.firebaseAuth?.currentUser) {
    alert('Please log in to submit a referral');
    showSection('login');
    return;
  }
  loading.style.display = 'block';
  try {
    const user = window.firebaseAuth.currentUser;
    const token = await user.getIdToken();
    console.log('Submitting referral for user ID:', user.uid);
    const response = await fetchWithRetry(`${BACKEND_URL}/api/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ email: document.getElementById('referral-email').value })
    });
    await response;
    fetchReferrals();
  } catch (error) {
    console.error('Referral error:', error);
    referralsList.innerHTML = `<p>Error submitting referral: ${error.message}</p>`;
  }
  loading.style.display = 'none';
});

async function fetchReferrals() {
  if (!(await waitForFirebase()) || !window.firebaseAuth?.currentUser) {
    referralsList.innerHTML = '<p>Please log in to view referrals</p>';
    return;
  }
  loading.style.display = 'block';
  try {
    const user = window.firebaseAuth.currentUser;
    const token = await user.getIdToken();
    console.log('Fetching referrals for user ID:', user.uid);
    const referrals = await fetchWithRetry(`${BACKEND_URL}/api/referrals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
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
  if (!(await waitForFirebase()) || !window.firebaseAuth) {
    alert('Authentication service unavailable.');
    return;
  }
  loading.style.display = 'block';
  try {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    console.log('Login: Sending request to /api/login with email:', email);
    const response = await fetchWithRetry(`${BACKEND_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const { token, userId } = response;
    console.log('Login: Received Firebase custom token, user ID:', userId);
    try {
      const userCredential = await signInWithCustomToken(window.firebaseAuth, token);
      console.log('Login: Signed in with custom token, user:', userCredential.user.uid);
      showSection('subscriptions');
    } catch (authError) {
      console.error('Login: Firebase auth error:', authError.code, authError.message);
      throw new Error(`Firebase auth error: ${authError.message}`);
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed: ' + error.message);
  }
  loading.style.display = 'none';
});

// Register
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await waitForFirebase()) || !window.firebaseAuth) {
    alert('Authentication service unavailable.');
    return;
  }
  loading.style.display = 'block';
  try {
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    console.log('Register: Sending request to /api/register with email:', email);
    const response = await fetchWithRetry(`${BACKEND_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const { token, userId } = response;
    console.log('Register: Received Firebase custom token, user ID:', userId);
    try {
      const userCredential = await signInWithCustomToken(window.firebaseAuth, token);
      console.log('Register: Signed in with custom token, user:', userCredential.user.uid);
      showSection('subscriptions');
    } catch (authError) {
      console.error('Register: Firebase auth error:', authError.code, authError.message);
      throw new Error(`Firebase auth error: ${authError.message}`);
    }
  } catch (error) {
    console.error('Register error:', error);
    alert('Registration failed: ' + error.message);
  }
  loading.style.display = 'none';
});

// Get Started button
getStartedBtn.addEventListener('click', async () => {
  if (await waitForFirebase() && window.firebaseAuth?.currentUser) {
    showSection('subscriptions');
  } else {
    showSection('login');
  }
});

// Notification permission
if (window.firebaseMessaging && (await waitForFirebase())) {
  try {
    await window.firebaseMessaging.requestPermission();
    const token = await getToken(window.firebaseMessaging, { vapidKey: window.vapidKey });
    if (window.firebaseAuth?.currentUser) {
      const idToken = await window.firebaseAuth.currentUser.getIdToken();
      await fetchWithRetry(`${BACKEND_URL}/api/save-notification-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ token, userId: window.firebaseAuth.currentUser.uid })
      });
    }
  } catch (error) {
    console.error('Notification permission error:', error);
  }
}

initializeAuth();