import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import { formatToIST } from '../../utils/time';

export default function MissingPersonHistory() {
  const { user } = useAuth();
  const [foundCases, setFoundCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const qFound = query(
      collection(db, 'missing_persons'),
      where('reported_by', '==', user.uid),
      where('status', '==', 'MATCH_CONFIRMED'),
      limit(200)
    );

    const unsub = onSnapshot(
      qFound,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const aMs = typeof a.updated_at?.toMillis === 'function' ? a.updated_at.toMillis() : new Date(a.updated_at || a.created_at).getTime();
          const bMs = typeof b.updated_at?.toMillis === 'function' ? b.updated_at.toMillis() : new Date(b.updated_at || b.created_at).getTime();
          return bMs - aMs;
        });
        setFoundCases(list);
        setLoading(false);
      },
      () => {
        setFoundCases([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  const count = useMemo(() => foundCases.length, [foundCases]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Found History</h2>
        <span className="text-sm text-gray-600">
          Total found: <span className="font-semibold text-gray-900">{count}</span>
        </span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {foundCases.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-xl font-semibold mb-2">No Found Cases Yet</h3>
            <p className="text-gray-600">When authorities confirm a match, it will appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {foundCases.map((person) => (
              <div key={person.id} className="border border-gray-200 rounded-xl p-4 bg-green-50 border-green-300">
                <div className="flex gap-4">
                  {person.photo_url && (
                    <img
                      src={person.photo_url}
                      alt={person.name || 'Missing person'}
                      loading="lazy"
                      className="w-20 h-20 rounded-xl object-cover bg-white ring-1 ring-green-200"
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-lg text-gray-900">{person.name || 'Unnamed'}</h3>
                        <p className="text-sm text-gray-700">
                          {person.age ? `${person.age} years old` : 'Age N/A'}
                          {person.gender ? ` • ${person.gender}` : ''}
                        </p>
                      </div>
                      <span className="px-3 py-1 bg-green-600 text-white rounded-full text-xs font-semibold">
                        FOUND
                      </span>
                    </div>

                    <p className="text-sm text-gray-700 mt-2">
                      📍 Last seen: {person.last_seen_location || 'N/A'}{person.last_seen_city ? `, ${person.last_seen_city}` : ''}
                    </p>

                    <p className="text-xs text-gray-600 mt-2">
                      Updated: {formatToIST(person.updated_at || person.last_updated || person.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

