import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

const BACKEND_URL = 'https://range30.onrender.com';
try {
  const response = await fetch(`${BACKEND_URL}/api/firebase-config`);
  const firebaseConfig = await response.json();
  const app = initializeApp(firebaseConfig);
  window.firebaseApp = app;
  window.firebaseAuth = getAuth(app);
  window.firebaseMessaging = getMessaging(app);
  window.vapidKey = firebaseConfig.vapidKey;
} catch (error) {
  console.error('Error fetching Firebase config:', error);
  document.getElementById('loading').innerText = 'Error loading configuration';
  document.getElementById('loading').style.display = 'block';
}