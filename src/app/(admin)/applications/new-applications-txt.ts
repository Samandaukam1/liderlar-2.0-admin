type Contact = {
  full_name: string;
  phone: string | null;
  telegram: string | null;
};

function phoneNumber(value: string | null): string | null {
  const compact = (value ?? "").trim().replace(/[\s().-]/g, "");
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

export function telegramUsername(value: string | null): string | null {
  const raw = (value ?? "").trim();
  if (phoneNumber(raw)) return null;
  const link = /^(?:https?:\/\/)?t\.me\/([a-z0-9_]+)\/?$/i.exec(raw);
  const username = link?.[1] ?? raw.replace(/^@/, "");
  return /^[a-z][a-z0-9_]{4,31}$/i.test(username) ? `@${username}` : null;
}

type ExportCounts = { usernameCount: number; phoneCount: number };

/** Kelish tartibidagi arizalarni ikkita ro‘yxatga ajratib, har birining sanog‘ini davom ettiradi. */
export function formatNewApplications(rows: Contact[], previous: ExportCounts) {
  const usernames: string[] = [];
  const phoneContacts: string[] = [];

  for (const row of rows) {
    const username = telegramUsername(row.telegram);
    if (username) {
      usernames.push(`${previous.usernameCount + usernames.length + 1}. ${username}`);
      continue;
    }

    const name = row.full_name.trim().replace(/\s+/g, " ");
    const phone = phoneNumber(row.phone) ?? phoneNumber(row.telegram) ?? "telefon ko‘rsatilmagan";
    phoneContacts.push(`${previous.phoneCount + phoneContacts.length + 1}. ${name} — ${phone}`);
  }

  return {
    text: [
      "Telegram username bor",
      ...usernames,
      "",
      "Telegram username yo‘q",
      ...phoneContacts,
      "",
    ].join("\n"),
    usernameCount: previous.usernameCount + usernames.length,
    phoneCount: previous.phoneCount + phoneContacts.length,
  };
}
