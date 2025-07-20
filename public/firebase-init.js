import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

async function initFirebase() {
  try {
    const response = await fetch('/api/firebase-config');
    if (!response.ok) {
      throw new Error(`Failed to fetch Firebase config: ${response.status}`);
    }
    const firebaseConfig = await response.json();
    const app = initializeApp(firebaseConfig);
    window.firebaseAuth = getAuth(app);
    window.firebaseMessaging = getMessaging(app);
    window.vapidKey = firebaseConfig.vapidKey;
    window.firebaseInitialized = true;
    console.log('Firebase initialized successfully');
  } catch (error) {
    console.error('Firebase initialization error:', error);
    window.firebaseInitialized = false;
  }
}

initFirebase();

export { window as firebase }; // Export for module compatibility