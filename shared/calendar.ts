// Read-only Google Calendar state. OAuth tokens never appear in these types.
export type GoogleAccount = {
  id: string;
  email: string;
  status: "connected" | "reconnect" | "error";
  message: string | null;
  lastSyncAt: string | null;
  syncing: boolean;
  // Increases on every change, including sync start and finish.
  revision: number;
  calendars: Array<{ id: string; summary: string; primary: boolean }>;
};

// Timed events use UTC ISO instants; all-day events use exclusive-end dates.
export type AgendaEvent = {
  accountId: string;
  calendarId: string;
  id: string;
  icalUid: string | null;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
};

export type CalendarSnapshot = {
  configured: boolean;
  accounts: GoogleAccount[];
  events: AgendaEvent[];
};
