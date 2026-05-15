/**
 * Firebase Configuration
 * Initialize Firebase services for authentication and Firestore
 * Note: Image storage is handled by Cloudinary (configured in backend)
 */

import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Validate configuration
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('Firebase configuration is missing. Please check your .env file.');
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Auth functions
export async function registerUser(email, password, name, role) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store role in Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email,
      name,
      role, // 'citizen' or 'authority'
      created_at: serverTimestamp()
    });
    
    return { user, role };
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
}

export async function loginUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Get role from Firestore
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      throw new Error('User document not found');
    }
    
    const userData = userDoc.data();
    const role = userData.role;
    
    return { user, role };
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
}

export async function getAuthToken() {
  const user = auth.currentUser;
  if (user) {
    return await user.getIdToken();
  }
  return null;
}

export async function updateUserProfile(uid, name, email = null) {
  try {
    const user = auth.currentUser;
    
    if (!user || user.uid !== uid) {
      throw new Error('User not authenticated');
    }
    
    // Update display name in Firebase Auth
    if (name) {
      await updateProfile(user, {
        displayName: name
      });
    }
    
    // Update email if provided
    if (email && email !== user.email) {
      await updateEmail(user, email);
    }
    
    // Update in Firestore
    const updateData = {
      updated_at: serverTimestamp()
    };
    
    if (name) {
      updateData.name = name;
    }
    
    if (email && email !== user.email) {
      updateData.email = email;
    }
    
    await updateDoc(doc(db, 'users', uid), updateData);
    
    return { success: true };
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
}

export async function changeUserPassword(currentPassword, newPassword) {
  try {
    const user = auth.currentUser;
    
    if (!user || !user.email) {
      throw new Error('User not authenticated');
    }
    
    // Re-authenticate user with current password
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    
    // Update password
    await updatePassword(user, newPassword);
    
    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);
    
    // Provide user-friendly error messages
    if (error.code === 'auth/wrong-password') {
      throw new Error('Current password is incorrect');
    } else if (error.code === 'auth/weak-password') {
      throw new Error('New password is too weak. Please use at least 6 characters');
    } else if (error.code === 'auth/requires-recent-login') {
      throw new Error('Please log out and log back in before changing your password');
    }
    
    throw error;
  }
}

export { auth, db, onAuthStateChanged };

