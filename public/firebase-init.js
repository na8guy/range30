import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getMessaging } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js';

async function fetchWithRetry(url, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Fetching Firebase config from ${url}, attempt ${attempt}`);
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        console.error('Failed to fetch Firebase config:', {
          status: response.status,
          statusText: response.statusText,
          responseText: text.slice(0, 100)
        });
        throw new Error(`Failed to fetch Firebase config: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Fetch attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function initFirebase() {
  try {
    const firebaseConfig = await fetchWithRetry('/api/firebase-config');
    console.log('Received Firebase config:', firebaseConfig);
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId || !firebaseConfig.vapidKey) {
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