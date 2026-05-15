export function formatToIST(timestamp) {
  if (!timestamp) return "";

  let date;

  if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp?.toDate === "function") {
    // Firestore Timestamp
    date = timestamp.toDate();
  } else if (typeof timestamp === "object" && typeof timestamp.seconds === "number") {
    // Serialized Firestore Timestamp-like object
    date = new Date(timestamp.seconds * 1000);
  } else if (typeof timestamp === "object" && typeof timestamp._seconds === "number") {
    date = new Date(timestamp._seconds * 1000);
  } else {
    date = new Date(timestamp);
  }

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

