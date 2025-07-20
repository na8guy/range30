import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

const BACKEND_URL = 'https://range30.onrender.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

async function fetchWithRetry(url, options, retries) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed:`, error.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw error;
      }
    }
  }
}

async function initializeFirebase() {
  try {
    console.log('Fetching Firebase config...');
    const firebaseConfig = await fetchWithRetry(`${BACKEND_URL}/api/firebase-config`, {}, MAX_RETRIES);
    console.log('Firebase config received:', firebaseConfig);
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
      throw new Error('Invalid Firebase config: missing required fields');
    }
    const app = initializeApp(firebaseConfig);
    console.log('Firebase app initialized:', app.name);
    const auth = getAuth(app);
    if (!auth) {
      throw new Error('Failed to initialize Firebase Auth');
    }
    const messaging = getMessaging(app);
    if (!messaging) {
      throw new Error('Failed to initialize Firebase Messaging');
    }
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseMessaging = messaging;
    window.vapidKey = firebaseConfig.vapidKey;
    window.firebaseInitialized = true;
    console.log('Firebase initialized successfully:', { auth: !!auth, messaging: !!messaging });
    console.log('Window objects after initialization:', {
      firebaseApp: !!window.firebaseApp,
      firebaseAuth: !!window.firebaseAuth,
      firebaseMessaging: !!window.firebaseMessaging,
      firebaseInitialized: window.firebaseInitialized
    });
  } catch (error) {
    console.error('Error initializing Firebase:', error.message);
    document.getElementById('loading').innerText = 'Failed to initialize authentication. Please try again later.';
    document.getElementById('loading').style.display = 'block';
    window.firebaseInitialized = false;
  }
}

initializeFirebase();