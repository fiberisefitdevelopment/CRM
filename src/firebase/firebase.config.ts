import admin from 'firebase-admin';

let app: admin.app.App | null = null;

export function initializeFirebaseAdmin(): admin.app.App {
  // Check if app already exists in module cache (handles hot reloading in Next.js)
  if (app) {
    return app;
  }

  // Check if a default app already exists (handles Next.js hot reloading and multiple initializations)
  // admin.apps is an array that contains all initialized apps
  if (admin.apps.length > 0) {
    app = admin.apps[0] as admin.app.App;
    return app;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin SDK configuration is missing. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.'
    );
  }

  try {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
    return app;
  } catch (error: any) {
    // If app already exists error, try to get the existing app
    if (error?.code === 'app/duplicate-app' || error?.message?.includes('already exists')) {
      try {
        app = admin.app('[DEFAULT]');
        return app;
      } catch (getAppError) {
        // If getting app fails, try apps array
        if (admin.apps.length > 0) {
          app = admin.apps[0] as admin.app.App;
          return app;
        }
      }
    }
    console.error('❌ Firebase Admin SDK initialization error:', error);
    throw error;
  }
}

export function getFirebaseAdmin(): admin.app.App {
  if (!app) {
    return initializeFirebaseAdmin();
  }
  return app;
}

export function getMessaging(): admin.messaging.Messaging {
  const adminApp = getFirebaseAdmin();
  return admin.messaging(adminApp);
}
