import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// This config ships to every browser. It is NOT a secret — firestore.rules is
// the only thing standing between it and your data.
export const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "fake-api-key",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "demo-apimock",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo-apimock.firebaseapp.com",
});
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
