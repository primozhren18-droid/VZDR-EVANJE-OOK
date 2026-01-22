import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwyF6wLkxeipZ0dyYea5JF5y5Cczkf_As",
  authDomain: "vzdr-evanje-ook.firebaseapp.com",
  projectId: "vzdr-evanje-ook",
  storageBucket: "vzdr-evanje-ook.appspot.com", 
  messagingSenderId: "116508236756",
  appId: "1:116508236756:web:9d6870e996f192e6251441"
};

export const fbApp = initializeApp(firebaseConfig);
export const auth = getAuth(fbApp);
export const db = getFirestore(fbApp);
export const storage = getStorage(fbApp);
