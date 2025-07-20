import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

const BACKEND_URL = 'https://range30.onrender.com';

async function initializeFirebase() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    const response = await fetch(`${BACKEND_URL}/api/firebase-config`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const firebaseConfig = await response.json();
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      throw new Error('Invalid Firebase config');
    }
    const app = initializeApp(firebaseConfig);
    window.firebaseApp = app;
    window.firebaseAuth = getAuth(app);
    window.firebaseMessaging = getMessaging(app);
    window.vapidKey = firebaseConfig.vapidKey;
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    document.getElementById('loading').innerText = 'Failed to load configuration. Please try again later.';
    document.getElementById('loading').style.display = 'block';
  }
}

initializeFirebase();