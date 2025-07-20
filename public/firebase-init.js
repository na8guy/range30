import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

async function initFirebase() {
  try {
    console.log('Fetching Firebase config from /api/firebase-config');
    const response = await fetch('/api/firebase-config');
    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to fetch Firebase config:', {
        status: response.status,
        statusText: response.statusText,
        responseText: text.slice(0, 100)
      });
      throw new Error(`Failed to fetch Firebase config: ${response.status} ${response.statusText}`);
    }
    const firebaseConfig = await response.json();
    console.log('Received Firebase config:', firebaseConfig);
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
      throw new Error('Invalid Firebase config: missing required fields');
    }
    const app = initializeApp(firebaseConfig);
    window.firebaseAuth = getAuth(app);
    window.firebaseMessaging = getMessaging(app);
    window.vapidKey = firebaseConfig.vapidKey;
    window.firebaseInitialized = true;
    console.log('Firebase initialized successfully');
  } catch (error) {
    console.error('Firebase initialization error:', error.message);
    window.firebaseInitialized = false;
  }
}

initFirebase();

export { window as firebase };