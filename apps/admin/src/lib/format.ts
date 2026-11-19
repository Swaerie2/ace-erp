// Dates are shown in South African time wherever the server happens to run.
const ZONE = "Africa/Johannesburg";

const date = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: ZONE });
const dateTime = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: ZONE,
});

export const formatDate = (value: Date): string => date.format(value);
export const formatDateTime = (value: Date): string => dateTime.format(value);
