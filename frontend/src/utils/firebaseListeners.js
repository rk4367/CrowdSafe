import { onSnapshot } from "firebase/firestore";

export function listenQuery(queryRef, onData, onError) {
  return onSnapshot(
    queryRef,
    (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(data);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

