/**
 * Authentication Hook
 * Manages user authentication state and role
 */

import { useState, useEffect } from 'react';
import { onAuthStateChanged, auth, db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Get user role from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUser(firebaseUser);
            setRole(userData.role);
          } else {
            setUser(null);
            setRole(null);
          }
        } catch (error) {
          console.error('Error fetching user role:', error);
          setUser(null);
          setRole(null);
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });
    
    return unsubscribe;
  }, []);
  
  return { user, role, loading };
}

